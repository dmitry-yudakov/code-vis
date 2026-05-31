import { getProjectFiles, openFile, saveFile, watchDirectory } from './io';
import {
  ChangeSet,
  ChangeSource,
  ChangeSourceRequest,
  ChangedFileInfo,
  ChangedFileStatus,
  CommitSummary,
  FileIncludeInfo,
  FileMapping,
  FocusedDeclarationCallInfo,
  FocusedDeclarationInfo,
  FocusedDeclarationReason,
  FocusedFileInfo,
  FocusedReviewOptions,
  FocusedReviewMap,
  FunctionCallInfo,
  FunctionDeclarationInfo,
  ProjectChangeEvent,
  ProjectConfig,
  RelatedReason,
} from './types';
import { getAnalyzer } from './analyzers';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const MAX_DECLARATION_BRIDGE_DEPTH = 3;
const MAX_DECLARATION_BRIDGE_PATHS = 24;

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
    map.set(filename, { ...prev, filename, status });
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

const parseCommitLogOutput = (output: string): CommitSummary[] =>
  output
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [hash, shortHash, timestamp, authorName, ...subjectParts] =
        line.split('\x1f');
      return {
        hash,
        shortHash,
        timestamp: Number(timestamp),
        authorName,
        subject: subjectParts.join('\x1f'),
      };
    })
    .filter((commit) => !!commit.hash);

const hasReason = (reasons: RelatedReason[], reason: RelatedReason): boolean =>
  reasons.some((item) => item.type === reason.type && item.via === reason.via);

const basename = (filename: string): string => {
  const normalized = filename.replace(/\\/g, '/');
  return normalized.slice(normalized.lastIndexOf('/') + 1);
};

const stripSourceExtension = (filename: string): string =>
  filename.replace(/\.[jt]sx?$/i, '');

const isTestFile = (filename: string): boolean => {
  const normalized = filename.replace(/\\/g, '/');
  const name = basename(normalized);

  return (
    /\.(test|spec)\.[jt]sx?$/i.test(name) ||
    /(^|\/)(__tests__|tests?|spec)\//i.test(normalized)
  );
};

