import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const routeState = vi.hoisted(() => ({
  dataDir: '',
  health: { available: true, authenticated: true as const, supportedModes: ['ask', 'plan', 'agent'] },
}));

vi.mock('@/server/config', () => ({
  getConfig: () => ({
    dataDir: routeState.dataDir,
    projectsRoot: '/projects',
    projectDiscoveryDepth: 1,
    maxDiagramAttachments: 4,
    maxTranscriptMessages: 40,
    maxTranscriptBytes: 24_000,
  }),
}));

vi.mock('@/server/projects/projectRegistry', () => ({
  getProjectRegistry: () => ({
    resolve: async (projectId: string) => {
      if (projectId !== 'project-a') throw new Error('Unknown project');
      return { id: projectId, name: 'Project', relativePath: '.', realPath: '/projects/project-a' };
    },
  }),
}));

vi.mock('@/server/agents/providerRegistry', () => ({
  getProviderAdapters: () => ({
    claude: { checkHealth: async () => routeState.health },
    codex: { checkHealth: async () => routeState.health },
  }),
}));

import { GET, POST } from '@/app/api/threads/[threadId]/participants/route';
import { POST as POST_MESSAGE } from '@/app/api/agent/message/route';
import { POST as POST_THREAD } from '@/app/api/threads/route';
import { ThreadRegistry } from '@/server/storage/threadRegistry';

describe('participant routes', () => {
  beforeEach(async () => {
    routeState.dataDir = await mkdtemp(path.join(os.tmpdir(), 'codeai-participant-route-'));
    routeState.health = { available: true, authenticated: true, supportedModes: ['ask', 'plan', 'agent'] };
  });

  it('returns a session-free roster and reconciles an idempotent participant retry', async () => {
    const registry = new ThreadRegistry(routeState.dataDir);
    const thread = await registry.create('project-a', 'claude');
    const context = { params: Promise.resolve({ threadId: thread.id }) };
    const rosterResponse = await GET(new Request(
      `http://localhost/api/threads/${thread.id}/participants?projectId=project-a`,
    ), context);
    expect(rosterResponse.status).toBe(200);
    const roster = await rosterResponse.json();
    expect(JSON.stringify(roster)).not.toMatch(/session|lastObserved|creationRequest/i);

    const requestId = crypto.randomUUID();
    const add = () => POST(new Request(`http://localhost/api/threads/${thread.id}/participants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'project-a', provider: 'codex', role: 'reviewer', requestId }),
    }), context);
    const first = await add();
    const retry = await add();
    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    const firstBody = await first.json();
    const retryBody = await retry.json();
    expect(retryBody).toEqual(firstBody);
    expect(firstBody.participants).toHaveLength(3);
    expect(JSON.stringify(firstBody)).not.toMatch(/session|lastObserved|creationRequest/i);
  });

  it('passes a non-default role through thread creation', async () => {
    const response = await POST_THREAD(new Request('http://localhost/api/threads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'project-a', provider: 'claude', role: 'reviewer' }),
    }));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.thread.participants).toContainEqual(expect.objectContaining({
      id: body.thread.primaryAgentId, role: 'reviewer', defaultMode: 'ask',
    }));
  });

  it('returns 409 before creating a participant when its provider is unhealthy', async () => {
    const registry = new ThreadRegistry(routeState.dataDir);
    const thread = await registry.create('project-a', 'claude');
    routeState.health = { available: false, authenticated: true, supportedModes: [] };
    const response = await POST(new Request(`http://localhost/api/threads/${thread.id}/participants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'project-a', provider: 'codex', role: 'reviewer', requestId: crypto.randomUUID(),
      }),
    }), { params: Promise.resolve({ threadId: thread.id }) });
    expect(response.status).toBe(409);
    expect((await registry.get(thread.id)).participants).toHaveLength(2);
  });

  it('returns a clear 404 for an unknown thread', async () => {
    const threadId = crypto.randomUUID();
    const response = await GET(new Request(
      `http://localhost/api/threads/${threadId}/participants?projectId=project-a`,
    ), { params: Promise.resolve({ threadId }) });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Unknown project-bound thread' });
  });

  it('rejects an addressed participant id owned by a different thread', async () => {
    const registry = new ThreadRegistry(routeState.dataDir);
    const first = await registry.create('project-a', 'claude');
    const second = await registry.create('project-a', 'codex');
    const response = await POST_MESSAGE(new Request('http://localhost/api/agent/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'project-a', threadId: first.id, messageId: crypto.randomUUID(),
        participantId: second.primaryAgentId, text: 'forged address', transcript: [], diagramAttachments: [],
      }),
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'The addressed participant is not an agent in this conversation.' });
  });
});
