import { execFile } from 'node:child_process';
import { access, chmod, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { changeGitIndex, commitGitIndex } from '@/server/repository/gitChanges';
import { readGitIndexState } from '@/server/repository/gitIndex';
import { runRegistry } from '@/server/runs/runRegistry';

const execute = promisify(execFile);
let scratch: string;
let cwd: string;
const git = async (...args: string[]) => (await execute('git', args, { cwd })).stdout.trim();
const write = (name: string, text: string) => writeFile(path.join(cwd, name), text);
const change = async (action: 'stage' | 'unstage', paths: string[]) => changeGitIndex(cwd, action, paths, await readGitIndexState(cwd));
const commit = async (message = 'Save staged work\n\nDetails ✓') => commitGitIndex(cwd, message, await readGitIndexState(cwd));
beforeEach(async () => {
  scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), 'codeai-changes-')));
  cwd = path.join(scratch, 'repo'); await mkdir(cwd);
  vi.stubEnv('CODEAI_DATA_DIR', path.join(scratch, 'data'));
  vi.stubEnv('CODEAI_REPOSITORIES_ROOT', scratch);
  vi.stubEnv('CODEAI_DOCKER_ENABLED', 'false');
  vi.stubEnv('HOME', scratch); vi.stubEnv('XDG_CONFIG_HOME', scratch);
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  await git('init', '-q', '-b', 'main');
  await git('config', 'user.name', 'Changes Test'); await git('config', 'user.email', 'changes@example.invalid');
  await write('tracked.txt', 'original\n'); await git('add', '.'); await git('commit', '-qm', 'initial');
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(scratch, { recursive: true, force: true }); });
it('stages chosen literal files, commits only the index and leaves later working edits intact', async () => {
  await write('tracked.txt', 'staged\n'); await write('new [file].txt', 'new\n'); await write('leave.txt', 'leave\n');
  await change('stage', ['tracked.txt', 'new [file].txt']);
  await write('tracked.txt', 'later\n');
  const hash = await commit();
  expect(hash).toMatch(/^[a-f0-9]{40,64}$/);
  expect(await git('show', 'HEAD:tracked.txt')).toBe('staged');
  expect(await git('show', 'HEAD:new [file].txt')).toBe('new');
  expect(await git('log', '-1', '--format=%B')).toBe('Save staged work\n\nDetails ✓');
  expect(await readFile(path.join(cwd, 'tracked.txt'), 'utf8')).toBe('later\n');
  expect(await git('status', '--porcelain')).toContain('?? leave.txt');
});
it('unstages renames and deletions without altering working files', async () => {
  await rename(path.join(cwd, 'tracked.txt'), path.join(cwd, 'renamed.txt')); await git('add', '-A');
  await change('unstage', ['renamed.txt']);
  expect(await git('diff', '--cached', '--name-only')).toBe('');
  expect(await readFile(path.join(cwd, 'renamed.txt'), 'utf8')).toBe('original\n');
  await change('stage', ['tracked.txt', 'renamed.txt']); await commit();
  await rm(path.join(cwd, 'renamed.txt')); await change('stage', ['renamed.txt']);
  expect(await git('diff', '--cached', '--name-status')).toContain('D\trenamed.txt');
  await change('unstage', ['renamed.txt']); expect(await git('diff', '--cached', '--name-only')).toBe('');
  expect(await access(path.join(cwd, 'renamed.txt')).then(() => true, () => false)).toBe(false);
});
it('stages and unstages the first commit in an unborn repository', async () => {
  await git('checkout', '--orphan', 'new'); await git('rm', '--cached', '-r', '.');
  await change('stage', ['tracked.txt']); await write('tracked.txt', 'later\n');
  await change('unstage', ['tracked.txt']); expect(await git('ls-files')).toBe('');
  await change('stage', ['tracked.txt']); await commit('First'); expect(await git('log', '--format=%s')).toBe('First');
});
it('rejects stale index or HEAD and empty commits/messages without losing edits', async () => {
  await write('tracked.txt', 'changed\n'); const state = await readGitIndexState(cwd);
  await git('add', '.');
  await expect(commitGitIndex(cwd, 'Stale', state)).rejects.toThrow(/changed.*refresh/i);
  await expect(changeGitIndex(cwd, 'unstage', ['tracked.txt'], state)).rejects.toThrow(/changed.*refresh/i);
  await expect(commit('   ')).rejects.toThrow(/message/i);
  await commit(); await expect(commit()).rejects.toThrow(/staged/i);
  expect(await git('rev-list', '--count', 'HEAD')).toBe('2');
});
it.each(['../outside', '/tmp/file', ':', '--all', 'missing.txt', '.'])('refuses paths outside the changed-file list: %s', async file => {
  await expect(change('stage', [file])).rejects.toThrow(/file|path|changed/i);
  expect(await git('diff', '--cached', '--name-only')).toBe('');
});
it('rejects a busy checkout and unsafe local configuration, releasing access after failure', async () => {
  await write('tracked.txt', 'changed'); const state = await readGitIndexState(cwd);
  const release = runRegistry.acquireCheckoutWrite(cwd)!;
  await expect(changeGitIndex(cwd, 'stage', ['tracked.txt'], state)).rejects.toThrow(/using this checkout|being edited/); release();
  await git('config', 'filter.evil.clean', 'exit 1');
  await expect(change('stage', ['tracked.txt'])).rejects.toThrow(/configuration/);
  await git('config', '--remove-section', 'filter.evil'); await change('stage', ['tracked.txt']); await commit();
});
it('never runs hooks, filters, signing tools or ambient Git overrides', async () => {
  const marker = path.join(scratch, 'ran');
  await write('.git/hooks/pre-commit', `#!/bin/sh\ntouch '${marker}'\nexit 1\n`); await chmod(path.join(cwd, '.git/hooks/pre-commit'), 0o755);
  await write('.gitattributes', 'tracked.txt filter=evil\n');
  await writeFile(path.join(scratch, '.gitconfig'), `[filter "evil"]\n clean = touch '${marker}'\n[commit]\n gpgsign = true\n`);
  await write('tracked.txt', 'changed'); await change('stage', ['tracked.txt']); await commit();
  expect(await access(marker).then(() => true, () => false)).toBe(false);
});

