import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { getConfig } from '@/server/config';
import { DockerRuntime } from '@/server/execution/dockerRuntime';
import {
  compareCliVersions, isCliVersion, providerVolume, DOCKER_HOME, DOCKER_IMAGE_TAG, DOCKER_LABEL, DOCKER_PROFILE, DOCKER_VERSIONS,
} from '@/server/execution/dockerProfile';
import {
  dockerVersionsPath, planDockerUpdate, readDockerVersions, runDockerUpdate, DockerUpdateRejected,
} from '@/server/execution/dockerUpgrade';
import { AGENT_MODES, requiredFlagsForMode } from '@/server/agents/claudeInvocation';

const mocks = vi.hoisted(() => ({ command: vi.fn(), spawn: vi.fn(), failAfterRename: '' }));
vi.mock('@/server/storage/sessionStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/storage/sessionStore')>();
  return {
    ...actual,
    atomicWrite: async (...args: Parameters<typeof actual.atomicWrite>) => {
      await actual.atomicWrite(...args);
      if (args[0] === mocks.failAfterRename) throw new Error(`EIO: i/o error, fsync '${args[0]}'`);
    },
  };
});
vi.mock('@/server/execution/dockerCommand', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/server/execution/dockerCommand')>(),
  localDockerEndpoint: async () => 'unix:///fixture/docker.sock',
  dockerCommand: mocks.command,
  removeContainerDetached: vi.fn(),
  spawnDocker: mocks.spawn,
}));

const FAKE_CODEX = path.resolve('test/fixtures/fake-codex.mjs');
const BASE = `sha256:${'a'.repeat(64)}`;
const CANDIDATE = `sha256:${'c'.repeat(64)}`;
const OTHER = `sha256:${'d'.repeat(64)}`;
const FULL_HELP = [...new Set(AGENT_MODES.flatMap((mode) => requiredFlagsForMode(mode))), '--model', '--effort'].join(' ');

const directories: string[] = [];
afterEach(async () => {
  vi.resetAllMocks();
  mocks.failAfterRename = '';
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});
beforeAll(async () => { await import('node:fs/promises').then(({ chmod }) => chmod(FAKE_CODEX, 0o755)); });

type Versions = { claude: string; codex: string };

