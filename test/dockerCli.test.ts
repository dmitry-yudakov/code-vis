import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(), spawn: vi.fn(), createWorker: vi.fn(), cleanupParticipant: vi.fn(), stop: vi.fn(),
  command: vi.fn(), saveProvision: vi.fn(), provisioned: vi.fn(), check: vi.fn(), writeVersions: vi.fn(), readVersions: vi.fn(),
  plan: vi.fn(), run: vi.fn(), buildArguments: vi.fn(),
}));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('node:fs/promises', () => ({ readFile: mocks.readFile }));
vi.mock('@next/env', () => ({ loadEnvConfig: vi.fn() }));
vi.mock('@/server/config', () => ({ getConfig: () => ({ dataDir: '/fixture', dockerEnabled: true }) }));
vi.mock('@/server/execution/dockerCommand', () => ({
  localDockerEndpoint: async () => 'unix:///fixture/docker.sock', dockerCommand: mocks.command, dockerEnvironment: () => ({}),
}));
vi.mock('@/server/execution/dockerRuntime', () => ({
  DockerRuntime: class {
    owner = 'fixture-owner';
    createWorker = mocks.createWorker;
    cleanupParticipant = mocks.cleanupParticipant;
  },
  saveDockerProvision: mocks.saveProvision,
  dockerProvisioned: mocks.provisioned,
  ALREADY_PROVISIONED: 'This installation is already provisioned.',
}));
vi.mock('@/server/execution/dockerUpgrade', () => ({
  checkDockerImage: mocks.check, writeDockerVersions: mocks.writeVersions, readDockerVersions: mocks.readVersions,
  planDockerUpdate: mocks.plan, runDockerUpdate: mocks.run, dockerBuildArguments: mocks.buildArguments,
  dockerBuildContext: () => '/installation/docker',
}));

import { dockerMain } from '../scripts/docker';
import { DOCKER_IMAGE_TAG, DOCKER_VERSIONS } from '@/server/execution/dockerProfile';

const sessionId = crypto.randomUUID();
const participantId = crypto.randomUUID();
const originalTty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
function legacySession(execution = 'docker') {
  return JSON.stringify({
    version: 4, execution, revision: 0, id: sessionId, title: 'Legacy Docker session',
    createdAt: '2026-09-09T10:00:00.000Z', updatedAt: '2026-09-09T10:00:00.000Z',
    repositories: [{ id: crypto.randomUUID(), hostId: crypto.randomUUID(), checkoutId: 'fixture', role: 'primary' }],
    primaryAgentId: participantId, messages: [], pinnedDiagramIds: [], annotations: {}, sketches: [],
    participants: [
      { id: 'human', kind: 'human', displayName: 'You' },
      { id: participantId, kind: 'agent', displayName: 'Claude', provider: 'claude', role: 'coder', defaultMode: 'ask', session: { provider: 'claude', started: false } },
    ],
  });
}

beforeEach(() => {
  Object.defineProperty(process.stdin, 'isTTY', { configurable: true, writable: true, value: true });
  vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  mocks.createWorker.mockResolvedValue({ worker: 'setup-worker', endpoint: 'unix:///fixture/docker.sock', stop: mocks.stop });
  mocks.stop.mockResolvedValue(undefined);
  mocks.cleanupParticipant.mockResolvedValue({ homeRemoved: false });
  mocks.spawn.mockImplementation(() => {
    const child = new EventEmitter();
    queueMicrotask(() => child.emit('exit', 0));
    return child;
  });
});

afterEach(() => {
  if (originalTty) Object.defineProperty(process.stdin, 'isTTY', originalTty);
  else Reflect.deleteProperty(process.stdin, 'isTTY');
  vi.restoreAllMocks(); vi.resetAllMocks();
});

