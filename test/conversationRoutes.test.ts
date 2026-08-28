import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const routeState = vi.hoisted(() => ({
  dataDir: '',
  checkoutAvailable: true,
  healthChecks: 0,
  runnersCreated: 0,
}));

vi.mock('@/server/config', () => ({
  getConfig: () => ({
    dataDir: routeState.dataDir,
    hostLabel: 'Route host',
    projectsRoot: '/projects',
    projectDiscoveryDepth: 1,
    maxDiagramAttachments: 4,
    maxTranscriptMessages: 40,
    maxTranscriptBytes: 24_000,
  }),
}));

vi.mock('@/server/projects/projectRegistry', () => ({
  getProjectRegistry: () => ({
    resolve: async (checkoutId: string) => {
      if (!routeState.checkoutAvailable || checkoutId !== 'checkout-a') throw new Error('Unknown project');
      return { id: checkoutId, name: 'Project', relativePath: '.', realPath: '/projects/checkout-a' };
    },
  }),
}));

vi.mock('@/server/agents/providerRegistry', () => ({
  getProviderAdapters: () => ({
    claude: {
      checkHealth: async () => {
        routeState.healthChecks += 1;
        return { available: true, authenticated: true, supportedModes: ['ask', 'plan', 'agent'] };
      },
      createRunner: () => {
        routeState.runnersCreated += 1;
        throw new Error('A rejected request must not create a runner');
      },
    },
    codex: {
      checkHealth: async () => {
        routeState.healthChecks += 1;
        return { available: true, authenticated: true, supportedModes: ['ask', 'plan'] };
      },
      createRunner: () => {
        routeState.runnersCreated += 1;
        throw new Error('A rejected request must not create a runner');
      },
    },
  }),
}));

import { GET as GET_THREADS, POST as POST_THREAD } from '@/app/api/threads/route';
import { GET as GET_THREAD } from '@/app/api/threads/[threadId]/route';
import { POST as POST_SKETCH } from '@/app/api/threads/[threadId]/sketches/route';
import { PUT as PUT_ANNOTATION } from '@/app/api/threads/[threadId]/annotations/route';
import { PUT as PUT_PINS } from '@/app/api/threads/[threadId]/pins/route';
import { POST as POST_MESSAGE } from '@/app/api/agent/message/route';
import { ConversationStore, serverAgent } from '@/server/storage/conversationStore';
import { runRegistry } from '@/server/runs/runRegistry';
import type { DurableConversation, PublicConversation } from '@/shared/types';

function context(threadId: string) {
  return { params: Promise.resolve({ threadId }) };
}

function requestBody(thread: PublicConversation) {
  return {
    threadId: thread.id,
    messageId: crypto.randomUUID(),
    participantId: thread.primaryAgentId,
    text: 'Explain this.',
    diagramAttachments: [],
    mode: 'ask',
  };
}

async function createViaRoute(checkoutId?: string): Promise<PublicConversation> {
  const response = await POST_THREAD(new Request('http://localhost/api/threads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...(checkoutId ? { checkoutId } : {}), provider: 'claude' }),
  }));
  expect(response.status).toBe(201);
  return (await response.json()).thread as PublicConversation;
}

