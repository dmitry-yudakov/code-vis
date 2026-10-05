import { describe, expect, it, vi } from 'vitest';
import { RunRegistry } from '@/server/runs/runRegistry';
import type { AgentMode } from '@/shared/types';

async function tick() { await Promise.resolve(); await Promise.resolve(); }
function hold(registry: RunRegistry, mode: AgentMode = 'ask') {
  const runId = crypto.randomUUID();
  const controller = new AbortController();
  let release!: () => void;
  const executing = new Promise<void>((resolve) => { release = resolve; });
  const execute = vi.fn(() => executing);
  const cancel = vi.fn(() => controller.abort());
  const cancelQueued = vi.fn(async () => undefined);
  const changeMode = vi.fn(async (): Promise<{ ok: true }> => ({ ok: true }));
  expect(registry.reserve({ runId, sessionId: crypto.randomUUID(), participantId: crypto.randomUUID(),
    checkoutId: 'checkout', checkoutPath: '/repo', providerKey: crypto.randomUUID(), mode,
    access: mode === 'ask' || mode === 'plan' ? 'read' : 'write', cancel, changeMode,
  }).accepted).toBe(true);
  registry.activate(runId, { execute, cancelQueued });
  return { runId, controller, execute, cancel, cancelQueued, changeMode, release };
}

describe('mode changes in the checkout scheduler', () => {
  it('queues a read-to-write upgrade behind another reader and resumes the same execution once', async () => {
    const registry = new RunRegistry(3);
    const first = hold(registry);
    const second = hold(registry);
    await tick();
    let resumed = false;
    const upgraded = registry.upgradeToWrite(first.runId, first.controller.signal).then(() => { resumed = true; });
    const later = hold(registry);
    await tick();
    expect(resumed).toBe(false);
    expect(registry.currentRuns.find((run) => run.runId === first.runId)?.state).toBe('queued');
    expect(later.execute).not.toHaveBeenCalled();
    second.release();
    await upgraded;
    expect(first.execute).toHaveBeenCalledOnce();
    expect(later.execute).not.toHaveBeenCalled();
    first.release();
    await registry.wait(first.runId);
    await tick();
    expect(later.execute).toHaveBeenCalledOnce();
    later.release();
  });

  it('cancels a waiting upgrade through the live execution and never invokes queued-message cancellation', async () => {
    const registry = new RunRegistry();
    const first = hold(registry);
    const second = hold(registry);
    await tick();
    const upgraded = registry.upgradeToWrite(first.runId, first.controller.signal);
    const rejected = expect(upgraded).rejects.toThrow();
    expect(await registry.cancel(first.runId)).toBe('accepted');
    await rejected;
    expect(first.cancelQueued).not.toHaveBeenCalled();
    expect(first.controller.signal.aborted).toBe(true);
    first.release(); second.release();
    await registry.wait(first.runId);
    expect(first.execute).toHaveBeenCalledOnce();
  });

  it('keeps a repeatedly cancelled upgrade reserved until the live execution finishes cleanup', async () => {
    const registry = new RunRegistry();
    const first = hold(registry);
    const second = hold(registry);
    await tick();
    const sessionId = registry.currentRuns.find((run) => run.runId === first.runId)!.sessionId;
    let finished = false;
    const completion = registry.wait(first.runId)!.then(() => { finished = true; });
    const rejected = expect(registry.upgradeToWrite(first.runId, first.controller.signal)).rejects.toThrow();

    expect(await registry.cancel(first.runId)).toBe('accepted');
    await rejected;
    expect(await registry.cancel(first.runId)).toBe('accepted');
    expect(first.cancelQueued).not.toHaveBeenCalled();
    expect(first.cancel).toHaveBeenCalledOnce();
    expect(finished).toBe(false);
    expect(registry.hasLiveSession(sessionId)).toBe(true);
    expect(registry.reserve({ runId: crypto.randomUUID(), sessionId, participantId: crypto.randomUUID(),
      providerKey: crypto.randomUUID(), checkoutId: 'checkout', access: 'read', cancel: vi.fn(),
    })).toMatchObject({ accepted: false, reason: 'session-conflict' });

    second.release();
    await registry.wait(second.runId);
    expect(finished).toBe(false);
    expect(first.execute).toHaveBeenCalledOnce();
    first.release();
    await completion;
    expect(registry.hasLiveSession(sessionId)).toBe(false);
  });

  it('lets a queued writer become a shared reader and exposes the chosen mode in discovery/replay', async () => {
    const registry = new RunRegistry();
    const reader = hold(registry);
    const waiting = hold(registry, 'agent');
    await tick();
    expect(waiting.execute).not.toHaveBeenCalled();
    expect(await registry.changeMode(waiting.runId, 'plan')).toEqual({ ok: true });
    await tick();
    expect(waiting.execute).toHaveBeenCalledOnce();
    expect(registry.currentRuns.find((run) => run.runId === waiting.runId)?.mode).toBe('plan');
    expect(registry.subscribe(waiting.runId, () => undefined)?.replay).toContainEqual({
      type: 'mode-changed', runId: waiting.runId, mode: 'plan',
    });
    reader.release(); waiting.release();
  });

  it('retains exclusive access when a started writer changes to Plan', async () => {
    const registry = new RunRegistry();
    const writer = hold(registry, 'agent');
    const reader = hold(registry);
    await tick();
    await registry.changeMode(writer.runId, 'plan');
    expect(reader.execute).not.toHaveBeenCalled();
    writer.release();
    await registry.wait(writer.runId);
    await tick();
    expect(reader.execute).toHaveBeenCalledOnce();
    reader.release();
  });

  it('can abandon a waiting upgrade and resume as a reader without waiting for other readers', async () => {
    const registry = new RunRegistry();
    const first = hold(registry);
    const second = hold(registry);
    await tick();
    const upgraded = registry.upgradeToWrite(first.runId, first.controller.signal);
    expect(await registry.changeMode(first.runId, 'plan')).toEqual({ ok: true });
    await upgraded;
    expect(first.execute).toHaveBeenCalledOnce();
    expect(registry.currentRuns.every((run) => run.state === 'running')).toBe(true);
    first.release(); second.release();
  });

  it('serializes rapid selections while a previous mode is being validated', async () => {
    const registry = new RunRegistry();
    const turn = hold(registry);
    let release!: () => void;
    turn.changeMode.mockImplementationOnce(() => new Promise<{ ok: true }>((resolve) => {
      release = () => resolve({ ok: true });
    }));
    const first = registry.changeMode(turn.runId, 'plan');
    const second = registry.changeMode(turn.runId, 'agent');
    await tick();
    expect(turn.changeMode).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second]);
    expect(turn.changeMode).toHaveBeenCalledTimes(2);
    expect(registry.currentRuns.find((run) => run.runId === turn.runId)?.mode).toBe('agent');
    turn.release();
  });
});
