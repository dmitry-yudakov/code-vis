import { execFile } from 'node:child_process';
import type { GitChangedFile, GitFileDiff, GitFileStatus, GitWorkingTree } from '@/shared/types';

const STATUS_BUFFER_BYTES = 5 * 1024 * 1024;
const DIFF_BUFFER_BYTES = 2 * 1024 * 1024;
const GIT_TIMEOUT_MS = 8_000;

interface GitFailure extends Error {
  code?: number | string;
  stderr?: string;
}

function runGit(
  cwd: string,
  args: string[],
  options: { allowedExitCodes?: number[]; maxBuffer?: number } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: options.maxBuffer || STATUS_BUFFER_BYTES,
      timeout: GIT_TIMEOUT_MS,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      const failure = error as GitFailure | null;
      if (!failure || (typeof failure.code === 'number' && options.allowedExitCodes?.includes(failure.code))) {
        resolve(stdout);
        return;
      }
      failure.stderr = stderr;
      reject(failure);
    });
  });
}

function fileStatus(code: string): GitFileStatus {
  if (code === '??') return 'untracked';
  if (code.includes('U') || ['DD', 'AA', 'AU', 'UD', 'UA', 'DU'].includes(code)) return 'conflicted';
  if (code.includes('R')) return 'renamed';
  if (code.includes('C')) return 'copied';
  if (code.includes('D')) return 'deleted';
  if (code.includes('A')) return 'added';
  return 'modified';
}

function branchMetadata(header: string): Pick<GitWorkingTree, 'branch' | 'ahead' | 'behind'> {
  let description = header.startsWith('## ') ? header.slice(3) : header;
  description = description.replace(/^No commits yet on /, '').replace(/^Initial commit on /, '');
  const ahead = description.match(/\bahead (\d+)\b/)?.[1];
  const behind = description.match(/\bbehind (\d+)\b/)?.[1];
  const branchPart = description.split('...')[0].replace(/ \[.*$/, '');
  return {
    branch: branchPart === 'HEAD (no branch)' ? 'Detached HEAD' : branchPart,
    ...(ahead ? { ahead: Number(ahead) } : {}),
    ...(behind ? { behind: Number(behind) } : {}),
  };
}

/** Parse porcelain v1's NUL form so whitespace, quotes, and rename arrows remain literal. */
export function parseGitStatus(output: string): GitWorkingTree {
  const records = output.split('\0');
  const first = records[0] || '';
  const metadata = first.startsWith('## ') ? branchMetadata(first) : {};
  let index = first.startsWith('## ') ? 1 : 0;
  const files: GitChangedFile[] = [];

  while (index < records.length) {
    const record = records[index++];
    if (!record || record.length < 3) continue;
    const code = record.slice(0, 2);
    if (code === '!!') continue;
    const path = record.slice(3);
    if (!path) continue;
    const isRenameOrCopy = code.includes('R') || code.includes('C');
    const previousPath = isRenameOrCopy ? records[index++] || undefined : undefined;
    files.push({
      path,
      ...(previousPath ? { previousPath } : {}),
      status: fileStatus(code),
      staged: code[0] !== ' ' && code[0] !== '?',
      unstaged: code[1] !== ' ' && code[1] !== '?',
    });
  }

  files.sort((left, right) => left.path.localeCompare(right.path));
  return { isRepository: true, ...metadata, files };
}

function isNotRepository(error: unknown): boolean {
  const failure = error as GitFailure;
  return failure.code === 128 && Boolean(failure.stderr?.toLocaleLowerCase().includes('not a git repository'));
}

function boundedGitError(error: unknown, operation: 'status' | 'diff'): Error {
  const failure = error as GitFailure;
  if (failure.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
    return new Error(operation === 'diff' ? 'This diff is too large to display.' : 'This working tree has too many changes to display.');
  }
  if ((failure as { killed?: boolean }).killed) return new Error(`Git ${operation} timed out.`);
  if (failure.code === 'ENOENT') return new Error('Git is not installed or is not available to Cartograph.');
  return new Error(`Could not read Git ${operation}.`);
}

export async function readWorkingTree(projectPath: string): Promise<GitWorkingTree> {
  try {
    const output = await runGit(projectPath, [
      '-c', 'status.relativePaths=true', 'status', '--porcelain=v1', '-z', '--branch',
      '--untracked-files=all', '--', '.',
    ]);
    return parseGitStatus(output);
  } catch (error) {
    if (isNotRepository(error)) return { isRepository: false, files: [] };
    throw boundedGitError(error, 'status');
  }
}

/** Exact membership is the route's path authorization boundary. */
export function findChangedFile(tree: GitWorkingTree, requestedPath: string): GitChangedFile | undefined {
  return tree.files.find((file) => file.path === requestedPath);
}

async function readDiff(projectPath: string, args: string[], allowedExitCodes?: number[]): Promise<string> {
  try {
    return await runGit(projectPath, args, { allowedExitCodes, maxBuffer: DIFF_BUFFER_BYTES });
  } catch (error) {
    throw boundedGitError(error, 'diff');
  }
}

export async function readFileDiff(projectPath: string, file: GitChangedFile): Promise<GitFileDiff> {
  const result: GitFileDiff = { path: file.path };
  const common = ['--no-ext-diff', '--no-color', '--unified=3'];

  if (file.staged) {
    result.staged = await readDiff(projectPath, ['diff', '--cached', ...common, '--', file.path]);
  }
  if (file.status === 'untracked') {
    const nullDevice = process.platform === 'win32' ? 'NUL' : '/dev/null';
    result.unstaged = await readDiff(
      projectPath,
      ['diff', '--no-index', ...common, '--', nullDevice, file.path],
      [1],
    );
  } else if (file.unstaged) {
    result.unstaged = await readDiff(projectPath, ['diff', ...common, '--', file.path]);
  }
  return result;
}
