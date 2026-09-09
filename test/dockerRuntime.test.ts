import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getConfig } from '@/server/config';
import { DockerRuntime } from '@/server/execution/dockerRuntime';
import { DOCKER_HOME, DOCKER_LABEL, DOCKER_PROFILE, participantVolume } from '@/server/execution/dockerProfile';

const mocks = vi.hoisted(() => ({ command: vi.fn() }));
vi.mock('@/server/execution/dockerCommand', () => ({
  localDockerEndpoint: async () => 'unix:///fixture/docker.sock',
  dockerCommand: mocks.command,
  spawnDocker: vi.fn(() => { throw new Error('A recovery must never start a provider'); }),
}));

const directories: string[] = [];
async function fixture() {
  const dataDir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'codeai-recovery-')));
  directories.push(dataDir);
  await mkdir(path.join(dataDir, 'docker'));
  await writeFile(path.join(dataDir, 'docker', 'profile.json'), JSON.stringify({
    profile: DOCKER_PROFILE, image: `sha256:${'a'.repeat(64)}`, engineId: 'engine-original',
  }));
  const runtime = new DockerRuntime({ ...getConfig(), dataDir, dockerEnabled: true });
  return { runtime, dataDir };
}

afterEach(async () => {
  vi.resetAllMocks();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('Docker termination and orphan recovery', () => {
  it('does not consider an unavailable or different engine proof of termination', async () => {
    const { runtime } = await fixture();
    const command = vi.fn().mockRejectedValueOnce(new Error('Daemon unavailable'));
    await expect(runtime.removeContainer(command, 'owned-worker')).rejects.toThrow('unavailable');
    command.mockResolvedValueOnce('engine-replacement');
    await expect(runtime.removeContainer(command, 'owned-worker')).rejects.toThrow('identity changed');
    expect(command.mock.calls.every(([args]) => args[0] === 'info')).toBe(true);
  });

  it('requires an authoritative empty inventory after removal and retries a failed removal', async () => {
    const { runtime } = await fixture();
    let present = true;
    let rejectRemoval = true;
    const command = vi.fn(async (args: string[]) => {
      if (args[0] === 'info') return 'engine-original';
      if (args[1] === 'ls') {
        expect(args).toContain(`label=${DOCKER_LABEL}.owner=${runtime.owner}`);
        return present ? 'abcdef123456' : '';
      }
      if (args[1] === 'rm') {
        if (rejectRemoval) throw new Error('Stop failed');
        present = false;
        return '';
      }
      throw new Error('Unexpected command');
    });
    await expect(runtime.removeContainer(command, 'abcdef1234567890')).rejects.toThrow('Stop failed');
    expect(present).toBe(true);
    rejectRemoval = false;
    await runtime.removeContainer(command, 'abcdef1234567890');
    expect(present).toBe(false);
    expect(command.mock.calls.at(-1)?.[0].slice(0, 2)).toEqual(['container', 'ls']);
  });

  it('persists interrupted delivery, preserves active setup, and removes obsolete cache keepers', async () => {
    const { runtime, dataDir } = await fixture();
    const interruptedSession = crypto.randomUUID();
    const setupSession = crypto.randomUUID();
    const records = new Map<string, Record<string, string>>();
    const add = (id: string, kind: string, session: string, instance = 'previous-instance') => records.set(id, {
      [`${DOCKER_LABEL}.owner`]: runtime.owner, [`${DOCKER_LABEL}.kind`]: kind,
      [`${DOCKER_LABEL}.session`]: session, [`${DOCKER_LABEL}.instance`]: instance,
      [`${DOCKER_LABEL}.pid`]: String(process.pid),
    });
    add('old-worker', 'worker', interruptedSession);
    add('old-egress', 'egress', interruptedSession);
    add('home-cache', 'cache', interruptedSession);
    add('active-setup', 'setup', setupSession);
    add('setup-egress', 'egress', setupSession);
    add('setup-cache', 'cache', setupSession);
    add('current-worker', 'worker', crypto.randomUUID(), runtime.instance);
    add('current-cache', 'cache', crypto.randomUUID(), runtime.instance);
    mocks.command.mockImplementation(async (input: string[]) => {
      const args = input.slice(2);
      if (args[0] === 'info') return 'engine-original';
      if (args[0] === 'container' && args[1] === 'ls') return [...records.keys()].join('\n');
      if (args[0] === 'inspect') return JSON.stringify(records.get(args.at(-1)!));
      if (args[0] === 'container' && args[1] === 'rm') {
        expect(JSON.parse(await readFile(path.join(dataDir, 'docker', 'interrupted.json'), 'utf8'))).toEqual([interruptedSession]);
        records.delete(args.at(-1)!);
        return '';
      }
      if (args[0] === 'network' && args[1] === 'ls') return '';
      throw new Error(`Unexpected recovery command: ${args[0]}`);
    });
    expect(await runtime.reconcile()).toEqual([interruptedSession]);
    expect([...records.keys()]).toEqual(['active-setup', 'setup-egress', 'current-worker']);
    const resumed = new DockerRuntime(runtime.config);
    mocks.command.mockImplementation(async (input: string[]) => {
      if (input[2] === 'info') return 'engine-original';
      if (input[3] === 'ls') return '';
      throw new Error('Unexpected command');
    });
    // A second application crash after removal must not lose the delivery failure ledger.
    expect(await resumed.reconcile()).toEqual([interruptedSession]);
  });
});

async function workerFixture() {
  const { runtime, dataDir } = await fixture();
  const checkout = await realpath(await mkdtemp(path.join(os.tmpdir(), 'codeai-checkout-')));
  directories.push(checkout);
  const context = path.join(dataDir, 'context');
  await mkdir(context);
  const identity = { sessionId: crypto.randomUUID(), participantId: crypto.randomUUID(), runId: crypto.randomUUID(), provider: 'codex' as const };
  const home = participantVolume(runtime.owner, identity.sessionId, identity.participantId, 'home');
  const containers = new Map<string, string[]>();
  const networks = new Set<string>();
  const state = { homeLabels: undefined as Record<string, string> | undefined, failAccess: false, failPrepare: false };
  let sequence = 0;
  const command = vi.fn(async (args: string[]) => {
    if (args[0] === 'info') return 'engine-original';
    if (args[0] === 'version') return JSON.stringify({ Version: '28.0.0', Os: 'linux' });
    if (args[0] === 'image') return JSON.stringify({ Id: `sha256:${'a'.repeat(64)}`, Config: { Labels: { [`${DOCKER_LABEL}.profile`]: DOCKER_PROFILE } } });
    if (args[0] === 'create') {
      const id = `container-${++sequence}`;
      containers.set(id, args);
      return id;
    }
    if (args[0] === 'container' && args[1] === 'ls') {
      expect(args).toContain(`label=${DOCKER_LABEL}.owner=${runtime.owner}`);
      return [...containers.keys()].join('\n');
    }
    if (args[0] === 'container' && args[1] === 'rm') { containers.delete(args.at(-1)!); return ''; }
    if (args[0] === 'volume' && args[1] === 'ls') return state.homeLabels ? home : '';
    if (args[0] === 'volume' && args[1] === 'inspect') return JSON.stringify(state.homeLabels);
    if (args[0] === 'volume' && args[1] === 'create') return args.at(-1)!;
    if (args[0] === 'network' && args[1] === 'create') { networks.add(args.at(-1)!); return args.at(-1)!; }
    if (args[0] === 'network' && args[1] === 'ls') return [...networks].join('\n');
    if (args[0] === 'network' && args[1] === 'rm') { networks.delete(args.at(-1)!); return ''; }
    if (args[0] === 'network' && args[1] === 'connect') return '';
    if (args[0] === 'start') {
      if (args[1] === '--attach' && state.failPrepare) throw new Error('Invalid Git metadata');
      return '';
    }
    if (args[0] === 'exec' && args[4] === 'access') {
      if (state.failAccess) throw new Error('Permission denied');
      return '';
    }
    throw new Error(`Unexpected worker command: ${args.join(' ')}`);
  });
  mocks.command.mockImplementation((args: string[]) => command(args.slice(2)));
  return { runtime, identity, home, checkout, context, command, containers, networks, state };
}

function mounts(args: string[]) {
  return args.filter((_, index) => args[index - 1] === '--mount');
}

describe('Docker checkout mounts', () => {
  it.each(['ask', 'plan', 'agent'] as const)('uses one %s checkout bind and only a persistent provider home', async (mode) => {
    const { runtime, identity, home, checkout, context, command, containers, networks } = await workerFixture();
    const worker = await runtime.createWorker(identity, { checkout, context, mode });
    const preparer = command.mock.calls.map(([args]) => args).find((args) => args[0] === 'create' && args.includes(`${DOCKER_LABEL}.kind=prepare`))!;
    expect(mounts(preparer)).toEqual([`type=bind,src=${checkout},dst=/workspace,readonly`]);
    expect(preparer.slice(-3)).toEqual(['node', '/opt/codeai/worker.mjs', 'prepare']);
    const launch = containers.get(worker.worker)!;
    expect(mounts(launch)).toEqual([
      `type=volume,src=${home},dst=${DOCKER_HOME}`,
      `type=bind,src=${checkout},dst=/workspace${mode === 'agent' ? '' : ',readonly'}`,
      `type=bind,src=${context},dst=/context,readonly`,
    ]);
    expect(launch).toContain('npm_config_cache=/tmp/npm');
    expect(launch).toContain(`${DOCKER_LABEL}.kind=worker`);
    expect(command.mock.calls.filter(([args]) => args[0] === 'volume' && args[1] === 'create').map(([args]) => args.at(-1))).toEqual([home]);
    expect(command.mock.calls.some(([args]) => args.some((arg) => /volume-subpath=|kind=cache|\/cache|keeper/.test(arg)))).toBe(false);
    expect(command).toHaveBeenCalledWith(['exec', worker.worker, 'node', '/opt/codeai/worker.mjs', 'access', mode]);
    await worker.stop();
    expect(containers.size).toBe(0);
    expect(networks.size).toBe(0);
    const stoppedCalls = command.mock.calls.length;
    await worker.stop();
    expect(command).toHaveBeenCalledTimes(stoppedCalls);
    expect(command.mock.calls.some(([args]) => args[0] === 'volume' && args[1] === 'rm')).toBe(false);
  });

  it('reuses the owned participant home for interactive setup without exposing a checkout', async () => {
    const { runtime, identity, home, command, containers, state } = await workerFixture();
    state.homeLabels = { [`${DOCKER_LABEL}.owner`]: runtime.owner, [`${DOCKER_LABEL}.participant`]: identity.participantId };
    const worker = await runtime.createWorker(identity, { mode: 'ask', setup: true });
    const launch = containers.get(worker.worker)!;
    expect(mounts(launch)).toEqual([`type=volume,src=${home},dst=${DOCKER_HOME}`]);
    expect(launch).toContain(`${DOCKER_LABEL}.kind=setup`);
    expect(command.mock.calls.some(([args]) => args[0] === 'volume' && args[1] === 'create')).toBe(false);
    await worker.stop();
  });

  it.each(['owner', 'participant'])('rejects an existing provider home with a different %s and releases the session lease', async (field) => {
    const { runtime, identity, containers, networks, state } = await workerFixture();
    state.homeLabels = { [`${DOCKER_LABEL}.owner`]: runtime.owner, [`${DOCKER_LABEL}.participant`]: identity.participantId, [`${DOCKER_LABEL}.${field}`]: 'different' };
    await expect(runtime.createWorker(identity, { mode: 'ask', setup: true })).rejects.toThrow('ownership');
    expect(containers.size).toBe(0);
    expect(networks.size).toBe(0);
  });

  it.each(['failPrepare', 'failAccess'] as const)('removes every transient resource when checkout validation fails at %s', async (failure) => {
    const { runtime, identity, checkout, containers, networks, state } = await workerFixture();
    state[failure] = true;
    await expect(runtime.createWorker(identity, { checkout, mode: 'agent' })).rejects.toThrow(failure === 'failPrepare' ? 'Git metadata' : 'cannot access');
    expect(containers.size).toBe(0);
    expect(networks.size).toBe(0);
  });
});
