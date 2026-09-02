import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const routeState = vi.hoisted(() => ({
  dataDir: '',
  runnersCreated: 0,
  started: [] as string[],
  resolvers: new Map<string, () => void>(),
}));

vi.mock('@/server/config', () => ({
  getConfig: () => ({
    dataDir: routeState.dataDir,
    hostLabel: 'Scheduler route host',
    repositoriesRoot: '/repositories',
    repositoryDiscoveryDepth: 1,
    maxConcurrentRuns: 2,
    maxDiagramAttachments: 4,
    maxTranscriptMessages: 40,
    maxTranscriptBytes: 24_000,
  }),
}));

vi.mock('@/server/repository/checkoutRegistry', () => ({
  getCheckoutRegistry: () => ({
    resolve: async (checkoutId: string) => ({
      id: checkoutId,
      name: 'Repository',
      relativePath: '.',
      realPath: `/repositories/${checkoutId}`,
    }),
  }),
}));

vi.mock('@/server/agents/providerRegistry', () => ({
  getProviderAdapters: () => ({
    claude: {
      checkHealth: async () => ({
        available: true,
        authenticated: true,
        supportedModes: ['ask', 'plan', 'agent'],
      }),
      createRunner: () => {
        routeState.runnersCreated += 1;
        return {};
      },
    },
    codex: {
      checkHealth: async () => ({
        available: false,
        authenticated: false,
        supportedModes: [],
      }),
      createRunner: vi.fn(),
    },
  }),
}));

vi.mock('@/server/conversation/conversationService', () => ({
  runConversation: vi.fn(async (input: {
    runId: string;
    request: { sessionId: string; messageId: string; participantId: string };
    emit(event: unknown): void;
  }) => {
    routeState.started.push(input.runId);
    input.emit({
      type: 'run-started',
      runId: input.runId,
      sessionId: input.request.sessionId,
      messageId: input.request.messageId,
      participantId: input.request.participantId,
    });
    await new Promise<void>((resolve) => routeState.resolvers.set(input.runId, resolve));
    input.emit({ type: 'done', runId: input.runId, durationMs: 1, cancelled: false });
  }),
}));

import { POST as POST_CANCEL } from '@/app/api/agent/cancel/route';
import { POST as POST_MESSAGE } from '@/app/api/agent/message/route';
import { runRegistry } from '@/server/runs/runRegistry';
import { getSessionStore, SessionStore } from '@/server/storage/sessionStore';
import type { DurableSession } from '@/shared/types';

async function createSessions(count: number): Promise<DurableSession[]> {
  const store = new SessionStore(routeState.dataDir, { hostLabel: 'Scheduler route host' });
  const project = await store.createProject('Scheduler project', ['checkout-a']);
  const sessions: DurableSession[] = [];
  for (let index = 0; index < count; index += 1) {
    sessions.push(await store.createSession({ projectId: project.id, provider: 'claude' }));
  }
  await store.close();
  return sessions;
}

function messageRequest(session: DurableSession): Request {
  return new Request('http://localhost/api/agent/message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: session.id,
      messageId: crypto.randomUUID(),
      participantId: session.primaryAgentId,
      text: `Turn for ${session.id}`,
      diagramAttachments: [],
      mode: 'ask',
    }),
  });
}

