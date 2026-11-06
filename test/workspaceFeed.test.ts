import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getConfig } from '@/server/config';
import { getSessionStore, type SessionStore } from '@/server/storage/sessionStore';
import { getMachineRegistry } from '@/server/machines/machineRegistry';
import { localExecutorSnapshot } from '@/server/machines/localExecutorSnapshot';
import { runRegistry } from '@/server/runs/runRegistry';
import { workspaceFeeds } from '@/server/workspace/workspaceFeed';
import { SESSION_INACTIVITY_MS } from '@/server/storage/autoArchiveSessions';
import type { ArenaSnapshot, ExecutorSnapshot } from '@/shared/types';

vi.mock('@/server/agents/providerRegistry', () => ({ cachedLocalProviderHealth: async () => ({
  claude: { available: true, authenticated: 'unknown', supportedModes: ['ask'] },
  codex: { available: true, authenticated: 'unknown', supportedModes: ['ask'] },
}) }));
vi.mock('@/server/repository/checkoutRegistry', () => ({ getCheckoutRegistry: () => ({ list: async () => [] }) }));
vi.mock('@/server/machines/localExecutorSnapshot', async importOriginal => {
  const actual = await importOriginal<typeof import('@/server/machines/localExecutorSnapshot')>();
  return { ...actual, localExecutorSnapshot: vi.fn(actual.localExecutorSnapshot) };
});

let store: SessionStore;
const releases: Array<() => void> = [];
beforeEach(async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codeai-workspace-feed-'));
  vi.stubEnv('CODEAI_DATA_DIR', root);
  vi.stubEnv('CODEAI_REMOTE_ACCESS', 'local');
  vi.stubEnv('CODEAI_WORKTREES_ROOT', path.join(root, 'worktrees-root'));
  store = getSessionStore(root);
  await store.host();
  vi.mocked(localExecutorSnapshot).mockClear();
});
afterEach(async () => {
  for (const release of releases.splice(0)) release();
  for (const run of runRegistry.list().active) runRegistry.finish(run.runId);
  await store.close();
  vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals();
});

