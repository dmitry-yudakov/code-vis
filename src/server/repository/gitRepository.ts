import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { namesOpenFiles, readBoundedTextFile } from '@/server/boundedTextFile';
import { runRegistry } from '@/server/runs/runRegistry';
import { isNotRepositoryOutput, runGitRead } from './gitRead';
import type { GitChangedFile, GitFileDiff, GitFileStatus, GitWorkingTree } from '@/shared/types';

const DIFF_BUFFER_BYTES = 2 * 1024 * 1024;
const MARKDOWN_PREVIEW_BYTES = 512 * 1024;
export const DETACHED_HEAD = 'Detached HEAD';

interface GitFailure extends Error {
  code?: number | string;
  stderr?: string;
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

function branchMetadata(header: string): Pick<GitWorkingTree, 'branch' | 'upstream' | 'unborn' | 'ahead' | 'behind'> {
  let description = header.startsWith('## ') ? header.slice(3) : header;
  const unborn = /^(?:No commits yet|Initial commit) on /.test(description);
  description = description.replace(/^No commits yet on /, '').replace(/^Initial commit on /, '');
  const ahead = description.match(/\bahead (\d+)\b/)?.[1];
  const behind = description.match(/\bbehind (\d+)\b/)?.[1];
  const [branchPart, upstream] = description.split('...').map((part) => part.replace(/ \[.*$/, ''));
  return {
    branch: branchPart === 'HEAD (no branch)' ? DETACHED_HEAD : branchPart,
    ...(upstream ? { upstream } : {}),
    ...(unborn ? { unborn } : {}),
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
  return failure.code === 128 && isNotRepositoryOutput(failure.stderr);
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

export async function readWorkingTree(repositoryPath: string): Promise<GitWorkingTree> {
  try {
    const output = await runGitRead(repositoryPath, [
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

async function readDiff(repositoryPath: string, args: string[], allowedExitCodes?: number[]): Promise<string> {
  try {
    return await runGitRead(repositoryPath, args, { allowedExitCodes, maxBuffer: DIFF_BUFFER_BYTES });
  } catch (error) {
    throw boundedGitError(error, 'diff');
  }
}

async function readMarkdownPreview(repositoryPath: string, filePath: string): Promise<NonNullable<GitFileDiff['preview']>> {
  // The checkout is agent-writable: never silently skip the handle's path proof on other systems.
  if (!namesOpenFiles()) return { error: 'Markdown preview currently requires Linux to verify the file stays inside this repository.' };
  const release = runRegistry.acquireCheckoutRead(repositoryPath, undefined, true);
  if (!release) return { error: 'This repository is busy. Refresh to try again.' };
  try {
    const root = await realpath(repositoryPath);
    if (root !== repositoryPath) return { error: 'The repository location changed. Refresh to try again.' };
    const target = path.resolve(root, filePath);
    if (!target.startsWith(root + path.sep) || await realpath(target) !== target) {
      return { error: 'Preview is unavailable for symbolic links or files outside this repository.' };
    }
    const result = await readBoundedTextFile(target, MARKDOWN_PREVIEW_BYTES, { exactly: true });
    if ('text' in result) return { markdown: result.text };
    if (result.issue === 'too-large') return { error: 'Markdown preview is limited to 512 KiB per file.' };
    if (result.issue === 'not-text') return { error: 'Markdown preview requires a UTF-8 text file.' };
    return { error: 'The current file could not be read. Refresh to try again.' };
  } catch (error) {
    return { error: (error as NodeJS.ErrnoException).code === 'ENOENT'
      ? 'The working-tree file no longer exists. Its changes are still available in Diff.'
      : 'The current file could not be read. Refresh to try again.' };
  } finally {
    release();
  }
}

export async function readFileDiff(repositoryPath: string, file: GitChangedFile): Promise<GitFileDiff> {
  const result: GitFileDiff = { path: file.path };
  const common = ['--no-ext-diff', '--no-textconv', '--no-color', '--unified=3'];

  if (file.staged) {
    result.staged = await readDiff(repositoryPath, ['diff', '--cached', ...common, '--', file.path]);
  }
  if (file.status === 'untracked') {
    const nullDevice = process.platform === 'win32' ? 'NUL' : '/dev/null';
    result.unstaged = await readDiff(
      repositoryPath,
      ['diff', '--no-index', ...common, '--', nullDevice, file.path],
      [1],
    );
  } else if (file.unstaged) {
    result.unstaged = await readDiff(repositoryPath, ['diff', ...common, '--', file.path]);
  }
  if (/\.(md|markdown)$/i.test(file.path)) result.preview = await readMarkdownPreview(repositoryPath, file.path);
  return result;
}