/** A Docker daemon holding the recorded image, answering exactly what an update and its checks ask. */
async function installation(options: { versions?: unknown; profile?: boolean } = {}) {
  const dataDir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'codeai-upgrade-')));
  directories.push(dataDir);
  await mkdir(path.join(dataDir, 'docker'));
  const profileFile = path.join(dataDir, 'docker', 'profile.json');
  if (options.profile !== false) {
    await writeFile(profileFile, JSON.stringify({ profile: DOCKER_PROFILE, image: BASE, engineId: 'engine-original' }));
  }
  if (options.versions !== undefined) await writeFile(dockerVersionsPath(dataDir), JSON.stringify(options.versions));
  const runtime = new DockerRuntime({ ...getConfig(), dataDir, dockerEnabled: true });
  const state = {
    engine: 'engine-original',
    images: new Map<string, Versions>([[BASE, { claude: DOCKER_VERSIONS.claude, codex: DOCKER_VERSIONS.codex }]]),
    containers: new Map<string, string[]>(),
    tags: new Map<string, string>([[DOCKER_IMAGE_TAG, BASE]]),
    help: FULL_HELP,
    /** What the candidate's CLIs report, when npm installed something else. */
    installed: {} as Partial<Versions>,
    codex: { mode: 'normal', signedOut: true, broken: false },
    buildFails: false,
    duringBuild: undefined as undefined | (() => Promise<void>),
    builds: [] as Versions[],
  };
  const labels = (args: string[]) => Object.fromEntries(args.filter((_, index) => args[index - 1] === '--label').map((label) => {
    const separator = label.indexOf('=');
    return [label.slice(0, separator), label.slice(separator + 1)];
  }));
  const imageOf = (id: string) => state.containers.get(id)!.find((arg) => /^sha256:[a-f0-9]{64}$/.test(arg))!;
  let sequence = 0;
  const command = vi.fn(async (args: string[]): Promise<string> => {
    if (args[0] === 'info') return `${state.engine}\n`;
    if (args[0] === 'version') return JSON.stringify({ Version: '28.0.0', Os: 'linux' });
    if (args[0] === 'image' && args[1] === 'inspect') {
      if (!state.images.has(args[2])) throw new Error('No such image');
      return args.at(-1) === '{{.Id}}' ? `${args[2]}\n`
        : JSON.stringify({ Id: args[2], Config: { Labels: { [`${DOCKER_LABEL}.profile`]: DOCKER_PROFILE } } });
    }
    if (args[0] === 'build') {
      const value = (name: string) => args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
      const requested = { claude: value('CLAUDE_VERSION')!, codex: value('CODEX_VERSION')! };
      state.builds.push(requested);
      await state.duringBuild?.();
      if (state.buildFails) throw new Error('npm ERR! notarget');
      state.images.set(CANDIDATE, { ...requested, ...state.installed });
      state.tags.set(args[args.indexOf('--tag') + 1], CANDIDATE);
      return `${CANDIDATE}\n`;
    }
    if (args[0] === 'image' && args[1] === 'rm') {
      // As Docker does: a tag is removed, and the image with it once nothing else references it.
      const image = state.tags.get(args[2]) ?? args[2];
      state.tags.delete(args[2]);
      const referenced = [...state.tags.values()].includes(image) || [...state.containers.values()].some((container) => container.includes(image));
      if (!referenced || image === args[2]) state.images.delete(image);
      return '';
    }
    if (args[0] === 'tag') { state.tags.set(args[2], args[1]); return ''; }
    if (args[0] === 'create') {
      const name = args[args.indexOf('--name') + 1];
      if (args.includes('--name') && [...state.containers.values()].some((container) => container[container.indexOf('--name') + 1] === name)) {
        throw new Error('Container name already in use');
      }
      const id = `container-${String(++sequence).padStart(4, '0')}`;
      state.containers.set(id, args);
      return `${id}\n`;
    }
    if (args[0] === 'start') return '';
    if (args[0] === 'exec') {
      const image = state.images.get(imageOf(args[1]))!;
      const [binary, flag] = args.slice(2);
      if (flag === '--version') return binary === 'claude' ? `${image.claude} (Claude Code)\n` : `codex-cli ${image.codex}\n`;
      if (binary === 'claude' && flag === '--help') return `${state.help}\n`;
      throw new Error(`Unexpected exec: ${args.join(' ')}`);
    }
    if (args[0] === 'container' && args[1] === 'ls') {
      const filters = args.filter((_, index) => args[index - 1] === '--filter');
      return [...state.containers.entries()].filter(([, container]) => filters.every((filter) => {
        if (filter.startsWith('label=')) return container.includes(filter.slice(6));
        if (filter.startsWith('volume=')) return container.some((arg) => arg.includes(`src=${filter.slice(7)},`));
        if (filter.startsWith('name=')) return new RegExp(filter.slice(5)).test(`/${container[container.indexOf('--name') + 1]}`);
        throw new Error(`Unexpected filter ${filter}`);
      })).map(([id]) => id).join('\n');
    }
    if (args[0] === 'container' && args[1] === 'rm') { state.containers.delete(args.at(-1)!); return ''; }
    if (args[0] === 'inspect') return JSON.stringify(labels(state.containers.get(args.at(-1)!)!));
    throw new Error(`Unexpected Docker command: ${args.join(' ')}`);
  });
  mocks.command.mockImplementation((args: string[]) => command(args.slice(2)));
  const recordPath = path.join(dataDir, 'codex-requests.json');
  mocks.spawn.mockImplementation((_endpoint: string, args: string[]) => {
    expect(args.slice(0, 2)).toEqual(['exec', '-i']);
    if (state.codex.broken) return spawn(process.execPath, ['-e', 'process.exit(3)'], { stdio: ['pipe', 'pipe', 'pipe'] });
    return spawn(FAKE_CODEX, args.slice(4), {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env, CODEAI_FAKE_CODEX_MODE: state.codex.mode, CODEAI_FAKE_CODEX_RECORD: recordPath,
        ...(state.codex.signedOut ? { CODEAI_FAKE_CODEX_SIGNED_OUT: '1' } : {}),
      },
    });
  });
  const records = async () => ({
    profile: await readFile(profileFile, 'utf8').catch(() => undefined),
    versions: await readFile(dockerVersionsPath(dataDir), 'utf8').catch(() => undefined),
  });
  const codexRequests = async () => (JSON.parse(await readFile(recordPath, 'utf8')) as { requests: Array<{ method: string }> })
    .requests.map((request) => request.method);
  return { dataDir, runtime, state, command, records, codexRequests, profileFile };
}

