import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import { listRepositoryDirectory, readRepositoryFile } from '@/server/repository/repositoryFiles';
import * as boundedText from '@/server/boundedTextFile';
import { runRegistry } from '@/server/runs/runRegistry';

const roots: string[] = [];
async function root() {
  const value = await mkdtemp(path.join(os.tmpdir(), 'codeai-files-'));
  roots.push(value);
  return value;
}
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(value => rm(value, { recursive: true, force: true }))); });

it('browses an ordinary folder lazily, including unchanged, untracked and dot files', async () => {
  const directory = await root();
  await mkdir(path.join(directory, 'docs'));
  await mkdir(path.join(directory, '.git'));
  await writeFile(path.join(directory, 'README.md'), '# Project');
  await writeFile(path.join(directory, '.gitignore'), 'build');
  await writeFile(path.join(directory, 'docs', 'a.md'), 'Details');
  expect(await listRepositoryDirectory(directory, '')).toEqual({ path: '', entries: [
    { name: 'docs', kind: 'directory' }, { name: '.gitignore', kind: 'file' }, { name: 'README.md', kind: 'file' },
  ] });
  expect(await listRepositoryDirectory(directory, 'docs')).toEqual({ path: 'docs', entries: [{ name: 'a.md', kind: 'file' }] });
  expect(await readRepositoryFile(directory, 'docs/../README.md')).toEqual({ path: 'README.md', text: '# Project' });
  expect(await readRepositoryFile(directory, path.join(directory, 'README.md'))).toEqual({ path: 'README.md', text: '# Project' });
});

it('rejects paths outside the resolved checkout, metadata, and symbolic links', async () => {
  const directory = await root();
  const outside = await root();
  await writeFile(path.join(outside, 'secret'), 'outside');
  await mkdir(path.join(directory, '.git'));
  await writeFile(path.join(directory, '.git', 'config'), 'private');
  await symlink(outside, path.join(directory, 'linked'));
  await symlink(path.join(outside, 'secret'), path.join(directory, 'linked-file'));
  for (const file of [path.join(outside, 'secret'), '../secret', '.git/config', 'linked/secret', 'linked-file', 'a\0b']) {
    await expect(readRepositoryFile(directory, file)).rejects.toThrow();
  }
  for (const entry of ['../', '.git', 'linked']) await expect(listRepositoryDirectory(directory, entry)).rejects.toThrow();
  expect((await listRepositoryDirectory(directory, '')).entries).toEqual([]);
});

it('reads whole bounded UTF-8 files and explains missing, binary, oversized and directory targets', async () => {
  const directory = await root();
  await writeFile(path.join(directory, 'empty'), '');
  await writeFile(path.join(directory, 'binary'), Buffer.from([0, 1]));
  await writeFile(path.join(directory, 'large'), 'a'.repeat(512 * 1024 + 1));
  expect((await readRepositoryFile(directory, 'empty')).text).toBe('');
  await expect(readRepositoryFile(directory, 'missing')).rejects.toMatchObject({ status: 404 });
  await expect(readRepositoryFile(directory, 'binary')).rejects.toThrow(/UTF-8/);
  await expect(readRepositoryFile(directory, 'large')).rejects.toThrow(/512 KiB/);
  await expect(readRepositoryFile(directory, '.')).rejects.toThrow(/regular file/);
  await writeFile(path.join(directory, 'large'), 'recovered');
  expect((await readRepositoryFile(directory, 'large')).text).toBe('recovered');
});

it('fails explicitly when one directory has more than 2000 entries', async () => {
  const directory = await root();
  await Promise.all(Array.from({ length: 2001 }, (_, index) => writeFile(path.join(directory, `${index}.txt`), '')));
  await expect(listRepositoryDirectory(directory, '')).rejects.toThrow(/2,000/);
});

it('honors recovery ownership and releases successful and failed reads for later recovery', async () => {
  const directory = await root();
  await writeFile(path.join(directory, 'file.txt'), 'content');
  const release = runRegistry.acquireCheckoutWrite(directory)!;
  try {
    await expect(readRepositoryFile(directory, 'file.txt')).rejects.toMatchObject({ status: 409 });
    await expect(listRepositoryDirectory(directory, '')).rejects.toMatchObject({ status: 409 });
  } finally { release(); }
  await readRepositoryFile(directory, 'file.txt');
  await listRepositoryDirectory(directory, '');
  await expect(readRepositoryFile(directory, 'missing.txt')).rejects.toThrow();
  await expect(listRepositoryDirectory(directory, 'missing')).rejects.toThrow();
  const recover = runRegistry.acquireCheckoutWrite(directory);
  expect(recover).toBeTypeOf('function');
  recover?.();
});

it('refuses replaced checkout roots and platforms without open-handle proof', async () => {
  const directory = await root();
  const outside = await root();
  await writeFile(path.join(outside, 'secret'), 'outside');
  await rename(directory, directory + '-old');
  roots.push(directory + '-old');
  await symlink(outside, directory);
  await expect(readRepositoryFile(directory, 'secret')).rejects.toThrow(/location changed/);
  await expect(listRepositoryDirectory(directory, '')).rejects.toThrow(/location changed/);
  vi.spyOn(boundedText, 'namesOpenFiles').mockReturnValue(false);
  await expect(readRepositoryFile(outside, 'secret')).rejects.toThrow(/Linux/);
  await expect(listRepositoryDirectory(outside, '')).rejects.toThrow(/Linux/);
});
