import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
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
const IMAGE = `sha256:${'a'.repeat(64)}`;
let dataDir: string;
let home: string;
let repository: string;

beforeEach(async () => {
  dataDir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'codeai-git-read-data-')));
  home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'codeai-git-read-home-')));
  repository = await realpath(await mkdtemp(path.join(os.tmpdir(), 'codeai-git-read-')));
  directories.push(dataDir, home, repository);
  vi.stubEnv('CODEAI_DATA_DIR', dataDir);
  // The developer's own personal ignore file must not change these results.
  vi.stubEnv('HOME', home);
  vi.stubEnv('XDG_CONFIG_HOME', '');
  await execute('git', ['init', '-b', 'main'], { cwd: repository });
  await writeFile(path.join(repository, 'new note.md'), '# untracked\n');
});

async function recordProvisionedProfile(): Promise<void> {
  await mkdir(path.join(dataDir, 'docker'));
  await writeFile(path.join(dataDir, 'docker', 'profile.json'), JSON.stringify({
    profile: DOCKER_PROFILE, image: IMAGE, engineId: 'engine-original',
  }));
}

const personalIgnorePath = () => path.join(home, '.config', 'git', 'ignore');

async function writePersonalIgnore(patterns: string): Promise<void> {
  await mkdir(path.dirname(personalIgnorePath()), { recursive: true });
  await writeFile(personalIgnorePath(), patterns);
}

const changedPaths = async () => (await readWorkingTree(repository)).files.map((file) => file.path);

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
    await recordProvisionedProfile();
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

  it('honors the personal ignore file before provisioning, where Git looks for it', async () => {
    await writePersonalIgnore('personal.log\n');
    await writeFile(path.join(repository, 'personal.log'), 'noise\n');
    expect(await changedPaths()).toEqual(['new note.md']);

    const configHome = path.join(home, 'xdg');
    await mkdir(path.join(configHome, 'git'), { recursive: true });
    await writeFile(path.join(configHome, 'git', 'ignore'), 'new note.md\n');
    vi.stubEnv('XDG_CONFIG_HOME', configHome);
    expect(await changedPaths()).toEqual(['personal.log']);
    // A relative value is ignored, so ~/.config applies again.
    vi.stubEnv('XDG_CONFIG_HOME', path.relative(process.cwd(), configHome));
    expect(await changedPaths()).toEqual(['new note.md']);
  });

  it('reads an oversized, NUL-carrying, non-UTF-8, or non-regular personal ignore file as none', async () => {
    await writeFile(path.join(repository, 'personal.log'), 'noise\n');
    await writePersonalIgnore(`personal.log\n#${'x'.repeat(64 * 1024)}\n`);
    expect(await changedPaths()).toEqual(['new note.md', 'personal.log']);
    await writePersonalIgnore('personal.log\n\0\n');
    expect(await changedPaths()).toEqual(['new note.md', 'personal.log']);
    await mkdir(path.dirname(personalIgnorePath()), { recursive: true });
    await writeFile(personalIgnorePath(), Buffer.from('personal.log\ncaf\xe9\n', 'latin1'));
    expect(await changedPaths()).toEqual(['new note.md', 'personal.log']);
    // Reading a FIFO would block the Git read until its timeout.
    await rm(personalIgnorePath());
    await execute('mkfifo', [personalIgnorePath()]);
    expect(await changedPaths()).toEqual(['new note.md', 'personal.log']);
  });

  it('passes the personal ignore patterns, never a host path, to the isolated helper', async () => {
    vi.stubEnv('CODEAI_DOCKER_ENABLED', 'false');
    await recordProvisionedProfile();
    mocks.command.mockImplementation(async (input: string[]) => {
      if (input[2] === 'info') return 'engine-original';
      if (input[3] === 'ls') return '';
      throw new Error(`The helper is not started here: ${input[2]}`);
    });
    await expect(readWorkingTree(repository)).rejects.toThrow('Could not read Git status');

    const target = path.join(home, 'dotfiles', 'ignore');
    await mkdir(path.dirname(target));
    await writeFile(target, 'personal.log\n');
    await mkdir(path.dirname(personalIgnorePath()), { recursive: true });
    await symlink(target, personalIgnorePath());
    await expect(readWorkingTree(repository)).rejects.toThrow('Could not read Git status');

    const creations = mocks.command.mock.calls.filter(([input]) => input[2] === 'create');
    expect(creations.map(([, options]) => options.env)).toEqual([
      { CODEAI_PERSONAL_IGNORE: '' }, { CODEAI_PERSONAL_IGNORE: 'personal.log\n' },
    ]);
    for (const [input] of creations) {
      expect(input.filter((arg: string) => arg.startsWith('type=bind'))).toEqual([`type=bind,src=${repository},dst=/workspace,readonly`]);
      expect(input.join('\n')).not.toContain('personal.log');
      const image = input.indexOf(IMAGE);
      expect(input.slice(image - 4, image + 6)).toEqual([
        '--env', 'CODEAI_PERSONAL_IGNORE', '--entrypoint', '/bin/sh', IMAGE,
        '-c', 'printf %s "$CODEAI_PERSONAL_IGNORE" > /tmp/personal-git-ignore && exec git "$@"',
        'sh', '-c', 'safe.directory=/workspace',
      ]);
      expect(input).toContain('core.excludesFile=/tmp/personal-git-ignore');
    }
  });

  it('fails closed when the provisioning record cannot be checked', async () => {
    vi.stubEnv('CODEAI_DOCKER_ENABLED', 'false');
    // Recovery is already complete for this data directory, so the read reaches its own check.
    await expect(readWorkingTree(repository)).resolves.toMatchObject({ isRepository: true });
    await writeFile(path.join(dataDir, 'docker'), 'not a directory');
    await expect(readWorkingTree(repository)).rejects.toThrow('Could not read Git status');
  });
});