describe('Docker owner-terminal login', () => {
  it.each(['claude', 'codex'])('signs in %s before a session exists without reading provider or session files', async (provider) => {
    await dockerMain(['login', provider]);
    expect(mocks.readFile).not.toHaveBeenCalled();
    expect(mocks.createWorker).toHaveBeenCalledWith(expect.objectContaining({ provider }), { mode: 'ask', setup: true });
    expect(mocks.spawn).toHaveBeenCalledWith('docker', ['--host', 'unix:///fixture/docker.sock', 'exec', '-it', 'setup-worker', provider,
      ...(provider === 'claude' ? ['auth', 'login'] : ['login', '--device-auth'])], expect.objectContaining({ stdio: 'inherit', shell: false }));
    expect(mocks.stop).toHaveBeenCalledOnce();
  });

  it('requires an interactive owner terminal and removes the setup worker after login failure', async () => {
    process.stdin.isTTY = false;
    await expect(dockerMain(['login', 'codex'])).rejects.toThrow('interactive terminal');
    expect(mocks.createWorker).not.toHaveBeenCalled();
    process.stdin.isTTY = true;
    mocks.spawn.mockImplementation(() => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit('exit', 1));
      return child;
    });
    await expect(dockerMain(['login', 'codex'])).rejects.toThrow('did not complete');
    expect(mocks.stop).toHaveBeenCalledOnce();
  });

  it('retains ID-based login for archived legacy sessions', async () => {
    mocks.readFile.mockRejectedValueOnce(Object.assign(new Error('Missing'), { code: 'ENOENT' })).mockResolvedValueOnce(legacySession());
    await dockerMain(['login', sessionId, participantId]);
    expect(mocks.readFile.mock.calls.map(([file]) => file)).toEqual([
      `/fixture/session-store-v2/sessions/${sessionId}.json`, `/fixture/session-store-v2/archived-sessions/${sessionId}.json`,
    ]);
    expect(mocks.createWorker).toHaveBeenCalledWith(expect.objectContaining({ sessionId, participantId, provider: 'claude' }), { mode: 'ask', setup: true });
  });

  it('keeps cleanup scoped to a validated Docker participant and rejects provider-wide cleanup', async () => {
    await expect(dockerMain(['cleanup', 'codex'])).rejects.toThrow('Usage:');
    expect(mocks.cleanupParticipant).not.toHaveBeenCalled();
    mocks.readFile.mockResolvedValueOnce(legacySession('local'));
    await expect(dockerMain(['cleanup', sessionId, participantId])).rejects.toThrow('Docker session');
    mocks.readFile.mockResolvedValueOnce(legacySession());
    await dockerMain(['cleanup', sessionId, participantId]);
    expect(mocks.cleanupParticipant).toHaveBeenCalledWith(expect.objectContaining({ sessionId, participantId, provider: 'claude' }));
  });
});

describe('Docker owner-terminal provisioning', () => {
  const codexModels = { models: [{ id: 'gpt-worker', label: 'GPT Worker', efforts: ['low'] }], efforts: ['low'] };
  beforeEach(() => {
    mocks.command.mockResolvedValue('sha256:image\n');
    mocks.buildArguments.mockReturnValue(['--build-arg', 'fixture']);
    mocks.check.mockResolvedValue({ passed: true, codexModels });
  });

  it('builds the pinned versions, checks them offline like an update, and records them', async () => {
    await dockerMain(['provision']);
    expect(mocks.buildArguments).toHaveBeenCalledWith(DOCKER_VERSIONS);
    expect(mocks.spawn).toHaveBeenCalledWith('docker', ['--host', 'unix:///fixture/docker.sock', 'build', '--load',
      '--build-arg', 'fixture', '--tag', DOCKER_IMAGE_TAG, '/installation/docker'], expect.objectContaining({ stdio: 'inherit' }));
    expect(mocks.check).toHaveBeenCalledWith(expect.anything(), 'sha256:image', DOCKER_VERSIONS);
    expect(mocks.writeVersions).toHaveBeenCalledWith('/fixture', {
      image: 'sha256:image', claude: DOCKER_VERSIONS.claude, codex: DOCKER_VERSIONS.codex, previous: {}, codexModels,
    });
    expect(mocks.saveProvision.mock.invocationCallOrder[0]).toBeLessThan(mocks.writeVersions.mock.invocationCallOrder[0]);
    // Its own tag keeps the recorded image from counting as dangling when the shared tag moves on.
    expect(mocks.command).toHaveBeenCalledWith(['--host', 'unix:///fixture/docker.sock', 'tag', 'sha256:image', 'codeai-worker:fixture-owner']);
  });

  it('refuses an already provisioned installation before building, unless it adopts a replaced engine', async () => {
    mocks.provisioned.mockResolvedValue(true);
    await expect(dockerMain(['provision'])).rejects.toThrow('already provisioned');
    expect(mocks.spawn).not.toHaveBeenCalled();
    await dockerMain(['provision', '--replace-engine']);
    expect(mocks.saveProvision).toHaveBeenLastCalledWith('/fixture', 'sha256:image', true);
  });

  it('records nothing when the built worker fails a check', async () => {
    mocks.check.mockResolvedValue({ passed: false, check: 'claude-flags', message: 'claude --help does not document --effort.' });
    await expect(dockerMain(['provision'])).rejects.toThrow('claude-flags check: claude --help does not document --effort.');
    expect(mocks.saveProvision).not.toHaveBeenCalled();
    expect(mocks.writeVersions).not.toHaveBeenCalled();
  });

  it('adopts a replaced engine only on the explicit owner flag', async () => {
    await dockerMain(['provision']);
    expect(mocks.saveProvision).toHaveBeenLastCalledWith('/fixture', 'sha256:image', false);
    await dockerMain(['provision', '--replace-engine']);
    expect(mocks.saveProvision).toHaveBeenLastCalledWith('/fixture', 'sha256:image', true);
  });

  it('rejects any other provisioning argument before building', async () => {
    await expect(dockerMain(['provision', '--force'])).rejects.toThrow('Usage:');
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.saveProvision).not.toHaveBeenCalled();
  });
});