describe('Docker CLI versions', () => {
  it.each(['2.1.280', '0.156.1', '10.0.0', '0.0.0'])('accepts the exact release %s', (version) => {
    expect(isCliVersion(version)).toBe(true);
  });

  it.each(['2.1', '2.1.280.1', '2.1.280-beta.1', '^2.1.280', '~2.1.280', '>=2.1.280', 'latest', '02.1.0', 'v2.1.0', ' 2.1.0', '2.1.0\n', '', '1.2.12345678901'])(
    'rejects %j', (version) => { expect(isCliVersion(version)).toBe(false); },
  );

  it('compares numerically, not as text', () => {
    expect(compareCliVersions('2.1.280', '2.1.226')).toBeGreaterThan(0);
    expect(compareCliVersions('0.99.0', '0.152.0')).toBeLessThan(0);
    expect(compareCliVersions('1.0.0', '1.0.0')).toBe(0);
  });
});

describe('planning a Docker CLI update', () => {
  it.each([
    ['claude', '2.1', 'exact version'],
    ['claude', '2.1.280-beta.1', 'exact version'],
    ['claude', 'latest', 'exact version'],
    ['claude', '2.1.100', `at least ${DOCKER_VERSIONS.claude}`],
    ['codex', '0.151.9', `at least ${DOCKER_VERSIONS.codex}`],
    ['claude', DOCKER_VERSIONS.claude, 'already'],
    ['gemini', '1.0.0', 'claude or codex'],
  ])('rejects %s %s before building anything', async (provider, version, message) => {
    const { runtime, state, records } = await installation();
    const before = await records();
    await expect(planDockerUpdate(runtime, provider, version)).rejects.toThrow(DockerUpdateRejected);
    await expect(planDockerUpdate(runtime, provider, version)).rejects.toThrow(message);
    expect(state.builds).toEqual([]);
    expect(await records()).toEqual(before);
  });

  it('rejects an unprovisioned installation and a changed engine before building anything', async () => {
    const unprovisioned = await installation({ profile: false });
    await expect(planDockerUpdate(unprovisioned.runtime, 'claude', '2.1.280')).rejects.toThrow('npm run docker:provision');
    expect(unprovisioned.state.builds).toEqual([]);
    const replaced = await installation();
    replaced.state.engine = 'engine-replacement';
    await expect(planDockerUpdate(replaced.runtime, 'claude', '2.1.280')).rejects.toThrow('--replace-engine');
    expect(replaced.state.builds).toEqual([]);
  });

  it('plans while Docker turns are disabled, since only the recorded image and engine matter', async () => {
    const { runtime } = await installation();
    const disabled = new DockerRuntime({ ...runtime.config, dockerEnabled: false });
    await expect(planDockerUpdate(disabled, 'claude', '2.1.280')).resolves.toMatchObject({ provider: 'claude', version: '2.1.280' });
  });

  it('warns before a downgrade that the newer CLI may have migrated the shared home', async () => {
    const { runtime } = await installation({ versions: {
      image: BASE, claude: '2.1.280', codex: DOCKER_VERSIONS.codex, previous: { claude: DOCKER_VERSIONS.claude },
    } });
    const plan = await planDockerUpdate(runtime, 'claude', DOCKER_VERSIONS.claude);
    expect(plan.warning).toMatch(/older than the recorded 2\.1\.280.*may already have migrated/);
    expect((await planDockerUpdate(runtime, 'codex', '0.156.1')).warning).toBeUndefined();
  });
});

