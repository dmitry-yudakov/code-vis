import { getProjectFiles, openFile, saveFile, watchDirectory } from './io';
import {
  ChangeSet,
  ChangeSource,
  ChangeSourceRequest,
  ChangedFileInfo,
  ChangedFileStatus,
  FileIncludeInfo,
  FileMapping,
  FocusedFileInfo,
  FocusedReviewMap,
  ProjectChangeEvent,
  ProjectConfig,
  RelatedReason,
} from './types';
import { getAnalyzer } from './analyzers';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const changeStatusPriority: Record<ChangedFileStatus, number> = {
  modified: 1,
  added: 2,
  renamed: 3,
  deleted: 4,
};

const mergeChangedFileStatus = (
  map: Map<string, ChangedFileInfo>,
  filename: string,
  status: ChangedFileStatus
) => {
  const prev = map.get(filename);
  if (
    !prev ||
    changeStatusPriority[status] >= changeStatusPriority[prev.status]
  ) {
    map.set(filename, { filename, status });
  }
};

const classifyPorcelainStatus = (status: string): ChangedFileStatus => {
  if (status === '??' || status.includes('A')) return 'added';
  if (status.includes('R')) return 'renamed';
  if (status.includes('D')) return 'deleted';
  return 'modified';
};

const parsePorcelainOutput = (output: string): ChangedFileInfo[] => {
  const map = new Map<string, ChangedFileInfo>();

  for (const line of output.split('\n')) {
    if (!line) continue;

    const status = line.slice(0, 2);
    if (status === '!!') continue;

    const payload = line.slice(3).trim();
    if (!payload) continue;

    if (payload.includes(' -> ')) {
      const parts = payload.split(' -> ');
      const renamedTo = parts[parts.length - 1].trim();
      if (renamedTo) mergeChangedFileStatus(map, renamedTo, 'renamed');
      continue;
    }

    mergeChangedFileStatus(map, payload, classifyPorcelainStatus(status));
  }

  return Array.from(map.values()).sort((a, b) =>
    a.filename.localeCompare(b.filename)
  );
};

const classifyNameStatus = (status: string): ChangedFileStatus => {
  if (status.startsWith('A')) return 'added';
  if (status.startsWith('R')) return 'renamed';
  if (status.startsWith('D')) return 'deleted';
  return 'modified';
};

const parseNameStatusOutput = (output: string): ChangedFileInfo[] => {
  const map = new Map<string, ChangedFileInfo>();

  for (const line of output.split('\n')) {
    if (!line) continue;

    const parts = line.split('\t');
    const status = (parts[0] || '').trim();
    if (!status) continue;

    const filename = status.startsWith('R')
      ? (parts[2] || '').trim()
      : (parts[1] || '').trim();
    if (!filename) continue;

    mergeChangedFileStatus(map, filename, classifyNameStatus(status));
  }

  return Array.from(map.values()).sort((a, b) =>
    a.filename.localeCompare(b.filename)
  );
};

const hasReason = (reasons: RelatedReason[], reason: RelatedReason): boolean =>
  reasons.some((item) => item.type === reason.type && item.via === reason.via);

export default class Project {
  public files: string[] = [];
  public projectMap: FileIncludeInfo[] = [];
  public hideFilesMasks: { [k: string]: RegExp } = {};

  constructor(
    private projectPath: string,
    private config: ProjectConfig
  ) {
    this.reloadProject();
  }

  processCommand = async (type: string, payload: any | undefined) => {
    // let tokens = type.split(' ').filter((word) => word);
    console.log('Process command', { type, payload });

    switch (type) {
      case 'mapProject':
        return this.handleCommandProjectMap();
      case 'mapFile':
        return this.handleCommandFileMap(
          payload.filename,
          payload.includeRelated
        );
      case 'saveFile':
        return this.handleCommandSaveFile(
          payload.filename,
          payload.content,
          payload.pos,
          payload.end
        );
      case 'mapFocusedReview':
        return this.handleCommandFocusedReview(payload?.source);
      default:
        throw new Error('Could not recognize command: "' + type + '"');
    }
    // case 'hide': {
    //   const maskName = tokens.join('|');
    //   const what = tokens.shift();
    //   let reString;
    //   if (what === 'directory') {
    //     reString = `^.*${tokens.join('.*')}\/`;
    //   } else if (what === 'file') {
    //     reString = `^.*${['/', ...tokens].join('.*')}[^/]`;
    //   } else {
    //     return unrecognized();
    //   }
    //   console.log('Ignore regex', reString);
    //   this.hideFilesMasks[maskName] = new RegExp(reString, 'i');

    //   return this.projectMap();
    // }
  };

