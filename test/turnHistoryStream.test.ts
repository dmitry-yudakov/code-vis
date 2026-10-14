import { describe, expect, it, vi } from 'vitest';
import { agentEventStream } from '@/app/api/agent/eventStream';
import { RunRegistry } from '@/server/runs/runRegistry';
import { PermissionBroker } from '@/server/runs/permissionBroker';
import { createTurn, updateActivity } from '@/shared/turnActivity';

describe('bounded chronological replay', () => {
  it('detaches a stalled stream, retains only the latest history, and preserves permission and checkout ownership', async () => {
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
      await expect(response.body!.getReader().read()).rejects.toThrow('reader fell behind');
      expect(detach).toHaveBeenCalledOnce();
      expect(cancel).not.toHaveBeenCalled();
      expect(registry.list().active).toMatchObject([{ runId, pendingPermissions: [{ requestId }] }]);
      expect(registry.acquireCheckoutWrite('/checkout')).toBeUndefined();
      const replay = registry.subscribe(runId, () => undefined)!;
      expect(replay.replay.filter(event => event.type === 'turn-activity')).toMatchObject([{ turn: { sequence: 50 } }]);
      expect(replay.replay.find(event => event.type === 'permission-request')).toMatchObject({ review: { completeness: 'complete', text: 'pwd' } });
      expect(broker.pendingCount).toBe(1);
      expect(registry.decide(runId, requestId, 'allow')).toBe('accepted');
      expect(decision).toHaveBeenCalledWith('allow');
    } finally { broker.cancelAll(); registry.finish(runId); }
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