describe('reading the recorded versions', () => {
  it.each([
    ['missing', undefined],
    ['for another image', { image: OTHER, claude: '2.1.280', codex: '0.156.1', previous: { claude: '2.1.226' }, codexModels: { models: [] } }],
    ['damaged', 'not a record'],
  ])('reads a %s record again from the recorded image, with no previous versions or Codex models', async (_, versions) => {
    const { runtime, command } = await installation({ versions });
    expect(await readDockerVersions(runtime)).toEqual({
      image: BASE, claude: DOCKER_VERSIONS.claude, codex: DOCKER_VERSIONS.codex, previous: {},
    });
    const checks = command.mock.calls.map(([args]) => args).filter((args) => args[0] === 'create');
    expect(checks.every((args) => args.includes('none') && !args.includes('--mount'))).toBe(true);
    // An image's CLIs never change, so its versions are read once per process.
    const reads = command.mock.calls.length;
    await readDockerVersions(runtime);
    expect(command.mock.calls.length).toBe(reads);
  });
});

describe('updating one provider', () => {
  it.each([
    ['a missing', undefined],
    ['a stale', { image: OTHER, claude: '2.1.250', codex: '0.155.0', previous: {} }],
  ])('keeps the other provider’s recorded version with %s versions record', async (_, versions) => {
    const { runtime, state } = await installation({ versions });
    const plan = await planDockerUpdate(runtime, 'claude', '2.1.280');
    expect(await runDockerUpdate(runtime, plan)).toMatchObject({ outcome: 'switched' });
    expect(state.builds).toEqual([{ claude: '2.1.280', codex: DOCKER_VERSIONS.codex }]);
  });

  it('checks a passing candidate offline, records it on the same engine, and serves it without a restart', async () => {
    const { runtime, state, command, dataDir, profileFile, codexRequests } = await installation();
    state.codex.mode = 'unauthenticated';
    const progress: string[] = [];
    const plan = await planDockerUpdate(runtime, 'codex', '0.156.1');
    const result = await runDockerUpdate(runtime, plan, (step) => progress.push(step));
    expect(result).toEqual({ outcome: 'switched', provider: 'codex', version: '0.156.1', replaced: DOCKER_VERSIONS.codex });
    expect(progress).toEqual(['building', 'checking', 'switching']);
    expect(JSON.parse(await readFile(profileFile, 'utf8'))).toEqual({ profile: DOCKER_PROFILE, image: CANDIDATE, engineId: 'engine-original' });
    const versions = JSON.parse(await readFile(dockerVersionsPath(dataDir), 'utf8'));
    expect(versions).toEqual({
      image: CANDIDATE, claude: DOCKER_VERSIONS.claude, codex: '0.156.1', previous: { codex: DOCKER_VERSIONS.codex },
      codexModels: {
        models: [
          { id: 'fake-large', label: 'Fake Large', efforts: ['low', 'medium', 'high', 'ultra'] },
          { id: 'fake-small', label: 'Fake Small', efforts: ['minimal', 'low', 'medium', 'high', 'xhigh'] },
        ],
        efforts: ['low', 'medium', 'high'],
      },
    });
    // Its own installation's tag keeps it from counting as dangling; the shared tag stays where
    // provisioning put it, since another installation's recorded image may depend on it.
    expect(state.tags.get(`codeai-worker:${runtime.owner}`)).toBe(CANDIDATE);
    expect(state.tags.get(DOCKER_IMAGE_TAG)).toBe(BASE);
    expect([...state.tags.keys()].filter((tag) => tag.includes('candidate'))).toEqual([]);
    // The previous image stays in Docker for turns already running in it.
    expect(state.images.has(BASE)).toBe(true);
    // profile.json is read on every use: the next turn, login and Git read start from the candidate.
    expect((await runtime.profile()).image).toBe(CANDIDATE);
    expect((await new DockerRuntime(runtime.config).provision()).image).toBe(CANDIDATE);

    // Every check ran in its own new container: no network, no mounts, a throwaway home.
    const checks = command.mock.calls.map(([args]) => args).filter((args) => args[0] === 'create' && args.includes(`${DOCKER_LABEL}.kind=check`));
    expect(checks.length).toBeGreaterThanOrEqual(3);
    for (const args of checks) {
      expect(args[args.indexOf('--network') + 1]).toBe('none');
      expect(args).not.toContain('--mount');
      expect(args).not.toContain('--volume');
      expect(args).not.toContain('-v');
      expect(args).toContain(`${DOCKER_HOME}:rw,nosuid,nodev,size=64m,mode=1777`);
      expect(args).toContain('--rm');
    }
    expect(state.containers.size).toBe(0);
    // Nothing signs in, and no provider session or model turn starts.
    const executed = command.mock.calls.map(([args]) => args).filter((args) => args[0] === 'exec');
    expect(executed.some((args) => args.some((arg) => /^(login|auth)$/.test(arg)))).toBe(false);
    expect(await codexRequests()).not.toEqual(expect.arrayContaining(['thread/start']));
    expect(await codexRequests()).not.toEqual(expect.arrayContaining(['turn/start']));
    expect(await codexRequests()).toEqual(expect.arrayContaining(['initialize', 'model/list', 'account/read']));
  });

  it.each([
    ['version', 'the installed CLI reports another version', (state: Awaited<ReturnType<typeof installation>>['state']) => { state.installed = { claude: '2.1.281' }; }, /claude --version reports 2\.1\.281, not 2\.1\.280/],
    ['claude-flags', 'a required Claude flag is missing', (state: Awaited<ReturnType<typeof installation>>['state']) => { state.help = FULL_HELP.replace('--allowedTools', ''); }, /--allowedTools/],
    ['claude-flags', '--effort is missing', (state: Awaited<ReturnType<typeof installation>>['state']) => { state.help = FULL_HELP.replace('--effort', ''); }, /--effort/],
    ['codex-handshake', 'Codex App Server exits', (state: Awaited<ReturnType<typeof installation>>['state']) => { state.codex.broken = true; }, /App Server/],
    ['codex-handshake', 'Codex reports somebody signed in', (state: Awaited<ReturnType<typeof installation>>['state']) => { state.codex.signedOut = false; }, /signed/],
    ['codex-models', 'Codex answers no model/list', (state: Awaited<ReturnType<typeof installation>>['state']) => { state.codex.mode = 'no-model-list'; }, /model\/list/],
    ['build', 'the build fails', (state: Awaited<ReturnType<typeof installation>>['state']) => { state.buildFails = true; }, /could not be built/],
  ] as const)('fails the %s check when %s, removes the candidate and writes nothing', async (check, _, arrange, message) => {
    const { runtime, state, records } = await installation({ versions: {
      image: BASE, claude: DOCKER_VERSIONS.claude, codex: DOCKER_VERSIONS.codex, previous: {},
    } });
    arrange(state);
    const before = await records();
    const plan = await planDockerUpdate(runtime, 'claude', '2.1.280');
    const result = await runDockerUpdate(runtime, plan);
    expect(result).toMatchObject({ outcome: 'failed', check });
    expect(result.outcome === 'failed' && result.message).toMatch(message);
    expect(await records()).toEqual(before);
    expect(state.images.has(CANDIDATE)).toBe(false);
    expect(state.images.has(BASE)).toBe(true);
    expect(state.tags.get(DOCKER_IMAGE_TAG)).toBe(BASE);
    expect([...state.tags.keys()].filter((tag) => tag.includes('candidate'))).toEqual([]);
    expect(state.containers.size).toBe(0);
  });

  it('removes the candidate tag when a finished build’s answer cannot be read', async () => {
    const { runtime, state, command } = await installation();
    const answer = command.getMockImplementation()!;
    command.mockImplementation(async (args: string[]) => {
      const result = await answer(args);
      return args[0] === 'build' ? 'no image ID here\n' : result;
    });
    expect(await runDockerUpdate(runtime, await planDockerUpdate(runtime, 'claude', '2.1.280'))).toMatchObject({ outcome: 'failed', check: 'build' });
    expect([...state.tags.keys()].filter((tag) => tag.includes('candidate'))).toEqual([]);
    expect(state.images.has(CANDIDATE)).toBe(false);
  });

  it('reports switched, and keeps the image, when profile.json was replaced but its write then failed', async () => {
    const { runtime, state, profileFile } = await installation();
    mocks.failAfterRename = profileFile;
    const result = await runDockerUpdate(runtime, await planDockerUpdate(runtime, 'claude', '2.1.280'));
    expect(result).toMatchObject({ outcome: 'switched' });
    expect(JSON.parse(await readFile(profileFile, 'utf8')).image).toBe(CANDIDATE);
    expect(state.images.has(CANDIDATE)).toBe(true);
  });

  it('shows only CodeAI’s own messages, never a file-system error naming a path', async () => {
    const { runtime, profileFile, state } = await installation();
    const plan = await planDockerUpdate(runtime, 'claude', '2.1.280');
    // profile.json becomes unreadable while the candidate builds.
    state.duringBuild = async () => { await rm(profileFile); await mkdir(profileFile); };
    const result = await runDockerUpdate(runtime, plan);
    expect(result).toMatchObject({ outcome: 'failed' });
    expect(JSON.stringify(result)).not.toContain(runtime.config.dataDir);
    await expect(planDockerUpdate(runtime, 'claude', '2.1.280')).rejects.toThrow('CodeAI could not read its Docker profile.');
  });

  it('reports switched once profile.json names the candidate, even if a later step fails', async () => {
    const { runtime, state, dataDir, profileFile } = await installation();
    // A directory where the versions record belongs: writing it fails after the switch.
    await mkdir(dockerVersionsPath(dataDir));
    const result = await runDockerUpdate(runtime, await planDockerUpdate(runtime, 'claude', '2.1.280'));
    expect(result).toEqual({ outcome: 'switched', provider: 'claude', version: '2.1.280', replaced: DOCKER_VERSIONS.claude });
    expect(JSON.parse(await readFile(profileFile, 'utf8')).image).toBe(CANDIDATE);
    // Still referenced by its candidate tag, since the installation tag never took over.
    expect(state.images.has(CANDIDATE)).toBe(true);
    // The unreadable record is stale: the versions come from the image again.
    expect(await readDockerVersions(runtime)).toMatchObject({ image: CANDIDATE, claude: '2.1.280', previous: {} });
  });
});

