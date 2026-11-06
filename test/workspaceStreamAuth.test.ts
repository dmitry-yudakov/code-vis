import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ dataDir: '', released: vi.fn(), subscriptions: vi.fn() }));
vi.mock('@/server/config', () => ({ getConfig: () => ({ remoteAccess: 'paired', publicOrigin: 'https://codeai.test',
  publicOrigins: ['https://codeai.test'], dataDir: state.dataDir, hostLabel: 'Home', repositoriesRoot: '/repositories', repositoryDiscoveryDepth: 1 }) }));
vi.mock('@/server/workspace/workspaceFeed', () => ({
  workspaceFeeds: () => {
    const feed = { refresh() {}, subscribe(receive: (value: object) => void) {
      state.subscriptions(); receive({ machines: [] }); return state.released;
    } };
    return { arena: feed, executor: feed };
  }, refreshWorkspaceFeeds() {}, remoteProjection() {},
}));

import { GET as ARENA } from '@/app/api/arena/route';
import { GET as EXECUTOR } from '@/app/api/machine/snapshot/route';
import { DeviceAuthStore } from '@/server/devices/deviceAuthStore';
import { MachineAuthStore } from '@/server/machines/machineAuthStore';
import { WORKSPACE_HEARTBEAT_MS } from '@/shared/workspaceStream';

function request(pathname: string, headers: HeadersInit = {}) {
  return new Request(`https://codeai.test${pathname}`, { headers: {
    Accept: 'application/x-ndjson', 'x-codeai-internal-transport': 'stream-auth-marker', ...headers,
  } });
}

beforeEach(async () => {
  vi.useFakeTimers();
  state.dataDir = await mkdtemp(path.join(os.tmpdir(), 'codeai-stream-auth-'));
  state.released.mockClear(); state.subscriptions.mockClear();
  (globalThis as typeof globalThis & { __codeaiInternalTlsMarker?: string }).__codeaiInternalTlsMarker = 'stream-auth-marker';
});
afterEach(() => vi.useRealTimers());

describe('workspace subscription authorization', () => {
  it('rejects unpaired and insecure subscriptions before attaching a source', async () => {
    expect((await ARENA(request('/api/arena'))).status).toBe(401);
    expect((await ARENA(new Request('https://codeai.test/api/arena', { headers: { Accept: 'application/x-ndjson' } }))).status).toBe(426);
    expect((await EXECUTOR(request('/api/machine/snapshot'))).status).toBe(401);
    expect(state.subscriptions).not.toHaveBeenCalled();
  });

  it('stops a quiet browser stream when its real device credential is revoked', async () => {
    const auth = new DeviceAuthStore(state.dataDir);
    const challenge = await auth.issuePairingCode();
    const paired = await auth.pair(challenge.code, 'Browser');
    const response = await ARENA(request('/api/arena', { Cookie: `__Host-codeai-device=${paired.credential}` }));
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    expect((await reader.read()).done).toBe(false);
    await auth.revoke(paired.device.id);
    await vi.advanceTimersByTimeAsync(WORKSPACE_HEARTBEAT_MS);
    await expect(reader.read()).rejects.toThrow('no longer authorized');
    expect(state.released).toHaveBeenCalledOnce();
  });

  it('keeps machine credentials out of Arena and stops their quiet executor stream after revocation', async () => {
    const auth = new MachineAuthStore(state.dataDir);
    const challenge = await auth.issuePairingCode();
    const paired = await auth.pair(challenge.code, { id: crypto.randomUUID(), label: 'Home peer' });
    const headers = { Authorization: `Bearer ${paired.credential}` };
    expect((await ARENA(request('/api/arena', headers))).status).toBe(401);
    const response = await EXECUTOR(request('/api/machine/snapshot', headers));
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    expect((await reader.read()).done).toBe(false);
    await auth.revoke(paired.peer.connectionId);
    await vi.advanceTimersByTimeAsync(WORKSPACE_HEARTBEAT_MS);
    await expect(reader.read()).rejects.toThrow('no longer authorized');
    expect(state.released).toHaveBeenCalledOnce();
  });
});
