import { describe, expect, it } from 'vitest';
import { parseObserverAnswer, observerRequestSchema } from '@/shared/observer';
import { observerContext } from '@/features/observer/observerModel';
import type { ArenaMachineSnapshot } from '@/shared/types';

const machineId = '10000000-0000-4000-8000-000000000001';
const sessionId = '20000000-0000-4000-8000-000000000001';
function machine(count = 1): ArenaMachineSnapshot {
  return { machine: { id: machineId, label: 'Home', kind: 'local', state: 'online' }, projects: [], checkouts: [],
    recentCheckoutIds: [], providers: {} as ArenaMachineSnapshot['providers'], runs: { active: [], recent: [] }, archivedSessions: [],
    sessions: Array.from({ length: count }, (_, i) => ({ id: i ? `20000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}` : sessionId,
      revision: 1, title: `Task ${i}`, agents: [], repositoryCheckoutIds: [], updatedAt: '2026-11-17T10:00:00Z' })) };
}

describe('Observer context and contract', () => {
  it('counts every session before paging, preserves offline uncertainty, and bounds UTF-8 context', () => {
    const home = machine(1000);
    home.sessions.forEach(s => { s.title = '界'.repeat(150); s.lastMessage = { role: 'user', author: 'You', text: '界'.repeat(600), truncated: true }; });
    const offline = { ...machine(), machine: { ...machine().machine, id: '30000000-0000-4000-8000-000000000001', kind: 'remote' as const, state: 'offline' as const } };
    const first = observerContext([home, offline], 0);
    expect(first.total).toBe(1001);
    expect(first.counts).toMatchObject({ idle: 1000, offline: 1 });
    expect(first.rows.length).toBeGreaterThan(0);
    expect(first.nextOffset).toBe(first.rows.length);
    expect(new TextEncoder().encode(JSON.stringify(first)).length).toBeLessThan(48 * 1024);
    const second = observerContext([home, offline], first.nextOffset!);
    expect(second.rows[0].sessionId).not.toBe(first.rows[0].sessionId);
    expect(second.total).toBe(1001);
  });

  it('rejects arbitrary actions, unknown targets, malformed output and overlong proposals', () => {
    const context = observerContext([machine()], 0);
    expect(parseObserverAnswer(JSON.stringify({ answer: 'Hello', command: 'rm -rf /' }), context)).toBeUndefined();
    expect(parseObserverAnswer(JSON.stringify({ answer: 'Hello', proposal: { machineId, sessionId: machineId, text: 'Continue' } }), context)).toBeUndefined();
    expect(parseObserverAnswer('```json\n{}\n```', context)).toBeUndefined();
    expect(parseObserverAnswer(JSON.stringify({ answer: 'Hello', proposal: { machineId, sessionId, text: 'a'.repeat(8001) } }), context)).toBeUndefined();
    expect(parseObserverAnswer(JSON.stringify({ answer: 'Ready', proposal: { machineId, sessionId, text: 'Continue' } }), context)).toMatchObject({ answer: 'Ready', proposal: { sessionId } });
  });

  it('finds a named session outside the default page before applying context limits', () => {
    const home = machine(1000);
    home.sessions[999].title = 'Payment migration';
    const focused = observerContext([home], 0, 'Tell Payment migration to run its tests');
    expect(focused.rows[0].sessionId).toBe(home.sessions[999].id);
    expect(focused.matchedTotal).toBe(1);
  });

  it('keeps pages progressing when a session has many large pending permissions', () => {
    const home = machine(2);
    home.runs.active = [{ sessionId, state: 'needs-you', pendingPermissionCount: 32,
      pendingPermissions: Array.from({ length: 32 }, () => ({ tool: '界'.repeat(500), detail: '界'.repeat(600) })) } as never];
    const context = observerContext([home]);
    expect(context.rows[0]).toMatchObject({ sessionId, pendingCount: 32 });
    expect(context.rows[0].pending).toHaveLength(3);
    expect(context.rows).toHaveLength(2);
  });

  it('bounds client history and does not accept browser-owned observations or executable options', () => {
    expect(observerRequestSchema.safeParse({ text: 'Status?', provider: 'claude' }).success).toBe(true);
    expect(observerRequestSchema.safeParse({ text: 'Status?', provider: 'claude', machines: [] }).success).toBe(false);
    expect(observerRequestSchema.safeParse({ text: 'Status?', provider: 'claude', history: Array(7).fill({ role: 'user', text: 'Hi' }) }).success).toBe(false);
  });

  it('binds management actions to the observed run and permission and permits only one operation', () => {
    const home = machine();
    const runId = '40000000-0000-4000-8000-000000000001';
    const requestId = '50000000-0000-4000-8000-000000000001';
    home.runs.active = [{ runId, sessionId, state: 'needs-you', pendingPermissionCount: 1,
      pendingPermissions: [{ requestId, tool: 'Bash', detail: 'npm test' }] } as never];
    const context = observerContext([home]);
    const action = { kind: 'permission', machineId, sessionId, runId, requestId, decision: 'allow' };
    const parse = (value: unknown) => parseObserverAnswer(JSON.stringify(value), context);
    expect(parse({ answer: 'Review this approval.', action })).toMatchObject({ action });
    expect(parse({ answer: 'Wrong request', action: { ...action, requestId: runId } })).toBeUndefined();
    expect(parse({ answer: 'Wrong run', action: { ...action, runId: requestId } })).toBeUndefined();
    expect(parse({ answer: 'Two actions', action, proposal: { machineId, sessionId, text: 'Continue' } })).toBeUndefined();
    expect(parse({ answer: 'Read first', action, inspect: { machineId, sessionId } })).toBeUndefined();
    expect(parse({ answer: 'Review restart', action: { kind: 'build-and-restart' } })).toMatchObject({ action: { kind: 'build-and-restart' } });
    expect(parse({ answer: 'Already running', action: { kind: 'edit-queued', machineId, sessionId, runId, text: 'Correction' } })).toBeUndefined();
    home.runs.active[0].state = 'queued';
    expect(parseObserverAnswer(JSON.stringify({ answer: 'Correct it', action: { kind: 'edit-queued', machineId, sessionId, runId, text: 'Correction' } }), observerContext([home]))).toBeDefined();
  });
});