describe('removing a candidate', () => {
  it('only untags an identical image that something else references, such as another installation’s', async () => {
    const { runtime, state, records } = await installation();
    // Docker's build cache reproduces an identical image: the same versions give the same ID.
    state.images.set(CANDIDATE, { claude: '2.1.280', codex: DOCKER_VERSIONS.codex });
    state.tags.set('codeai-worker:another-installation', CANDIDATE);
    state.help = FULL_HELP.replace('--effort', '');
    const before = await records();
    expect(await runDockerUpdate(runtime, await planDockerUpdate(runtime, 'claude', '2.1.280'))).toMatchObject({ outcome: 'failed' });
    expect(state.images.has(CANDIDATE)).toBe(true);
    expect([...state.tags.entries()].filter(([, image]) => image === CANDIDATE)).toEqual([['codeai-worker:another-installation', CANDIDATE]]);
    expect(await records()).toEqual(before);
  });

  it('never removes by image ID, so an update that lost the race cannot delete what the winner recorded', async () => {
    const { runtime, command } = await installation();
    await runDockerUpdate(runtime, await planDockerUpdate(runtime, 'claude', '2.1.280'));
    const removals = command.mock.calls.map(([args]) => args).filter((args) => args[0] === 'image' && args[1] === 'rm');
    expect(removals.every((args) => /^codeai-worker:candidate-[0-9a-f-]{36}$/.test(args[2]))).toBe(true);
  });
});

