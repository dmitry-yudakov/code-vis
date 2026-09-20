import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOCKER_LABEL, DOCKER_PROFILE } from '@/server/execution/dockerProfile';

const mocks = vi.hoisted(() => ({ command: vi.fn() }));
vi.mock('@/server/execution/dockerCommand', () => ({
  localDockerEndpoint: async () => 'unix:///fixture/docker.sock',
  dockerCommand: mocks.command,
}));

import { findChangedFile, readFileDiff, readWorkingTree } from '@/server/repository/gitRepository';

const execute = promisify(execFile);
const directories: string[] = [];
let dataDir: string;
let repository: string;

beforeEach(async () => {
  dataDir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'codeai-git-read-data-')));
  repository = await realpath(await mkdtemp(path.join(os.tmpdir(), 'codeai-git-read-')));
  directories.push(dataDir, repository);
  vi.stubEnv('CODEAI_DATA_DIR', dataDir);
  await execute('git', ['init', '-b', 'main'], { cwd: repository });
  await writeFile(path.join(repository, 'new note.md'), '# untracked\n');
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('Git read isolation', () => {
  it('keeps host Git for status and diff while Docker is enabled but not yet provisioned', async () => {
    vi.stubEnv('CODEAI_DOCKER_ENABLED', 'true');
    const tree = await readWorkingTree(repository);
    expect(tree).toMatchObject({ isRepository: true, branch: 'main' });
    const diff = await readFileDiff(repository, findChangedFile(tree, 'new note.md')!);
    expect(diff.unstaged).toContain('+# untracked');
    expect(mocks.command).not.toHaveBeenCalled();
  });

  it('isolates reads once provisioned, even with Docker turns disabled, and refuses a different engine', async () => {
    vi.stubEnv('CODEAI_DOCKER_ENABLED', 'false');
    await mkdir(path.join(dataDir, 'docker'));
    await writeFile(path.join(dataDir, 'docker', 'profile.json'), JSON.stringify({
      profile: DOCKER_PROFILE, image: `sha256:${'a'.repeat(64)}`, engineId: 'engine-original',
    }));
    let engine = 'engine-original';
    mocks.command.mockImplementation(async (input: string[]) => {
      if (input[2] === 'info') return engine;
      if (input[3] === 'ls') return '';
      throw new Error(`The helper is not started here: ${input[2]}`);
    });
    const creations = () => mocks.command.mock.calls.map(([input]) => input.slice(2)).filter((args) => args[0] === 'create');
    // Recovery succeeds once for this data directory, so both reads reach the isolation decision.
    await expect(readWorkingTree(repository)).rejects.toThrow('Could not read Git status');
    expect(creations()).toEqual([expect.arrayContaining([
      `${DOCKER_LABEL}.kind=git`, '--network', 'none', `type=bind,src=${repository},dst=/workspace,readonly`,
    ])]);
    engine = 'engine-replacement';
    await expect(readWorkingTree(repository)).rejects.toThrow('Could not read Git status');
    expect(creations()).toHaveLength(1);
  });

  it('fails closed when the provisioning record cannot be checked', async () => {
    vi.stubEnv('CODEAI_DOCKER_ENABLED', 'false');
    // Recovery is already complete for this data directory, so the read reaches its own check.
    await expect(readWorkingTree(repository)).resolves.toMatchObject({ isRepository: true });
    await writeFile(path.join(dataDir, 'docker'), 'not a directory');
    await expect(readWorkingTree(repository)).rejects.toThrow('Could not read Git status');
  });
});
