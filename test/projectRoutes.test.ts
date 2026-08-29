import { beforeEach, describe, expect, it, vi } from 'vitest';

const routeState = vi.hoisted(() => ({
  projects: [
    { id: 'a', name: 'A', relativePath: 'a' },
    { id: 'b', name: 'B', relativePath: 'b' },
    { id: 'c', name: 'C', relativePath: 'c' },
  ],
  sessions: [] as Array<{
    attachments: Array<{ id: string; hostId: string; checkoutId: string; role: 'primary' | 'reference' }>;
    updatedAt: string;
  }>,
}));

vi.mock('@/server/config', () => ({
  getConfig: () => ({
    dataDir: '/data',
    hostLabel: 'Route host',
    projectsRoot: '/projects',
    projectDiscoveryDepth: 2,
  }),
}));

vi.mock('@/server/projects/projectRegistry', () => ({
  getProjectRegistry: () => ({ list: async () => routeState.projects }),
}));

vi.mock('@/server/storage/sessionStore', () => ({
  getSessionStore: () => ({
    host: async () => ({ id: '11111111-1111-4111-8111-111111111111', label: 'Route host' }),
    listSessions: async () => routeState.sessions,
  }),
}));

import { GET } from '@/app/api/projects/route';

describe('projects route', () => {
  beforeEach(() => {
    routeState.sessions = [
      {
        attachments: [{
          id: 'attachment-b',
          hostId: '11111111-1111-4111-8111-111111111111',
          checkoutId: 'b',
          role: 'primary',
        }],
        updatedAt: '2026-08-28T10:00:00.000Z',
      },
      {
        attachments: [{
          id: 'attachment-a',
          hostId: '11111111-1111-4111-8111-111111111111',
          checkoutId: 'a',
          role: 'primary',
        }],
        updatedAt: '2026-08-28T11:00:00.000Z',
      },
    ];
  });

  it('returns discovered projects with session-derived recency', async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      projects: routeState.projects,
      recentProjectIds: ['a', 'b'],
      discoveryDepth: 2,
    });
  });
});