  watch(callback: (e: ProjectChangeEvent) => void) {
    watchDirectory(this.projectPath, async (e) => {
      console.log('Watcher:', e);
      // switch (e.type) {
      //   case 'add':
      //   case 'remove':
      // even file change could contain changes for import, so reload is needed, TODO better
      this.reloadProject();
      await this.recreateProjectMap();
      //     break;
      // }
      callback(e);
    });
  }

  reloadProject() {
    this.files = getProjectFiles(
      this.projectPath,
      this.config.includeMask,
      this.config.excludeMask
    );
    console.log('Project files:', this.files);
    console.log(
      'Loaded total',
      this.files.length,
      'files from',
      this.projectPath,
      'config:',
      this.config
    );
  }

  async recreateProjectMap() {
    console.log('recreateProjectMap called, files count:', this.files.length);
    const analyzer = getAnalyzer('js'); // temp
    // TODO check should ignore
    this.projectMap = await analyzer.extractFilesHierarchy(this.files, (fn) =>
      openFile(fn, this.projectPath)
    );
    console.log(
      'recreateProjectMap completed, projectMap length:',
      this.projectMap.length
    );
  }
  async handleCommandProjectMap() {
    console.log(
      'handleCommandProjectMap called, current projectMap length:',
      this.projectMap.length
    );
    await this.recreateProjectMap();

    // console.log(data);
    console.log(
      'handleCommandProjectMap returning, projectMap length:',
      this.projectMap.length
    );
    return { type: 'projectMap', payload: this.projectMap };
  }

  private async runGit(args: string[]): Promise<string> {
    const command = `git ${args.join(' ')}`;
    try {
      const { stdout } = await execFileAsync('git', args, {
        cwd: this.projectPath,
        maxBuffer: 10 * 1024 * 1024,
      });
      return stdout.toString();
    } catch (error: any) {
      const stderr = error?.stderr ? error.stderr.toString() : '';
      throw new Error(
        `Git command failed (${command}): ${stderr || error.message}`
      );
    }
  }

  private async tryRunGit(args: string[]): Promise<string | null> {
    try {
      return await this.runGit(args);
    } catch {
      return null;
    }
  }