describe('switching to a checked candidate', () => {
  it('refuses while a turn uses the provider’s home, and while a login holds it', async () => {
    const { runtime, state, records } = await installation();
    const home = providerVolume(runtime.owner, 'claude');
    const before = await records();
    state.containers.set('running-turn', ['create', '--label', `${DOCKER_LABEL}.owner=${runtime.owner}`, '--label', `${DOCKER_LABEL}.kind=worker`,
      '--mount', `type=volume,src=${home},dst=${DOCKER_HOME}`, BASE]);
    const turn = await runDockerUpdate(runtime, await planDockerUpdate(runtime, 'claude', '2.1.280'));
    expect(turn).toEqual({ outcome: 'in-use', message: 'Claude is in use by a turn. Try again when it finishes.' });
    expect(await records()).toEqual(before);
    expect(state.images.has(CANDIDATE)).toBe(false);
    expect(state.tags.get(DOCKER_IMAGE_TAG)).toBe(BASE);
    // The switch's own hold is gone; the turn is untouched.
    expect([...state.containers.keys()]).toEqual(['running-turn']);

    state.containers.clear();
    state.containers.set('live-login', ['create', '--name', `${home}-admission`, '--label', `${DOCKER_LABEL}.owner=${runtime.owner}`,
      '--label', `${DOCKER_LABEL}.kind=setup`, '--label', `${DOCKER_LABEL}.home=${home}`, '--label', `${DOCKER_LABEL}.pid=${process.pid}`,
      '--label', `${DOCKER_LABEL}.session=${crypto.randomUUID()}`, BASE, 'true']);
    const login = await runDockerUpdate(runtime, await planDockerUpdate(runtime, 'claude', '2.1.280'));
    expect(login).toEqual({ outcome: 'in-use', message: 'Claude is in use by a login or another update. Try again when it finishes.' });
    expect(await records()).toEqual(before);
    expect([...state.containers.keys()]).toEqual(['live-login']);
  });

  it('does not hold the other provider’s home', async () => {
    const { runtime, state } = await installation();
    state.containers.set('codex-turn', ['create', '--label', `${DOCKER_LABEL}.owner=${runtime.owner}`, '--label', `${DOCKER_LABEL}.kind=worker`,
      '--mount', `type=volume,src=${providerVolume(runtime.owner, 'codex')},dst=${DOCKER_HOME}`, BASE]);
    expect(await runDockerUpdate(runtime, await planDockerUpdate(runtime, 'claude', '2.1.280'))).toMatchObject({ outcome: 'switched' });
  });

  it('refuses when profile.json changed after the candidate’s build began', async () => {
    const { runtime, state, records, profileFile } = await installation();
    state.images.set(OTHER, { claude: '2.1.250', codex: DOCKER_VERSIONS.codex });
    const plan = await planDockerUpdate(runtime, 'claude', '2.1.280');
    state.duringBuild = () => writeFile(profileFile, JSON.stringify({ profile: DOCKER_PROFILE, image: OTHER, engineId: 'engine-original' }));
    const result = await runDockerUpdate(runtime, plan);
    expect(result).toMatchObject({ outcome: 'failed', message: expect.stringContaining('changed while') });
    expect(result).not.toHaveProperty('check');
    const after = await records();
    expect(JSON.parse(after.profile!).image).toBe(OTHER);
    expect(after.versions).toBeUndefined();
    expect(state.images.has(CANDIDATE)).toBe(false);
  });

  it('rolls back to the previous version and records the version it replaced as previous', async () => {
    const { runtime, dataDir, state } = await installation({ versions: {
      image: BASE, claude: '2.1.280', codex: '0.156.1', previous: { claude: DOCKER_VERSIONS.claude, codex: DOCKER_VERSIONS.codex },
    } });
    state.images.set(BASE, { claude: '2.1.280', codex: '0.156.1' });
    const plan = await planDockerUpdate(runtime, 'claude', DOCKER_VERSIONS.claude);
    expect(plan.warning).toContain('may already have migrated');
    expect(await runDockerUpdate(runtime, plan)).toMatchObject({ outcome: 'switched', version: DOCKER_VERSIONS.claude, replaced: '2.1.280' });
    expect(JSON.parse(await readFile(dockerVersionsPath(dataDir), 'utf8'))).toMatchObject({
      image: CANDIDATE, claude: DOCKER_VERSIONS.claude, codex: '0.156.1', previous: { claude: '2.1.280', codex: DOCKER_VERSIONS.codex },
    });
  });
});

describe('the worker Dockerfile', () => {
  it('names both CLI versions only through build arguments without defaults, and fails without them', async () => {
    const source = await readFile(path.resolve('docker/Dockerfile'), 'utf8');
    expect(source).toMatch(/^ARG CLAUDE_VERSION$/m);
    expect(source).toMatch(/^ARG CODEX_VERSION$/m);
    expect(source).toContain('test -n "$CLAUDE_VERSION"');
    expect(source).toContain('test -n "$CODEX_VERSION"');
    expect(source).not.toMatch(/claude-code@\d|codex@\d/);
  });
});