const normalizeTestPartnerPath = (filename: string): string => {
  let stem = stripSourceExtension(filename.replace(/\\/g, '/'));
  stem = stem.replace(/(^|\/)__tests__\//gi, '$1');
  stem = stem.replace(/\/(tests?|spec)\//gi, '/');
  stem = stem.replace(/\.(test|spec)$/i, '');
  return stem;
};

const areLikelyTestPartners = (
  testFilename: string,
  sourceFilename: string
): boolean => {
  if (!isTestFile(testFilename) || isTestFile(sourceFilename)) return false;

  const testStem = normalizeTestPartnerPath(testFilename);
  const sourceStem = normalizeTestPartnerPath(sourceFilename);
  if (testStem === sourceStem) return true;

  const testBase = basename(testStem);
  const sourceBase = basename(sourceStem);
  return (
    sourceBase.length > 2 &&
    sourceBase !== 'index' &&
    testBase === sourceBase
  );
};

type LineRange = { start: number; end: number };

type DiffLineRanges = {
  addedLines: LineRange[];
  removedLines: LineRange[];
};

const createEmptyDiffLineRanges = (): DiffLineRanges => ({
  addedLines: [],
  removedLines: [],
});

const hasLineRange = (ranges: LineRange[], range: LineRange): boolean =>
  ranges.some((item) => item.start === range.start && item.end === range.end);

const addLineRange = (ranges: LineRange[], range: LineRange) => {
  if (range.start <= 0 || range.end < range.start) return;
  if (!hasLineRange(ranges, range)) {
    ranges.push(range);
  }
};

const sortLineRanges = (ranges: LineRange[]) =>
  ranges.sort((left, right) => left.start - right.start || left.end - right.end);

const stripDiffFilename = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '/dev/null') return null;
  return trimmed.replace(/^[ab]\//, '').replace(/^"|"$/g, '');
};

const parseUnifiedDiffLineRanges = (output: string): Map<string, DiffLineRanges> => {
  const byFilename = new Map<string, DiffLineRanges>();
  let oldFilename: string | null = null;
  let newFilename: string | null = null;

  const ensureRanges = (filename: string): DiffLineRanges => {
    const existing = byFilename.get(filename);
    if (existing) return existing;

    const created = createEmptyDiffLineRanges();
    byFilename.set(filename, created);
    return created;
  };

  for (const line of output.split('\n')) {
    const diffHeader = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (diffHeader) {
      oldFilename = stripDiffFilename(`a/${diffHeader[1]}`);
      newFilename = stripDiffFilename(`b/${diffHeader[2]}`);
      continue;
    }

    if (line.startsWith('--- ')) {
      oldFilename = stripDiffFilename(line.slice(4));
      continue;
    }

    if (line.startsWith('+++ ')) {
      newFilename = stripDiffFilename(line.slice(4));
      continue;
    }

    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!hunk) continue;

    const filename = newFilename || oldFilename;
    if (!filename) continue;

    const oldStart = Number(hunk[1]);
    const oldCount = hunk[2] === undefined ? 1 : Number(hunk[2]);
    const newStart = Number(hunk[3]);
    const newCount = hunk[4] === undefined ? 1 : Number(hunk[4]);
    const ranges = ensureRanges(filename);

    // For declaration mapping, pure deletions need a new-file anchor too.
    if (newStart > 0 && (newCount > 0 || oldCount > 0)) {
      addLineRange(ranges.addedLines, {
        start: newStart,
        end: newStart + Math.max(newCount, 1) - 1,
      });
    }

    if (oldStart > 0 && oldCount > 0) {
      addLineRange(ranges.removedLines, {
        start: oldStart,
        end: oldStart + oldCount - 1,
      });
    }
  }

  byFilename.forEach((ranges) => {
    sortLineRanges(ranges.addedLines);
    sortLineRanges(ranges.removedLines);
  });

  return byFilename;
};

const mergeDiffLineRanges = (
  changes: Map<string, ChangedFileInfo>,
  rangesByFilename: Map<string, DiffLineRanges>
) => {
  rangesByFilename.forEach((ranges, filename) => {
    const info = changes.get(filename) || {
      filename,
      status: 'modified' as ChangedFileStatus,
    };

    const addedLines = info.addedLines || [];
    const removedLines = info.removedLines || [];

    ranges.addedLines.forEach((range) => addLineRange(addedLines, range));
    ranges.removedLines.forEach((range) => addLineRange(removedLines, range));

    changes.set(filename, {
      ...info,
      addedLines: addedLines.length > 0 ? sortLineRanges(addedLines) : undefined,
      removedLines:
        removedLines.length > 0 ? sortLineRanges(removedLines) : undefined,
    });
  });
};

const countLines = (content: string): number => {
  if (content.length === 0) return 0;
  return content.split(/\r\n|\r|\n/).length;
};

const rangesOverlap = (left: LineRange, right: LineRange): boolean =>
  left.start <= right.end && right.start <= left.end;

const buildLineStarts = (content: string): number[] => {
  const starts = [0];
  for (let idx = 0; idx < content.length; idx++) {
    if (content.charCodeAt(idx) === 10) {
      starts.push(idx + 1);
    }
  }
  return starts;
};

