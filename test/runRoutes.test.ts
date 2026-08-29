import { describe, expect, it } from 'vitest';
import { GET as GET_RUNS } from '@/app/api/agent/runs/route';
import { GET as GET_STREAM } from '@/app/api/agent/stream/route';
import { POST as POST_CANCEL } from '@/app/api/agent/cancel/route';
import { POST as POST_PERMISSION } from '@/app/api/agent/permission/route';
import { PermissionBroker } from '@/server/runs/permissionBroker';
import { runRegistry } from '@/server/runs/runRegistry';
import type { AgentEvent, RunDiscovery } from '@/shared/types';

function events(body: string): AgentEvent[] {
  return body.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as AgentEvent);
}

describe('run discovery and stream routes', () => {
  it('lists host-wide ownership, filters by session, and replays retained runs by run id', async () => {
    const runId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const otherSessionId = crypto.randomUUID();
    expect(runRegistry.start({
      runId, sessionId, participantId: 'agent-a', cancel: () => undefined,
    })).toBe(true);
    try {
      const hostWide = await GET_RUNS(new Request('http://localhost/api/agent/runs'));
      expect(hostWide.headers.get('cache-control')).toBe('no-store');
      expect((await hostWide.json() as RunDiscovery).active).toContainEqual(expect.objectContaining({
        runId, sessionId, participantId: 'agent-a', startedAt: expect.any(Number),
      }));

      const filtered = await GET_RUNS(new Request(`http://localhost/api/agent/runs?sessionId=${otherSessionId}`));
      expect(await filtered.json()).toEqual({ active: [], recent: [] });
      expect((await GET_RUNS(new Request('http://localhost/api/agent/runs?sessionId=bad'))).status).toBe(400);

      runRegistry.record(runId, { type: 'status', runId, phase: 'thinking', label: 'Thinking…' });
      runRegistry.record(runId, { type: 'done', runId, durationMs: 10, cancelled: false });
      runRegistry.finish(runId);

      const completed = await GET_RUNS(new Request(`http://localhost/api/agent/runs?sessionId=${sessionId}`));
      const completedBody = await completed.json() as RunDiscovery;
      expect(completedBody.active).toEqual([]);
      expect(completedBody.recent).toContainEqual(expect.objectContaining({
        runId, sessionId, participantId: 'agent-a', finishedAt: expect.any(Number),
      }));

      const replay = await GET_STREAM(new Request(`http://localhost/api/agent/stream?runId=${runId}`));
      expect(replay.status).toBe(200);
      expect(replay.headers.get('X-CodeAI-Run-Finished')).toBe('true');
      expect(events(await replay.text())).toEqual([
        { type: 'status', runId, phase: 'thinking', label: 'Thinking…' },
        { type: 'done', runId, durationMs: 10, cancelled: false },
      ]);
    } finally {
      runRegistry.finish(runId);
    }
  });

  it('attaches a live stream only by run id and follows it through completion', async () => {
    const runId = crypto.randomUUID();
    expect(runRegistry.start({
      runId, sessionId: crypto.randomUUID(), participantId: 'agent-live', cancel: () => undefined,
    })).toBe(true);
    try {
      expect((await GET_STREAM(new Request('http://localhost/api/agent/stream?sessionId=ignored'))).status).toBe(400);
      const response = await GET_STREAM(new Request(`http://localhost/api/agent/stream?runId=${runId}`));
      expect(response.headers.get('X-CodeAI-Run-Finished')).toBe('false');
      runRegistry.record(runId, { type: 'status', runId, phase: 'responding', label: 'Responding…' });
      runRegistry.record(runId, { type: 'done', runId, durationMs: 12, cancelled: false });
      runRegistry.finish(runId);
      expect(events(await response.text())).toEqual([
        { type: 'status', runId, phase: 'responding', label: 'Responding…' },
        { type: 'done', runId, durationMs: 12, cancelled: false },
      ]);
    } finally {
      runRegistry.finish(runId);
    }
  });

  it('shares run-id permission and cancellation operations across route modules', async () => {
    const runId = crypto.randomUUID();
    const requestId = crypto.randomUUID();
    let cancelled = false;
    let resolution: string | undefined;
    expect(runRegistry.start({
      runId,
      sessionId: crypto.randomUUID(),
      participantId: 'agent-routed',
      cancel: () => { cancelled = true; },
    })).toBe(true);
    try {
      const broker = new PermissionBroker(5_000);
      runRegistry.attachPermissions(runId, broker);
      broker.request(requestId, (value) => { resolution = value; });

      const permission = await POST_PERMISSION(new Request('http://localhost/api/agent/permission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId, requestId, decision: 'allow' }),
      }));
      expect(permission.status).toBe(200);
      expect(resolution).toBe('allow');

      const cancel = await POST_CANCEL(new Request('http://localhost/api/agent/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId }),
      }));
      expect(cancel.status).toBe(200);
      expect(cancelled).toBe(true);
    } finally {
      runRegistry.finish(runId);
    }
  });
});