async function settleScheduler(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('message route scheduler integration', () => {
  beforeEach(async () => {
    routeState.dataDir = await mkdtemp(path.join(os.tmpdir(), 'codeai-message-scheduler-'));
    routeState.runnersCreated = 0;
    routeState.started = [];
    routeState.resolvers.clear();
  });

  afterEach(async () => {
    for (let pass = 0; pass < 5 && runRegistry.currentRuns.length; pass += 1) {
      await Promise.all(runRegistry.currentRuns.map(async (run) => {
        if (run.state === 'queued') await runRegistry.cancel(run.runId);
        else routeState.resolvers.get(run.runId)?.();
      }));
      await settleScheduler();
    }
    routeState.started = [];
    routeState.resolvers.clear();
  });

  it('accepts a canonical queued request and promotes it after one running response finishes', async () => {
    const sessions = await createSessions(3);
    const responses = await Promise.all(sessions.map((session) => POST_MESSAGE(messageRequest(session))));
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200]);
    await vi.waitFor(() => expect(routeState.started).toHaveLength(2));

    const discovery = runRegistry.list();
    expect(discovery.active.filter((run) => run.state === 'running')).toHaveLength(2);
    const queued = discovery.active.find((run) => run.state === 'queued');
    expect(queued).toMatchObject({ queuePosition: 1 });
    expect(queued?.startedAt).toBeUndefined();
    const store = getSessionStore(routeState.dataDir, 'Scheduler route host');
    expect((await store.getSession(queued!.sessionId)).messages).toContainEqual(expect.objectContaining({
      role: 'user', status: 'sending',
    }));

    routeState.resolvers.get(discovery.active[0].runId)?.();
    await vi.waitFor(() => expect(routeState.started).toContain(queued!.runId));
    expect(runRegistry.list().active).toContainEqual(expect.objectContaining({
      runId: queued!.runId, state: 'running', startedAt: expect.any(Number),
    }));

    for (const runId of [...routeState.started]) routeState.resolvers.get(runId)?.();
    await vi.waitFor(() => expect(runRegistry.list().active).toEqual([]));
    await store.close();
    await Promise.all(responses.map((response) => response.body?.cancel()));
  });

  it('cancels queued work canonically without creating its provider runner', async () => {
    const sessions = await createSessions(3);
    const responses = await Promise.all(sessions.map((session) => POST_MESSAGE(messageRequest(session))));
    await vi.waitFor(() => expect(routeState.started).toHaveLength(2));
    const queued = runRegistry.list().active.find((run) => run.state === 'queued')!;
    const queuedIndex = sessions.findIndex((session) => session.id === queued.sessionId);

    const cancel = await POST_CANCEL(new Request('http://localhost/api/agent/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: queued.runId }),
    }));
    expect(cancel.status).toBe(200);
    const queuedEvents = await responses[queuedIndex].text();
    expect(queuedEvents).toContain('"phase":"queued"');
    expect(queuedEvents).toContain('"code":"cancelled"');
    expect(queuedEvents).toContain('"delivery":"not-sent"');
    expect(routeState.runnersCreated).toBe(2);
    expect(routeState.started).not.toContain(queued.runId);

    const store = getSessionStore(routeState.dataDir, 'Scheduler route host');
    expect((await store.getSession(queued.sessionId)).messages).toContainEqual(expect.objectContaining({
      role: 'user', status: 'cancelled', delivery: 'not-sent',
    }));
    await store.close();
    for (const runId of [...routeState.started]) routeState.resolvers.get(runId)?.();
    await vi.waitFor(() => expect(runRegistry.list().active).toEqual([]));
    await Promise.all(responses.filter((_, index) => index !== queuedIndex).map((response) => response.body?.cancel()));
  });

  it('keeps queued work retryable and emits no false terminal event when cancellation persistence fails', async () => {
    const sessions = await createSessions(3);
    const responses = await Promise.all(sessions.map((session) => POST_MESSAGE(messageRequest(session))));
    await vi.waitFor(() => expect(routeState.started).toHaveLength(2));
    const queued = runRegistry.list().active.find((run) => run.state === 'queued')!;
    const queuedIndex = sessions.findIndex((session) => session.id === queued.sessionId);
    const liveEvents: unknown[] = [];
    const attachment = runRegistry.subscribe(queued.runId, (event) => liveEvents.push(event))!;
    const store = getSessionStore(routeState.dataDir, 'Scheduler route host');
    const failure = vi.spyOn(store, 'failUserMessage').mockRejectedValueOnce(new Error('disk unavailable'));

    const failedCancel = await POST_CANCEL(new Request('http://localhost/api/agent/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: queued.runId }),
    }));
    expect(failedCancel.status).toBe(500);
    expect(await failedCancel.json()).toEqual({
      error: 'Cancellation could not be recorded. The turn remains queued; retry cancellation.',
    });
    expect(runRegistry.list().active).toContainEqual(expect.objectContaining({
      runId: queued.runId, state: 'queued', queuePosition: 1,
    }));
    expect(liveEvents).not.toContainEqual(expect.objectContaining({ type: 'error' }));
    expect(liveEvents).not.toContainEqual(expect.objectContaining({ type: 'done' }));
    expect((await store.getSession(queued.sessionId)).messages).toContainEqual(expect.objectContaining({
      role: 'user', status: 'sending',
    }));

    failure.mockRestore();
    const retry = await POST_CANCEL(new Request('http://localhost/api/agent/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: queued.runId }),
    }));
    expect(retry.status).toBe(200);
    expect(await responses[queuedIndex].text()).toContain('"code":"cancelled"');
    expect((await store.getSession(queued.sessionId)).messages).toContainEqual(expect.objectContaining({
      role: 'user', status: 'cancelled', delivery: 'not-sent',
    }));
    runRegistry.unsubscribe(queued.runId, attachment.attachmentId);

    for (const runId of [...routeState.started]) routeState.resolvers.get(runId)?.();
    await vi.waitFor(() => expect(runRegistry.list().active).toEqual([]));
    await store.close();
    await Promise.all(responses.filter((_, index) => index !== queuedIndex).map((response) => response.body?.cancel()));
  });
});
