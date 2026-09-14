import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DockerProcessRunner } from '@/server/execution/dockerProcessRunner';
import { getConfig } from '@/server/config';
import { resolveAgentPolicy } from '@/server/agents/agentPolicy';
import { RunRegistry } from '@/server/runs/runRegistry';
import type { AgentProcessRun } from '@/shared/types';

const mocks = vi.hoisted(() => ({ create: vi.fn(), run: vi.fn(), options: vi.fn() }));
vi.mock('@/server/execution/dockerRuntime', async (original) => ({
  ...await original<typeof import('@/server/execution/dockerRuntime')>(),
  getDockerRuntime: () => ({ createWorker: mocks.create }),
}));
vi.mock('@/server/agents/claudeProcessRunner', () => ({ ClaudeProcessRunner: class {
  constructor(options: unknown) { mocks.options(options); }
  run = mocks.run;
} }));
vi.mock('@/server/agents/codexProcessRunner', () => ({ CodexProcessRunner: class {
  constructor(options: unknown) { mocks.options(options); }
  run = mocks.run;
} }));

async function fixture() {
  const config = { ...getConfig(), dockerEnabled: true };
  const context = await mkdtemp(path.join(os.tmpdir(), 'codeai-transport-'));
  await writeFile(path.join(context, 'canvas.png'), 'synthetic-image');
  const signal = new AbortController();
  const input: AgentProcessRun = {
    runId: crypto.randomUUID(), session: { action: 'resume', id: 'native-history' },
    checkout: { id: 'checkout', name: 'Fixture', relativePath: '.', realPath: '/fixture/checkout' },
    attachmentDirectory: context, prompt: `Read ${context}/canvas.png in /fixture/checkout`,
    policy: resolveAgentPolicy(config, 'agent', 'docker'), signal: signal.signal, emit: vi.fn(),
  };
  const worker = { stop: vi.fn().mockResolvedValue(undefined), authenticate: vi.fn().mockResolvedValue(undefined), spawn: vi.fn() };
  mocks.create.mockResolvedValue(worker);
  mocks.run.mockResolvedValue({ finalText: 'Done', sessionId: 'native-history', durationMs: 1, outputBytes: 4 });
  return { worker, input, signal, runner: new DockerProcessRunner(config, 'codex', { sessionId: 'session', participantId: 'participant' }) };
}

describe('Docker protocol transport lifecycle', () => {
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

  it('translates prompt, image and resume inputs and stops all container processes before returning', async () => {
    const { runner, input, worker } = await fixture();
    await expect(runner.run(input)).resolves.toMatchObject({ sessionId: 'native-history' });
    expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({
      checkout: expect.objectContaining({ realPath: '/workspace' }), attachmentDirectory: '/context',
      prompt: 'Read /context/canvas.png in /workspace', session: { action: 'resume', id: 'native-history' },
    }));
    expect(mocks.options).toHaveBeenCalledWith(expect.objectContaining({ transport: worker, imagePaths: ['/context/canvas.png'], debug: false }));
    expect(worker.authenticate.mock.invocationCallOrder[0]).toBeLessThan(mocks.run.mock.invocationCallOrder[0]);
    expect(worker.stop).toHaveBeenCalledOnce();
  });

  it('does not deliver a prompt after participant authentication fails or cancellation arrives during preflight', async () => {
    const { runner, input, worker, signal } = await fixture();
    worker.authenticate.mockRejectedValueOnce(new Error('Participant login required'));
    await expect(runner.run(input)).rejects.toMatchObject({ code: 'unauthenticated', delivery: 'not-sent' });
    expect(mocks.run).not.toHaveBeenCalled();
    worker.authenticate.mockImplementationOnce(async () => { signal.abort(); });
    await expect(runner.run(input)).rejects.toMatchObject({ code: 'cancelled', delivery: 'not-sent' });
    expect(mocks.run).not.toHaveBeenCalled();
    expect(worker.stop).toHaveBeenCalledTimes(2);
  });

  it('stops the worker on protocol failure and never creates a host fallback', async () => {
    const { runner, input, worker } = await fixture();
    mocks.run.mockRejectedValueOnce(new Error('Malformed protocol'));
    await expect(runner.run(input)).rejects.toThrow('Malformed protocol');
    expect(worker.stop).toHaveBeenCalledOnce();
    expect(mocks.options).toHaveBeenCalledOnce();
    expect(mocks.options.mock.calls[0][0].transport).toBe(worker);
  });

  it('retains the checkout and machine slot until Docker confirms termination', async () => {
    const { runner, input, worker } = await fixture();
    const registry = new RunRegistry(1);
    let reachedStop!: () => void;
    const stopping = new Promise<void>((resolve) => { reachedStop = resolve; });
    worker.stop.mockImplementationOnce(async () => { reachedStop(); throw new Error('Daemon unavailable'); });
    vi.useFakeTimers();
    registry.reserve({ runId: input.runId, sessionId: 'docker', participantId: 'd', providerKey: 'docker:d', checkoutId: 'checkout', access: 'write', cancel() {} });
    registry.activate(input.runId, { execute: async () => { await runner.run(input); }, cancelQueued: async () => {} });
    const local = vi.fn().mockResolvedValue(undefined);
    registry.reserve({ runId: 'local', sessionId: 'local', participantId: 'l', providerKey: 'local:l', checkoutId: 'checkout', access: 'read', cancel() {} });
    registry.activate('local', { execute: local, cancelQueued: async () => {} });
    await stopping;
    expect(registry.list().active).toHaveLength(2);
    expect(local).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    await registry.wait('local');
    expect(worker.stop).toHaveBeenCalledTimes(2);
    expect(local).toHaveBeenCalledOnce();
    expect(registry.list().active).toHaveLength(0);
  });
});
