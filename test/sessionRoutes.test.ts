import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const routeState = vi.hoisted(() => ({
  dataDir: '',
  checkoutAvailable: true,
  healthChecks: 0,
  runnersCreated: 0,
  adapterRequests: [] as unknown[][],
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
    list: async () => ['checkout-a', 'checkout-b'].map((id) => ({ id, name: 'Repository', relativePath: id })),
    resolve: async (checkoutId: string) => {
      if (!routeState.checkoutAvailable || !['checkout-a', 'checkout-b'].includes(checkoutId)) throw new Error('Unknown checkout');
      return { id: checkoutId, name: 'Repository', relativePath: '.', realPath: `/repositories/${checkoutId}` };
    },
  }),
}));

vi.mock('@/server/agents/providerRegistry', () => ({
  getProviderAdapters: (_config: unknown, ...request: unknown[]) => (routeState.adapterRequests.push(request), {
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
import { GET as GET_PROJECTS } from '@/app/api/projects/route';
import { GET as GET_ARENA } from '@/app/api/arena/route';
import { GET as GET_SESSION } from '@/app/api/sessions/[sessionId]/route';
import { POST as POST_SKETCH } from '@/app/api/sessions/[sessionId]/sketches/route';
import { PUT as PUT_ANNOTATION } from '@/app/api/sessions/[sessionId]/annotations/route';
import { PUT as PUT_PINS } from '@/app/api/sessions/[sessionId]/pins/route';
import { PUT as PUT_REPOSITORIES } from '@/app/api/sessions/[sessionId]/repositories/route';
import { POST as ARCHIVE_SESSION } from '@/app/api/sessions/[sessionId]/archive/route';
import { POST as RESTORE_SESSION } from '@/app/api/sessions/[sessionId]/restore/route';
import { POST as POST_MESSAGE } from '@/app/api/agent/message/route';
import { SessionStore, publicSession, serverAgent } from '@/server/storage/sessionStore';
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

async function seedVersionFourSession(execution: 'local' | 'docker'): Promise<DurableSession> {
  const store = new SessionStore(routeState.dataDir, { hostLabel: 'Route host' });
  const project = await store.createProject('Shared project', ['checkout-a']);
  const created = await store.createSession({ projectId: project.id, provider: 'claude' });
  await store.close();
  const session: DurableSession = { ...created, version: 4, execution };
  await writeFile(path.join(routeState.dataDir, 'session-store-v2', 'sessions', `${session.id}.json`), JSON.stringify(session));
  return session;
}

async function seedVersionThreeSession(): Promise<DurableSession> {
  const created = await seedVersionFourSession('local');
  const { execution: _execution, ...session } = created;
  const versionThree: DurableSession = { ...session, version: 3 };
  await writeFile(path.join(routeState.dataDir, 'session-store-v2', 'sessions', `${session.id}.json`), JSON.stringify(versionThree));
  return versionThree;
}

describe('session snapshot and mutation routes', () => {
  beforeEach(async () => {
    routeState.dataDir = await mkdtemp(path.join(os.tmpdir(), 'codeai-session-routes-'));
    routeState.checkoutAvailable = true;
    routeState.healthChecks = 0;
    routeState.runnersCreated = 0;
    routeState.adapterRequests = [];
  });

  it.each([3, 4] as const)('lists and hydrates version %i public snapshots, then applies revisioned canvas operations', async (version) => {
    let session = publicSession(version === 3 ? await seedVersionThreeSession() : await seedVersionFourSession('local'));
    expect(session).toMatchObject({
      version,
      ...(version === 4 ? { execution: 'local' } : {}),
      revision: 0,
      repositories: [{ checkoutId: 'checkout-a', role: 'primary' }],
    });
    expect(session.participants.some((participant) => 'session' in participant)).toBe(false);
    expect(JSON.stringify(session)).not.toMatch(/lastObserved/);

    const projects = await GET_PROJECTS();
    expect(projects.status).toBe(200);
    expect((await projects.json()).projects).toEqual([expect.objectContaining({ id: session.projectId })]);
    const list = await GET_SESSIONS(new Request(`http://localhost/api/sessions?projectId=${session.projectId}`));
    expect(list.status).toBe(200);
    expect((await list.json()).sessions).toEqual([session]);
    const ambiguous = await GET_SESSIONS(new Request(`http://localhost/api/sessions?projectId=${session.projectId}&loose=true`));
    expect(ambiguous.status).toBe(400);
    expect((await ambiguous.json()).error).toContain('either a project or loose sessions');
    const hydrated = await GET_SESSION(new Request(`http://localhost/api/sessions/${session.id}`), context(session.id));
    expect((await hydrated.json()).session).toEqual(session);
    const arena = await GET_ARENA();
    const arenaBody = await arena.json();
    expect(arena.status).toBe(200);
    expect(arenaBody.machines).toHaveLength(1);
    expect(arenaBody.machines[0].machine).toMatchObject({ label: 'Route host', kind: 'local', state: 'online' });
    expect(arenaBody.machines[0].sessions).toEqual([expect.objectContaining({
      id: session.id,
      repositoryCheckoutIds: ['checkout-a'],
      agents: [expect.objectContaining({ displayName: 'Claude', provider: 'claude' })],
    })]);
    expect(arenaBody.machines[0].archivedSessions).toEqual([]);
    expect(arenaBody.machines[0].runs).toEqual({ active: [], recent: [] });
    expect(JSON.stringify(arenaBody)).not.toContain('provider-session');

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
    expect(session).toMatchObject({ version, revision: 3, pinnedDiagramIds: [sketch.id] });
    expect(session.execution).toBe(version === 4 ? 'local' : undefined);

    const stale = await PUT_PINS(new Request(`http://localhost/api/sessions/${session.id}/pins`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 1, pinnedDiagramIds: [] }),
    }), context(session.id));
    expect(stale.status).toBe(409);
    expect((await stale.json()).error).toContain('Refetch and retry');
  });

  it('keeps Docker history readable, rejects repository changes without modifying history, and sends turns to the Docker adapter', async () => {
    const session = await seedVersionFourSession('docker');
    const sessionPath = path.join(routeState.dataDir, 'session-store-v2', 'sessions', `${session.id}.json`);
    const projectPath = path.join(routeState.dataDir, 'session-store-v2', 'projects', `${session.projectId}.json`);
    const originals = await Promise.all([sessionPath, projectPath].map((file) => readFile(file, 'utf8')));
    const loaded = await GET_SESSION(new Request('http://localhost'), context(session.id));
    expect(loaded.status).toBe(200);
    expect((await loaded.json()).session).toMatchObject({ id: session.id, version: 4, execution: 'docker' });

    const rebind = await PUT_REPOSITORIES(new Request('http://localhost', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expectedRevision: session.revision,
        repositories: [{ ...session.repositories[0], id: crypto.randomUUID(), checkoutId: 'checkout-b' }],
      }),
    }), context(session.id));
    expect(rebind.status).toBe(400);
    expect((await rebind.json()).error).toContain('repository binding is fixed');
    expect(await Promise.all([sessionPath, projectPath].map((file) => readFile(file, 'utf8')))).toEqual(originals);

    const response = await POST_MESSAGE(new Request('http://localhost/api/agent/message', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody(publicSession(session))),
    }));
    expect(routeState.adapterRequests).toEqual([['docker', { sessionId: session.id, participantId: session.primaryAgentId }]]);
    expect(response.status).toBe(200);
    // The fixture runner throws once requested, which ends the accepted turn and drains its stream.
    expect(await response.text()).toContain('"type":"done"');
    expect(routeState.healthChecks).toBe(1);
    expect(routeState.runnersCreated).toBe(1);
    await vi.waitFor(() => expect(runRegistry.currentRuns).toEqual([]));
  });

  it('reads a version 3 session as Local for its adapter and scheduler key', async () => {
    const reserve = vi.spyOn(runRegistry, 'reserve').mockReturnValue({ accepted: false, reason: 'queue-full' });
    try {
      const sessions = [await seedVersionThreeSession(), await seedVersionFourSession('local')];
      for (const session of sessions) {
        const response = await POST_MESSAGE(new Request('http://localhost/api/agent/message', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody(publicSession(session))),
        }));
        expect(response.status).toBe(429);
      }
      expect(reserve.mock.calls.map(([input]) => input.providerKey)).toEqual(sessions.map((session) => (
        `${session.repositories[0].hostId}:local:claude:participant:${session.primaryAgentId}`
      )));
      expect(routeState.adapterRequests.map(([execution]) => execution)).toEqual(['local', 'local']);
    } finally {
      reserve.mockRestore();
    }
  });

  it('answers an incomplete Docker recovery with the actions that resolve it', async () => {
    const session = await createViaRoute('checkout-a');
    await mkdir(path.join(routeState.dataDir, 'docker'));
    await writeFile(path.join(routeState.dataDir, 'docker', 'profile.json'), 'unreadable');
    const response = await POST_MESSAGE(new Request('http://localhost/api/agent/message', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody(session)),
    }));
    expect(response.status).toBe(409);
    const { error } = await response.json();
    expect(error).toContain('start it and retry');
    expect(error).toContain('npm run docker:provision -- --replace-engine');
    expect(routeState.healthChecks).toBe(0);
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

  it('archives and restores sessions through revisioned bounded routes', async () => {
    const session = await createViaRoute('checkout-a');
    const archivedResponse = await ARCHIVE_SESSION(new Request('http://localhost', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedRevision: session.revision }),
    }), context(session.id));
    expect(archivedResponse.status).toBe(200);
    const archived = (await archivedResponse.json()).session;
    expect(archived).toMatchObject({ id: session.id, revision: 1, archivedAt: expect.any(String) });
    expect(JSON.stringify(archived)).not.toContain('provider-session');
    expect((await GET_SESSION(new Request('http://localhost'), context(session.id))).status).toBe(404);
    expect((await (await GET_SESSIONS(new Request('http://localhost/api/sessions'))).json()).sessions).toEqual([]);
    const arena = await (await GET_ARENA()).json();
    expect(arena.machines[0].sessions).toEqual([]);
    expect(arena.machines[0].archivedSessions).toEqual([expect.objectContaining({ id: session.id, revision: 1 })]);

    const staleRestore = await RESTORE_SESSION(new Request('http://localhost', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedRevision: session.revision }),
    }), context(session.id));
    expect(staleRestore.status).toBe(409);

    const restoredResponse = await RESTORE_SESSION(new Request('http://localhost', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedRevision: archived.revision }),
    }), context(session.id));
    expect(restoredResponse.status).toBe(200);
    expect((await restoredResponse.json()).session).toMatchObject({ id: session.id, revision: 2 });
    expect((await GET_SESSION(new Request('http://localhost'), context(session.id))).status).toBe(200);
  });

  it('rejects archiving during the hidden run-reservation window', async () => {
    const session = await createViaRoute('checkout-a');
    const runId = crypto.randomUUID();
    const reservation = runRegistry.reserve({
      runId,
      sessionId: session.id,
      participantId: session.primaryAgentId,
      providerKey: `test:${runId}`,
      checkoutId: 'checkout-a',
      access: 'read',
      cancel: () => undefined,
    });
    expect(reservation).toMatchObject({ accepted: true });
    try {
      expect(runRegistry.list(session.id).active).toEqual([]);
      const response = await ARCHIVE_SESSION(new Request('http://localhost', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRevision: session.revision }),
      }), context(session.id));
      expect(response.status).toBe(409);
      expect((await response.json()).error).toContain('reserved');
      expect((await GET_SESSION(new Request('http://localhost'), context(session.id))).status).toBe(200);
    } finally {
      runRegistry.release(runId);
    }
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
