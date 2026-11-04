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
