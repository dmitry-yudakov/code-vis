import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecutorSnapshot } from '@/shared/types';

const LOCAL_ID = '11111111-1111-4111-8111-111111111111';
const REMOTE_ID = '22222222-2222-4222-8222-222222222222';
const CREDENTIAL = `33333333-3333-4333-8333-333333333333.${'a'.repeat(43)}`;

function executor(id: string, label: string): ExecutorSnapshot {
  return {
    machine: { id, label }, projects: [], checkouts: [], recentCheckoutIds: [],
    providers: {
      claude: { available: true, authenticated: true, supportedModes: ['ask'] },
      codex: { available: false, authenticated: 'unknown', supportedModes: [] },
    },
    sessions: [], archivedSessions: [], runs: { active: [], recent: [] },
  };
}

const arenaState = vi.hoisted(() => ({
  failRemote: false,
  observed: [] as string[],
  local: {} as ExecutorSnapshot,
  remote: {} as ExecutorSnapshot,
  connection: {} as Record<string, unknown>,
}));

vi.mock('@/server/devices/deviceAuthorization', () => ({ authorizePersonalDeviceRequest: async () => undefined }));
vi.mock('@/server/config', () => ({ getConfig: () => ({ dataDir: '/arena-data' }) }));
vi.mock('@/server/machines/localExecutorSnapshot', () => ({ localExecutorSnapshot: async () => arenaState.local }));
vi.mock('@/server/machines/machineClient', () => ({
  fetchExecutorSnapshot: async () => {
    if (arenaState.failRemote) throw new Error('asleep');
    return arenaState.remote;
  },
}));
vi.mock('@/server/machines/machineRegistry', () => ({
  getMachineRegistry: () => ({
    list: async () => [arenaState.connection],
    observe: async (id: string) => { arenaState.observed.push(id); },
  }),
}));

import { GET as GET_ARENA } from '@/app/api/arena/route';

describe('multi-machine Arena snapshot', () => {
  beforeEach(() => {
    arenaState.failRemote = false;
    arenaState.observed = [];
    arenaState.local = executor(LOCAL_ID, 'Desktop');
    arenaState.remote = executor(REMOTE_ID, 'Laptop');
    arenaState.connection = {
      machine: { id: REMOTE_ID, label: 'Laptop' },
      origin: 'https://laptop.test', credential: CREDENTIAL,
      expiresAt: '2099-01-01T00:00:00.000Z', attachedAt: '2026-09-04T09:00:00.000Z',
      lastSeenAt: '2026-09-04T10:00:00.000Z', cachedSnapshot: arenaState.remote,
    };
  });

  it('lists local and reachable executors and records a successful observation', async () => {
    const response = await GET_ARENA();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.machines.map((entry: { machine: { id: string; kind: string; state: string } }) => entry.machine))
      .toEqual([
        expect.objectContaining({ id: LOCAL_ID, kind: 'local', state: 'online' }),
        expect.objectContaining({ id: REMOTE_ID, kind: 'remote', state: 'online' }),
      ]);
    expect(arenaState.observed).toEqual([REMOTE_ID]);
  });

  it('keeps the last cached cards but removes live runs and actions while offline', async () => {
    arenaState.failRemote = true;
    arenaState.remote.sessions = [{
      id: '44444444-4444-4444-8444-444444444444', revision: 0, title: 'Cached work',
      repositoryCheckoutIds: [], agents: [], updatedAt: '2026-09-04T10:00:00.000Z',
    }];
    arenaState.remote.runs.active = [{
      runId: '55555555-5555-4555-8555-555555555555',
      sessionId: '44444444-4444-4444-8444-444444444444',
      participantId: 'agent', state: 'running', enqueuedAt: 1,
      pendingPermissionCount: 0, pendingPermissions: [],
    }];
    arenaState.connection.cachedSnapshot = arenaState.remote;
    const body = await (await GET_ARENA()).json();
    const remote = body.machines[1];
    expect(remote.machine).toMatchObject({ id: REMOTE_ID, state: 'offline', lastSeenAt: '2026-09-04T10:00:00.000Z' });
    expect(remote.sessions).toEqual([expect.objectContaining({ title: 'Cached work' })]);
    expect(remote.runs).toEqual({ active: [], recent: [] });
    expect(remote.providers.claude).toMatchObject({ available: false, supportedModes: [] });
  });
});
