import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('@/server/repository/gitRead', async original => ({ ...await original<typeof import('@/server/repository/gitRead')>(), runGitRead: state.read }));
import { parseGitIndexStatus, readGitIndexStatus } from '@/server/repository/gitIndex';
const head = '# branch.oid ' + 'a'.repeat(40) + '\0# branch.head main\0';
const entry = (xy: string, file = 'file.txt', blob = 'b'.repeat(40), workMode = '100644') => `1 ${xy} N... 100644 100644 ${workMode} ${'c'.repeat(40)} ${blob} ${file}\0`;
beforeEach(() => { state.read.mockReset(); });
it('derives the displayed files and their mutation token from exactly one bounded status result', async () => {
  const snapshot = head + entry('M.', 'already-staged.txt') + entry('MM', 'newly-staged.txt');
  state.read.mockResolvedValueOnce(snapshot).mockRejectedValueOnce(new Error('A second read would see a different index.'));
  const tree = await readGitIndexStatus('/repo');
  expect(tree.files.map(file => [file.path, file.staged])).toEqual([['already-staged.txt', true], ['newly-staged.txt', true]]);
  expect(tree.indexState).toBe(parseGitIndexStatus(snapshot).indexState);
  expect(state.read).toHaveBeenCalledTimes(1);
  expect(state.read.mock.calls[0][1]).toContain('--porcelain=v2');
});
it('does not serialize every tracked path to enable mutations in a clean repository', async () => {
  state.read.mockResolvedValue(head);
  expect(await readGitIndexStatus('/large-repo')).toMatchObject({ isRepository: true, files: [], indexState: expect.any(String) });
  expect(state.read).toHaveBeenCalledTimes(1);
  expect(state.read.mock.calls[0][1][2]).toBe('status');
});
it('ignores unstaged content, worktree modes and untracked files in the staged token', () => {
  const before = parseGitIndexStatus(head + entry('M.'));
  const after = parseGitIndexStatus(head + entry('MM', 'file.txt', 'b'.repeat(40), '100755') + '? untracked [name].txt\0');
  expect(after.indexState).toBe(before.indexState);
  expect(after.files).toContainEqual({ path: 'untracked [name].txt', status: 'untracked', staged: false, unstaged: false });
  expect(after.files[0].unstaged).toBe(true);
});
it('changes the token for different staged blobs, paths, branch or HEAD', () => {
  const initial = parseGitIndexStatus(head + entry('M.')).indexState;
  for (const snapshot of [head + entry('M.', 'file.txt', 'd'.repeat(40)), head + entry('M.', 'renamed.txt'), head.replace('main', 'other') + entry('M.'), head.replace('a'.repeat(40), 'e'.repeat(40)) + entry('M.')]) {
    expect(parseGitIndexStatus(snapshot).indexState).not.toBe(initial);
  }
});
it('preserves rename paths, whitespace, conflicts and branch tracking metadata', () => {
  const output = head + '# branch.upstream origin/main\0# branch.ab +2 -3\0'
    + `2 RM N... 100644 100644 100644 ${'c'.repeat(40)} ${'b'.repeat(40)} R100 new\n [name].txt\0 old name.txt\0`
    + `u UU N... 100644 100644 100644 100644 ${'a'.repeat(40)} ${'b'.repeat(40)} ${'c'.repeat(40)} conflict.txt\0`;
  expect(parseGitIndexStatus(output)).toMatchObject({ branch: 'main', upstream: 'origin/main', ahead: 2, behind: 3, files: [
    { path: 'conflict.txt', status: 'conflicted', staged: true, unstaged: true },
    { path: 'new\n [name].txt', previousPath: ' old name.txt', status: 'renamed', staged: true, unstaged: true },
  ] });
});
it('handles unborn/detached HEAD and keeps non-repositories distinguishable', async () => {
  expect(parseGitIndexStatus('# branch.oid (initial)\0# branch.head main\0')).toMatchObject({ unborn: true, branch: 'main' });
  expect(parseGitIndexStatus(head.replace('main', '(detached)')).branch).toBe('Detached HEAD');
  state.read.mockRejectedValue({ code: 128, stderr: 'fatal: not a git repository' });
  expect(await readGitIndexStatus('/outside')).toEqual({ isRepository: false, files: [] });
});
it('reports bounded, path-free status failures and permits a later retry', async () => {
  state.read.mockRejectedValueOnce({ code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' });
  await expect(readGitIndexStatus('/repo')).rejects.toThrow('5 MiB');
  state.read.mockRejectedValueOnce(new Error('/private/repo is broken'));
  await expect(readGitIndexStatus('/repo')).rejects.toThrow('Could not read Git status. Refresh Changes and retry.');
  state.read.mockResolvedValueOnce(head);
  expect((await readGitIndexStatus('/repo')).indexState).toBeDefined();
});
