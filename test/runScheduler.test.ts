import { describe, expect, it, vi } from 'vitest';
import { PermissionBroker } from '@/server/runs/permissionBroker';
import { MAX_QUEUED_RUNS, RunRegistry, type RunAccess } from '@/server/runs/runRegistry';
import type { AgentEvent, AgentExecution } from '@/shared/types';

interface TurnOptions {
  sessionId?: string;
  participantId?: string;
  providerKey?: string;
  checkoutId?: string;
  checkoutPath?: string;
  access?: RunAccess;
  execution?: AgentExecution;
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
    checkoutPath: options.checkoutPath,
    access: options.access || 'read',
    execution: options.execution,
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
  it('creates alongside verified Local turns and read-only Git leases while new affected turns wait', async () => {
    const registry = new RunRegistry(3);
    const source = turn(registry, { checkoutPath: '/repos/a', access: 'write', execution: 'local' });
    const sibling = turn(registry, { checkoutPath: '/worktrees/a', access: 'write', execution: 'local' });
    await scheduled();
    const read = registry.acquireCheckoutRead('/repos/a', undefined, true)!;
    const admission = registry.acquireWorktreeCreation();
    if (!admission.acquired) throw new Error('Creation was refused');
    try {
      expect(admission.lease.acquireScopes(['/repos/a', '/worktrees/a', '/worktrees/new'], {
        root: '/worktrees', registered: ['/worktrees/a'], independent: ['/repos/a'],
        concurrentTurnRoots: ['/repos/a', '/worktrees/a'],
      })).toEqual({ acquired: true });
      expect(registry.acquireCheckoutWrite('/repos/a')).toBeUndefined();
      expect(registry.acquireCheckoutWrite('/worktrees/a')).toBeUndefined();
      expect(registry.acquireCheckoutRead('/repos/a/.git', undefined, true)).toBeUndefined();
      const nextRead = registry.acquireCheckoutRead('/worktrees/a', undefined, true)!;
      expect(nextRead).toBeTypeOf('function'); nextRead();
      expect(registry.acquireCheckoutRead('/worktrees/new', undefined, true)).toBeUndefined();
      const next = turn(registry, { checkoutPath: '/repos/a', access: 'write' });
      registry.finish(source.runId); read(); await scheduled();
      expect(next.execute).not.toHaveBeenCalled();
      admission.lease.release(); await scheduled();
      expect(next.execute).toHaveBeenCalledOnce(); registry.finish(next.runId);
    } finally { read(); admission.lease.release(); registry.finish(source.runId); registry.finish(sibling.runId); }
  });

  it.each(['/repos', '/repos/a/nested', '/worktrees/a/nested', '/worktrees/unverified'])('still excludes a turn at %s around concurrent roots', (checkoutPath) => {
    const registry = new RunRegistry();
    const run = turn(registry, { checkoutPath, access: 'write' });
    const admission = registry.acquireWorktreeCreation();
    if (!admission.acquired) throw new Error('Creation was refused');
    try {
      expect(admission.lease.acquireScopes(['/repos/a', '/worktrees/a', '/worktrees/unverified'], {
        root: '/worktrees', registered: ['/worktrees/a', '/worktrees/unverified'], independent: ['/repos/a'],
        concurrentTurnRoots: ['/repos/a', '/worktrees/a'],
      })).toMatchObject({ acquired: false, conflict: { kind: 'turn' } });
    } finally { admission.lease.release(); registry.finish(run.runId); }
  });

