import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/sessions/route';
import { getSessionStore, serverAgent, type SessionStore } from '@/server/storage/sessionStore';
import type { AgentExecution } from '@/shared/types';

const state = vi.hoisted(() => ({ dataDir: '', dockerReady: true, validateCheckout: vi.fn() }));
vi.mock('@/server/config', () => ({
  getConfig: () => ({ dataDir: state.dataDir, hostLabel: 'Test host', repositoriesRoot: '/repositories', repositoryDiscoveryDepth: 1 }),
}));
vi.mock('@/server/execution/dockerRuntime', () => ({
  getDockerRuntime: () => ({ health: async () => ({ available: state.dockerReady, message: 'Docker setup needed.' }) }),
}));
vi.mock('@/server/execution/dockerProfile', () => ({ validateDockerCheckout: state.validateCheckout }));
vi.mock('@/server/repository/checkoutRegistry', () => ({
  getCheckoutRegistry: () => ({ resolve: async (id: string) => ({ realPath: `/repositories/${id}` }) }),
}));

function create(input: Record<string, unknown>) {
  return POST(new Request('http://localhost/api/sessions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  }));
}

describe('continuing a session in another execution', () => {
  let store: SessionStore;
  beforeEach(async () => {
    state.dataDir = await mkdtemp(path.join(os.tmpdir(), 'codeai-continuation-'));
    state.dockerReady = true;
    state.validateCheckout.mockReset().mockResolvedValue({ uid: 1000, gid: 1000 });
    store = getSessionStore(state.dataDir, 'Test host');
  });
  afterEach(async () => {
    await store.close();
    await rm(state.dataDir, { recursive: true, force: true });
  });

  it.each<AgentExecution>(['local', 'docker'])('continues from %s with exact bindings and fresh provider history', async (execution) => {
    const project = await store.createProject('Project', ['original-checkout']);
    let source = await store.createSession({ provider: 'claude', projectId: project.id, execution });
    source = await store.markProviderSessionStarted(source.id, source.primaryAgentId, 'claude', 'native-source-history');
    source = (await store.appendUserMessage(source.id, {
      id: crypto.randomUUID(), role: 'user', authorId: source.participants.find((item) => item.kind === 'human')!.id,
      addressedParticipantId: source.primaryAgentId, text: 'Continue my work', createdAt: new Date().toISOString(),
      status: 'sent', mode: 'plan', diagramAttachments: [],
    })).session;
    // A project's current default can differ from its existing session's repository.
    await store.updateProject(project.id, {
      expectedRevision: project.revision,
      repositories: [{ ...project.repositories[0], checkoutId: 'different-checkout' }],
    });
    const targetExecution = execution === 'local' ? 'docker' : 'local';
    const response = await create({ provider: 'claude', execution: targetExecution, sourceSessionId: source.id });
    expect(response.status).toBe(201);
    const { session } = await response.json();
    expect(session.id).not.toBe(source.id);
    expect(session).toMatchObject({ projectId: project.id, execution: targetExecution, repositories: source.repositories, messages: [] });
    expect(session.primaryAgentId).not.toBe(source.primaryAgentId);
    expect(serverAgent(await store.getSession(session.id), session.primaryAgentId)?.session).toEqual({ provider: 'claude', started: false });
    expect(await store.getSession(source.id)).toEqual(source);
    if (targetExecution === 'docker') {
      expect(state.validateCheckout).toHaveBeenCalledWith('/repositories/original-checkout', expect.any(Object));
    } else expect(state.validateCheckout).not.toHaveBeenCalled();
  });

  it('keeps a loose session loose and preserves its checkout when returning to Local', async () => {
    const source = await store.createSession({ provider: 'codex', checkoutId: 'checkout', execution: 'docker' });
    const response = await create({ provider: 'codex', execution: 'local', sourceSessionId: source.id });
    expect(response.status).toBe(201);
    const { session } = await response.json();
    expect(session).not.toHaveProperty('projectId');
    expect(session.repositories).toEqual(source.repositories);
  });

  it('rejects unavailable Docker, invalid bindings, and protected checkouts without creating a session', async () => {
    const source = await store.createSession({ provider: 'claude', checkoutId: 'checkout' });
    const input = { provider: 'claude', execution: 'docker', sourceSessionId: source.id };
    state.dockerReady = false;
    expect((await create(input)).status).toBe(409);
    state.dockerReady = true;
    state.validateCheckout.mockRejectedValueOnce(new Error('Protected checkout'));
    expect((await create(input)).status).not.toBe(201);
    const empty = await store.createSession({ provider: 'claude' });
    const response = await create({ ...input, sourceSessionId: empty.id });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('exactly one primary repository');
    expect(await store.listSessions()).toHaveLength(2);
  });

  it('rejects ambiguous inputs and missing or archived sources', async () => {
    const source = await store.createSession({ provider: 'claude' });
    const input = { provider: 'claude', sourceSessionId: source.id };
    for (const extra of [{}, { execution: 'docker', checkoutId: 'checkout' }, { execution: 'local', projectId: crypto.randomUUID() }]) {
      expect((await create({ ...input, ...extra })).status).toBe(400);
    }
    expect((await create({ ...input, execution: 'local', sourceSessionId: crypto.randomUUID() })).status).toBe(404);
    await store.archiveSession(source.id, source.revision);
    expect((await create({ ...input, execution: 'local' })).status).toBe(404);
    expect(await store.listSessions()).toHaveLength(0);
  });

  it('rejects a source change between Docker validation and durable creation', async () => {
    const source = await store.createSession({ provider: 'claude', checkoutId: 'checkout' });
    state.validateCheckout.mockImplementationOnce(async () => {
      await store.setSessionRepositories(source.id, [{ ...source.repositories[0], checkoutId: 'changed' }], source.revision);
    });
    const response = await create({ provider: 'claude', execution: 'docker', sourceSessionId: source.id });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('source session changed');
    expect(await store.listSessions()).toHaveLength(1);
  });
});
