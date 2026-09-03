import { describe, expect, it, vi } from 'vitest';
import { PermissionBroker } from '@/server/runs/permissionBroker';
import { MAX_QUEUED_RUNS, RunRegistry, type RunAccess } from '@/server/runs/runRegistry';
import type { AgentEvent } from '@/shared/types';

interface TurnOptions {
  sessionId?: string;
  participantId?: string;
  providerKey?: string;
  checkoutId?: string;
  access?: RunAccess;
}

function turn(registry: RunRegistry, options: TurnOptions = {}) {
  const runId = crypto.randomUUID();
  const execute = vi.fn(async () => new Promise<void>(() => undefined));
  const cancelQueued = vi.fn(async () => undefined);
  const reservation = registry.reserve({
    runId,
    sessionId: options.sessionId || crypto.randomUUID(),
    participantId: options.participantId || crypto.randomUUID(),
    providerKey: options.providerKey || `provider:${crypto.randomUUID()}`,
    checkoutId: options.checkoutId || `checkout:${crypto.randomUUID()}`,
    access: options.access || 'read',
    cancel: vi.fn(),
  });
  expect(reservation).toMatchObject({ accepted: true, runId });
  registry.activate(runId, { execute, cancelQueued });
  return { runId, execute, cancelQueued };
}