describe('conversation snapshot and mutation routes', () => {
  beforeEach(async () => {
    routeState.dataDir = await mkdtemp(path.join(os.tmpdir(), 'codeai-conversation-routes-'));
    routeState.checkoutAvailable = true;
    routeState.healthChecks = 0;
    routeState.runnersCreated = 0;
  });

  it('lists and hydrates public host snapshots, then applies revisioned canvas operations', async () => {
    let thread = await createViaRoute('checkout-a');
    expect(thread).toMatchObject({ version: 1, revision: 0, attachments: [{ checkoutId: 'checkout-a', role: 'primary' }] });
    expect(JSON.stringify(thread)).not.toMatch(/projectId|sessionId|lastObserved/);

    const list = await GET_THREADS(new Request('http://localhost/api/threads?checkoutId=checkout-a'));
    expect(list.status).toBe(200);
    expect((await list.json()).threads).toEqual([thread]);
    const hydrated = await GET_THREAD(new Request(`http://localhost/api/threads/${thread.id}`), context(thread.id));
    expect((await hydrated.json()).thread).toEqual(thread);

    const sketch = {
      id: crypto.randomUUID(), threadId: thread.id, ordinal: 1,
      createdAt: new Date().toISOString(), viewBox: [0, 0, 1_600, 1_000],
    };
    const sketchResponse = await POST_SKETCH(new Request(`http://localhost/api/threads/${thread.id}/sketches`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sketch }),
    }), context(thread.id));
    thread = (await sketchResponse.json()).thread;
    expect(thread).toMatchObject({ revision: 1, sketches: [sketch] });

    const annotation = { version: 1, diagramId: sketch.id, marks: [], updatedAt: new Date().toISOString() };
    const annotationResponse = await PUT_ANNOTATION(new Request(`http://localhost/api/threads/${thread.id}/annotations`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedRevision: thread.revision, annotation }),
    }), context(thread.id));
    thread = (await annotationResponse.json()).thread;
    expect(thread).toMatchObject({ revision: 2, annotations: { [sketch.id]: annotation } });

    const pinsResponse = await PUT_PINS(new Request(`http://localhost/api/threads/${thread.id}/pins`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedRevision: thread.revision, pinnedDiagramIds: [sketch.id] }),
    }), context(thread.id));
    thread = (await pinsResponse.json()).thread;
    expect(thread).toMatchObject({ revision: 3, pinnedDiagramIds: [sketch.id] });

    const stale = await PUT_PINS(new Request(`http://localhost/api/threads/${thread.id}/pins`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 1, pinnedDiagramIds: [] }),
    }), context(thread.id));
    expect(stale.status).toBe(409);
    expect((await stale.json()).error).toContain('Refetch and retry');
  });

  it('keeps attachment-free conversations readable and rejects their turns before provider work', async () => {
    const thread = await createViaRoute();
    const response = await POST_MESSAGE(new Request('http://localhost/api/agent/message', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody(thread)),
    }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('no working directory');
    expect(routeState.healthChecks).toBe(0);
    expect(routeState.runnersCreated).toBe(0);
    expect((await GET_THREAD(new Request('http://localhost'), context(thread.id))).status).toBe(200);
  });

  it('keeps the visible busy error and reports the host-wide active run descriptor', async () => {
    const thread = await createViaRoute('checkout-a');
    const blockingRun = {
      runId: crypto.randomUUID(),
      threadId: crypto.randomUUID(),
      participantId: 'agent-on-another-conversation',
    };
    expect(runRegistry.start({ ...blockingRun, cancel: () => undefined })).toBe(true);
    try {
      const response = await POST_MESSAGE(new Request('http://localhost/api/agent/message', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody(thread)),
      }));
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: 'Another agent turn is already running.',
        activeRun: expect.objectContaining({ ...blockingRun, startedAt: expect.any(Number) }),
      });
      expect(routeState.runnersCreated).toBe(0);
      expect(runRegistry.currentRuns).toHaveLength(1);
    } finally {
      runRegistry.finish(blockingRun.runId);
    }
  });

  it.each([
    ['remote attachment', (record: DurableConversation) => {
      record.attachments[0].hostId = crypto.randomUUID();
    }, /another host/, true],
    ['stale checkout', (_record: DurableConversation) => {
      routeState.checkoutAvailable = false;
    }, /Rebinding attachments is not available/, false],
    ['foreign session', (record: DurableConversation) => {
      const agent = serverAgent(record, record.primaryAgentId)!;
      agent.session = {
        provider: agent.provider,
        started: true,
        sessionId: 'foreign-provider-session',
        hostId: crypto.randomUUID(),
      };
    }, /provider session belongs to another host/, true],
  ])('rejects a %s before registry admission or provider spawn', async (_label, mutate, expected, editFile) => {
    const direct = new ConversationStore(routeState.dataDir, { hostLabel: 'Route host' });
    const created = await direct.createConversation({ checkoutId: 'checkout-a', provider: 'claude' });
    const publicThread = {
      ...created,
      participants: created.participants.map((item) => item.kind === 'human' ? item : {
        id: item.id, kind: item.kind, displayName: item.displayName, provider: item.provider,
        role: item.role, defaultMode: item.defaultMode,
      }),
    } as PublicConversation;
    await direct.close();

    const threadPath = path.join(routeState.dataDir, 'conversation-store-v1', 'threads', `${created.id}.json`);
    const record = JSON.parse(await readFile(threadPath, 'utf8')) as DurableConversation;
    mutate(record);
    if (editFile) await writeFile(threadPath, `${JSON.stringify(record, null, 2)}\n`);

    const response = await POST_MESSAGE(new Request('http://localhost/api/agent/message', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody(publicThread)),
    }));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(expected);
    expect(routeState.healthChecks).toBe(0);
    expect(routeState.runnersCreated).toBe(0);
  });
});
