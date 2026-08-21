import { promises as fs } from 'fs';
import path from 'path';
import { defaultConfig, loadConfiguration } from './io';
import Project from './project';
import {
  OpenProjectResponse,
  ProjectChangeEvent,
  ProjectInfo,
  ProjectListResponse,
} from './types';

const HIDDEN_PROJECT_DIRS = new Set([
  '.git',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
]);
const PROJECT_MARKERS = [
  'package.json',
  'tsconfig.json',
  'jsconfig.json',
  'yarn.lock',
  'package-lock.json',
  'pnpm-lock.yaml',
  '.git',
];

type LoadedProject = {
  project: Project;
  stopWatching: () => void;
};

type ProjectRegistryOptions = {
  forceProjectsDirectory?: boolean;
  discoveryDepth?: number;
  onProjectChange?: (event: ProjectChangeEvent) => void;
};

const normalizeDiscoveryDepth = (depth?: number): number => {
  if (depth === undefined || !Number.isFinite(depth)) return 1;
  return Math.max(1, Math.floor(depth));
};

const projectIdFromPath = (projectPath: string): string =>
  encodeURIComponent(path.resolve(projectPath));

const isHiddenProjectDirectory = (name: string): boolean =>
  name.startsWith('.') || HIDDEN_PROJECT_DIRS.has(name);

const hasProjectMarker = async (directoryPath: string): Promise<boolean> => {
  for (const marker of PROJECT_MARKERS) {
    try {
      await fs.access(path.join(directoryPath, marker));
      return true;
    } catch {
      // Keep probing the small marker list.
    }
  }

  return false;
};

const readChildDirectories = async (rootPath: string): Promise<string[]> => {
  const entries = await fs.readdir(rootPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !isHiddenProjectDirectory(name))
    .sort((left, right) => left.localeCompare(right));
};

export default class ProjectRegistry {
  private projects: ProjectInfo[] = [];
  private activeProjectId: string | undefined;
  private loadedProject: LoadedProject | undefined;
  private discoveryDepth: number;

  constructor(
    private rootPath: string,
    private options: ProjectRegistryOptions = {}
  ) {
    this.rootPath = path.resolve(rootPath);
    this.discoveryDepth = normalizeDiscoveryDepth(options.discoveryDepth);
  }

  async initialize(): Promise<void> {
    const projectPaths = await this.discoverProjectPaths();
    this.projects = await Promise.all(
      projectPaths.map((projectPath) => this.createProjectInfo(projectPath))
    );
    this.sortProjects();
  }

  getProjectList(): ProjectListResponse {
    return {
      rootPath: this.rootPath,
      projects: this.projects.map((project) => ({
        ...project,
        isActive: project.id === this.activeProjectId,
      })),
      activeProjectId: this.activeProjectId,
    };
  }

  hasSingleProject(): boolean {
    return this.projects.length === 1;
  }

  getSingleProjectId(): string | undefined {
    return this.projects[0]?.id;
  }

  getActiveProjectInfo(): ProjectInfo | undefined {
    return this.projects.find((project) => project.id === this.activeProjectId);
  }

  async openProject(projectId: string): Promise<OpenProjectResponse> {
    const projectInfo = this.findProject(projectId);
    await this.activateProject(projectInfo);

    const loaded = this.loadedProject;
    if (!loaded) {
      throw new Error('Project failed to load');
    }

    await loaded.project.recreateProjectMap();
    const activeProjectInfo = this.getActiveProjectInfo() || projectInfo;

    return {
      ...this.getProjectList(),
      project: {
        ...activeProjectInfo,
        isActive: true,
      },
      projectMap: loaded.project.projectMap,
    };
  }

  async processActiveProjectCommand(
    type: string,
    payload: any | undefined
  ): Promise<{ type: string; payload: unknown } | void> {
    const loaded = this.loadedProject;
    if (!loaded || !this.activeProjectId) {
      throw new Error('No project is open. Select a project first.');
    }

    return loaded.project.processCommand(type, payload);
  }

  private async discoverProjectPaths(): Promise<string[]> {
    const childDirectories = await readChildDirectories(this.rootPath);
    const rootIsProject =
      !this.options.forceProjectsDirectory &&
      (await hasProjectMarker(this.rootPath));

    if (rootIsProject || childDirectories.length === 0) {
      return [this.rootPath];
    }

    const childProjectPaths = childDirectories.map((name) =>
      path.join(this.rootPath, name)
    );
    const markedProjectPaths = await this.findMarkedProjectPaths(
      childProjectPaths,
      this.discoveryDepth
    );

    return markedProjectPaths.length > 0 ? markedProjectPaths : childProjectPaths;
  }

