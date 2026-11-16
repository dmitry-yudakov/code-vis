import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { listRepositoryFiles } from '@/server/repository/repositoryFiles';
import * as git from '@/server/repository/gitRead';
import { runRegistry } from '@/server/runs/runRegistry';

const execute = promisify(execFile);
let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'codeai-file-search-'));
  vi.stubEnv('CODEAI_DATA_DIR', path.join(directory, 'data'));
  vi.stubEnv('CODEAI_DOCKER_ENABLED', 'false');
  vi.stubEnv('XDG_CONFIG_HOME', path.join(directory, 'settings'));
});
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });

it('lists tracked and untracked paths with Git ignore rules, deduplicating staged modifications', async () => {
  await execute('git', ['init'], { cwd: directory });
  await writeFile(path.join(directory, '.gitignore'), 'ignored.txt\n');
  for (const name of ['tracked.txt', 'untracked file.txt', 'ignored.txt']) await writeFile(path.join(directory, name), 'content');
  await execute('git', ['add', 'tracked.txt'], { cwd: directory });
  await writeFile(path.join(directory, 'tracked.txt'), 'changed');
  expect((await listRepositoryFiles(directory)).paths).toEqual(['.gitignore', 'tracked.txt', 'untracked file.txt']);
});

it('supports plain project folders and skips generated folders and symlinks', async () => {
  await mkdir(path.join(directory, 'docs'));
  await mkdir(path.join(directory, 'node_modules'));
  await writeFile(path.join(directory, 'node_modules', 'generated.js'), 'ignored');
  await writeFile(path.join(directory, 'docs', 'notes.md'), '# Notes');
  await writeFile(path.join(directory, '.hidden'), 'hidden');
  await symlink('/etc', path.join(directory, 'outside'));
  expect((await listRepositoryFiles(directory)).paths).toEqual(['.hidden', 'docs/notes.md']);
});

it('honors personal ignores through the shared Git reader', async () => {
  await execute('git', ['init'], { cwd: directory });
  const settings = path.join(directory, 'settings', 'git');
  await mkdir(settings, { recursive: true });
  await writeFile(path.join(settings, 'ignore'), 'personal.txt\nsettings/\n');
  await writeFile(path.join(directory, 'personal.txt'), 'ignored');
  await writeFile(path.join(directory, 'visible.txt'), 'visible');
  expect((await listRepositoryFiles(directory)).paths).toEqual(['visible.txt']);
});

it('fails visibly at collection limits instead of searching an incomplete prefix', async () => {
  vi.spyOn(git, 'runGitRead').mockResolvedValueOnce(Array.from({ length: 50001 }, (_, index) => `${index}.ts\0`).join(''));
  await expect(listRepositoryFiles(directory)).rejects.toThrow(/50,000/);
  vi.mocked(git.runGitRead).mockRejectedValueOnce(Object.assign(new Error('overflow'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }));
  await expect(listRepositoryFiles(directory)).rejects.toThrow(/5 MiB/);
  const release = runRegistry.acquireCheckoutWrite(directory);
  expect(release).toBeTypeOf('function');
  release?.();
});

it('refuses busy checkouts and replaced roots, and releases ownership for a retry', async () => {
  const release = runRegistry.acquireCheckoutWrite(directory)!;
  await expect(listRepositoryFiles(directory)).rejects.toMatchObject({ status: 409 });
  release();
  expect(await listRepositoryFiles(directory)).toEqual({ paths: [] });
  await mkdir(path.join(directory, 'outside'));
  const old = path.join(directory, 'original');
  await mkdir(old);
  const replaced = path.join(directory, 'replaced');
  await rename(old, replaced);
  await symlink(path.join(directory, 'outside'), old);
  await expect(listRepositoryFiles(old)).rejects.toThrow(/location changed/);
});

it('bounds the total path bytes in plain folders as well as Git listings', async () => {
  let nested = directory;
  for (let depth = 0; depth < 15; depth++) {
    nested = path.join(nested, 'a'.repeat(200));
    await mkdir(nested);
  }
  await Promise.all(Array.from({ length: 1900 }, (_, index) => writeFile(path.join(nested, `${index}.txt`), '')));
  await expect(listRepositoryFiles(directory)).rejects.toThrow(/5 MiB/);
});
