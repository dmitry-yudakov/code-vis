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
      if (checkoutId !== 'checkout-a') throw new Error('Unknown checkout');
      return { id: checkoutId, name: 'Repository', relativePath: '.', realPath: '/repositories/checkout-a' };
    },
  }),
}));

vi.mock('@/server/agents/providerRegistry', () => ({
  getProviderAdapters: () => ({
    claude: { checkHealth: async () => routeState.health },
    codex: { checkHealth: async () => routeState.health },
  }),
}));

import { GET, POST } from '@/app/api/sessions/[sessionId]/participants/route';
import { POST as POST_MESSAGE } from '@/app/api/agent/message/route';
import { POST as POST_SESSION } from '@/app/api/sessions/route';
import { getSessionStore } from '@/server/storage/sessionStore';

describe('participant routes', () => {
  beforeEach(async () => {
    routeState.dataDir = await mkdtemp(path.join(os.tmpdir(), 'codeai-participant-route-'));
    routeState.health = { available: true, authenticated: true, supportedModes: ['ask', 'plan', 'agent'] };
  });

  it('returns a session-free roster and reconciles an idempotent participant retry', async () => {
    const registry = getSessionStore(routeState.dataDir, 'Test host');
    const session = await registry.createSession({ provider: 'claude' });
    const context = { params: Promise.resolve({ sessionId: session.id }) };
    const rosterResponse = await GET(new Request(
      `http://localhost/api/sessions/${session.id}/participants`,
    ), context);
    expect(rosterResponse.status).toBe(200);
    const roster = await rosterResponse.json();
    expect(roster.session.participants.some((participant: Record<string, unknown>) => 'session' in participant)).toBe(false);
    expect(JSON.stringify(roster)).not.toMatch(/lastObserved|creationRequest/i);

    const requestId = crypto.randomUUID();
    const add = () => POST(new Request(`http://localhost/api/sessions/${session.id}/participants`, {
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
    expect(firstBody.session.participants).toHaveLength(3);
    expect(firstBody.session.participants.some((participant: Record<string, unknown>) => 'session' in participant)).toBe(false);
    expect(JSON.stringify(firstBody)).not.toMatch(/lastObserved|creationRequest/i);
  });

  it('passes a non-default role through session creation', async () => {
    const response = await POST_SESSION(new Request('http://localhost/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'claude', role: 'reviewer' }),
    }));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.session.participants).toContainEqual(expect.objectContaining({
      id: body.session.primaryAgentId, role: 'reviewer', defaultMode: 'ask',
    }));
  });

  it('returns 409 before creating a participant when its provider is unhealthy', async () => {
    const registry = getSessionStore(routeState.dataDir, 'Test host');
    const session = await registry.createSession({ provider: 'claude' });
    routeState.health = { available: false, authenticated: true, supportedModes: [] };
    const response = await POST(new Request(`http://localhost/api/sessions/${session.id}/participants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'codex', role: 'reviewer', requestId: crypto.randomUUID(),
      }),
    }), { params: Promise.resolve({ sessionId: session.id }) });
    expect(response.status).toBe(409);
    expect((await registry.getSession(session.id)).participants).toHaveLength(2);
  });

  it('returns a clear 404 for an unknown session', async () => {
    const sessionId = crypto.randomUUID();
    const response = await GET(new Request(
      `http://localhost/api/sessions/${sessionId}/participants`,
    ), { params: Promise.resolve({ sessionId }) });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Unknown session' });
  });

  it('rejects an addressed participant id owned by a different session', async () => {
    const registry = getSessionStore(routeState.dataDir, 'Test host');
    const first = await registry.createSession({ provider: 'claude' });
    const second = await registry.createSession({ provider: 'codex' });
    const response = await POST_MESSAGE(new Request('http://localhost/api/agent/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: first.id, messageId: crypto.randomUUID(),
        participantId: second.primaryAgentId, text: 'forged address', diagramAttachments: [],
      }),
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'The addressed participant is not an agent in this session.' });
  });
});
