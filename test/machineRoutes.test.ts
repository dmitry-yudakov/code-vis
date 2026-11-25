import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const routeState = vi.hoisted(() => ({ dataDir: '', additionalOrigins: [] as string[] }));

vi.mock('@/server/config', () => ({
  getConfig: () => ({
    remoteAccess: 'paired',
    publicOrigin: 'https://executor.test',
    publicOrigins: ['https://executor.test', ...routeState.additionalOrigins],
    dataDir: routeState.dataDir,
    hostLabel: 'Executor laptop',
    repositoriesRoot: routeState.dataDir,
    repositoryDiscoveryDepth: 1,
  }),
}));

vi.mock('@/server/agents/providerRegistry', () => ({
  cachedLocalProviderHealth: async () => {
    const health = { available: false, authenticated: 'unknown', supportedModes: [] };
    return { claude: health, codex: health };
  },
}));

import { POST as PAIR_MACHINE } from '@/app/api/machine/pair/route';
import { DELETE as DETACH_MACHINE } from '@/app/api/machine/attachment/route';
import { GET as GET_SNAPSHOT } from '@/app/api/machine/snapshot/route';
import { GET as GET_RUNS } from '@/app/api/agent/runs/route';
import { POST as POST_CANCEL } from '@/app/api/agent/cancel/route';
import { POST as POST_RUN_NOW } from '@/app/api/agent/run-now/route';
import { GET as GET_ARENA } from '@/app/api/arena/route';
import { MachineAuthStore } from '@/server/machines/machineAuthStore';
import { getSessionStore } from '@/server/storage/sessionStore';
import { runRegistry } from '@/server/runs/runRegistry';
import { RUN_NOW_CAPABILITY_HEADER, WORKSPACE_STREAM_TYPE } from '@/shared/workspaceStream';

const MARKER = 'machine-route-marker';
const HOME = { id: '11111111-1111-4111-8111-111111111111', label: 'Home desktop' };

function secure(pathname: string, init: RequestInit = {}, credential?: string, origin = 'https://executor.test'): Request {
  const headers = new Headers(init.headers);
  headers.set('x-codeai-internal-transport', MARKER);
  if (credential) headers.set('Authorization', `Bearer ${credential}`);
  return new Request(`${origin}${pathname}`, { ...init, headers });
}

describe.sequential('execution machine route authorization', () => {
  beforeEach(async () => {
    routeState.additionalOrigins = [];
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

  it('advertises Run now to compatible homes and accepts the action from the paired home', async () => {
    const challenge = await new MachineAuthStore(routeState.dataDir).issuePairingCode();
    const paired = await PAIR_MACHINE(secure('/api/machine/pair', {
      method: 'POST', body: JSON.stringify({ code: challenge.code, machine: HOME }),
    }));
    expect(paired.status).toBe(201);
    const { credential } = await paired.json();
    const runId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const execute = vi.fn(async () => undefined);
    expect(runRegistry.reserve({ runId, sessionId, participantId: crypto.randomUUID(), providerKey: runId, checkoutId: 'repo',
      access: 'read', mode: 'ask', waitForCheckout: true, blockedBySessions: ['earlier'], cancel: vi.fn() })).toMatchObject({ accepted: true });
    runRegistry.activate(runId, { execute, cancelQueued: async () => undefined, saveRunNow: async () => undefined });
    try {
      const legacy = await GET_SNAPSHOT(secure('/api/machine/snapshot', {}, credential));
      const legacySnapshot = await legacy.json();
      expect(legacy.status, JSON.stringify(legacySnapshot)).toBe(200);
      expect(legacySnapshot.runs.active.find((run: { runId: string }) => run.runId === runId)).not.toHaveProperty('canRunNow');
      const supported = await GET_SNAPSHOT(secure('/api/machine/snapshot', {
        headers: { Accept: WORKSPACE_STREAM_TYPE, [RUN_NOW_CAPABILITY_HEADER]: 'true' },
      }, credential));
      expect(supported.status).toBe(200);
      const reader = supported.body!.getReader();
      try {
        const first = JSON.parse(new TextDecoder().decode((await reader.read()).value).trim());
        expect(first.snapshot.runs.active).toContainEqual(expect.objectContaining({ runId, canRunNow: true }));
      } finally { await reader.cancel(); }
      const send = (auth?: string) => POST_RUN_NOW(secure('/api/agent/run-now', {
        method: 'POST', body: JSON.stringify({ runId }),
      }, auth));
      expect((await send()).status).toBe(403);
      expect(execute).not.toHaveBeenCalled();
      expect(await (await send(credential)).json()).toEqual({ ok: true, queued: false });
      expect(execute).toHaveBeenCalledOnce();
    } finally {
      runRegistry.finish(runId, false);
    }
  });

  it('pairs and authorizes a machine through an additional address without browser Origin', async () => {
    const origin = 'https://100.64.0.10';
    routeState.additionalOrigins = [origin];
    const challenge = await new MachineAuthStore(routeState.dataDir).issuePairingCode();
    const paired = await PAIR_MACHINE(secure('/api/machine/pair', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: challenge.code, machine: HOME }),
    }, undefined, origin));
    expect(paired.status).toBe(201);
    const { credential } = await paired.json();
    expect((await GET_RUNS(secure('/api/agent/runs', {}, credential, origin))).status).toBe(200);
    expect((await GET_ARENA(secure('/api/arena', {}, credential, origin))).status).toBe(401);
    expect((await DETACH_MACHINE(secure('/api/machine/attachment', { method: 'DELETE' }, credential, origin))).status).toBe(200);
    expect((await GET_RUNS(secure('/api/agent/runs', {}, credential, origin))).status).toBe(401);
  });
});
