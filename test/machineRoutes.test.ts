import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const routeState = vi.hoisted(() => ({ dataDir: '' }));

vi.mock('@/server/config', () => ({
  getConfig: () => ({
    remoteAccess: 'paired',
    publicOrigin: 'https://executor.test',
    dataDir: routeState.dataDir,
    hostLabel: 'Executor laptop',
    repositoriesRoot: '/repositories',
    repositoryDiscoveryDepth: 1,
  }),
}));

import { POST as PAIR_MACHINE } from '@/app/api/machine/pair/route';
import { DELETE as DETACH_MACHINE } from '@/app/api/machine/attachment/route';
import { GET as GET_RUNS } from '@/app/api/agent/runs/route';
import { POST as POST_CANCEL } from '@/app/api/agent/cancel/route';
import { GET as GET_ARENA } from '@/app/api/arena/route';
import { MachineAuthStore } from '@/server/machines/machineAuthStore';
import { getSessionStore } from '@/server/storage/sessionStore';

const MARKER = 'machine-route-marker';
const HOME = { id: '11111111-1111-4111-8111-111111111111', label: 'Home desktop' };

function secure(pathname: string, init: RequestInit = {}, credential?: string): Request {
  const headers = new Headers(init.headers);
  headers.set('x-codeai-internal-transport', MARKER);
  if (credential) headers.set('Authorization', `Bearer ${credential}`);
  return new Request(`https://executor.test${pathname}`, { ...init, headers });
}

describe.sequential('execution machine route authorization', () => {
  beforeEach(async () => {
    routeState.dataDir = await mkdtemp(path.join(os.tmpdir(), 'codeai-machine-routes-'));
    (globalThis as typeof globalThis & { __codeaiInternalTlsMarker?: string }).__codeaiInternalTlsMarker = MARKER;
  });

  it('pairs only through the dedicated TLS listener and accepts bearer calls without browser Origin', async () => {
    const challenge = await new MachineAuthStore(routeState.dataDir).issuePairingCode();
    const insecure = await PAIR_MACHINE(new Request('http://executor.test/api/machine/pair', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: challenge.code, machine: HOME }),
    }));
    expect(insecure.status).toBe(426);

    const oversized = await PAIR_MACHINE(secure('/api/machine/pair', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'x'.repeat(4_097),
    }));
    expect(oversized.status).toBe(413);

    const paired = await PAIR_MACHINE(secure('/api/machine/pair', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: challenge.code, machine: HOME }),
    }));
    expect(paired.status).toBe(201);
    const body = await paired.json();
    const local = await getSessionStore(routeState.dataDir, 'Executor laptop').host();
    expect(body).toMatchObject({ machine: local, credential: expect.any(String), expiresAt: expect.any(String) });
    expect((await GET_RUNS(secure('/api/agent/runs', {}, body.credential))).status).toBe(200);
    expect((await GET_ARENA(secure('/api/arena', {}, body.credential))).status).toBe(401);

    const mutation = await POST_CANCEL(secure('/api/agent/cancel', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: crypto.randomUUID() }),
    }, body.credential));
    expect(mutation.status).toBe(404);

    expect((await DETACH_MACHINE(secure('/api/machine/attachment', { method: 'DELETE' }, body.credential))).status).toBe(200);
    expect((await GET_RUNS(secure('/api/agent/runs', {}, body.credential))).status).toBe(401);
  });

  it('rejects self-attachment before issuing a credential', async () => {
    const local = await getSessionStore(routeState.dataDir, 'Executor laptop').host();
    const challenge = await new MachineAuthStore(routeState.dataDir).issuePairingCode();
    const response = await PAIR_MACHINE(secure('/api/machine/pair', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: challenge.code, machine: local }),
    }));
    expect(response.status).toBe(409);
  });
});
