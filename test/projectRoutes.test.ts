import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const routeState = vi.hoisted(() => ({
  dataDir: '',
  checkouts: [
    { id: 'a', name: 'A', relativePath: 'a' },
    { id: 'b', name: 'B', relativePath: 'b' },
  ],
  validatedBatches: [] as string[][],
}));

vi.mock('@/server/config', () => ({
  getConfig: () => ({
    dataDir: routeState.dataDir,
    hostLabel: 'Route host',
    repositoriesRoot: '/repositories',
    repositoryDiscoveryDepth: 2,
  }),
}));

vi.mock('@/server/repository/checkoutRegistry', () => ({
  getCheckoutRegistry: () => ({
    list: async () => routeState.checkouts,
    resolveMany: async (ids: string[]) => {
      routeState.validatedBatches.push(ids);
      return ids.map((id) => {
        const checkout = routeState.checkouts.find((item) => item.id === id);
        if (!checkout) throw new Error('Unknown checkout');
        return { ...checkout, realPath: `/repositories/${id}` };
      });
    },
  }),
}));

import { GET, POST } from '@/app/api/projects/route';
import { DELETE, PATCH } from '@/app/api/projects/[projectId]/route';
import { GET as GET_CHECKOUTS } from '@/app/api/checkouts/route';
import { getSessionStore } from '@/server/storage/sessionStore';

function context(projectId: string) {
  return { params: Promise.resolve({ projectId }) };
}

describe('project and checkout routes', () => {
  beforeEach(async () => {
    routeState.dataDir = await mkdtemp(path.join(os.tmpdir(), 'codeai-project-routes-'));
    routeState.validatedBatches = [];
  });

  it('creates, lists, renames, and deletes projects while leaving their sessions loose', async () => {
    const createdResponse = await POST(new Request('http://localhost/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Body of work', checkoutIds: ['a', 'b'] }),
    }));
    expect(createdResponse.status).toBe(201);
    let project = (await createdResponse.json()).project;
    expect(project).toMatchObject({ version: 1, revision: 0, name: 'Body of work' });
    expect(project.repositories.map((item: { checkoutId: string }) => item.checkoutId)).toEqual(['a', 'b']);
    expect(routeState.validatedBatches).toEqual([['a', 'b']]);
    expect((await (await GET()).json()).projects).toEqual([project]);

    const store = getSessionStore(routeState.dataDir, 'Route host');
    const session = await store.createSession({ projectId: project.id, provider: 'claude' });
    const renamedResponse = await PATCH(new Request('http://localhost', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedRevision: project.revision, name: 'Renamed' }),
    }), context(project.id));
    project = (await renamedResponse.json()).project;
    expect(project).toMatchObject({ revision: 1, name: 'Renamed' });

    const stale = await PATCH(new Request('http://localhost', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 0, name: 'Stale' }),
    }), context(project.id));
    expect(stale.status).toBe(409);

    const deleted = await DELETE(new Request('http://localhost', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedRevision: project.revision }),
    }), context(project.id));
    expect(await deleted.json()).toEqual({ detachedSessionCount: 1 });
    expect((await store.getSession(session.id)).projectId).toBeUndefined();
    expect((await (await GET()).json()).projects).toEqual([]);
  });

  it('returns checkout discovery separately with host-local recency', async () => {
    const store = getSessionStore(routeState.dataDir, 'Route host');
    const project = await store.createProject('Work', ['b']);
    await store.createSession({ projectId: project.id, provider: 'claude' });
    const response = await GET_CHECKOUTS();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      checkouts: routeState.checkouts,
      recentCheckoutIds: ['b'],
      discoveryDepth: 2,
      hostId: expect.any(String),
    });
  });
});
