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
    hostLabel: 'Test host',
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
import { getConversationStore } from '@/server/storage/conversationStore';

describe('participant routes', () => {
  beforeEach(async () => {
    routeState.dataDir = await mkdtemp(path.join(os.tmpdir(), 'codeai-participant-route-'));
    routeState.health = { available: true, authenticated: true, supportedModes: ['ask', 'plan', 'agent'] };
  });

  it('returns a session-free roster and reconciles an idempotent participant retry', async () => {
    const registry = getConversationStore(routeState.dataDir, 'Test host');
    const thread = await registry.createConversation({ checkoutId: 'project-a', provider: 'claude' });
    const context = { params: Promise.resolve({ threadId: thread.id }) };
    const rosterResponse = await GET(new Request(
      `http://localhost/api/threads/${thread.id}/participants`,
    ), context);
    expect(rosterResponse.status).toBe(200);
    const roster = await rosterResponse.json();
    expect(JSON.stringify(roster)).not.toMatch(/session|lastObserved|creationRequest/i);

    const requestId = crypto.randomUUID();
    const add = () => POST(new Request(`http://localhost/api/threads/${thread.id}/participants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'codex', role: 'reviewer', requestId }),
    }), context);
    const first = await add();
    const retry = await add();
    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    const firstBody = await first.json();
    const retryBody = await retry.json();
    expect(retryBody).toEqual(firstBody);
    expect(firstBody.thread.participants).toHaveLength(3);
    expect(JSON.stringify(firstBody)).not.toMatch(/session|lastObserved|creationRequest/i);
  });

  it('passes a non-default role through thread creation', async () => {
    const response = await POST_THREAD(new Request('http://localhost/api/threads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checkoutId: 'project-a', provider: 'claude', role: 'reviewer' }),
    }));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.thread.participants).toContainEqual(expect.objectContaining({
      id: body.thread.primaryAgentId, role: 'reviewer', defaultMode: 'ask',
    }));
  });

  it('returns 409 before creating a participant when its provider is unhealthy', async () => {
    const registry = getConversationStore(routeState.dataDir, 'Test host');
    const thread = await registry.createConversation({ checkoutId: 'project-a', provider: 'claude' });
    routeState.health = { available: false, authenticated: true, supportedModes: [] };
    const response = await POST(new Request(`http://localhost/api/threads/${thread.id}/participants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'codex', role: 'reviewer', requestId: crypto.randomUUID(),
      }),
    }), { params: Promise.resolve({ threadId: thread.id }) });
    expect(response.status).toBe(409);
    expect((await registry.getConversation(thread.id)).participants).toHaveLength(2);
  });

  it('returns a clear 404 for an unknown thread', async () => {
    const threadId = crypto.randomUUID();
    const response = await GET(new Request(
      `http://localhost/api/threads/${threadId}/participants`,
    ), { params: Promise.resolve({ threadId }) });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Unknown conversation' });
  });

  it('rejects an addressed participant id owned by a different thread', async () => {
    const registry = getConversationStore(routeState.dataDir, 'Test host');
    const first = await registry.createConversation({ checkoutId: 'project-a', provider: 'claude' });
    const second = await registry.createConversation({ checkoutId: 'project-a', provider: 'codex' });
    const response = await POST_MESSAGE(new Request('http://localhost/api/agent/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        threadId: first.id, messageId: crypto.randomUUID(),
        participantId: second.primaryAgentId, text: 'forged address', diagramAttachments: [],
      }),
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'The addressed participant is not an agent in this conversation.' });
  });
});