it('stages later edits on a staged rename without trying to add its absent former path', async () => {
  await git('mv', 'tracked.txt', 'renamed.txt'); await write('renamed.txt', 'later edit\n');
  await change('stage', ['renamed.txt']); await commit();
  expect(await git('show', 'HEAD:renamed.txt')).toBe('later edit');
});
it('uses the owner global Git identity when the repository has none', async () => {
  await git('config', '--unset', 'user.name'); await git('config', '--unset', 'user.email');
  await writeFile(path.join(scratch, '.gitconfig'), '[user]\n name = Global Owner\n email = owner@example.invalid\n');
  await write('tracked.txt', 'global identity'); await change('stage', ['tracked.txt']); await commit();
  expect(await git('log', '-1', '--format=%an <%ae>')).toBe('Global Owner <owner@example.invalid>');
});
it('refuses missing identity and an unfinished merge, then recovers without losing staged work', async () => {
  await git('config', '--unset', 'user.name'); await git('config', '--unset', 'user.email');
  await write('tracked.txt', 'changed'); await change('stage', ['tracked.txt']);
  await expect(commit()).rejects.toThrow(/user.name and user.email/);
  await git('config', 'user.name', 'Fixed'); await git('config', 'user.email', 'fixed@example.invalid');
  await write('.git/MERGE_HEAD', await git('rev-parse', 'HEAD'));
  await expect(commit()).rejects.toThrow(/Finish or abort/); await rm(path.join(cwd, '.git/MERGE_HEAD'));
  await commit(); expect(await git('show', 'HEAD:tracked.txt')).toBe('changed');
});

