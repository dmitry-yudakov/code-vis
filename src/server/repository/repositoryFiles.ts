import { constants } from 'node:fs';
import { open, opendir, readlink, realpath } from 'node:fs/promises';
import path from 'node:path';
import { namesOpenFiles, readBoundedTextFile } from '@/server/boundedTextFile';
import { runRegistry } from '@/server/runs/runRegistry';
import type { RepositoryDirectory, RepositoryFile, RepositoryFileList } from '@/shared/repositoryFiles';
import { isNotRepositoryOutput, runGitRead } from './gitRead';

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

/** Image-only reads reuse the file viewer's path proof and checkout ownership. */
export async function readRepositoryImage(root: string, requested: string): Promise<{ bytes: Uint8Array<ArrayBuffer>; contentType: string }> {
  return withRepositoryPath(root, requested, async target => {
    const handle = await open(target, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
    try {
      const maxBytes = 2 * 1024 * 1024;
      const info = await handle.stat();
      if (!info.isFile()) throw new RepositoryFileError('Choose a regular image file.');
      if (await readlink(`/proc/self/fd/${handle.fd}`) !== target) throw new RepositoryFileError('The image location changed. Try again.');
      if (info.size > maxBytes) throw new RepositoryFileError('Project logos are limited to 2 MiB.');
      const buffer = Buffer.alloc(maxBytes + 1);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
        if (!bytesRead) break;
        length += bytesRead;
      }
      if (length > maxBytes) throw new RepositoryFileError('Project logos are limited to 2 MiB.');
      const bytes = buffer.subarray(0, length);
      const extension = path.extname(target).toLowerCase();
      const signatures: Record<string, [string, boolean]> = {
        '.png': ['image/png', bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))],
        '.jpg': ['image/jpeg', bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255],
        '.jpeg': ['image/jpeg', bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255],
        '.gif': ['image/gif', /^GIF8[79]a/.test(bytes.subarray(0, 6).toString())],
        '.webp': ['image/webp', bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP'],
        '.ico': ['image/x-icon', bytes.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0]))],
        '.svg': ['image/svg+xml', !bytes.includes(0) && /<svg[\s>]/i.test(bytes.toString('utf8'))],
      };
      const format = signatures[extension];
      if (!format?.[1]) throw new RepositoryFileError('Choose a PNG, JPEG, GIF, WebP, SVG or ICO image.');
      return { bytes: new Uint8Array(bytes), contentType: format[0] };
    } finally { await handle.close(); }
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

const FILE_SEARCH_LIMIT = 50000;
const FILE_SEARCH_BYTES = 5 * 1024 * 1024;
const GENERATED_DIRECTORIES = new Set(['node_modules', 'dist', 'build', 'coverage', '.next', '.next-e2e', 'out', 'target']);

/** Names only: contents still go through the file viewer's independent path proof. */
export async function listRepositoryFiles(root: string): Promise<RepositoryFileList> {
  return withRepositoryPath(root, '', async () => {
    let paths: string[];
    try {
      const output = await runGitRead(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '.'],
        { maxBuffer: FILE_SEARCH_BYTES, timeout: 10000 });
      paths = [...new Set(output.split('\0').filter(file => file && file.length <= 4096
        && !/[\u0000-\u001f\u007f\\]/.test(file) && !path.isAbsolute(file)
        && !file.split('/').some(part => part === '.git' || part === '..')))];
    } catch (error) {
      const failure = error as { code?: number | string; stderr?: string };
      if (failure.code !== 128 || !isNotRepositoryOutput(failure.stderr)) {
        throw new RepositoryFileError('Could not list project files within the search limits (5 MiB, 10 seconds). Try again or use Files.');
      }
      // Projects can be plain folders. Reuse verified directory reads without following links.
      paths = [];
      let bytes = 0;
      const folders = [''];
      const deadline = Date.now() + 10000;
      for (let index = 0; index < folders.length; index++) {
        if (index >= 2000 || Date.now() > deadline) throw new RepositoryFileError('This project is too large to search. Use Files to browse a folder.');
        const directory = await listRepositoryDirectory(root, folders[index]);
        for (const entry of directory.entries) {
          const target = directory.path ? `${directory.path}/${entry.name}` : entry.name;
          if (entry.kind === 'directory') {
            if (!GENERATED_DIRECTORIES.has(entry.name)) folders.push(target);
          } else {
            bytes += Buffer.byteLength(target, 'utf8') + 1;
            if (bytes > FILE_SEARCH_BYTES) throw new RepositoryFileError('Project file paths exceed the 5 MiB search limit. Use Files to browse a folder.');
            paths.push(target);
          }
        }
        if (folders.length > 2000) throw new RepositoryFileError('This project is too large to search. Use Files to browse a folder.');
        if (paths.length > FILE_SEARCH_LIMIT) break;
      }
    }
    if (paths.length > FILE_SEARCH_LIMIT) throw new RepositoryFileError('This project has more than 50,000 files. Use Files to browse a folder.');
    return { paths: paths.sort((a, b) => a.localeCompare(b)) };
  });
}
