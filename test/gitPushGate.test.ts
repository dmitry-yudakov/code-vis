import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const read = vi.hoisted(() => vi.fn());
vi.mock('@/server/repository/gitRead', async (original) => ({
  ...await original<typeof import('@/server/repository/gitRead')>(),
  runGitRead: read,
}));

import { pushCurrentBranch, withPushOffer } from '@/server/repository/gitPush';

const execute = promisify(execFile);
let repository: string;

beforeEach(async () => {
  repository = await realpath(await mkdtemp(path.join(os.tmpdir(), 'codeai-push-gate-')));
  vi.stubEnv('CODEAI_DATA_DIR', repository);
  await execute('git', ['init', '-q', '-b', 'main'], { cwd: repository });
});

afterEach(async () => {
  vi.unstubAllEnvs();
  read.mockReset();
  await rm(repository, { recursive: true, force: true });
});

// Once provisioned this read is the Docker helper, and a Git config on the host must not be asked first.
it('takes the branch and the gate from the read path, not from host Git', async () => {
  read.mockImplementation(async (_cwd: string, args: string[]) => args[0] === 'symbolic-ref' ? 'refs/heads/main\n' : 'core.sshcommand\nplanted\0');
  await expect(pushCurrentBranch(repository, 'origin/main')).rejects.toThrow('core.sshcommand');
  expect(read.mock.calls.map(([, args]) => args[0])).toEqual(['symbolic-ref', 'config']);
});

it('reads the user push default without letting host Git parse the checkout configuration', async () => {
  vi.stubEnv('HOME', repository);
  vi.stubEnv('XDG_CONFIG_HOME', '');
  await writeFile(path.join(repository, '.gitconfig'), '[remote]\n pushDefault = fork\n');
  await writeFile(path.join(repository, '.git', 'config'), 'not valid Git configuration\n');
  read.mockImplementation(async (_cwd: string, args: string[]) => args[0] === 'rev-list' ? '1\n' :
    'remote.origin.url\nssh://fixture/origin\0remote.fork.url\nssh://fixture/fork\0branch.main.remote\norigin\0branch.main.merge\nrefs/heads/main\0');
  await expect(withPushOffer(repository, { isRepository: true, branch: 'main', upstream: 'origin/main', files: [] }))
    .resolves.toMatchObject({ pushTarget: 'fork/main' });
});