const getLineNumber = (lineStarts: number[], offset: number): number => {
  let low = 0;
  let high = lineStarts.length - 1;
  let best = 0;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (lineStarts[middle] <= offset) {
      best = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return best + 1;
};

const focusedDeclarationId = (decl: FunctionDeclarationInfo): string =>
  `decl:${decl.filename}->${decl.name}:${decl.pos}`;

const focusedDeclarationLabel = (
  decl: Pick<FunctionDeclarationInfo, 'name' | 'filename'>
): string => `${decl.name} (${decl.filename})`;

const hasDeclarationReason = (
  reasons: FocusedDeclarationReason[],
  reason: FocusedDeclarationReason
): boolean =>
  reasons.some((item) => item.type === reason.type && item.via === reason.via);

const findContainingDeclaration = (
  declarations: FunctionDeclarationInfo[],
  call: FunctionCallInfo
): FunctionDeclarationInfo | null => {
  let match: FunctionDeclarationInfo | null = null;

  for (const decl of declarations) {
    if (decl.pos <= call.pos && call.end <= decl.end) {
      if (!match || decl.end - decl.pos < match.end - match.pos) {
        match = decl;
      }
    }
  }

  return match;
};

type DeclarationCallEdge = {
  source: FunctionDeclarationInfo;
  target: FunctionDeclarationInfo;
  call: FunctionCallInfo;
  sourceId: string;
  targetId: string;
};

const declarationCallKey = (edge: DeclarationCallEdge): string =>
  `${edge.sourceId}->${edge.targetId}:${edge.call.pos}`;

const buildDeclarationAdjacency = (
  calls: DeclarationCallEdge[]
): Map<string, DeclarationCallEdge[]> => {
  const adjacency = new Map<string, DeclarationCallEdge[]>();

  for (const edge of calls) {
    const existing = adjacency.get(edge.sourceId) || [];
    existing.push(edge);
    adjacency.set(edge.sourceId, existing);
  }

  adjacency.forEach((edges) => {
    edges.sort(
      (a, b) =>
        a.targetId.localeCompare(b.targetId) ||
        a.call.filename.localeCompare(b.call.filename) ||
        a.call.pos - b.call.pos
    );
  });

  return adjacency;
};

const findShortestDeclarationPath = (
  sourceId: string,
  targetId: string,
  adjacency: Map<string, DeclarationCallEdge[]>,
  changedDeclarationIds: Set<string>,
  maxDepth: number
): DeclarationCallEdge[] | null => {
  const queue: Array<{
    id: string;
    path: DeclarationCallEdge[];
    seen: Set<string>;
  }> = [{ id: sourceId, path: [], seen: new Set([sourceId]) }];

  let index = 0;
  while (index < queue.length) {
    const current = queue[index++];
    if (current.path.length >= maxDepth) continue;

    const edges = adjacency.get(current.id) || [];
    for (const edge of edges) {
      if (current.seen.has(edge.targetId)) continue;
      if (
        edge.targetId !== targetId &&
        changedDeclarationIds.has(edge.targetId)
      ) {
        continue;
      }

      const path = [...current.path, edge];
      if (edge.targetId === targetId) return path;

      const seen = new Set(current.seen);
      seen.add(edge.targetId);
      queue.push({ id: edge.targetId, path, seen });
    }
  }

  return null;
};

const findDeclarationBridgePaths = (
  calls: DeclarationCallEdge[],
  changedDeclarationIds: Set<string>,
  maxDepth: number,
  maxPaths: number
): DeclarationCallEdge[][] => {
  if (changedDeclarationIds.size < 2) return [];

  const adjacency = buildDeclarationAdjacency(calls);
  const changedIds = Array.from(changedDeclarationIds).sort((a, b) =>
    a.localeCompare(b)
  );
  const paths: DeclarationCallEdge[][] = [];

  for (const sourceId of changedIds) {
    for (const targetId of changedIds) {
      if (sourceId === targetId) continue;

      const path = findShortestDeclarationPath(
        sourceId,
        targetId,
        adjacency,
        changedDeclarationIds,
        maxDepth
      );
      if (!path || path.length <= 1) continue;

      paths.push(path);
      if (paths.length >= maxPaths) return paths;
    }
  }

  return paths;
};

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
        return this.handleCommandFocusedReview(
          payload?.source,
          payload?.options
        );
      case 'listCommits':
        return this.handleCommandListCommits(payload);
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
    const filesByName = new Map(
      parsePorcelainOutput(output).map((file) => [file.filename, file])
    );

    const unstagedDiff = await this.tryRunGit([
      'diff',
      '--unified=0',
      '--no-ext-diff',
    ]);
    if (unstagedDiff) {
      mergeDiffLineRanges(
        filesByName,
        parseUnifiedDiffLineRanges(unstagedDiff)
      );
    }

    const stagedDiff = await this.tryRunGit([
      'diff',
      '--cached',
      '--unified=0',
      '--no-ext-diff',
    ]);
    if (stagedDiff) {
      mergeDiffLineRanges(filesByName, parseUnifiedDiffLineRanges(stagedDiff));
    }

    await this.addFullFileRangesForAddedFiles(filesByName);

    return {
      source: { mode: 'diff' },
      files: this.sortedChangedFiles(filesByName),
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
    const filesByName = new Map(
      parseNameStatusOutput(output).map((file) => [file.filename, file])
    );

    const diffOutput = await this.runGit([
      'diff',
      '--unified=0',
      '--no-ext-diff',
      mergeBase,
      'HEAD',
    ]);
    mergeDiffLineRanges(filesByName, parseUnifiedDiffLineRanges(diffOutput));

    return {
      source: { mode: 'branch', baseRef: resolvedBaseRef },
      files: this.sortedChangedFiles(filesByName),
    };
  }

  private async resolveCommitRef(ref: string): Promise<string> {
    return (
      await this.runGit(['rev-parse', '--verify', `${ref}^{commit}`])
    ).trim();
  }

  private async resolveCommitParent(
    commitRef: string,
    parentRef?: string
  ): Promise<string> {
    if (parentRef) return this.resolveCommitRef(parentRef);

    const parentLine = (
      await this.runGit(['rev-list', '--parents', '-n', '1', commitRef])
    ).trim();
    const [, firstParent] = parentLine.split(/\s+/);

    if (firstParent) return firstParent;

    return (
      await this.runGit(['hash-object', '-t', 'tree', '/dev/null'])
    ).trim();
  }

  private async getCommitChangeSet(
    ref: string,
    parentRef?: string
  ): Promise<ChangeSet> {
    const resolvedRef = await this.resolveCommitRef(ref);
    const resolvedParentRef = await this.resolveCommitParent(
      resolvedRef,
      parentRef
    );

    const output = await this.runGit([
      'diff',
      '--name-status',
      '--find-renames',
      resolvedParentRef,
      resolvedRef,
    ]);
    const filesByName = new Map(
      parseNameStatusOutput(output).map((file) => [file.filename, file])
    );

    const diffOutput = await this.runGit([
      'diff',
      '--unified=0',
      '--no-ext-diff',
      resolvedParentRef,
      resolvedRef,
    ]);
    mergeDiffLineRanges(filesByName, parseUnifiedDiffLineRanges(diffOutput));

    return {
      source: {
        mode: 'commit',
        ref: resolvedRef,
        parentRef: resolvedParentRef,
      },
      files: this.sortedChangedFiles(filesByName),
    };
  }

  private sortedChangedFiles(
    filesByName: Map<string, ChangedFileInfo>
  ): ChangedFileInfo[] {
    return Array.from(filesByName.values()).sort((a, b) =>
      a.filename.localeCompare(b.filename)
    );
  }

  private async addFullFileRangesForAddedFiles(
    filesByName: Map<string, ChangedFileInfo>
  ) {
    for (const info of Array.from(filesByName.values())) {
      if (info.status !== 'added' || (info.addedLines?.length || 0) > 0) {
        continue;
      }

      try {
        const content = await openFile(info.filename, this.projectPath);
        const lineCount = countLines(content);
        if (lineCount > 0) {
          info.addedLines = [{ start: 1, end: lineCount }];
        }
      } catch {
        // Unreadable added files still appear at file level.
      }
    }
  }

  private async buildFocusedReviewMap(
    changeSet: ChangeSet,
    options: FocusedReviewOptions = {}
  ): Promise<FocusedReviewMap> {
    const includeTests = options.includeTests !== false;
    const focusedFiles = new Map<string, FocusedFileInfo>();

    const ensureFocusedFile = (filename: string): FocusedFileInfo => {
      const existing = focusedFiles.get(filename);
      if (existing) return existing;

      const created: FocusedFileInfo = {
        filename,
        reasons: [],
        isChanged: false,
        isTest: isTestFile(filename),
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
        if (isTestFile(edge.to)) {
          if (includeTests) {
            addReason(edge.to, {
              type: 'related-test',
              via: edge.from,
            });
          }
        } else {
          addReason(edge.to, {
            type: 'imports-changed',
            via: edge.from,
          });
        }
      }

      if (changedFiles.has(edge.to)) {
        if (isTestFile(edge.from)) {
          if (includeTests) {
            addReason(edge.from, {
              type: 'related-test',
              via: edge.to,
            });
          }
        } else {
          addReason(edge.from, {
            type: 'imported-by-changed',
            via: edge.to,
          });
        }
      }
    }

    if (includeTests) {
      const changedSourceFiles = changeSet.files.filter(
        (file) => file.status !== 'deleted' && !isTestFile(file.filename)
      );

      for (const filename of this.files) {
        if (
          !isTestFile(filename) ||
          changedFiles.has(filename) ||
          focusedFiles.has(filename)
        ) {
          continue;
        }

        const relatedSource = changedSourceFiles.find((file) =>
          areLikelyTestPartners(filename, file.filename)
        );
        if (relatedSource) {
          addReason(filename, {
            type: 'related-test',
            via: relatedSource.filename,
          });
        }
      }
    }

    const visibleFiles = new Set(focusedFiles.keys());
    const focusedIncludes = this.projectMap.filter(
      (edge) => visibleFiles.has(edge.from) && visibleFiles.has(edge.to)
    );
    const declarationGraph = await this.buildFocusedDeclarationGraph(
      changeSet,
      visibleFiles
    );

    const files = Array.from(focusedFiles.values()).sort((a, b) => {
      if (a.isChanged !== b.isChanged) return a.isChanged ? -1 : 1;
      return a.filename.localeCompare(b.filename);
    });

    return {
      changeSet,
      files,
      includes: focusedIncludes,
      declarations: declarationGraph.declarations,
      declarationCalls: declarationGraph.declarationCalls,
    };
  }

  private async buildFocusedDeclarationGraph(
    changeSet: ChangeSet,
    visibleFiles: Set<string>
  ): Promise<{
    declarations: FocusedDeclarationInfo[];
    declarationCalls: FocusedDeclarationCallInfo[];
  }> {
    const changedFiles = new Map(
      changeSet.files.map((file) => [file.filename, file])
    );
    const analyzer = getAnalyzer('js');
    const mappings = new Map<string, { content: string; mapping: FileMapping }>();

    for (const filename of Array.from(visibleFiles.values())) {
      const changeInfo = changedFiles.get(filename);
      if (changeInfo?.status === 'deleted') continue;

      try {
        const content = await openFile(filename, this.projectPath);
        mappings.set(filename, {
          content,
          mapping: analyzer.extractFileMapping(filename, content, this.files),
        });
      } catch {
        // File-level review can still represent missing or unreadable files.
      }
    }

    const allDeclarations = new Map<
      string,
      {
        decl: FunctionDeclarationInfo;
        startLine: number;
        endLine: number;
      }
    >();
    const declarationsByFileAndName = new Map<string, FunctionDeclarationInfo[]>();

    mappings.forEach(({ content, mapping }) => {
      const lineStarts = buildLineStarts(content);

      for (const decl of mapping.functionDeclarations) {
        const id = focusedDeclarationId(decl);
        allDeclarations.set(id, {
          decl,
          startLine: getLineNumber(lineStarts, decl.pos),
          endLine: getLineNumber(lineStarts, Math.max(decl.pos, decl.end - 1)),
        });

        const key = `${decl.filename}::${decl.name}`;
        const existing = declarationsByFileAndName.get(key) || [];
        existing.push(decl);
        declarationsByFileAndName.set(key, existing);
      }
    });

    const focusedDeclarations = new Map<string, FocusedDeclarationInfo>();
    const changedDeclarationIds = new Set<string>();

    const ensureFocusedDeclaration = (
      decl: FunctionDeclarationInfo
    ): FocusedDeclarationInfo => {
      const id = focusedDeclarationId(decl);
      const existing = focusedDeclarations.get(id);
      if (existing) return existing;

      const lineInfo = allDeclarations.get(id);
      const changeInfo = changedFiles.get(decl.filename);
      const created: FocusedDeclarationInfo = {
        id,
        name: decl.name,
        filename: decl.filename,
        pos: decl.pos,
        end: decl.end,
        args: decl.args,
        reasons: [],
        isChanged: false,
        changeStatus: changeInfo?.status,
        startLine: lineInfo?.startLine,
        endLine: lineInfo?.endLine,
      };
      focusedDeclarations.set(id, created);
      return created;
    };

    const addDeclarationReason = (
      decl: FunctionDeclarationInfo,
      reason: FocusedDeclarationReason
    ) => {
      const info = ensureFocusedDeclaration(decl);
      if (!hasDeclarationReason(info.reasons, reason)) {
        info.reasons.push(reason);
      }
      if (reason.type === 'changed') {
        info.isChanged = true;
        changedDeclarationIds.add(info.id);
      }
    };

    allDeclarations.forEach(({ decl, startLine, endLine }) => {
      const changeInfo = changedFiles.get(decl.filename);
      if (!changeInfo || changeInfo.status === 'deleted') return;

      const changedRanges =
        changeInfo.status === 'added'
          ? [{ start: startLine, end: endLine }]
          : changeInfo.addedLines || [];
      const declarationRange = { start: startLine, end: endLine };
      const hasChangedRange = changedRanges.some((range) =>
        rangesOverlap(range, declarationRange)
      );

      if (changeInfo.status === 'added' || hasChangedRange) {
        addDeclarationReason(decl, { type: 'changed' });
      }
    });

    const lookupDeclaration = (
      filename: string,
      name: string
    ): FunctionDeclarationInfo | null => {
      const matches = declarationsByFileAndName.get(`${filename}::${name}`);
      return matches?.[0] || null;
    };

    const rawDeclarationCalls: DeclarationCallEdge[] = [];

    mappings.forEach(({ mapping }) => {
      for (const call of mapping.functionCalls) {
        if (call.isBuiltin) continue;

        const source = findContainingDeclaration(
          mapping.functionDeclarations,
          call
        );
        if (!source) continue;

        const importedFrom = mapping.includes.find((incl) =>
          incl.items.includes(call.name)
        )?.from;
        const targetFilename = importedFrom || call.filename;
        const target = lookupDeclaration(targetFilename, call.name);
        if (!target) continue;

        const sourceId = focusedDeclarationId(source);
        const targetId = focusedDeclarationId(target);
        if (sourceId === targetId) continue;

        rawDeclarationCalls.push({
          source,
          target,
          call,
          sourceId,
          targetId,
        });
      }
    });

    const visibleCalls = new Map<
      string,
      { edge: DeclarationCallEdge; reasons: FocusedDeclarationReason[] }
    >();

    const addVisibleCallReason = (
      edge: DeclarationCallEdge,
      reason: FocusedDeclarationReason
    ) => {
      const key = declarationCallKey(edge);
      const existing = visibleCalls.get(key) || { edge, reasons: [] };
      if (!hasDeclarationReason(existing.reasons, reason)) {
        existing.reasons.push(reason);
      }
      visibleCalls.set(key, existing);
    };

    rawDeclarationCalls.forEach((edge) => {
      const { source, target } = edge;
      const { sourceId, targetId } = edge;
      const reasons: FocusedDeclarationReason[] = [];

      if (changedDeclarationIds.has(sourceId)) {
        const reason: FocusedDeclarationReason = {
          type: 'called-by-changed',
          via: focusedDeclarationLabel(source),
        };
        addDeclarationReason(target, reason);
        reasons.push(reason);
        addVisibleCallReason(edge, reason);
      }

      if (changedDeclarationIds.has(targetId)) {
        const reason: FocusedDeclarationReason = {
          type: 'calls-changed',
          via: focusedDeclarationLabel(target),
        };
        addDeclarationReason(source, reason);
        if (!hasDeclarationReason(reasons, reason)) {
          reasons.push(reason);
        }
        addVisibleCallReason(edge, reason);
      }
    });

    const bridgePaths = findDeclarationBridgePaths(
      rawDeclarationCalls,
      changedDeclarationIds,
      MAX_DECLARATION_BRIDGE_DEPTH,
      MAX_DECLARATION_BRIDGE_PATHS
    );

    for (const path of bridgePaths) {
      const first = path[0];
      const last = path[path.length - 1];
      const reason: FocusedDeclarationReason = {
        type: 'bridge-between-changes',
        via: `${focusedDeclarationLabel(first.source)} -> ${focusedDeclarationLabel(
          last.target
        )}`,
      };

      path.forEach((edge, idx) => {
        const sourceIsStart = idx === 0;
        const targetIsEnd = idx === path.length - 1;

        if (!sourceIsStart && !changedDeclarationIds.has(edge.sourceId)) {
          addDeclarationReason(edge.source, reason);
        }

        if (!targetIsEnd && !changedDeclarationIds.has(edge.targetId)) {
          addDeclarationReason(edge.target, reason);
        }

        addVisibleCallReason(edge, reason);
      });
    }

    const declarationCalls: FocusedDeclarationCallInfo[] = [];

    visibleCalls.forEach(({ edge, reasons }) => {
      if (
        reasons.length > 0 &&
        focusedDeclarations.has(edge.sourceId) &&
        focusedDeclarations.has(edge.targetId)
      ) {
        declarationCalls.push({
          id: `call:${edge.sourceId}->${edge.targetId}:${edge.call.pos}`,
          from: edge.sourceId,
          to: edge.targetId,
          name: edge.call.name,
          filename: edge.call.filename,
          pos: edge.call.pos,
          end: edge.call.end,
          reasons,
          isHeuristic: true,
        });
      }
    });

    return {
      declarations: Array.from(focusedDeclarations.values()).sort((a, b) => {
        if (a.isChanged !== b.isChanged) return a.isChanged ? -1 : 1;
        return (
          a.filename.localeCompare(b.filename) ||
          (a.startLine || 0) - (b.startLine || 0) ||
          a.name.localeCompare(b.name)
        );
      }),
      declarationCalls: declarationCalls.sort(
        (a, b) =>
          a.filename.localeCompare(b.filename) ||
          a.pos - b.pos ||
          a.name.localeCompare(b.name)
      ),
    };
  }

  async handleCommandFocusedReview(
    source: ChangeSourceRequest | undefined,
    options?: FocusedReviewOptions
  ) {
    this.reloadProject();
    await this.recreateProjectMap();

    const requestedSource: ChangeSourceRequest = source || { mode: 'diff' };
    let changeSet: ChangeSet;
    if (requestedSource.mode === 'branch') {
      changeSet = await this.getBranchChangeSet(requestedSource.baseRef);
    } else if (requestedSource.mode === 'commit') {
      changeSet = await this.getCommitChangeSet(
        requestedSource.ref,
        requestedSource.parentRef
      );
    } else {
      changeSet = await this.getDiffChangeSet();
    }

    const payload = await this.buildFocusedReviewMap(changeSet, options);

    return {
      type: 'focusedReviewMap',
      payload,
    };
  }

  async handleCommandListCommits(
    payload: { limit?: number; skip?: number } | undefined
  ) {
    const limit = Math.min(Math.max(Number(payload?.limit) || 5, 1), 50);
    const skip = Math.max(Number(payload?.skip) || 0, 0);
    const output = await this.runGit([
      'log',
      `--max-count=${limit}`,
      `--skip=${skip}`,
      '--format=%H%x1f%h%x1f%ct%x1f%an%x1f%s',
    ]);

    return {
      type: 'commitList',
      payload: parseCommitLogOutput(output),
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
