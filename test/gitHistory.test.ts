import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { readGitHistory } from '@/server/repository/gitHistory';

const execute = promisify(execFile);
let root: string;
const git = (cwd: string, args: string[]) => execute('git', args, { cwd });
async function repository() {
  const cwd = await mkdtemp(path.join(root, 'repo-'));
  await git(cwd, ['init', '-b', 'main']);
  await git(cwd, ['config', 'user.name', 'History Test']);
  await git(cwd, ['config', 'user.email', 'history@example.invalid']);
  await git(cwd, ['config', 'commit.gpgsign', 'false']);
  return cwd;
}
beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'codeai-history-'));
  vi.stubEnv('CODEAI_DATA_DIR', path.join(root, 'data'));
  vi.stubEnv('CODEAI_DOCKER_ENABLED', 'false');
});
afterAll(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });

it('distinguishes a non-repository from a branch without commits', async () => {
  expect(await readGitHistory(root)).toEqual({ isRepository: false, commits: [], truncated: false });
  expect(await readGitHistory(await repository())).toEqual({ isRepository: true, commits: [], truncated: false });
});

it('reads HEAD history newest first, without following other branches or changing HEAD/index', async () => {
  const cwd = await repository();
  await git(cwd, ['commit', '--allow-empty', '-m', 'First commit']);
  await git(cwd, ['checkout', '-b', 'other']);
  await git(cwd, ['commit', '--allow-empty', '-m', 'Other branch']);
  await git(cwd, ['checkout', 'main']);
  await git(cwd, ['commit', '--allow-empty', '-m', 'Fix Unicode ✓ and <markup>\n\nBody stays separate.']);
  const before = await git(cwd, ['status', '--porcelain=v1', '--branch']);
  const history = await readGitHistory(cwd);
  expect(history.isRepository).toBe(true);
  expect(history.truncated).toBe(false);
  expect(history.commits.map(commit => commit.subject)).toEqual(['Fix Unicode ✓ and <markup>', 'First commit']);
  expect(history.commits[0]).toEqual({
    hash: expect.stringMatching(/^[a-f0-9]{40}$/), author: 'History Test',
    date: expect.stringMatching(/^\d{4}-\d\d-\d\dT/), subject: 'Fix Unicode ✓ and <markup>',
  });
  expect(await git(cwd, ['status', '--porcelain=v1', '--branch'])).toEqual(before);
  await git(cwd, ['checkout', '--detach']);
  expect((await readGitHistory(cwd)).commits).toEqual(history.commits);
});

it('bounds recent history to 100 commits and explicitly reports older commits', async () => {
  const cwd = await repository();
  for (let i = 0; i < 101; i++) await git(cwd, ['commit', '--allow-empty', '-m', `Commit ${i}`]);
  const history = await readGitHistory(cwd);
  expect(history.commits).toHaveLength(100);
  expect(history.commits[0].subject).toBe('Commit 100');
  expect(history.commits[99].subject).toBe('Commit 1');
  expect(history.truncated).toBe(true);
});

it('refuses oversized output as a whole and recovers on a readable branch', async () => {
  const cwd = await repository();
  await writeFile(path.join(root, 'message'), 'a'.repeat(2 * 1024 * 1024));
  await git(cwd, ['commit', '--quiet', '--allow-empty', '-F', path.join(root, 'message')]);
  await expect(readGitHistory(cwd)).rejects.toThrow('2 MiB');
  await git(cwd, ['checkout', '--orphan', 'readable']);
  await git(cwd, ['commit', '--allow-empty', '-m', 'Readable']);
  expect((await readGitHistory(cwd)).commits[0].subject).toBe('Readable');
});

it('reads full messages and root patches, then rename/delete/binary changes without changing the worktree', async () => {
  const { readGitCommit, readGitCommitPatch } = await import('@/server/repository/gitHistory');
  const cwd = await repository();
  await writeFile(path.join(cwd, 'old [name].txt'), 'first\n');
  await git(cwd, ['add', '.']); await git(cwd, ['commit', '-m', 'First\n\nFull body ✓']);
  const first = (await git(cwd, ['rev-parse', 'HEAD'])).stdout.trim();
  const root = await readGitCommit(cwd, first);
  expect(root.message).toBe('First\n\nFull body ✓'); expect(root.parents).toEqual([]);
  expect(root.files).toEqual([{ path: 'old [name].txt', status: 'A' }]);
  expect(await readGitCommitPatch(cwd, first, 'old [name].txt')).toContain('+first');
  await git(cwd, ['mv', 'old [name].txt', 'new\nname.txt']);
  await writeFile(path.join(cwd, 'binary.dat'), Buffer.from([0, 1, 2, 255]));
  await git(cwd, ['add', '.']); await git(cwd, ['commit', '-m', 'Rename and binary']);
  const hash = (await git(cwd, ['rev-parse', 'HEAD'])).stdout.trim();
  const before = await git(cwd, ['status', '--porcelain']);
  const details = await readGitCommit(cwd, hash);
  expect(details).toMatchObject({ author: 'History Test', email: 'history@example.invalid', parents: [first] });
  expect(details.files).toContainEqual({ path: 'new\nname.txt', previousPath: 'old [name].txt', status: 'R100' });
  expect(await readGitCommitPatch(cwd, hash, 'new\nname.txt')).toContain('rename from');
  expect(await readGitCommitPatch(cwd, hash, 'binary.dat')).toContain('Binary files');
  await expect(readGitCommitPatch(cwd, hash, '../outside')).rejects.toThrow(/changed in this commit/);
  await expect(readGitCommit(cwd, 'HEAD~1')).rejects.toThrow(/full commit hash/);
  expect(await git(cwd, ['status', '--porcelain'])).toEqual(before);
  await git(cwd, ['rm', 'new\nname.txt']); await git(cwd, ['commit', '-m', 'Delete']);
  const deleted = (await git(cwd, ['rev-parse', 'HEAD'])).stdout.trim();
  expect((await readGitCommit(cwd, deleted)).files).toContainEqual({ path: 'new\nname.txt', status: 'D' });
  expect(await readGitCommitPatch(cwd, deleted, 'new\nname.txt')).toContain('-first');
});

it('compares merge commits with their first parent and reads empty commits', async () => {
  const { readGitCommit, readGitCommitPatch } = await import('@/server/repository/gitHistory');
  const cwd = await repository(); await git(cwd, ['commit', '--allow-empty', '-m', 'Root']);
  const root = (await git(cwd, ['rev-parse', 'HEAD'])).stdout.trim();
  expect((await readGitCommit(cwd, root)).files).toEqual([]);
  await git(cwd, ['checkout', '-b', 'other']); await writeFile(path.join(cwd, 'other.txt'), 'other\n');
  await git(cwd, ['add', '.']); await git(cwd, ['commit', '-m', 'Other']);
  await git(cwd, ['checkout', 'main']); await git(cwd, ['commit', '--allow-empty', '-m', 'Main']);
  await git(cwd, ['merge', '--no-ff', 'other', '-m', 'Merge']);
  const hash = (await git(cwd, ['rev-parse', 'HEAD'])).stdout.trim();
  expect((await readGitCommit(cwd, hash)).parents).toHaveLength(2);
  expect((await readGitCommit(cwd, hash)).files).toEqual([{ path: 'other.txt', status: 'A' }]);
  expect(await readGitCommitPatch(cwd, hash, 'other.txt')).toContain('+other');
});
