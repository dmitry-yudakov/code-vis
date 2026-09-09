import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(), spawn: vi.fn(), createWorker: vi.fn(), cleanupParticipant: vi.fn(), stop: vi.fn(),
}));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('node:fs/promises', () => ({ readFile: mocks.readFile }));
vi.mock('@next/env', () => ({ loadEnvConfig: vi.fn() }));
vi.mock('@/server/config', () => ({ getConfig: () => ({ dataDir: '/fixture', dockerEnabled: true }) }));
vi.mock('@/server/execution/dockerCommand', () => ({
  localDockerEndpoint: async () => 'unix:///fixture/docker.sock', dockerCommand: vi.fn(), dockerEnvironment: () => ({}),
}));
vi.mock('@/server/execution/dockerRuntime', () => ({
  DockerRuntime: class {
    createWorker = mocks.createWorker;
    cleanupParticipant = mocks.cleanupParticipant;
  },
  saveDockerProvision: vi.fn(),
}));

import { dockerMain } from '../scripts/docker';

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
