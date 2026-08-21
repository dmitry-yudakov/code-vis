import { createHash } from 'node:crypto';
import { readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { ProjectSummary, ServerProject } from '@/shared/types';

const PROJECT_MARKERS = [
  '.git', 'package.json', 'tsconfig.json', 'jsconfig.json', 'yarn.lock', 'package-lock.json',
  'pnpm-lock.yaml', 'pyproject.toml', 'go.mod', 'Cargo.toml', 'pom.xml',
];
const IGNORED = new Set(['node_modules', 'dist', 'build', 'coverage', '.next', '.next-e2e', 'out', 'target']);

function isContained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function isProject(directory: string): Promise<boolean> {
  const names = new Set((await readdir(directory).catch(() => [])).map((entry) => entry.toString()));
  return PROJECT_MARKERS.some((marker) => names.has(marker));
}

async function childDirectories(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && !IGNORED.has(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

function projectId(realPath: string): string {
  return createHash('sha256').update(realPath).digest('base64url').slice(0, 22);
}

export class ProjectRegistry {
  private rootRealPath?: string;
  private projects = new Map<string, ServerProject>();

  constructor(
    private readonly configuredRoot: string,
    private readonly discoveryDepth = 1,
  ) {
    if (!Number.isSafeInteger(discoveryDepth) || discoveryDepth < 1 || discoveryDepth > 10) {
      throw new Error('Project discovery depth must be an integer between 1 and 10');
    }
  }

  async refresh(): Promise<ServerProject[]> {
    const root = await realpath(this.configuredRoot);
    if (!(await stat(root)).isDirectory()) throw new Error('Projects root is not a directory');
    this.rootRealPath = root;

    const candidates: Array<{ realPath: string; relativePath: string }> = [];
    if (await isProject(root)) {
      candidates.push({ realPath: root, relativePath: '.' });
    } else {
      const immediateChildren = await childDirectories(root);
      const queue = immediateChildren.map((name) => ({ directory: path.join(root, name), depth: 1 }));
      while (queue.length) {
        const current = queue.shift()!;
        const candidate = await realpath(current.directory).catch(() => undefined);
        if (!candidate || !isContained(root, candidate)) continue;
        if (await isProject(candidate)) {
          candidates.push({ realPath: candidate, relativePath: path.relative(root, candidate).split(path.sep).join('/') });
        }
        if (current.depth >= this.discoveryDepth) continue;
        const nested = await childDirectories(candidate).catch(() => []);
        queue.push(...nested.map((name) => ({ directory: path.join(candidate, name), depth: current.depth + 1 })));
      }
      if (!candidates.length) {
        for (const name of immediateChildren) {
          const candidate = await realpath(path.join(root, name)).catch(() => undefined);
          if (candidate && isContained(root, candidate)) candidates.push({ realPath: candidate, relativePath: name });
        }
      }
    }

    this.projects.clear();
    for (const candidate of candidates.sort((a, b) => a.relativePath.localeCompare(b.relativePath))) {
      const project: ServerProject = {
        id: projectId(candidate.realPath),
        name: candidate.relativePath === '.' ? path.basename(candidate.realPath) : candidate.relativePath,
        relativePath: candidate.relativePath,
        realPath: candidate.realPath,
      };
      this.projects.set(project.id, project);
    }
    return [...this.projects.values()];
  }

  async list(): Promise<ProjectSummary[]> {
    const projects = await this.refresh();
    return projects.map(({ id, name, relativePath }) => ({ id, name, relativePath }));
  }

  async resolve(id: string): Promise<ServerProject> {
    await this.refresh();
    const project = this.projects.get(id);
    if (!project || !this.rootRealPath) throw new Error('Unknown project');
    const current = await realpath(project.realPath);
    if (!isContained(this.rootRealPath, current) || current !== project.realPath) {
      throw new Error('Project no longer resolves within the configured root');
    }
    return project;
  }
}

let singleton: ProjectRegistry | undefined;
let singletonKey: string | undefined;

export function getProjectRegistry(root: string, discoveryDepth = 1): ProjectRegistry {
  const key = `${root}\0${discoveryDepth}`;
  if (!singleton || singletonKey !== key) {
    singleton = new ProjectRegistry(root, discoveryDepth);
    singletonKey = key;
  }
  return singleton;
}