async function scheduled(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('machine run scheduler', () => {
  it('runs to capacity, exposes queue positions, and promotes FIFO when a slot opens', async () => {
    const registry = new RunRegistry(2);
    const first = turn(registry);
    const second = turn(registry);
    const third = turn(registry);
    await scheduled();

    expect(first.execute).toHaveBeenCalledOnce();
    expect(second.execute).toHaveBeenCalledOnce();
    expect(third.execute).not.toHaveBeenCalled();
    expect(registry.list().active).toEqual([
      expect.objectContaining({ runId: first.runId, state: 'running', startedAt: expect.any(Number) }),
      expect.objectContaining({ runId: second.runId, state: 'running', startedAt: expect.any(Number) }),
      expect.objectContaining({ runId: third.runId, state: 'queued', queuePosition: 1 }),
    ]);

    registry.finish(first.runId);
    await scheduled();
    expect(third.execute).toHaveBeenCalledOnce();
    expect(registry.list().active).toContainEqual(expect.objectContaining({
      runId: third.runId, state: 'running',
    }));
  });

  it('lets readers overlap, gives a waiting writer priority, and bypasses a blocked checkout', async () => {
    const registry = new RunRegistry(3);
    const firstReader = turn(registry, { checkoutId: 'shared', access: 'read' });
    const secondReader = turn(registry, { checkoutId: 'shared', access: 'read' });
    const independent = turn(registry, { checkoutId: 'other', access: 'write' });
    const writer = turn(registry, { checkoutId: 'shared', access: 'write' });
    const lateReader = turn(registry, { checkoutId: 'shared', access: 'read' });
    const laterIndependent = turn(registry, { checkoutId: 'third', access: 'read' });
    await scheduled();

    expect(firstReader.execute).toHaveBeenCalledOnce();
    expect(secondReader.execute).toHaveBeenCalledOnce();
    expect(independent.execute).toHaveBeenCalledOnce();
    expect(writer.execute).not.toHaveBeenCalled();
    expect(lateReader.execute).not.toHaveBeenCalled();

    registry.finish(independent.runId);
    await scheduled();
    expect(laterIndependent.execute).toHaveBeenCalledOnce();
    expect(writer.execute).not.toHaveBeenCalled();

    registry.finish(firstReader.runId);
    registry.finish(secondReader.runId);
    await scheduled();
    expect(writer.execute).toHaveBeenCalledOnce();
    expect(lateReader.execute).not.toHaveBeenCalled();

    registry.finish(writer.runId);
    await scheduled();
    expect(lateReader.execute).toHaveBeenCalledOnce();
  });

  it('reserves session and provider uniqueness atomically and releases failed appends', () => {
    const registry = new RunRegistry(2);
    const firstId = crypto.randomUUID();
    expect(registry.reserve({
      runId: firstId,
      sessionId: 'session-a',
      participantId: 'agent-a',
      providerKey: 'provider-session-a',
      checkoutId: 'checkout-a',
      access: 'read',
      cancel: vi.fn(),
    })).toMatchObject({ accepted: true });
    expect(registry.reserve({
      runId: crypto.randomUUID(),
      sessionId: 'session-a',
      participantId: 'agent-b',
      providerKey: 'provider-session-b',
      checkoutId: 'checkout-b',
      access: 'read',
      cancel: vi.fn(),
    })).toMatchObject({ accepted: false, reason: 'session-conflict' });
    expect(registry.reserve({
      runId: crypto.randomUUID(),
      sessionId: 'session-b',
      participantId: 'agent-c',
      providerKey: 'provider-session-a',
      checkoutId: 'checkout-b',
      access: 'read',
      cancel: vi.fn(),
    })).toMatchObject({ accepted: false, reason: 'provider-conflict' });
    expect(registry.list().active).toEqual([]);
    expect(registry.release(firstId)).toBe(true);
    expect(registry.reserve({
      runId: crypto.randomUUID(),
      sessionId: 'session-a',
      participantId: 'agent-a',
      providerKey: 'provider-session-a',
      checkoutId: 'checkout-a',
      access: 'read',
      cancel: vi.fn(),
    })).toMatchObject({ accepted: true });
  });

  it('bounds waiting reservations before their canonical messages are appended', () => {
    const registry = new RunRegistry(1);
    expect(registry.start({
      runId: crypto.randomUUID(),
      sessionId: 'running',
      participantId: 'agent-running',
      cancel: vi.fn(),
    })).toBe(true);
    const reserved: string[] = [];
    for (let index = 0; index < MAX_QUEUED_RUNS; index += 1) {
      const runId = crypto.randomUUID();
      reserved.push(runId);
      expect(registry.reserve({
        runId,
        sessionId: `session-${index}`,
        participantId: `agent-${index}`,
        providerKey: `provider-${index}`,
        checkoutId: `checkout-${index}`,
        access: 'read',
        cancel: vi.fn(),
      })).toMatchObject({ accepted: true });
    }
    expect(registry.reserve({
      runId: crypto.randomUUID(),
      sessionId: 'overflow',
      participantId: 'overflow',
      providerKey: 'overflow',
      checkoutId: 'overflow',
      access: 'read',
      cancel: vi.fn(),
    })).toEqual({ accepted: false, reason: 'queue-full' });
    for (const runId of reserved) expect(registry.release(runId)).toBe(true);
  });

  it('bounds lock-blocked work even when machine capacity is idle', async () => {
    const registry = new RunRegistry(2);
    turn(registry, { checkoutId: 'shared', access: 'write' });
    await scheduled();

    for (let index = 0; index < MAX_QUEUED_RUNS; index += 1) {
      turn(registry, {
        sessionId: `blocked-session-${index}`,
        providerKey: `blocked-provider-${index}`,
        checkoutId: 'shared',
        access: 'read',
      });
    }
    expect(registry.list().active.filter((run) => run.state === 'queued')).toHaveLength(MAX_QUEUED_RUNS);
    expect(registry.reserve({
      runId: crypto.randomUUID(),
      sessionId: 'blocked-overflow',
      participantId: 'blocked-overflow',
      providerKey: 'blocked-overflow',
      checkoutId: 'shared',
      access: 'read',
      cancel: vi.fn(),
    })).toEqual({ accepted: false, reason: 'queue-full' });
  });

  it('keeps a permission wait in its slot and reports needs-you only on its run', async () => {
    const registry = new RunRegistry(1);
    const first = turn(registry);
    const second = turn(registry);
    await scheduled();
    const broker = new PermissionBroker(5_000);
    registry.attachPermissions(first.runId, broker);
    broker.request('approval-a', vi.fn());
    registry.record(first.runId, {
      type: 'permission-request',
      runId: first.runId,
      requestId: 'approval-a',
      participantId: 'agent-a',
      tool: 'Edit',
      detail: 'src/a.ts',
    });
    expect(registry.list().active).toContainEqual(expect.objectContaining({
      runId: first.runId,
      state: 'needs-you',
      pendingPermissionCount: 1,
      pendingPermissions: [{
        requestId: 'approval-a',
        participantId: 'agent-a',
        tool: 'Edit',
        detail: 'src/a.ts',
      }],
      status: 'Waiting for approval — Edit: src/a.ts',
    }));
    expect(second.execute).not.toHaveBeenCalled();
    expect(registry.decide(first.runId, 'approval-a', 'allow')).toBe('accepted');
    registry.record(first.runId, {
      type: 'permission-resolved',
      runId: first.runId,
      requestId: 'approval-a',
      decision: 'allow',
    });
    expect(registry.list().active).toContainEqual(expect.objectContaining({
      runId: first.runId,
      state: 'running',
      pendingPermissionCount: 0,
      pendingPermissions: [],
      status: 'Continuing agent turn',
    }));
    expect(second.execute).not.toHaveBeenCalled();
  });

  it('reports isolated terminal outcomes and current status without exposing transcript text', async () => {
    const registry = new RunRegistry(2);
    const completed = turn(registry);
    const failed = turn(registry);
    await scheduled();
    registry.record(completed.runId, { type: 'status', runId: completed.runId, phase: 'thinking', label: 'Tracing callers' });
    registry.record(completed.runId, { type: 'assistant-delta', runId: completed.runId, delta: 'private answer text' });
    registry.record(completed.runId, { type: 'done', runId: completed.runId, durationMs: 10, cancelled: false });
    registry.finish(completed.runId);
    registry.record(failed.runId, {
      type: 'error',
      runId: failed.runId,
      code: 'process-failed',
      message: 'Provider exited',
      retryable: true,
      delivery: 'possibly-sent',
    });
    registry.record(failed.runId, { type: 'done', runId: failed.runId, durationMs: 11, cancelled: false });
    registry.finish(failed.runId);

    const recent = registry.list().recent;
    expect(recent).toContainEqual(expect.objectContaining({
      runId: completed.runId,
      status: 'Turn completed',
      outcome: 'completed',
      pendingPermissions: [],
    }));
    expect(recent).toContainEqual(expect.objectContaining({
      runId: failed.runId,
      status: 'Provider exited',
      outcome: 'failed',
      pendingPermissions: [],
    }));
    expect(JSON.stringify(recent)).not.toContain('private answer text');
  });

  it('cancels queued work without executing it and immediately repositions later work', async () => {
    const registry = new RunRegistry(1);
    const first = turn(registry);
    const cancelled = turn(registry);
    const third = turn(registry);
    await scheduled();
    expect(registry.list().active).toContainEqual(expect.objectContaining({
      runId: third.runId, queuePosition: 2,
    }));

    expect(await registry.cancel(cancelled.runId)).toBe('accepted');
    await scheduled();
    expect(cancelled.execute).not.toHaveBeenCalled();
    expect(cancelled.cancelQueued).toHaveBeenCalledOnce();
    expect(registry.list().active).toContainEqual(expect.objectContaining({
      runId: third.runId, queuePosition: 1,
    }));

    registry.finish(first.runId);
    await scheduled();
    expect(third.execute).toHaveBeenCalledOnce();
  });

  it('parks a failed queued cancellation without blocking later checkout readers', async () => {
    const registry = new RunRegistry(1);
    const first = turn(registry, { checkoutId: 'shared', access: 'read' });
    const earlierQueued = turn(registry, { checkoutId: 'independent', access: 'read' });
    const queued = turn(registry, { checkoutId: 'shared', access: 'write' });
    const laterReader = turn(registry, { checkoutId: 'shared', access: 'read' });
    queued.cancelQueued.mockRejectedValueOnce(new Error('disk unavailable'));
    await scheduled();
    const events: AgentEvent[] = [];
    registry.subscribe(queued.runId, (event) => events.push(event));

    expect(await registry.cancel(queued.runId)).toBe('failed');
    expect(registry.list().active).toContainEqual(expect.objectContaining({
      runId: queued.runId, state: 'queued', queuePosition: 2,
    }));
    expect(events.some((event) => event.type === 'error' || event.type === 'done')).toBe(false);
    expect(events).toContainEqual(expect.objectContaining({
      type: 'status',
      label: 'Queued · position 2 · cancellation must be retried',
    }));

    expect(await registry.cancel(earlierQueued.runId)).toBe('accepted');
    expect(events.at(-1)).toMatchObject({
      type: 'status',
      label: 'Queued · position 1 · cancellation must be retried',
    });

    registry.finish(first.runId);
    await scheduled();
    expect(queued.execute).not.toHaveBeenCalled();
    expect(laterReader.execute).toHaveBeenCalledOnce();
    expect(await registry.cancel(queued.runId)).toBe('accepted');
    expect(queued.cancelQueued).toHaveBeenCalledTimes(2);
    expect(registry.list().active).not.toContainEqual(expect.objectContaining({ runId: queued.runId }));
  });
});
