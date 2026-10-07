import { mkdtemp, mkdir, readFile, realpath, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getConfig } from '@/server/config';
import { DockerRuntime, saveDockerProvision } from '@/server/execution/dockerRuntime';
import { DOCKER_HOME, DOCKER_LABEL, DOCKER_PROFILE, participantVolume, providerVolume } from '@/server/execution/dockerProfile';
import { userOwnedParent } from './userOwned';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createManagedWorktree, readWorktreeRecords } from '@/server/repository/managedWorktrees';
import { CheckoutRegistry } from '@/server/repository/checkoutRegistry';
import { getSessionStore } from '@/server/storage/sessionStore';
import { runRegistry } from '@/server/runs/runRegistry';

const execute = promisify(execFile);

const mocks = vi.hoisted(() => ({ command: vi.fn(), removeDetached: vi.fn() }));
vi.mock('@/server/execution/dockerCommand', () => ({
  localDockerEndpoint: async () => 'unix:///fixture/docker.sock',
  dockerCommand: mocks.command,
  removeContainerDetached: mocks.removeDetached,
  spawnDocker: vi.fn(() => { throw new Error('A recovery must never start a provider'); }),
}));

const directories: string[] = [];
const foreignExitListeners = process.listeners('exit');
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
  vi.unstubAllEnvs();
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

  it('advertises Ask, Plan, and Agent for a provisioned engine, and never Auto', async () => {
    // This list is what the message route checks a Docker turn's mode against.
    const { runtime } = await fixture();
    mocks.command.mockImplementation(async (args: string[]) => {
      if (args.includes('info')) return 'engine-original';
      if (args.includes('version')) return JSON.stringify({ Version: '28.5.2', Os: 'linux' });
      if (args.includes('inspect')) return JSON.stringify({ Id: `sha256:${'a'.repeat(64)}`, Config: { Labels: { [`${DOCKER_LABEL}.profile`]: DOCKER_PROFILE } } });
      throw new Error(`Unexpected docker ${args.join(' ')}`);
    });
    await expect(runtime.health()).resolves.toEqual({ available: true, authenticated: 'unknown', supportedModes: ['ask', 'plan', 'agent'] });
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
    // A terminal update's offline check: it removes itself, and its terminal still needs it.
    add('terminal-check', 'check', '');
    // One whose process died before starting it never exits, so it never removes itself.
    add('dead-check', 'check', '');
    records.get('dead-check')![`${DOCKER_LABEL}.pid`] = '2147483646';
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
    expect([...records.keys()]).toEqual(['active-setup', 'setup-egress', 'current-worker', 'terminal-check']);
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
  const home = providerVolume(runtime.owner, identity.provider);
  const legacyHome = participantVolume(runtime.owner, identity.sessionId, identity.participantId, 'home');
  const containers = new Map<string, string[]>();
  const networks = new Set<string>();
  const volumes = new Map<string, Record<string, string>>();
  const state = { failAccess: false, failPrepare: false, failAuth: false, engine: 'engine-original' };
  const labels = (args: string[]) => Object.fromEntries(args.filter((_, index) => args[index - 1] === '--label').map((label) => {
    const separator = label.indexOf('=');
    return [label.slice(0, separator), label.slice(separator + 1)];
  }));
  let sequence = 0;
  const command = vi.fn(async (args: string[]) => {
    if (args[0] === 'info') return state.engine;
    if (args[0] === 'version') return JSON.stringify({ Version: '28.0.0', Os: 'linux' });
    if (args[0] === 'image') return JSON.stringify({ Id: `sha256:${'a'.repeat(64)}`, Config: { Labels: { [`${DOCKER_LABEL}.profile`]: DOCKER_PROFILE } } });
    if (args[0] === 'create') {
      const nameIndex = args.indexOf('--name');
      if (nameIndex !== -1 && [...containers.values()].some((container) => container.includes(args[nameIndex + 1]))) throw new Error('Container name already in use');
      const id = `container-${++sequence}`;
      containers.set(id, args);
      return id;
    }
    if (args[0] === 'container' && args[1] === 'ls') {
      const filters = args.filter((_, index) => args[index - 1] === '--filter');
      return [...containers.entries()].filter(([, container]) => filters.every((filter) => {
        if (filter.startsWith('label=')) return container.includes(filter.slice(6));
        if (filter.startsWith('volume=')) return mounts(container).some((mount) => mount.includes(`src=${filter.slice(7)},`));
        if (filter.startsWith('name=')) return new RegExp(filter.slice(5)).test(`/${container[container.indexOf('--name') + 1]}`);
        throw new Error(`Unexpected filter ${filter}`);
      })).map(([id]) => id).join('\n');
    }
    if (args[0] === 'container' && args[1] === 'rm') { containers.delete(args.at(-1)!); return ''; }
    if (args[0] === 'inspect') return JSON.stringify(labels(containers.get(args.at(-1)!)!));
    if (args[0] === 'volume' && args[1] === 'ls') {
      const name = args.find((arg) => arg.startsWith('name='))!;
      return [...volumes.keys()].filter((volume) => new RegExp(name.slice(5)).test(volume)).join('\n');
    }
    if (args[0] === 'volume' && args[1] === 'inspect') return JSON.stringify(volumes.get(args[2]));
    if (args[0] === 'volume' && args[1] === 'create') { volumes.set(args.at(-1)!, labels(args)); return args.at(-1)!; }
    if (args[0] === 'volume' && args[1] === 'rm') { volumes.delete(args[2]); return ''; }
    if (args[0] === 'network' && args[1] === 'create') { networks.add(args.at(-1)!); return args.at(-1)!; }
    if (args[0] === 'network' && args[1] === 'ls') {
      const name = args.find((arg) => arg.startsWith('name='));
      return [...networks].filter((network) => !name || new RegExp(name.slice(5)).test(network)).join('\n');
    }
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
    if (args[0] === 'exec' && ['claude', 'codex'].includes(args[2])) {
      if (state.failAuth) throw new Error('Signed out');
      return '';
    }
    throw new Error(`Unexpected worker command: ${args.join(' ')}`);
  });
  mocks.command.mockImplementation((args: string[]) => command(args.slice(2)));
  return { runtime, identity, home, legacyHome, checkout, context, command, containers, networks, volumes, state };
}

// Above every platform's PID range, so no live process can answer for it.
const DEAD_OWNER = `${DOCKER_LABEL}.pid=2147483646`;

function mounts(args: string[]) {
  return args.filter((_, index) => args[index - 1] === '--mount');
}

describe('Docker checkout mounts', () => {
  async function managedFixture() {
    const fixture = await workerFixture();
    const { runtime, checkout } = fixture;
    const worktreesRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), 'codeai-managed-mounts-')));
    directories.push(worktreesRoot);
    vi.stubEnv('CODEAI_DATA_DIR', runtime.config.dataDir);
    vi.stubEnv('CODEAI_REPOSITORIES_ROOT', checkout);
    vi.stubEnv('CODEAI_WORKTREES_ROOT', worktreesRoot);
    Object.assign(runtime.config, { repositoriesRoot: checkout, worktreesRoot });
    await execute('git', ['init', '-q'], { cwd: checkout });
    await writeFile(path.join(checkout, 'file.txt'), 'baseline');
    await execute('git', ['add', '.'], { cwd: checkout });
    await execute('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture'], { cwd: checkout });
    const checkoutId = (await new CheckoutRegistry(checkout).list())[0].id;
    const profileFile = path.join(runtime.config.dataDir, 'docker', 'profile.json');
    const profile = await readFile(profileFile);
    await rm(profileFile);
    try {
      await createManagedWorktree({ provider: 'codex', checkoutId, checkoutMode: 'worktree', creationRequestId: crypto.randomUUID() }, runtime.config);
      const [record] = await readWorktreeRecords(runtime.config.dataDir);
      return { ...fixture, record };
    } finally { await writeFile(profileFile, profile); await getSessionStore(runtime.config.dataDir).close(); }
  }

  it.each(['ask', 'plan', 'agent'] as const)('binds verified managed Git metadata with %s permissions on existing images', async (mode) => {
    const { runtime, identity, record, context, containers, command } = await managedFixture();
    const worker = await runtime.createWorker(identity, { checkout: record.destination, context, mode });
    const binds = mounts(containers.get(worker.worker)!).filter((mount) => mount.startsWith('type=bind'));
    const common = record.originGit.path;
    expect(binds).toEqual([
      `type=bind,src=${record.destination},dst=/workspace${mode === 'agent' ? '' : ',readonly'}`,
      `type=bind,src=${common},dst=${common},readonly`,
      ...(mode === 'agent' ? [record.gitDirectory!.path, ...['objects', 'refs', 'logs'].map((name) => path.join(common, name))]
        .map((directory) => `type=bind,src=${directory},dst=${directory}`) : []),
      `type=bind,src=${context},dst=/context,readonly`,
    ]);
    expect(command.mock.calls.some(([args]) => args.includes(`${DOCKER_LABEL}.kind=prepare`))).toBe(false);
    expect(binds.join('\n')).not.toContain(`src=${record.originPath},`);
    await worker.stop(); expect(containers.size).toBe(0);
  });

  it('refuses changed managed linkage before start and cleans every allocated resource', async () => {
    const { runtime, identity, record, command, containers, networks } = await managedFixture();
    const original = command.getMockImplementation()!;
    let worker: string | undefined;
    command.mockImplementation(async (args: string[]) => {
      const result = await original(args);
      if (args[0] === 'create' && args.includes(`${DOCKER_LABEL}.kind=worker`)) {
        worker = result;
        await writeFile(path.join(record.destination, '.git'), 'gitdir: /outside/.git\n');
      }
      return result;
    });
    await expect(runtime.createWorker(identity, { checkout: record.destination, mode: 'agent' })).rejects.toThrow(/linkage/);
    expect(worker).toBeDefined(); expect(command).not.toHaveBeenCalledWith(['start', worker]);
    expect(containers.size).toBe(0); expect(networks.size).toBe(0);
  });

  it('refuses a replaced common objects directory even when its bind path stays the same', async () => {
    const { runtime, identity, record, command, containers, networks } = await managedFixture();
    const original = command.getMockImplementation()!;
    command.mockImplementation(async (args: string[]) => {
      const result = await original(args);
      if (args[0] === 'create' && args.includes(`${DOCKER_LABEL}.kind=worker`)) {
        const objects = path.join(record.originGit.path, 'objects');
        await rename(objects, `${objects}-old`); await mkdir(objects);
      }
      return result;
    });
    await expect(runtime.createWorker(identity, { checkout: record.destination, mode: 'agent' })).rejects.toThrow(/mounts changed/);
    expect(containers.size).toBe(0); expect(networks.size).toBe(0);
  });

  it('holds the source metadata lease through worker lifetime and releases it only after termination', async () => {
    const { runtime, identity, record } = await managedFixture();
    const worker = await runtime.createWorker(identity, { checkout: record.destination, mode: 'agent' });
    expect(runRegistry.acquireCheckoutWrite(record.originPath)).toBeUndefined();
    await worker.stop();
    const release = runRegistry.acquireCheckoutWrite(record.originPath);
    expect(release).toBeDefined(); release!();
    const sourceWriter = runRegistry.acquireCheckoutWrite(record.originPath)!;
    try { await expect(runtime.createWorker({ ...identity, runId: crypto.randomUUID() }, { checkout: record.destination, mode: 'agent' })).rejects.toThrow(/source checkout is being edited/); }
    finally { sourceWriter(); }
  });

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
    // Codex rejects a CODEX_HOME that does not exist yet; from HOME it creates its own on a new volume.
    expect(launch).toContain(`HOME=${DOCKER_HOME}`);
    expect(launch.some((arg) => arg.startsWith('CODEX_HOME='))).toBe(false);
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

  it('binds exactly the allowlisted customizations that exist, read-only under /user, and none for an isolated turn or a login', async () => {
    const { runtime, identity, home, checkout, context, containers } = await workerFixture();
    const codexHome = await realpath(await mkdtemp(path.join(userOwnedParent(), 'codeai-codex-home-')));
    directories.push(codexHome);
    vi.stubEnv('CODEX_HOME', codexHome);
    await writeFile(path.join(codexHome, 'AGENTS.md'), 'Be brief.\n');
    await mkdir(path.join(codexHome, 'skills'));
    // The folder is outside the temp directory, where a turn could swap an entry before Docker binds it.
    // Everything else in the folder stays on the host: credentials, settings, other projects' history.
    for (const name of ['auth.json', 'config.toml', 'history.jsonl']) await writeFile(path.join(codexHome, name), 'private');
    await mkdir(path.join(codexHome, 'sessions'));
    const customizations = [
      `type=bind,src=${path.join(codexHome, 'AGENTS.md')},dst=/user/codex/AGENTS.md,readonly`,
      `type=bind,src=${path.join(codexHome, 'skills')},dst=/user/codex/skills,readonly`,
    ];
    const base = [`type=volume,src=${home},dst=${DOCKER_HOME}`, `type=bind,src=${checkout},dst=/workspace`, `type=bind,src=${context},dst=/context,readonly`];

    const worker = await runtime.createWorker(identity, { checkout, context, mode: 'agent', customizations: true });
    expect(worker.customizations).toEqual(['AGENTS.md', 'skills']);
    // The checkout is writable in Agent; the user's own files never are.
    expect(mounts(containers.get(worker.worker)!)).toEqual([...base, ...customizations]);
    // Only the worker sees them: not the lease, the preparer, the admission, or the egress gateway.
    for (const [id, container] of containers) if (id !== worker.worker) expect(mounts(container).join()).not.toContain('/user/');
    await worker.stop();

    const isolated = await runtime.createWorker({ ...identity, runId: crypto.randomUUID() }, { checkout, context, mode: 'agent', customizations: false });
    expect(isolated.customizations).toEqual([]);
    expect(mounts(containers.get(isolated.worker)!)).toEqual(base);
    await isolated.stop();

    const login = await runtime.createWorker({ ...identity, runId: crypto.randomUUID() }, { mode: 'ask', setup: true, customizations: true });
    expect(mounts(containers.get(login.worker)!)).toEqual([`type=volume,src=${home},dst=${DOCKER_HOME}`]);
    await login.stop();
  });

  it('refuses to start a worker whose customizations changed after they were resolved', async () => {
    const { runtime, identity, checkout, context, command, containers } = await workerFixture();
    const codexHome = await realpath(await mkdtemp(path.join(userOwnedParent(), 'codeai-codex-home-')));
    const elsewhere = await realpath(await mkdtemp(path.join(userOwnedParent(), 'codeai-codex-elsewhere-')));
    directories.push(codexHome, elsewhere);
    vi.stubEnv('CODEX_HOME', codexHome);
    await mkdir(path.join(codexHome, 'skills'));
    // The entry is swapped for a link once the worker exists, before Docker attaches its binds.
    const create = command.getMockImplementation()!;
    let worker: string | undefined;
    command.mockImplementation(async (args: string[]) => {
      const result = await create(args);
      if (args[0] === 'create' && args.includes(`${DOCKER_LABEL}.kind=worker`)) {
        worker = result;
        await rm(path.join(codexHome, 'skills'), { recursive: true });
        await symlink(elsewhere, path.join(codexHome, 'skills'));
      }
      return result;
    });
    await expect(runtime.createWorker(identity, { checkout, context, mode: 'ask', customizations: true })).rejects.toThrow('customizations changed');
    expect(worker).toBeDefined();
    expect(command).not.toHaveBeenCalledWith(['start', worker]);
    expect(containers.size).toBe(0);
  });

  it('reuses the owned legacy participant home for interactive setup without exposing a checkout', async () => {
    const { runtime, identity, legacyHome: home, command, containers, volumes } = await workerFixture();
    volumes.set(home, { [`${DOCKER_LABEL}.owner`]: runtime.owner, [`${DOCKER_LABEL}.participant`]: identity.participantId, [`${DOCKER_LABEL}.session`]: identity.sessionId });
    const worker = await runtime.createWorker(identity, { mode: 'ask', setup: true });
    const launch = containers.get(worker.worker)!;
    expect(mounts(launch)).toEqual([`type=volume,src=${home},dst=${DOCKER_HOME}`]);
    expect(launch).toContain(`${DOCKER_LABEL}.kind=setup`);
    expect(command.mock.calls.some(([args]) => args[0] === 'volume' && args[1] === 'create')).toBe(false);
    await worker.stop();
  });

  it.each(['owner', 'participant', 'session'])('rejects an existing provider home with a different %s and releases the session lease', async (field) => {
    const { runtime, identity, legacyHome, containers, networks, volumes } = await workerFixture();
    volumes.set(legacyHome, { [`${DOCKER_LABEL}.owner`]: runtime.owner, [`${DOCKER_LABEL}.participant`]: identity.participantId, [`${DOCKER_LABEL}.session`]: identity.sessionId, [`${DOCKER_LABEL}.${field}`]: 'different' });
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

describe('Docker worker lifetime', () => {
  it.each(['ask', 'plan', 'agent'] as const)('ends an orphaned %s worker after its turn limit and a grace period', async (mode) => {
    const { runtime, identity, checkout, containers } = await workerFixture();
    const worker = await runtime.createWorker(identity, { checkout, mode });
    const limitMs = mode === 'agent' ? runtime.config.buildTimeoutMs : runtime.config.agentTimeoutMs;
    expect(containers.get(worker.worker)!.slice(-2)).toEqual(['sleep', String(limitMs / 1000 + 600)]);
    await worker.stop();
  });

  it('removes only the still-active workers on process exit, without waiting or handling signals', async () => {
    const signalListeners = () => (['SIGINT', 'SIGTERM'] as const).map((signal) => process.listenerCount(signal));
    const before = signalListeners();
    const { runtime, identity, checkout } = await workerFixture();
    const worker = await runtime.createWorker(identity, { checkout, mode: 'agent' });
    const finished = await new DockerRuntime(runtime.config).createWorker(
      { ...identity, sessionId: crypto.randomUUID(), participantId: crypto.randomUUID() }, { mode: 'ask' });
    await finished.stop();
    const hooks = process.listeners('exit').filter((listener) => !foreignExitListeners.includes(listener));
    expect(hooks).toHaveLength(1);
    expect(signalListeners()).toEqual(before);
    (hooks[0] as (code: number) => void)(0);
    // Its lease stays for the next start, which records the interrupted delivery.
    expect(mocks.removeDetached.mock.calls).toEqual([['unix:///fixture/docker.sock', worker.worker]]);
    await worker.stop();
    mocks.removeDetached.mockClear();
    (hooks[0] as (code: number) => void)(0);
    expect(mocks.removeDetached).not.toHaveBeenCalled();
  });

  it('starts from the image an update switched to while the turn waited for admission', async () => {
    const { runtime, identity, command, containers } = await workerFixture();
    const switched = `sha256:${'b'.repeat(64)}`;
    const answer = command.getMockImplementation()!;
    command.mockImplementation(async (args: string[]) => {
      // The switch holds admission, so a turn admitted after it finds the new profile.
      if (args[0] === 'create' && args.some((arg) => arg.endsWith('-admission'))) {
        await writeFile(path.join(runtime.config.dataDir, 'docker', 'profile.json'), JSON.stringify({
          profile: DOCKER_PROFILE, image: switched, engineId: 'engine-original',
        }));
      }
      return answer(args);
    });
    const worker = await runtime.createWorker(identity, { mode: 'ask' });
    const launches = [...containers.values()].filter((args) => args.includes(`${DOCKER_LABEL}.kind=worker`) || args.includes(`${DOCKER_LABEL}.kind=egress`));
    expect(launches).toHaveLength(2);
    expect(launches.every((args) => args.includes(switched))).toBe(true);
    await worker.stop();
  });

  it('gives interactive setup its own longer bound', async () => {
    const { runtime, identity, containers } = await workerFixture();
    const worker = await runtime.createWorker(identity, { mode: 'ask', setup: true });
    expect(containers.get(worker.worker)!.slice(-2)).toEqual(['sleep', '3600']);
    await worker.stop();
  });
});

describe('shared Docker provider storage', () => {
  it('reuses one owned home across sessions and runtime restarts, keeping providers and installations separate', async () => {
    const { runtime, identity, home, containers, volumes } = await workerFixture();
    const first = await runtime.createWorker(identity, { mode: 'ask' });
    await first.stop();
    const restarted = new DockerRuntime(runtime.config);
    const nextIdentity = { ...identity, sessionId: crypto.randomUUID(), participantId: crypto.randomUUID(), runId: crypto.randomUUID() };
    const next = await restarted.createWorker(nextIdentity, { mode: 'ask' });
    expect(mounts(containers.get(next.worker)!)).toEqual([`type=volume,src=${home},dst=${DOCKER_HOME}`]);
    const claude = await restarted.createWorker({ ...nextIdentity, sessionId: crypto.randomUUID(), provider: 'claude' }, { mode: 'ask' });
    const claudeHome = providerVolume(runtime.owner, 'claude');
    expect(mounts(containers.get(claude.worker)!)).toEqual([`type=volume,src=${claudeHome},dst=${DOCKER_HOME}`]);
    expect([...volumes.keys()]).toEqual([home, claudeHome]);
    expect(providerVolume('another-installation', identity.provider)).not.toBe(home);
    expect(volumes.get(home)).toMatchObject({ [`${DOCKER_LABEL}.owner`]: runtime.owner, [`${DOCKER_LABEL}.provider`]: 'codex' });
    expect(volumes.get(home)).not.toHaveProperty(`${DOCKER_LABEL}.participant`);
    await next.stop();
    await claude.stop();
  });

  it.each(['owner', 'provider', 'kind'])('refuses shared storage with a mismatched %s label', async (field) => {
    const { runtime, identity, home, containers, volumes } = await workerFixture();
    volumes.set(home, { [`${DOCKER_LABEL}.owner`]: runtime.owner, [`${DOCKER_LABEL}.provider`]: identity.provider,
      [`${DOCKER_LABEL}.kind`]: 'provider-home', [`${DOCKER_LABEL}.${field}`]: 'wrong' });
    await expect(runtime.createWorker(identity, { mode: 'ask' })).rejects.toThrow('ownership');
    expect(containers.size).toBe(0);
    expect(volumes.has(home)).toBe(true);
  });

  it('admits concurrent independent sessions without retaining their shared admission gate', async () => {
    const { runtime, identity, containers } = await workerFixture();
    const secondRuntime = new DockerRuntime(runtime.config);
    const workers = await Promise.all([
      runtime.createWorker(identity, { mode: 'ask' }),
      secondRuntime.createWorker({ ...identity, sessionId: crypto.randomUUID(), participantId: crypto.randomUUID() }, { mode: 'ask' }),
    ]);
    expect(workers.every((worker) => containers.has(worker.worker))).toBe(true);
    expect([...containers.values()].some((args) => args.includes(`${DOCKER_LABEL}.kind=admission`))).toBe(false);
    await Promise.all(workers.map((worker) => worker.stop()));
  });

  it('excludes setup while any session uses its home, and excludes turns and other setup until login stops', async () => {
    const { runtime, identity, containers } = await workerFixture();
    const otherRuntime = new DockerRuntime(runtime.config);
    const setupIdentity = { ...identity, sessionId: crypto.randomUUID(), participantId: crypto.randomUUID() };
    const turn = await runtime.createWorker(identity, { mode: 'ask' });
    await expect(otherRuntime.createWorker(setupIdentity, { mode: 'ask', setup: true })).rejects.toThrow('storage is active');
    expect(containers.has(turn.worker)).toBe(true);
    await turn.stop();
    const setup = await otherRuntime.createWorker(setupIdentity, { mode: 'ask', setup: true });
    await expect(runtime.createWorker(identity, { mode: 'ask' })).rejects.toThrow('setup is active');
    await expect(runtime.createWorker(identity, { mode: 'ask', setup: true })).rejects.toThrow('setup is active');
    const differentProvider = await runtime.createWorker({ ...identity, provider: 'claude' }, { mode: 'ask' });
    await differentProvider.stop();
    await setup.stop();
    const resumed = await runtime.createWorker(identity, { mode: 'ask' });
    await resumed.stop();
    expect(containers.size).toBe(0);
  });

  it('preserves every live setup resource through server reconciliation', async () => {
    const { runtime, identity, containers } = await workerFixture();
    const setup = await runtime.createWorker(identity, { mode: 'ask', setup: true });
    const before = [...containers.keys()];
    const replacement = new DockerRuntime(runtime.config);
    const command = mocks.command.getMockImplementation()!;
    mocks.command.mockImplementation((input: string[]) => input[2] === 'network' && input[3] === 'inspect' ? Promise.resolve('{"setup-worker":{}}') : command(input));
    expect(await replacement.reconcile()).toEqual([]);
    expect([...containers.keys()]).toEqual(before);
    expect([...containers.values()].some((args) => args.includes(`${DOCKER_LABEL}.home=${providerVolume(runtime.owner, 'codex')}`))).toBe(true);
    await setup.stop();
  });

  it.each(['turn', 'login'] as const)('lets a %s clear a login whose terminal died, without a server restart', async (next) => {
    const { runtime, identity, containers, networks } = await workerFixture();
    // The server's single reconciliation is already spent.
    expect(await runtime.reconcile()).toEqual([]);
    const login = { ...identity, sessionId: crypto.randomUUID(), participantId: crypto.randomUUID(), runId: crypto.randomUUID() };
    await new DockerRuntime(runtime.config).createWorker(login, { mode: 'ask', setup: true });
    const held = [...containers.keys()];
    await expect(runtime.createWorker(identity, { mode: 'ask' })).rejects.toThrow('setup is active');
    expect([...containers.keys()]).toEqual(held);
    for (const args of containers.values()) args[args.indexOf(`${DOCKER_LABEL}.pid=${process.pid}`)] = DEAD_OWNER;
    const worker = await (next === 'turn' ? runtime : new DockerRuntime(runtime.config))
      .createWorker(identity, { mode: 'ask', setup: next === 'login' });
    expect(held.some((id) => containers.has(id))).toBe(false);
    expect(networks.size).toBe(1);
    await worker.stop();
    expect(containers.size).toBe(0);
    expect(networks.size).toBe(0);
  });

  it.each(['setup', 'cleanup'])('clears a dead %s lease from the session it blocks', async (kind) => {
    const { runtime, identity, containers } = await workerFixture();
    const strand = () => containers.set('stale-lease', ['create', '--name', `codeai-${runtime.owner}-${identity.sessionId}`,
      '--label', `${DOCKER_LABEL}.owner=${runtime.owner}`, '--label', `${DOCKER_LABEL}.kind=${kind}`,
      '--label', `${DOCKER_LABEL}.session=${identity.sessionId}`, '--label', DEAD_OWNER]);
    strand();
    const turn = await runtime.createWorker(identity, { mode: 'ask' });
    expect(containers.has('stale-lease')).toBe(false);
    await turn.stop();
    strand();
    expect(await runtime.cleanupParticipant(identity)).toEqual({ homeRemoved: false });
    expect(containers.size).toBe(0);
  });

  it('keeps the original refusal when the dead-terminal sweep itself fails', async () => {
    const { runtime, identity } = await workerFixture();
    const setup = await new DockerRuntime(runtime.config).createWorker(
      { ...identity, sessionId: crypto.randomUUID(), participantId: crypto.randomUUID() }, { mode: 'ask', setup: true });
    const command = mocks.command.getMockImplementation()!;
    // Admission inspects its conflict first; a container vanishing under the sweep's inspections fails it.
    let inspections = 0;
    mocks.command.mockImplementation((input: string[]) => (
      input[2] === 'inspect' && ++inspections > 1 ? Promise.reject(new Error('No such container')) : command(input)));
    await expect(runtime.createWorker(identity, { mode: 'ask' })).rejects.toThrow('setup is active');
    mocks.command.mockImplementation(command);
    await setup.stop();
  });

  it('leaves a live turn alone while clearing a dead terminal\'s remains in the same session', async () => {
    const { runtime, identity, containers } = await workerFixture();
    const turn = await runtime.createWorker(identity, { mode: 'ask' });
    const live = [...containers.keys()];
    // A half-removed login: its lease is gone, so the live turn could take the session.
    containers.set('dead-setup', ['create', '--label', `${DOCKER_LABEL}.owner=${runtime.owner}`, '--label', `${DOCKER_LABEL}.kind=setup`,
      '--label', `${DOCKER_LABEL}.session=${identity.sessionId}`, '--label', DEAD_OWNER]);
    await expect(new DockerRuntime(runtime.config).createWorker({ ...identity, runId: crypto.randomUUID() }, { mode: 'ask' }))
      .rejects.toThrow('name already in use');
    expect([...containers.keys()]).toEqual(live);
    await turn.stop();
  });

  it('uses short login guidance for shared homes and ID guidance for legacy homes', async () => {
    const { runtime, identity, legacyHome, volumes, state } = await workerFixture();
    state.failAuth = true;
    const shared = await runtime.createWorker(identity, { mode: 'ask' });
    await expect(shared.authenticate()).rejects.toThrow('npm run docker:login -- codex in your terminal');
    await shared.stop();
    volumes.set(legacyHome, { [`${DOCKER_LABEL}.owner`]: runtime.owner, [`${DOCKER_LABEL}.participant`]: identity.participantId, [`${DOCKER_LABEL}.session`]: identity.sessionId });
    const legacy = await runtime.createWorker(identity, { mode: 'ask' });
    await expect(legacy.authenticate()).rejects.toThrow(`npm run docker:login -- ${identity.sessionId} ${identity.participantId}`);
    await legacy.stop();
  });
});

describe('Docker engine replacement', () => {
  const image = `sha256:${'b'.repeat(64)}`;

  it('keeps an existing profile unless the owner explicitly replaces a different engine', async () => {
    const { dataDir } = await fixture();
    const file = path.join(dataDir, 'docker', 'profile.json');
    const original = await readFile(file, 'utf8');
    mocks.command.mockResolvedValue('engine-replacement');
    await expect(saveDockerProvision(dataDir, image)).rejects.toThrow('npm run docker:provision -- --replace-engine');
    mocks.command.mockResolvedValue('engine-original');
    await expect(saveDockerProvision(dataDir, image, true)).rejects.toThrow('unchanged');
    expect(await readFile(file, 'utf8')).toBe(original);
    mocks.command.mockResolvedValue('engine-replacement');
    await saveDockerProvision(dataDir, image, true);
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ profile: DOCKER_PROFILE, image, engineId: 'engine-replacement' });
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it('provisions normally when there is no profile to replace', async () => {
    const { dataDir } = await fixture();
    await rm(path.join(dataDir, 'docker'), { recursive: true });
    mocks.command.mockResolvedValue('engine-replacement');
    await saveDockerProvision(dataDir, image, true);
    expect(JSON.parse(await readFile(path.join(dataDir, 'docker', 'profile.json'), 'utf8'))).toMatchObject({ engineId: 'engine-replacement' });
  });

  it('releases a turn stranded on the previous engine and recovers on the new one', async () => {
    const { runtime, identity, checkout, containers, networks, state } = await workerFixture();
    const worker = await runtime.createWorker(identity, { checkout, mode: 'agent' });
    // The replacement engine holds none of the previous engine's containers or networks.
    state.engine = 'engine-replacement';
    containers.clear();
    networks.clear();
    await expect(worker.stop()).rejects.toThrow('identity changed');
    await expect(new DockerRuntime(runtime.config).reconcile()).rejects.toThrow('identity changed');
    await saveDockerProvision(runtime.config.dataDir, image, true);
    await worker.stop();
    expect(await new DockerRuntime(runtime.config).reconcile()).toEqual([]);
  });
});

describe('legacy Docker participant cleanup', () => {
  it('retains shared storage, including while another session uses it', async () => {
    const { runtime, identity, home, volumes, command } = await workerFixture();
    const worker = await runtime.createWorker(identity, { mode: 'ask' });
    const cleanupIdentity = { ...identity, sessionId: crypto.randomUUID(), participantId: crypto.randomUUID() };
    expect(await runtime.cleanupParticipant(cleanupIdentity)).toEqual({ homeRemoved: false });
    expect(volumes.has(home)).toBe(true);
    expect(command.mock.calls.some(([args]) => args[0] === 'volume' && args[1] === 'rm')).toBe(false);
    await worker.stop();
  });

  it('removes only owned legacy storage after its turn or login has stopped', async () => {
    const { runtime, identity, legacyHome, volumes, containers } = await workerFixture();
    const labels = { [`${DOCKER_LABEL}.owner`]: runtime.owner, [`${DOCKER_LABEL}.participant`]: identity.participantId, [`${DOCKER_LABEL}.session`]: identity.sessionId };
    volumes.set(legacyHome, labels);
    const cache = participantVolume(runtime.owner, identity.sessionId, identity.participantId, 'cache');
    volumes.set(cache, labels);
    const worker = await runtime.createWorker(identity, { mode: 'ask', setup: true });
    await expect(runtime.cleanupParticipant(identity)).rejects.toThrow('name already in use');
    expect(volumes.has(legacyHome)).toBe(true);
    await worker.stop();
    expect(await runtime.cleanupParticipant(identity)).toEqual({ homeRemoved: true });
    expect(volumes.size).toBe(0);
    expect(containers.size).toBe(0);
  });

  it('refuses legacy volume ownership mismatches and containers outside its session lease', async () => {
    const { runtime, identity, legacyHome, volumes, containers } = await workerFixture();
    const labels = { [`${DOCKER_LABEL}.owner`]: runtime.owner, [`${DOCKER_LABEL}.participant`]: identity.participantId, [`${DOCKER_LABEL}.session`]: identity.sessionId };
    volumes.set(legacyHome, { ...labels, [`${DOCKER_LABEL}.owner`]: 'other' });
    await expect(runtime.cleanupParticipant(identity)).rejects.toThrow('ownership');
    volumes.set(legacyHome, labels);
    containers.set('external', ['create', '--label', `${DOCKER_LABEL}.owner=${runtime.owner}`, '--label', `${DOCKER_LABEL}.kind=worker`, '--mount', `type=volume,src=${legacyHome},dst=${DOCKER_HOME}`]);
    await expect(runtime.cleanupParticipant(identity)).rejects.toThrow('storage is active');
    expect(volumes.has(legacyHome)).toBe(true);
    expect([...containers.keys()]).toEqual(['external']);
  });
});