  private async resolveDefaultBaseRef(): Promise<string> {
    const originHead = await this.tryRunGit([
      'symbolic-ref',
      '--quiet',
      'refs/remotes/origin/HEAD',
    ]);
    if (originHead) {
      return originHead.trim().replace(/^refs\/remotes\//, '');
    }

    const candidates = ['origin/main', 'origin/master', 'main', 'master'];
    for (const candidate of candidates) {
      const check = await this.tryRunGit([
        'rev-parse',
        '--verify',
        '--quiet',
        candidate,
      ]);
      if (check !== null) return candidate;
    }

    return 'master';
  }

  private async getDiffChangeSet(): Promise<ChangeSet> {
    const output = await this.runGit(['status', '--porcelain']);
    return {
      source: { mode: 'diff' },
      files: parsePorcelainOutput(output),
    };
  }

  private async getBranchChangeSet(baseRef?: string): Promise<ChangeSet> {
    const resolvedBaseRef = baseRef || (await this.resolveDefaultBaseRef());
    const mergeBase = (
      await this.runGit(['merge-base', 'HEAD', resolvedBaseRef])
    ).trim();

    const output = await this.runGit([
      'diff',
      '--name-status',
      '--find-renames',
      mergeBase,
      'HEAD',
    ]);

    return {
      source: { mode: 'branch', baseRef: resolvedBaseRef },
      files: parseNameStatusOutput(output),
    };
  }

  private buildFocusedReviewMap(changeSet: ChangeSet): FocusedReviewMap {
    const focusedFiles = new Map<string, FocusedFileInfo>();

    const ensureFocusedFile = (filename: string): FocusedFileInfo => {
      const existing = focusedFiles.get(filename);
      if (existing) return existing;

      const created: FocusedFileInfo = {
        filename,
        reasons: [],
        isChanged: false,
      };
      focusedFiles.set(filename, created);
      return created;
    };

    const addReason = (filename: string, reason: RelatedReason) => {
      const info = ensureFocusedFile(filename);
      if (!hasReason(info.reasons, reason)) {
        info.reasons.push(reason);
      }
    };

    const changedFiles = new Set<string>();

    for (const changed of changeSet.files) {
      changedFiles.add(changed.filename);
      const info = ensureFocusedFile(changed.filename);
      info.isChanged = true;
      info.changeStatus = changed.status;
      if (!hasReason(info.reasons, { type: 'changed' })) {
        info.reasons.push({ type: 'changed' });
      }
    }

    for (const edge of this.projectMap) {
      if (changedFiles.has(edge.from)) {
        addReason(edge.to, {
          type: 'imports-changed',
          via: edge.from,
        });
      }

      if (changedFiles.has(edge.to)) {
        addReason(edge.from, {
          type: 'imported-by-changed',
          via: edge.to,
        });
      }
    }

    const visibleFiles = new Set(focusedFiles.keys());
    const focusedIncludes = this.projectMap.filter(
      (edge) => visibleFiles.has(edge.from) && visibleFiles.has(edge.to)
    );

    const files = Array.from(focusedFiles.values()).sort((a, b) => {
      if (a.isChanged !== b.isChanged) return a.isChanged ? -1 : 1;
      return a.filename.localeCompare(b.filename);
    });

    return {
      changeSet,
      files,
      includes: focusedIncludes,
    };
  }

  async handleCommandFocusedReview(source: ChangeSourceRequest | undefined) {
    this.reloadProject();
    await this.recreateProjectMap();

    const requestedSource: ChangeSourceRequest = source || { mode: 'diff' };
    const changeSet: ChangeSet =
      requestedSource.mode === 'branch'
        ? await this.getBranchChangeSet(requestedSource.baseRef)
        : await this.getDiffChangeSet();

    const payload = this.buildFocusedReviewMap(changeSet);

    return {
      type: 'focusedReviewMap',
      payload,
    };
  }

  async handleCommandFileMap(filename: string, includeRelated = false) {
    console.log('fileMap command', { filename, includeRelated });
    const analyzer = getAnalyzer('js'); // temp
    const content = await openFile(filename, this.projectPath);

    if (!content) throw new Error('File not found');

    const mapping: FileMapping = analyzer.extractFileMapping(
      filename,
      content,
      this.files
    );
    const payload = [{ content, mapping, filename }];

    if (includeRelated) {
      for (const fnm of mapping.includes.map((ii) => ii.from)) {
        const cont = await openFile(fnm, this.projectPath);
        const mpng = analyzer.extractFileMapping(fnm, cont, this.files);

        payload.push({ content: cont, mapping: mpng, filename: fnm });
      }

      for (const fnm of this.projectMap
        .filter((ii) => ii.from === filename)
        .map((ii) => ii.to)) {
        const cont = await openFile(fnm, this.projectPath);
        const mpng = analyzer.extractFileMapping(fnm, cont, this.files);

        payload.push({ content: cont, mapping: mpng, filename: fnm });
      }
    }

    return {
      type: 'fileMap',
      payload,
    };
  }

  async handleCommandSaveFile(
    filename: string,
    content: string,
    pos: number | undefined,
    end: number | undefined
  ) {
    console.log('handle saveFile', { filename, pos, end }, content);
    if (filename.includes('..')) throw new Error('Filename should not have ..');

    let content2save = content;

    if (pos !== undefined) {
      const fileContent = await openFile(filename, this.projectPath);
      content2save =
        fileContent.slice(0, pos) + content + fileContent.slice(end);
    }

    await saveFile(filename, this.projectPath, content2save);
  }

  shouldIgnoreFile = (filePath: string) =>
    Object.entries(this.hideFilesMasks).some(([key, re]) => {
      if (re.test(filePath)) {
        console.log('ignore', filePath, key, re);
        return true;
      }
      return false;
    });
}