  it('allows read-only common Git mounts while still excluding Docker writers, Undo and unclassified reads', () => {
    const registry = new RunRegistry();
    const proof = { root: '/worktrees', registered: ['/worktrees/a'], independent: ['/repos/a'],
      concurrentTurnRoots: ['/repos/a', '/worktrees/a'] };
    const admission = registry.acquireWorktreeCreation();
    if (!admission.acquired) throw new Error('Creation was refused');
    try {
      const writer = turn(registry, { checkoutPath: '/worktrees/a', access: 'write', execution: 'docker' });
      expect(admission.lease.acquireScopes(['/repos/a', '/worktrees/a'], proof)).toMatchObject({ acquired: false, conflict: { kind: 'turn' } });
      registry.finish(writer.runId);
      const undo = registry.acquireCheckoutWrite('/worktrees/a')!;
      expect(admission.lease.acquireScopes(['/repos/a', '/worktrees/a'], proof)).toMatchObject({ acquired: false, conflict: { kind: 'recovery' } });
      undo();
      const unknownRead = registry.acquireCheckoutRead('/repos/a/.git')!;
      expect(admission.lease.acquireScopes(['/repos/a', '/worktrees/a'], proof)).toMatchObject({ acquired: false, conflict: { kind: 'git-read' } });
      unknownRead();
      const readOnly = registry.acquireCheckoutRead('/repos/a/.git', undefined, true)!;
      expect(admission.lease.acquireScopes(['/repos/a', '/worktrees/a'], proof)).toEqual({ acquired: true });
      const nextReadOnly = registry.acquireCheckoutRead('/repos/a/.git', undefined, true)!;
      expect(nextReadOnly).toBeTypeOf('function'); nextReadOnly();
      expect(registry.acquireMaintenance()).toBe('live-runs');
      admission.lease.release();
      expect(registry.acquireCheckoutWrite('/repos/a')).toBeUndefined();
      expect(registry.acquireMaintenance()).toBe('live-runs');
      readOnly();
      expect(registry.acquireMaintenance()).toBe('acquired'); registry.releaseMaintenance();
    } finally { admission.lease.release(); }
  });

  it('admits only proved ordinary checkout roots and metadata while unknown Local checkouts wait', async () => {
    const registry = new RunRegistry(3);
    const admission = registry.acquireWorktreeCreation();
    if (!admission.acquired) throw new Error('Creation was refused');
    const proof = { root: '/worktrees', registered: [], independent: ['/repos/a', '/repos/b'] };
    const unknown = registry.acquireCheckoutWrite('/repos/new-linked')!;
    expect(admission.lease.acquireScopes(['/repos/a'], proof)).toMatchObject({ acquired: false, conflict: { kind: 'recovery' } });
    unknown();
    const read = registry.acquireCheckoutRead('/repos/new-linked')!;
    expect(admission.lease.acquireScopes(['/repos/a'], proof)).toMatchObject({ acquired: false, conflict: { kind: 'git-read' } });
    read();
    expect(admission.lease.acquireScopes(['/repos/a'], proof)).toEqual({ acquired: true });
    const independentRead = registry.acquireCheckoutRead('/repos/b/.git/objects')!;
    expect(independentRead).toBeTypeOf('function'); independentRead();
    expect(registry.acquireCheckoutWrite('/repos/b/nested-linked')).toBeUndefined();
    expect(registry.acquireCheckoutRead('/repos/new-linked')).toBeUndefined();
    const waiting = turn(registry, { checkoutPath: '/repos/new-linked', access: 'write' });
    const nested = turn(registry, { checkoutPath: '/repos/b/nested-linked', access: 'write' });
    const unrelated = turn(registry, { checkoutPath: '/repos/b', access: 'write' });
    await scheduled();
    expect(unrelated.execute).toHaveBeenCalledOnce();
    expect(waiting.execute).not.toHaveBeenCalled(); expect(nested.execute).not.toHaveBeenCalled();
    registry.finish(unrelated.runId); admission.lease.release(); await scheduled();
    expect(waiting.execute).toHaveBeenCalledOnce(); expect(nested.execute).toHaveBeenCalledOnce();
  });
  it('refuses existing unknown managed locks but permits descendants of unrelated registered worktrees', () => {
    const registry = new RunRegistry();
    const admission = registry.acquireWorktreeCreation();
    if (!admission.acquired) throw new Error('Creation was refused');
    const proof = { root: '/worktrees', registered: ['/worktrees/b'] };
    const undo = registry.acquireCheckoutWrite('/worktrees/unknown')!;
    expect(admission.lease.acquireScopes(['/repos/a'], proof)).toMatchObject({ acquired: false, conflict: { kind: 'recovery' } });
    undo();
    const reader = registry.acquireCheckoutRead('/worktrees/unknown/.git')!;
    expect(admission.lease.acquireScopes(['/repos/a'], proof)).toMatchObject({ acquired: false, conflict: { kind: 'git-read' } });
    reader();
    const unrelated = registry.acquireCheckoutRead('/worktrees/b/.git')!;
    expect(admission.lease.acquireScopes(['/repos/a'], proof)).toEqual({ acquired: true });
    const nextReader = registry.acquireCheckoutRead('/worktrees/b/src')!;
    expect(nextReader).toBeTypeOf('function'); nextReader(); unrelated();
    expect(registry.acquireCheckoutWrite('/worktrees/unknown')).toBeUndefined();
    expect(registry.acquireCheckoutRead('/worktrees/unknown')).toBeUndefined();
    admission.lease.release();
  });
  it('admits worktree creation alongside unrelated runs while preserving source and restart exclusion', async () => {
    const registry = new RunRegistry(2);
    const unrelated = turn(registry, { checkoutPath: '/repos/b', access: 'write' });
    const admission = registry.acquireWorktreeCreation();
    expect(admission.acquired).toBe(true);
    if (!admission.acquired) throw new Error('Creation was refused');
    const lease = admission.lease;
    expect(registry.acquireMaintenance()).toBe('live-runs');
    expect(registry.acquireWorktreeCreation()).toMatchObject({ acquired: false, conflict: { kind: 'creation' } });
    expect(lease.acquireScopes(['/repos/a', '/worktrees/a'])).toEqual({ acquired: true });
    expect(registry.acquireCheckoutRead('/repos/a/.git')).toBeUndefined();
    expect(registry.acquireCheckoutWrite('/worktrees/a')).toBeUndefined();
    const ownRead = registry.acquireCheckoutRead('/repos/a/.git', lease.token);
    expect(ownRead).toBeTypeOf('function'); ownRead!();
    const waiting = turn(registry, { checkoutPath: '/repos/a', access: 'write' });
    registry.finish(unrelated.runId);
    const next = turn(registry, { checkoutPath: '/repos/b', access: 'read' });
    await scheduled();
    expect(waiting.execute).not.toHaveBeenCalled();
    expect(next.execute).toHaveBeenCalledOnce();
    lease.release();
    await scheduled();
    expect(waiting.execute).toHaveBeenCalledOnce();
  });