describe('Docker owner-terminal upgrade', () => {
  const output = () => vi.mocked(process.stdout.write).mock.calls.map(([text]) => String(text)).join('');

  it('prints the recorded versions, previous versions and minimums', async () => {
    mocks.readVersions.mockResolvedValue({ image: 'sha256:image', claude: '2.1.280', codex: '0.152.0', previous: { claude: '2.1.226' } });
    await dockerMain(['upgrade']);
    expect(output()).toContain('Claude  2.1.280   previous 2.1.226, minimum 2.1.226');
    expect(output()).toContain('Codex   0.152.0   previous none, minimum 0.152.0');
    expect(mocks.plan).not.toHaveBeenCalled();
  });

  it('performs one update to an exact version, printing its steps and the rollback command', async () => {
    const plan = { provider: 'claude', version: '2.1.280', image: 'sha256:image', recorded: {} };
    mocks.plan.mockResolvedValue(plan);
    mocks.run.mockImplementation(async (_runtime: unknown, _plan: unknown, onStep: (step: string) => void) => {
      for (const step of ['building', 'checking', 'switching']) onStep(step);
      return { outcome: 'switched', provider: 'claude', version: '2.1.280', replaced: '2.1.226' };
    });
    await dockerMain(['upgrade', 'claude', '2.1.280']);
    expect(mocks.plan).toHaveBeenCalledWith(expect.anything(), 'claude', '2.1.280');
    expect(mocks.run).toHaveBeenCalledWith(expect.anything(), plan, expect.any(Function));
    expect(output()).toContain('Building a candidate worker with Claude 2.1.280');
    expect(output()).toContain('Docker Claude is now 2.1.280, replacing 2.1.226.');
    expect(output()).toContain('npm run docker:upgrade -- claude 2.1.226');
  });

  it('prints a downgrade warning before building', async () => {
    mocks.plan.mockResolvedValue({ provider: 'claude', version: '2.1.226', warning: 'may already have migrated' });
    mocks.run.mockImplementation(async () => {
      expect(output()).toContain('may already have migrated');
      return { outcome: 'switched', provider: 'claude', version: '2.1.226', replaced: '2.1.280' };
    });
    await dockerMain(['upgrade', 'claude', '2.1.226']);
    expect(mocks.run).toHaveBeenCalledOnce();
  });

  it.each([
    [{ outcome: 'failed', check: 'codex-models', message: 'No models.' }, 'The codex-models check failed: No models. The recorded image is unchanged.'],
    [{ outcome: 'in-use', message: 'Codex is in use by a turn. Try again when it finishes.' }, 'Codex is in use by a turn.'],
  ])('exits with the outcome %j', async (result, message) => {
    mocks.plan.mockResolvedValue({ provider: 'codex', version: '0.156.1' });
    mocks.run.mockResolvedValue(result);
    await expect(dockerMain(['upgrade', 'codex', '0.156.1'])).rejects.toThrow(message);
  });

  it.each([[['claude']], [['claude', '2.1.280', 'extra']]])('rejects %j before planning', async (targets) => {
    await expect(dockerMain(['upgrade', ...targets])).rejects.toThrow('Usage: npm run docker:upgrade');
    expect(mocks.plan).not.toHaveBeenCalled();
  });
});
