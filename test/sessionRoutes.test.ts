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
    repositoriesRoot: '/repositories',
    repositoryDiscoveryDepth: 1,
    maxDiagramAttachments: 4,
    maxTranscriptMessages: 40,
    maxTranscriptBytes: 24_000,
  }),
}));

vi.mock('@/server/repository/checkoutRegistry', () => ({
  getCheckoutRegistry: () => ({
    resolve: async (checkoutId: string) => {
      if (!routeState.checkoutAvailable || !['checkout-a', 'checkout-b'].includes(checkoutId)) throw new Error('Unknown checkout');
      return { id: checkoutId, name: 'Repository', relativePath: '.', realPath: `/repositories/${checkoutId}` };
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

import { GET as GET_SESSIONS, POST as POST_SESSION } from '@/app/api/sessions/route';
import { GET as GET_SESSION } from '@/app/api/sessions/[sessionId]/route';
import { POST as POST_SKETCH } from '@/app/api/sessions/[sessionId]/sketches/route';
import { PUT as PUT_ANNOTATION } from '@/app/api/sessions/[sessionId]/annotations/route';
import { PUT as PUT_PINS } from '@/app/api/sessions/[sessionId]/pins/route';
import { PUT as PUT_REPOSITORIES } from '@/app/api/sessions/[sessionId]/repositories/route';
import { POST as POST_MESSAGE } from '@/app/api/agent/message/route';
import { SessionStore, serverAgent } from '@/server/storage/sessionStore';
import { runRegistry } from '@/server/runs/runRegistry';
import type { DurableSession, PublicSession } from '@/shared/types';

function context(sessionId: string) {
  return { params: Promise.resolve({ sessionId }) };
}

function requestBody(session: PublicSession) {
  return {
    sessionId: session.id,
    messageId: crypto.randomUUID(),
    participantId: session.primaryAgentId,
    text: 'Explain this.',
    diagramAttachments: [],
    mode: 'ask',
  };
}

async function createViaRoute(checkoutId?: string): Promise<PublicSession> {
  let projectId: string | undefined;
  if (checkoutId) {
    const direct = new SessionStore(routeState.dataDir, { hostLabel: 'Route host' });
    projectId = (await direct.createProject('Test project', [checkoutId])).id;
    await direct.close();
  }
  const response = await POST_SESSION(new Request('http://localhost/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...(projectId ? { projectId } : {}), provider: 'claude' }),
  }));
  expect(response.status).toBe(201);
  return (await response.json()).session as PublicSession;
}

describe('session snapshot and mutation routes', () => {
  beforeEach(async () => {
    routeState.dataDir = await mkdtemp(path.join(os.tmpdir(), 'codeai-session-routes-'));
    routeState.checkoutAvailable = true;
    routeState.healthChecks = 0;
    routeState.runnersCreated = 0;
  });

  it('lists and hydrates public host snapshots, then applies revisioned canvas operations', async () => {
    let session = await createViaRoute('checkout-a');
    expect(session).toMatchObject({ version: 3, revision: 0, repositories: [{ checkoutId: 'checkout-a', role: 'primary' }] });
    expect(session.participants.some((participant) => 'session' in participant)).toBe(false);
    expect(JSON.stringify(session)).not.toMatch(/lastObserved/);

    const list = await GET_SESSIONS(new Request(`http://localhost/api/sessions?projectId=${session.projectId}`));
    expect(list.status).toBe(200);
    expect((await list.json()).sessions).toEqual([session]);
    const ambiguous = await GET_SESSIONS(new Request(`http://localhost/api/sessions?projectId=${session.projectId}&loose=true`));
    expect(ambiguous.status).toBe(400);
    expect((await ambiguous.json()).error).toContain('either a project or loose sessions');
    const hydrated = await GET_SESSION(new Request(`http://localhost/api/sessions/${session.id}`), context(session.id));
    expect((await hydrated.json()).session).toEqual(session);

    const sketch = {
      id: crypto.randomUUID(), sessionId: session.id, ordinal: 1,
      createdAt: new Date().toISOString(), viewBox: [0, 0, 1_600, 1_000],
    };
    const sketchResponse = await POST_SKETCH(new Request(`http://localhost/api/sessions/${session.id}/sketches`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sketch }),
    }), context(session.id));
    session = (await sketchResponse.json()).session;
    expect(session).toMatchObject({ revision: 1, sketches: [sketch] });

    const annotation = { version: 1, diagramId: sketch.id, marks: [], updatedAt: new Date().toISOString() };
    const annotationResponse = await PUT_ANNOTATION(new Request(`http://localhost/api/sessions/${session.id}/annotations`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedRevision: session.revision, annotation }),
    }), context(session.id));
    session = (await annotationResponse.json()).session;
    expect(session).toMatchObject({ revision: 2, annotations: { [sketch.id]: annotation } });

    const pinsResponse = await PUT_PINS(new Request(`http://localhost/api/sessions/${session.id}/pins`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedRevision: session.revision, pinnedDiagramIds: [sketch.id] }),
    }), context(session.id));
    session = (await pinsResponse.json()).session;
    expect(session).toMatchObject({ revision: 3, pinnedDiagramIds: [sketch.id] });

    const stale = await PUT_PINS(new Request(`http://localhost/api/sessions/${session.id}/pins`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 1, pinnedDiagramIds: [] }),
    }), context(session.id));
    expect(stale.status).toBe(409);
    expect((await stale.json()).error).toContain('Refetch and retry');
  });

  it('keeps repository-free sessions readable and rejects their turns before provider work', async () => {
    const session = await createViaRoute();
    const response = await POST_MESSAGE(new Request('http://localhost/api/agent/message', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody(session)),
    }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('no repository');
    expect(routeState.healthChecks).toBe(0);
    expect(routeState.runnersCreated).toBe(0);
    expect((await GET_SESSION(new Request('http://localhost'), context(session.id))).status).toBe(200);
  });

  it('updates repository order and primary role with revision conflicts enforced', async () => {
    const session = await createViaRoute('checkout-a');
    const second = {
      id: crypto.randomUUID(),
      hostId: session.repositories[0].hostId,
      checkoutId: 'checkout-b',
      role: 'primary' as const,
    };
    const repositories = [second, { ...session.repositories[0], role: 'reference' as const }];
    const update = await PUT_REPOSITORIES(new Request(`http://localhost/api/sessions/${session.id}/repositories`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedRevision: session.revision, repositories }),
    }), context(session.id));
    expect(update.status).toBe(200);
    const updated = (await update.json()).session as PublicSession;
    expect(updated).toMatchObject({ revision: 1, repositories });

    const stale = await PUT_REPOSITORIES(new Request(`http://localhost/api/sessions/${session.id}/repositories`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 0, repositories: [] }),
    }), context(session.id));
    expect(stale.status).toBe(409);
  });

  it('rejects a racing turn in the same session and reports its active descriptor', async () => {
    const session = await createViaRoute('checkout-a');
    const blockingRun = {
      runId: crypto.randomUUID(),
      sessionId: session.id,
      participantId: 'agent-on-another-session',
    };
    expect(runRegistry.start({ ...blockingRun, cancel: () => undefined })).toBe(true);
    try {
      const response = await POST_MESSAGE(new Request('http://localhost/api/agent/message', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody(session)),
      }));
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: 'This session already has an agent turn queued or running.',
        activeRun: expect.objectContaining({ ...blockingRun, startedAt: expect.any(Number) }),
      });
      expect(routeState.runnersCreated).toBe(0);
      expect(runRegistry.currentRuns).toHaveLength(1);
    } finally {
      runRegistry.finish(blockingRun.runId);
    }
  });

  it.each([
    ['remote repository', (record: DurableSession) => {
      record.repositories[0].hostId = crypto.randomUUID();
    }, /another host/, true],
    ['stale checkout', (_record: DurableSession) => {
      routeState.checkoutAvailable = false;
    }, /Choose another checkout or reattach it/, false],
    ['foreign session', (record: DurableSession) => {
      const agent = serverAgent(record, record.primaryAgentId)!;
      agent.session = {
        provider: agent.provider,
        started: true,
        sessionId: 'foreign-provider-session',
        hostId: crypto.randomUUID(),
      };
    }, /provider session belongs to another host/, true],
  ])('rejects a %s before registry admission or provider spawn', async (_label, mutate, expected, editFile) => {
    const direct = new SessionStore(routeState.dataDir, { hostLabel: 'Route host' });
    const project = await direct.createProject('Test project', ['checkout-a']);
    const created = await direct.createSession({ projectId: project.id, provider: 'claude' });
    const publicSession = {
      ...created,
      participants: created.participants.map((item) => item.kind === 'human' ? item : {
        id: item.id, kind: item.kind, displayName: item.displayName, provider: item.provider,
        role: item.role, defaultMode: item.defaultMode,
      }),
    } as PublicSession;
    await direct.close();

    const sessionPath = path.join(routeState.dataDir, 'session-store-v2', 'sessions', `${created.id}.json`);
    const record = JSON.parse(await readFile(sessionPath, 'utf8')) as DurableSession;
    mutate(record);
    if (editFile) await writeFile(sessionPath, `${JSON.stringify(record, null, 2)}\n`);

    const response = await POST_MESSAGE(new Request('http://localhost/api/agent/message', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody(publicSession)),
    }));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(expected);
    expect(routeState.healthChecks).toBe(0);
    expect(routeState.runnersCreated).toBe(0);
  });
});