  it('checks live and reserved source scopes at grant and reports bounded public blockers', async () => {
    const registry = new RunRegistry();
    const admission = registry.acquireWorktreeCreation();
    if (!admission.acquired) throw new Error('Creation was refused');
    const runId = crypto.randomUUID(), sessionId = crypto.randomUUID();
    registry.reserve({ runId, sessionId, checkoutId: 'a', checkoutPath: '/worktrees/new-sibling', access: 'write', participantId: 'agent', providerKey: 'private-key', cancel() {} });
    expect(admission.lease.acquireScopes(['/repos/a', '/worktrees/new-sibling'])).toEqual({ acquired: false,
      conflict: { kind: 'turn', blockingTurns: [{ sessionId, state: 'preparing' }] } });
    registry.release(runId);
    const reader = registry.acquireCheckoutRead('/repos/a/.git')!;
    expect(admission.lease.acquireScopes(['/repos/a'])).toMatchObject({ acquired: false, conflict: { kind: 'git-read' } });
    reader();
    const recovery = registry.acquireCheckoutWrite('/repos/a')!;
    expect(admission.lease.acquireScopes(['/repos/a'])).toMatchObject({ acquired: false, conflict: { kind: 'recovery' } });
    recovery();
    expect(admission.lease.acquireScopes(['/repos/a'])).toEqual({ acquired: true });
    admission.lease.release();
    expect(registry.acquireMaintenance()).toBe('acquired');
    expect(registry.acquireWorktreeCreation()).toMatchObject({ acquired: false, conflict: { kind: 'maintenance' } });
  });

