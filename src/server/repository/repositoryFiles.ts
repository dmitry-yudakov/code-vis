import { constants } from 'node:fs';
import { open, opendir, readlink, realpath } from 'node:fs/promises';
import path from 'node:path';
import { namesOpenFiles, readBoundedTextFile } from '@/server/boundedTextFile';
import { runRegistry } from '@/server/runs/runRegistry';
import type { RepositoryDirectory, RepositoryFile } from '@/shared/repositoryFiles';

export class RepositoryFileError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

/** The registry supplies the canonical root. Never turn a replacement root into new authority. */
async function withRepositoryPath<T>(root: string, requested: string, read: (target: string, relative: string) => Promise<T>): Promise<T> {
  if (!namesOpenFiles()) throw new RepositoryFileError('File browsing currently requires Linux to verify repository paths.');
  if (requested.length > 4096 || /[\u0000-\u001f\u007f\\]/.test(requested)) throw new RepositoryFileError('Invalid repository path.');
  const release = runRegistry.acquireCheckoutRead(root, undefined, true);
  if (!release) throw new RepositoryFileError('This repository is busy. Try again after the current operation.', 409);
  try {
    if (await realpath(root) !== root) throw new RepositoryFileError('The repository location changed. Refresh to try again.');
    const target = path.resolve(root, requested);
    const relative = path.relative(root, target);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || relative.split(path.sep).includes('.git')) {
      throw new RepositoryFileError('That path is outside the browsable repository files.', 404);
    }
    if (await realpath(target) !== target) throw new RepositoryFileError('Symbolic links cannot be opened in the file viewer.');
    return await read(target, relative);
  } catch (error) {
    if (error instanceof RepositoryFileError) throw error;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new RepositoryFileError('That file or folder no longer exists.', 404);
    throw new RepositoryFileError('Could not read this repository path. Try again.');
  } finally { release(); }
}

export async function readRepositoryFile(root: string, requested: string): Promise<RepositoryFile> {
  return withRepositoryPath(root, requested, async (target, relative) => {
    const result = await readBoundedTextFile(target, 512 * 1024, { exactly: true });
    if ('text' in result) return { path: relative, text: result.text };
    const errors = {
      'too-large': 'The file viewer is limited to 512 KiB per file.',
      'not-text': 'The file viewer requires a UTF-8 text file.',
      'not-file': 'Choose a regular file to view.',
      missing: 'That file no longer exists.',
      changed: 'The file location changed. Try again.',
      unreadable: 'The file could not be read. Try again.',
    };
    throw new RepositoryFileError(errors[result.issue], result.issue === 'missing' ? 404 : 400);
  });
}

/** One directory at a time, pinned to its verified handle; never recursively walk the checkout. */
export async function listRepositoryDirectory(root: string, requested: string): Promise<RepositoryDirectory> {
  return withRepositoryPath(root, requested, async (target, relative) => {
    const handle = await open(target, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      const descriptor = `/proc/self/fd/${handle.fd}`;
      if (await readlink(descriptor) !== target) throw new RepositoryFileError('The folder location changed. Try again.');
      const directory = await opendir(descriptor);
      const entries: RepositoryDirectory['entries'] = [];
      let count = 0;
      for await (const entry of directory) {
        if (++count > 2000) throw new RepositoryFileError('This folder contains more than 2,000 entries. Open a file through a chat link instead.');
        if (entry.name === '.git' || (!entry.isDirectory() && !entry.isFile())) continue;
        entries.push({ name: entry.name, kind: entry.isDirectory() ? 'directory' : 'file' });
      }
      if (await readlink(descriptor) !== target) throw new RepositoryFileError('The folder location changed. Try again.');
      entries.sort((a, b) => Number(b.kind === 'directory') - Number(a.kind === 'directory') || a.name.localeCompare(b.name));
      return { path: relative, entries };
    } finally { await handle.close(); }
  });
}
