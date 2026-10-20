import { describe, expect, it, vi } from 'vitest';
import { agentEventStream } from '@/app/api/agent/eventStream';
import { RunRegistry } from '@/server/runs/runRegistry';
import { PermissionBroker } from '@/server/runs/permissionBroker';
import { createTurn, updateActivity } from '@/shared/turnActivity';
import { readNdjson } from '@/features/conversation/ndjson';
import type { AgentEvent, AssistantMessage } from '@/shared/types';

async function collect(response: Response): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of readNdjson<AgentEvent>(response)) events.push(event);
  return events;
}

describe('bounded chronological replay', () => {
  it('coalesces paused-reader history and preserves permission and checkout ownership', async () => {
    const registry = new RunRegistry();
    const runId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const cancel = vi.fn();
    registry.start({ runId, sessionId, participantId: 'agent', access: 'write', cancel });
    const broker = new PermissionBroker(0);
    const decision = vi.fn();
    const requestId = crypto.randomUUID();
    broker.request(requestId, decision);
    registry.attachPermissions(runId, broker);
    let attachmentId = '';
    const detach = vi.fn(() => registry.unsubscribe(runId, attachmentId));
    const response = agentEventStream({ runId, onDetach: detach, start(write) {
      attachmentId = registry.subscribe(runId, write)!.attachmentId;
      return registry.wait(runId)!;
    } });
    try {
      registry.record(runId, { type: 'permission-request', runId, requestId, participantId: 'agent', tool: 'Run', detail: 'pwd', review: { completeness: 'complete', text: 'pwd' } });
      let turn = updateActivity(createTurn(runId, 'message', 'agent', new Date().toISOString()), 1,
        { kind: 'assistant', key: 'block', text: 'x'.repeat(256 * 1024) });
      for (let sequence = 1; sequence <= 50; sequence++) {
        turn = { ...turn, sequence, entries: turn.entries.map(entry => ({ ...entry, sequence })) };
        registry.record(runId, { type: 'turn-activity', runId, turn });
      }
      expect(detach).not.toHaveBeenCalled();
      expect(cancel).not.toHaveBeenCalled();
      expect(registry.list().active).toMatchObject([{ runId, pendingPermissions: [{ requestId }] }]);
      expect(registry.acquireCheckoutWrite('/checkout')).toBeUndefined();
      const replay = registry.subscribe(runId, () => undefined)!;
      expect(replay.replay.filter(event => event.type === 'turn-activity')).toMatchObject([{ turn: { sequence: 50 } }]);
      expect(replay.replay.find(event => event.type === 'permission-request')).toMatchObject({ review: { completeness: 'complete', text: 'pwd' } });
      expect(broker.pendingCount).toBe(1);
      expect(registry.decide(runId, requestId, 'allow')).toBe('accepted');
      expect(decision).toHaveBeenCalledWith('allow');
      registry.finish(runId);
      const events = await collect(response);
      expect(events.map(event => event.type)).toEqual(['permission-request', 'turn-activity']);
      expect(events.at(-1)).toMatchObject({ turn: { sequence: 50 } });
      expect(detach).toHaveBeenCalledOnce();
    } finally { broker.cancelAll(); registry.finish(runId); }
  });

  it('delivers large activity bursts through the real decoder with required events and the final answer intact', async () => {
    const registry = new RunRegistry();
    const runId = crypto.randomUUID();
    registry.start({ runId, sessionId: crypto.randomUUID(), participantId: 'agent', cancel() {} });
    let attachmentId = '';
    const detach = vi.fn(() => registry.unsubscribe(runId, attachmentId));
    const response = agentEventStream({ runId, onDetach: detach, start(write) {
      attachmentId = registry.subscribe(runId, write)!.attachmentId;
      return registry.wait(runId)!;
    } });
    let turn = createTurn(runId, 'message', 'agent', new Date().toISOString());
    for (let block = 0; block < 3; block++) {
      turn = updateActivity(turn, 1, { kind: 'assistant', key: `block-${block}`, text: 'x'.repeat(240 * 1024) });
    }
    const reading = collect(response);
    // Handle the expected pre-fix rejection while the synchronous producer is still emitting.
    void reading.catch(() => undefined);
    const final: AssistantMessage = { id: crypto.randomUUID(), role: 'assistant', authorId: 'agent',
      createdAt: new Date().toISOString(), status: 'complete', rawMarkdown: 'Done', blocks: [{ kind: 'markdown', markdown: 'Done' }] };
    try {
      for (let sequence = 1; sequence <= 40; sequence++) {
        registry.record(runId, { type: 'turn-activity', runId, turn: { ...turn, sequence } });
        registry.record(runId, { type: 'assistant-delta', runId, delta: String(sequence) });
        if (sequence === 20) registry.record(runId, { type: 'permission-request', runId, requestId: 'approval',
          participantId: 'agent', tool: 'Run', detail: 'pwd', review: { completeness: 'complete', text: 'pwd' } });
        if (sequence === 30) registry.record(runId, { type: 'permission-resolved', runId, requestId: 'approval', decision: 'allow' });
      }
      registry.record(runId, { type: 'assistant-message', runId, message: final });
      registry.record(runId, { type: 'done', runId, durationMs: 1, cancelled: false });
      registry.finish(runId);
      const events = await reading;
      const histories = events.filter(event => event.type === 'turn-activity');
      expect(histories.length).toBeLessThanOrEqual(2); // One in flight, one latest pending snapshot.
      expect(histories.at(-1)).toMatchObject({ turn: { sequence: 40 } });
      expect(events.filter(event => event.type === 'assistant-delta').map(event => event.delta)).toEqual(
        Array.from({ length: 40 }, (_, index) => String(index + 1)),
      );
      expect(events.filter(event => event.type.startsWith('permission-'))).toMatchObject([
        { type: 'permission-request', review: { completeness: 'complete', text: 'pwd' } },
        { type: 'permission-resolved', decision: 'allow' },
      ]);
      const latestActivityIndex = events.findLastIndex(event => event.type === 'turn-activity');
      expect(latestActivityIndex).toBeGreaterThan(events.findIndex(event => event.type === 'permission-resolved'));
      expect(latestActivityIndex).toBeLessThan(events.findIndex(event => event.type === 'assistant-message'));
      expect(events.slice(-2)).toEqual([
        { type: 'assistant-message', runId, message: final },
        { type: 'done', runId, durationMs: 1, cancelled: false },
      ]);
      expect(detach).toHaveBeenCalledOnce();
    } finally { registry.finish(runId); }
  });

  it('bounds required-event backlog, detaches without cancelling, and recovers current activity and approvals', async () => {
    const registry = new RunRegistry();
    const runId = crypto.randomUUID();
    const cancel = vi.fn();
    registry.start({ runId, sessionId: crypto.randomUUID(), participantId: 'agent', access: 'write', cancel });
    const broker = new PermissionBroker(0);
    broker.request('approval', () => undefined);
    registry.attachPermissions(runId, broker);
    let attachmentId = '';
    const detach = vi.fn(() => registry.unsubscribe(runId, attachmentId));
    const response = agentEventStream({ runId, onDetach: detach, start(write) {
      attachmentId = registry.subscribe(runId, write)!.attachmentId;
      return registry.wait(runId)!;
    } });
    try {
      registry.record(runId, { type: 'permission-request', runId, requestId: 'approval', participantId: 'agent',
        tool: 'Run', detail: 'pwd', review: { completeness: 'complete', text: 'pwd' } });
      for (let index = 0; index < 140; index++) {
        registry.record(runId, { type: 'assistant-delta', runId, delta: 'x'.repeat(64 * 1024) });
      }
      registry.record(runId, { type: 'turn-activity', runId, turn: {
        ...createTurn(runId, 'message', 'agent', new Date().toISOString()), sequence: 200,
      } });
      await expect(collect(response)).rejects.toThrow('reader fell behind');
      expect(detach).toHaveBeenCalledOnce();
      expect(cancel).not.toHaveBeenCalled();
      expect(broker.pendingCount).toBe(1);
      expect(registry.acquireCheckoutWrite('/checkout')).toBeUndefined();
      const replay = registry.subscribe(runId, () => undefined)!;
      const recovered = agentEventStream({ runId, replay: replay.replay,
        onDetach: () => registry.unsubscribe(runId, replay.attachmentId), start: async () => undefined });
      const events = await collect(recovered);
      expect(events.find(event => event.type === 'turn-activity')).toMatchObject({ turn: { sequence: 200 } });
      expect(events.find(event => event.type === 'permission-request')).toMatchObject({
        review: { completeness: 'complete', text: 'pwd' },
      });
      expect(registry.decide(runId, 'approval', 'allow')).toBe('accepted');
    } finally { broker.cancelAll(); registry.finish(runId); }
  });

  it('detaches a cancelled reader and ignores later writes without affecting execution', async () => {
    let write!: (event: AgentEvent) => void;
    let finish!: () => void;
    const completion = new Promise<void>(resolve => { finish = resolve; });
    const detach = vi.fn();
    const response = agentEventStream({ runId: 'run', onDetach: detach, start(writer) { write = writer; return completion; } });
    write({ type: 'status', runId: 'run', phase: 'thinking', label: 'Thinking' });
    write({ type: 'turn-activity', runId: 'run', turn: createTurn('run', 'message', 'agent', new Date().toISOString()) });
    await response.body!.cancel();
    write({ type: 'status', runId: 'run', phase: 'thinking', label: 'Still working' });
    finish();
    await completion;
    expect(detach).toHaveBeenCalledOnce();
  });

  it.each(['throw', 'reject'])('reports producer failure and detaches when start %ss', async failure => {
    const detach = vi.fn();
    const create = () => agentEventStream({ runId: 'run', onDetach: detach, start() {
      if (failure === 'throw') throw new Error('Producer failed');
      return Promise.reject(new Error('Producer failed'));
    } });
    await expect(collect(create())).rejects.toThrow('Producer failed');
    expect(detach).toHaveBeenCalledOnce();
  });

  it('drops full approval reviews when the run finishes and rejects stale decisions', () => {
    const registry = new RunRegistry();
    const runId = crypto.randomUUID();
    registry.start({ runId, sessionId: crypto.randomUUID(), participantId: 'agent', cancel() {} });
    const requestId = crypto.randomUUID();
    registry.record(runId, { type: 'permission-request', runId, requestId, participantId: 'agent', tool: 'Run', detail: 'summary', review: { completeness: 'complete', text: 'full review payload' } });
    registry.finish(runId);
    const replay = registry.subscribe(runId, () => undefined)!;
    expect(replay.finished).toBe(true);
    expect(JSON.stringify(replay.replay)).not.toContain('full review payload');
    expect(registry.decide(runId, requestId, 'allow')).toBe('unknown-run');
  });
});