describe('workspace source notifications', () => {
  it('shares the local source across tabs, delivers saved changes and approvals, and skips token deltas', async () => {
    const session = await store.createSession({ provider: 'claude' });
    const feed = workspaceFeeds().arena;
    const first: ArenaSnapshot[] = [], second: ArenaSnapshot[] = [];
    const fail = vi.fn();
    releases.push(feed.subscribe(value => first.push(value), fail), feed.subscribe(value => second.push(value), fail));
    await vi.waitFor(() => expect(first.at(-1)?.machines[0].sessions[0].id).toBe(session.id));
    expect(second.at(-1)).toEqual(first.at(-1));
    const initial = vi.mocked(localExecutorSnapshot).mock.calls.length;
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(localExecutorSnapshot).toHaveBeenCalledTimes(initial);
    const updated = await store.addAgent(session.id, 'codex', 'reviewer', crypto.randomUUID());
    await vi.waitFor(() => expect(first.at(-1)?.machines[0].sessions[0].revision).toBe(updated.revision));
    const runId = crypto.randomUUID(), requestId = crypto.randomUUID();
    runRegistry.start({ runId, sessionId: session.id, participantId: session.primaryAgentId, cancel() {} });
    runRegistry.record(runId, { type: 'permission-request', runId, requestId, participantId: session.primaryAgentId, tool: 'shell', detail: 'Needs approval' });
    await vi.waitFor(() => expect(first.at(-1)?.machines[0].runs.active[0].pendingPermissions[0].requestId).toBe(requestId));
    const reads = vi.mocked(localExecutorSnapshot).mock.calls.length;
    for (let i = 0; i < 500; i++) runRegistry.record(runId, { type: 'assistant-delta', runId, delta: 'word' });
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(localExecutorSnapshot).toHaveBeenCalledTimes(reads);
    runRegistry.record(runId, { type: 'permission-resolved', runId, requestId, decision: 'allow' });
    runRegistry.finish(runId);
    await vi.waitFor(() => expect(first.at(-1)?.machines[0].runs.recent[0].runId).toBe(runId));
    expect(fail).not.toHaveBeenCalled();
  });

  it('archives on the inactivity deadline and detects external saved-file edits without another request', async () => {
    const session = await store.createSession({ provider: 'claude' });
    const file = path.join(store.sessionsDirectory, `${session.id}.json`);
    await writeFile(file, JSON.stringify({ ...session, updatedAt: new Date(Date.now() - SESSION_INACTIVITY_MS + 700).toISOString() }));
    const received: ExecutorSnapshot[] = [];
    const fail = vi.fn();
    releases.push(workspaceFeeds().executor.subscribe(value => received.push(value), fail));
    await vi.waitFor(() => expect(received.at(-1)?.sessions[0]?.id).toBe(session.id));
    await vi.waitFor(() => expect(received.at(-1)?.archivedSessions[0]?.id).toBe(session.id), { timeout: 3_000 });
    const archived = await store.getArchivedSession(session.id);
    const restored = await store.restoreSession(session.id, archived.revision);
    await vi.waitFor(() => expect(received.at(-1)?.sessions[0]?.revision).toBe(restored.revision));
    await writeFile(file, JSON.stringify({ ...restored, title: 'Changed outside the server', revision: restored.revision + 1 }));
    await vi.waitFor(() => expect(received.at(-1)?.sessions[0]?.title).toBe('Changed outside the server'));
    expect(fail).not.toHaveBeenCalled();
  });

  it('shares one peer stream, retains offline cards, reconnects and tears down detached peers', async () => {
    const remoteId = crypto.randomUUID();
    const remote: ExecutorSnapshot = { machine: { id: remoteId, label: 'Laptop' }, projects: [], checkouts: [], recentCheckoutIds: [],
      providers: { claude: { available: true, authenticated: true, supportedModes: ['ask'] }, codex: { available: false, authenticated: 'unknown', supportedModes: [] } },
      sessions: [], archivedSessions: [], runs: { active: [], recent: [] } };
    const controls: ReadableStreamDefaultController<Uint8Array>[] = [];
    const signals: AbortSignal[] = [];
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      signals.push(init.signal as AbortSignal);
      return new Response(new ReadableStream({ start(controller) {
        controls.push(controller);
        init.signal!.addEventListener('abort', () => controller.error(new Error('aborted')), { once: true });
        controller.enqueue(new TextEncoder().encode(`${JSON.stringify({ type: 'snapshot', snapshot: remote })}\n`));
      } }), { headers: { 'content-type': 'application/x-ndjson' } });
    });
    vi.stubGlobal('fetch', fetcher);
    await getMachineRegistry(getConfig().dataDir).attach({ machine: remote.machine, origin: 'https://laptop.test',
      credential: `${crypto.randomUUID()}.${'a'.repeat(43)}`, expiresAt: '2099-01-01T00:00:00.000Z' });
    const first: ArenaSnapshot[] = [], second: ArenaSnapshot[] = [];
    const fail = vi.fn(), feed = workspaceFeeds().arena;
    releases.push(feed.subscribe(value => first.push(value), fail), feed.subscribe(value => second.push(value), fail));
    const peer = () => first.at(-1)?.machines.find(value => value.machine.id === remoteId);
    await vi.waitFor(() => expect(peer()?.machine.state).toBe('online'));
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][1].headers).toMatchObject({ Accept: 'application/x-ndjson' });
    controls[0].error(new Error('connection lost'));
    await vi.waitFor(() => expect(peer()?.machine.state).toBe('offline'));
    expect(peer()?.machine.label).toBe('Laptop');
    expect(peer()?.providers.claude.available).toBe(false);
    await vi.waitFor(() => expect(peer()?.machine.state).toBe('online'), { timeout: 3_000 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    await getMachineRegistry(getConfig().dataDir).remove(remoteId);
    await vi.waitFor(() => expect(first.at(-1)?.machines).toHaveLength(1));
    expect(signals[1].aborted).toBe(true);
    expect(second.at(-1)).toEqual(first.at(-1));
    expect(fail).not.toHaveBeenCalled();
  });
});
