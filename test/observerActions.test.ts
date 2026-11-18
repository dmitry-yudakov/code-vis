import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeObserverAction, observerActionSpeech, observerActionVoiceAllowed, previewObserverAction } from '@/features/observer/observerActions';
import { observerCommand } from '@/features/observer/observerModel';
import type { ArenaMachineSnapshot, PublicSession, RunDescriptor } from '@/shared/types';

const machineId = '10000000-0000-4000-8000-000000000001';
const sessionId = '20000000-0000-4000-8000-000000000001';
const runId = '30000000-0000-4000-8000-000000000001';
const requestId = '40000000-0000-4000-8000-000000000001';
const permission = { kind: 'permission' as const, machineId, sessionId, runId, requestId, decision: 'allow' as const };
afterEach(() => vi.unstubAllGlobals());

function fixture(queued = false) {
  const machine = { machine: { id: machineId, kind: 'remote', state: 'online', label: 'Worker' }, projects: [],
    sessions: [{ id: sessionId, title: 'Login' }] } as unknown as ArenaMachineSnapshot;
  const run = { runId, sessionId, state: queued ? 'queued' : 'needs-you',
    pendingPermissions: [{ requestId, participantId: sessionId, tool: 'Bash', detail: 'npm test' }] } as RunDescriptor;
  const saved = { id: sessionId, title: 'Login', messages: [{ id: requestId, role: 'user', text: 'Original instruction',
    turn: { runId, lifecycle: 'queued' } }] } as PublicSession;
  const active = [run];
  const posts: Array<{ path: string; body: unknown }> = [];
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      posts.push({ path: url, body: JSON.parse(String(init.body)) });
      return Response.json({ ok: true });
    }
    return Response.json(url.includes('/agent/runs') ? { active, recent: [] } : { session: saved });
  });
  vi.stubGlobal('fetch', fetcher);
  return { machine, run, saved, active, posts, fetcher, local: crypto.randomUUID() };
}