it('delivers large filename batches without overflowing mutation output, including unborn unstage', async () => {
  await git('checkout', '--orphan', 'large'); await git('rm', '--cached', '-r', '.');
  const files = Array.from({ length: 400 }, (_, i) => `${String(i).padStart(4, '0')}-${'long-file-name-'.repeat(12)}.txt`);
  await Promise.all(files.map(file => write(file, 'batch\n')));
  await change('stage', files); await change('unstage', files);
  expect(await git('ls-files')).toBe('');
  await change('stage', files); const hash = await commit('Large batch');
  expect(hash).toMatch(/^[a-f0-9]{40,64}$/);
  expect((await git('ls-tree', '--name-only', 'HEAD')).split('\n')).toHaveLength(400);
});

it('stages and commits a managed worktree while excluding its source and sibling writers', async () => {
  const { getConfig } = await import('@/server/config');
  const { CheckoutRegistry } = await import('@/server/repository/checkoutRegistry');
  const { createManagedWorktree, readWorktreeRecords } = await import('@/server/repository/managedWorktrees');
  const { getSessionStore } = await import('@/server/storage/sessionStore');
  const source = cwd;
  vi.stubEnv('CODEAI_REPOSITORIES_ROOT', source);
  vi.stubEnv('CODEAI_WORKTREES_ROOT', path.join(scratch, 'worktrees'));
  const config = getConfig();
  try {
    const checkoutId = (await new CheckoutRegistry(source).list())[0].id;
    for (let i = 0; i < 2; i++) await createManagedWorktree({ provider: 'claude', checkoutId, checkoutMode: 'worktree', creationRequestId: crypto.randomUUID() }, config);
    const [selected, sibling] = await readWorktreeRecords(config.dataDir);
    cwd = selected.destination;
    await write('tracked.txt', 'managed change\n'); const state = await readGitIndexState(cwd);
    for (const target of [source, sibling.destination]) {
      const release = runRegistry.acquireCheckoutWrite(target)!;
      try { await expect(changeGitIndex(cwd, 'stage', ['tracked.txt'], state)).rejects.toThrow(/using this checkout|being edited/); }
      finally { release(); }
    }
    await change('stage', ['tracked.txt']); await commit('Managed change');
    expect(await git('show', 'HEAD:tracked.txt')).toBe('managed change');
    cwd = source;
    expect(await git('show', 'HEAD:tracked.txt')).toBe('original');
    expect(await git('diff', '--cached', '--name-only')).toBe('');
  } finally { await getSessionStore(config.dataDir).close(); }
});
it('rejects unresolved index conflicts without changing the index or working files', async () => {
  await git('switch', '-qc', 'other'); await write('tracked.txt', 'other\n'); await git('commit', '-qam', 'other');
  await git('switch', '-q', 'main'); await write('tracked.txt', 'main\n'); await git('commit', '-qam', 'main');
  await expect(git('merge', 'other')).rejects.toThrow();
  const beforeIndex = await git('ls-files', '--stage'); const beforeText = await readFile(path.join(cwd, 'tracked.txt'), 'utf8');
  await expect(commit()).rejects.toThrow(/Resolve and stage conflicted/);
  expect(await git('ls-files', '--stage')).toBe(beforeIndex); expect(await readFile(path.join(cwd, 'tracked.txt'), 'utf8')).toBe(beforeText);
});
it('refuses committing from detached HEAD without losing staged edits', async () => {
  await write('tracked.txt', 'detached work\n'); await change('stage', ['tracked.txt']);
  await git('checkout', '--detach', '-q');
  await expect(commit()).rejects.toThrow(/local branch/);
  expect(await git('diff', '--cached')).toContain('+detached work');
});
it('rejects retrying an already-delivered commit with its previous snapshot', async () => {
  await write('tracked.txt', 'new commit\n'); await change('stage', ['tracked.txt']); const state = await readGitIndexState(cwd);
  await commitGitIndex(cwd, 'Exactly once', state);
  await expect(commitGitIndex(cwd, 'Exactly once', state)).rejects.toThrow(/changed.*refresh/i);
  expect(await git('rev-list', '--count', 'HEAD')).toBe('2');
});