  private async findMarkedProjectPaths(
    childProjectPaths: string[],
    maxDepth: number
  ): Promise<string[]> {
    const markedProjectPaths: string[] = [];
    const queue = childProjectPaths.map((projectPath) => ({
      projectPath,
      depth: 1,
    }));

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) continue;

      if (await hasProjectMarker(current.projectPath)) {
        markedProjectPaths.push(current.projectPath);
      }

      if (current.depth >= maxDepth) continue;

      let childDirectories: string[] = [];
      try {
        childDirectories = await readChildDirectories(current.projectPath);
      } catch {
        continue;
      }

      queue.push(
        ...childDirectories.map((name) => ({
          projectPath: path.join(current.projectPath, name),
          depth: current.depth + 1,
        }))
      );
    }

    return markedProjectPaths.sort((left, right) => left.localeCompare(right));
  }

  private async createProjectInfo(projectPath: string): Promise<ProjectInfo> {
    const resolvedPath = path.resolve(projectPath);
    const stats = await fs.stat(resolvedPath);
    const relativePath = path.relative(this.rootPath, resolvedPath);
    const normalizedRelativePath = relativePath.split(path.sep).join('/');

    return {
      id: projectIdFromPath(resolvedPath),
      name: normalizedRelativePath || path.basename(resolvedPath),
      path: resolvedPath,
      relativePath: normalizedRelativePath,
      rootPath: this.rootPath,
      mtimeMs: stats.mtimeMs,
      mtime: stats.mtime.toISOString(),
    };
  }

  private findProject(projectId: string): ProjectInfo {
    const projectInfo = this.projects.find((project) => project.id === projectId);
    if (!projectInfo) {
      throw new Error(`Unknown project: ${projectId}`);
    }

    return projectInfo;
  }

  private async activateProject(projectInfo: ProjectInfo): Promise<void> {
    if (this.activeProjectId === projectInfo.id && this.loadedProject) {
      this.touchProject(projectInfo.id);
      return;
    }

    if (this.loadedProject) {
      this.loadedProject.stopWatching();
      this.loadedProject = undefined;
    }

    const config = await loadConfiguration(projectInfo.path);
    const project = new Project(projectInfo.path, config || defaultConfig);
    const stopWatching = project.watch((event) => {
      this.refreshProjectMtime(projectInfo.id);
      this.options.onProjectChange?.({
        ...event,
        projectId: projectInfo.id,
        projectName: projectInfo.name,
        projectPath: projectInfo.path,
      });
    });

    this.activeProjectId = projectInfo.id;
    this.loadedProject = { project, stopWatching };
    this.touchProject(projectInfo.id);
  }

  private touchProject(projectId: string) {
    const openedAt = new Date().toISOString();
    this.projects = this.projects.map((project) =>
      project.id === projectId
        ? { ...project, lastOpenedAt: openedAt, isActive: true }
        : { ...project, isActive: false }
    );
    this.sortProjects();
  }

  private refreshProjectMtime(projectId: string) {
    const project = this.projects.find((item) => item.id === projectId);
    if (!project) return;

    fs.stat(project.path)
      .then((stats) => {
        this.projects = this.projects.map((item) =>
          item.id === projectId
            ? {
                ...item,
                mtimeMs: stats.mtimeMs,
                mtime: stats.mtime.toISOString(),
              }
            : item
        );
        this.sortProjects();
      })
      .catch(() => {
        // Project list remains usable even if a directory disappears mid-session.
      });
  }

  private sortProjects() {
    this.projects = [...this.projects].sort((left, right) => {
      const leftOpened = left.lastOpenedAt ? Date.parse(left.lastOpenedAt) : 0;
      const rightOpened = right.lastOpenedAt ? Date.parse(right.lastOpenedAt) : 0;
      if (leftOpened !== rightOpened) return rightOpened - leftOpened;
      if (left.mtimeMs !== right.mtimeMs) return right.mtimeMs - left.mtimeMs;
      return left.name.localeCompare(right.name);
    });
  }
}