describe('Observer management actions', () => {
  for (const decision of ['allow', 'deny'] as const) it(`previews full permission detail and sends ${decision} to the exact attached machine request`, async () => {
    const f = fixture();
    f.run.pendingPermissions[0].detail = 'npm test '.repeat(250);
    const preview = await previewObserverAction({ ...permission, decision }, [f.machine], f.local);
    expect(preview.permission?.detail).toBe(f.run.pendingPermissions[0].detail);
    expect(observerActionVoiceAllowed(preview)).toBe(false);
    expect(observerActionSpeech(preview)).toContain('too long to confirm by voice');
    await expect(executeObserverAction(preview, [f.machine], f.local)).resolves.toContain(decision === 'allow' ? 'approved' : 'denied');
    expect(f.posts).toEqual([{ path: `/api/machines/${machineId}/agent/permission`, body: { runId, requestId, decision } }]);
  });

  it('refuses a replaced permission or modified request detail without posting', async () => {
    const f = fixture();
    const preview = await previewObserverAction(permission, [f.machine], f.local);
    f.run.pendingPermissions[0].detail = 'npm publish';
    await expect(executeObserverAction(preview, [f.machine], f.local)).rejects.toThrow('changed');
    f.run.pendingPermissions[0].requestId = runId;
    await expect(executeObserverAction(preview, [f.machine], f.local)).rejects.toThrow('resolved');
    expect(f.posts).toHaveLength(0);
  });

  it('keeps the old run identity when another turn takes its place', async () => {
    const f = fixture();
    const preview = await previewObserverAction({ kind: 'cancel-turn', machineId, sessionId, runId }, [f.machine], f.local);
    f.run.runId = requestId;
    await expect(executeObserverAction(preview, [f.machine], f.local)).rejects.toThrow('no longer active');
    expect(f.posts).toHaveLength(0);
  });

  it('cancels a pinned run through its existing route', async () => {
    const f = fixture();
    const preview = await previewObserverAction({ kind: 'cancel-turn', machineId, sessionId, runId }, [f.machine], f.local);
    await expect(executeObserverAction(preview, [f.machine], f.local)).resolves.toContain('cancellation requested');
    expect(f.posts[0]).toMatchObject({ path: `/api/machines/${machineId}/agent/cancel`, body: { runId } });
  });

  it('corrects only the original queued message with compare-and-save text', async () => {
    const f = fixture(true);
    const preview = await previewObserverAction({ kind: 'edit-queued', machineId, sessionId, runId, text: 'Revised instruction' }, [f.machine], f.local);
    expect(preview.original).toEqual({ id: requestId, text: 'Original instruction' });
    await expect(executeObserverAction(preview, [f.machine], f.local)).resolves.toBe('Correction saved.');
    expect(f.posts[0]).toMatchObject({ path: `/api/machines/${machineId}/agent/queued-message`,
      body: { runId, text: 'Revised instruction', expectedText: 'Original instruction' } });
    f.saved.messages[0] = { ...f.saved.messages[0], text: 'Another device changed this' } as never;
    await expect(executeObserverAction(preview, [f.machine], f.local)).rejects.toThrow('changed');
    expect(f.posts).toHaveLength(1);
  });

  it('reconciles a saved correction after a lost response and never edits a started turn', async () => {
    const f = fixture(true);
    const preview = await previewObserverAction({ kind: 'edit-queued', machineId, sessionId, runId, text: 'Correction' }, [f.machine], f.local);
    f.run.state = 'running';
    await expect(executeObserverAction(preview, [f.machine], f.local)).rejects.toThrow('started');
    f.saved.messages[0] = { ...f.saved.messages[0], text: 'Correction' } as never;
    f.active.length = 0;
    await expect(executeObserverAction(preview, [f.machine], f.local)).resolves.toBe('Correction saved.');
    expect(f.posts).toHaveLength(0);
  });

  it('rejects stale or offline snapshots and archives before any mutation', async () => {
    const f = fixture();
    const preview = await previewObserverAction(permission, [f.machine], f.local);
    f.machine.snapshotFresh = false;
    await expect(executeObserverAction(preview, [f.machine], f.local)).rejects.toThrow('Refresh');
    f.machine.snapshotFresh = true; f.machine.machine.state = 'offline';
    await expect(previewObserverAction(permission, [f.machine], f.local)).rejects.toThrow('Refresh');
    f.machine.machine.state = 'online'; f.saved.archivedAt = new Date().toISOString();
    await expect(executeObserverAction(preview, [f.machine], f.local)).rejects.toThrow('changed');
    expect(f.posts).toHaveLength(0);
  });

  it('does not report a rejected or uncertain action as successful', async () => {
    const f = fixture();
    const preview = await previewObserverAction(permission, [f.machine], f.local);
    f.fetcher.mockImplementationOnce(async () => Response.json({ active: [f.run], recent: [] }));
    f.fetcher.mockImplementationOnce(async () => Response.json({ session: f.saved }));
    f.fetcher.mockImplementationOnce(async () => Response.json({ error: 'Already resolved' }, { status: 409 }));
    await expect(executeObserverAction(preview, [f.machine], f.local)).rejects.toThrow('Already resolved');
    f.fetcher.mockRejectedValueOnce(new Error('Disconnected'));
    await expect(executeObserverAction(preview, [f.machine], f.local)).rejects.toThrow('Disconnected');
    f.fetcher.mockImplementationOnce(async () => Response.json({ active: [f.run], recent: [] }));
    f.fetcher.mockImplementationOnce(async () => Response.json({ session: f.saved }));
    f.fetcher.mockRejectedValueOnce(new Error('POST response lost'));
    await expect(executeObserverAction(preview, [f.machine], f.local)).rejects.toThrow('outcome is unknown');
  });

  it('uses explicit distinct voice commands, with full short readbacks', async () => {
    const f = fixture();
    const preview = await previewObserverAction(permission, [f.machine], f.local);
    expect(observerActionVoiceAllowed(preview)).toBe(true);
    expect(observerActionSpeech(preview)).toContain('Bash. npm test Say Approve it');
    expect(observerCommand('Approve it!')).toBe('approve');
    expect(observerCommand('Deny it')).toBe('deny');
    expect(observerCommand('Save correction')).toBe('correct');
    expect(observerCommand('Confirm cancel turn')).toBe('cancel-turn');
    expect(observerCommand('yes')).toBeUndefined();
    expect(observerCommand('approve everything')).toBeUndefined();
  });
});