  it('serializes session archiving with turn admission and machine maintenance', () => {
    const registry = new RunRegistry();
    const release = registry.acquireSessionArchive('session-a');
    expect(release).toBeTypeOf('function');
    expect(registry.acquireSessionArchive('session-a')).toBeUndefined();
    expect(registry.acquireMaintenance()).toBe('live-runs');
    const input = { runId: crypto.randomUUID(), sessionId: 'session-a', participantId: 'agent', providerKey: 'provider', checkoutId: 'checkout', access: 'read' as const, cancel: vi.fn() };
    expect(registry.reserve(input)).toEqual({ accepted: false, reason: 'session-archiving' });
    release!();
    expect(registry.reserve(input)).toMatchObject({ accepted: true });
    expect(registry.acquireSessionArchive('session-a')).toBeUndefined();
    registry.release(input.runId);
    expect(registry.acquireMaintenance()).toBe('acquired');
    expect(registry.acquireSessionArchive('session-a')).toBeUndefined();
    registry.releaseMaintenance();
    registry.acquireSessionArchive('session-a')!();
  });

  it('excludes overlapping checkout paths even when their registry identities differ', async () => {
    const registry = new RunRegistry(3);
    const parent = turn(registry, { checkoutPath: '/repos/project', access: 'write' });
    const child = turn(registry, { checkoutPath: '/repos/project/package', access: 'read' });
    const sibling = turn(registry, { checkoutPath: '/repos/project-other', access: 'write' });
    await scheduled();
    expect(parent.execute).toHaveBeenCalledOnce();
    expect(child.execute).not.toHaveBeenCalled();
    expect(sibling.execute).toHaveBeenCalledOnce();
    registry.finish(parent.runId);
    await scheduled();
    expect(child.execute).toHaveBeenCalledOnce();
    const enclosing = turn(registry, { checkoutPath: '/repos', access: 'write' });
    await scheduled();
    expect(enclosing.execute).not.toHaveBeenCalled();
  });

  it('guards helper bind sources from enclosing writers without blocking live root diffs', async () => {
    const registry = new RunRegistry(2);
    const release = registry.acquireCheckoutRead('/repos/project/package');
    expect(release).toBeTypeOf('function');
    const writer = turn(registry, { checkoutPath: '/repos/project', access: 'write' });
    await scheduled();
    expect(writer.execute).not.toHaveBeenCalled();
    release!();
    await scheduled();
    expect(writer.execute).toHaveBeenCalledOnce();
    expect(registry.acquireCheckoutRead('/repos/project/package')).toBeUndefined();
    const releaseRoot = registry.acquireCheckoutRead('/repos/project');
    expect(releaseRoot).toBeTypeOf('function');
    releaseRoot!();
  });

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

  it('grants the maintenance lease only with no live run and refuses every reservation while it is held', async () => {
    const registry = new RunRegistry(2);
    const reservation = {
      sessionId: 'session-a', participantId: 'agent-a', providerKey: 'provider-a', checkoutId: 'checkout-a',
      access: 'read' as const, cancel: vi.fn(),
    };
    // A reservation whose canonical append has not finished is already live.
    const reserved = crypto.randomUUID();
    expect(registry.reserve({ ...reservation, runId: reserved })).toMatchObject({ accepted: true });
    expect(registry.acquireMaintenance()).toBe('live-runs');
    registry.release(reserved);

    const running = turn(registry);
    await scheduled();
    expect(registry.acquireMaintenance()).toBe('live-runs');
    registry.finish(running.runId);
    // A finished run stays replayable but no longer blocks.
    expect(registry.list().recent).toHaveLength(1);

    expect(registry.acquireMaintenance()).toBe('acquired');
    expect(registry.acquireMaintenance()).toBe('held');
    expect(registry.reserve({ ...reservation, runId: crypto.randomUUID() })).toEqual({ accepted: false, reason: 'maintenance' });
    expect(registry.list().active).toEqual([]);

    registry.releaseMaintenance();
    expect(registry.reserve({ ...reservation, runId: crypto.randomUUID() })).toMatchObject({ accepted: true });
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
