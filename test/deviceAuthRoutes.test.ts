import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const routeState = vi.hoisted(() => ({ dataDir: '' }));

vi.mock('@/server/config', () => ({
  getConfig: () => ({
    remoteAccess: 'paired',
    publicOrigin: 'https://codeai.test',
    dataDir: routeState.dataDir,
    hostLabel: 'Home desktop',
    repositoriesRoot: '/repositories',
    repositoryDiscoveryDepth: 1,
  }),
}));

import { GET as GET_STATUS } from '@/app/api/auth/status/route';
import { POST as POST_PAIR } from '@/app/api/auth/pair/route';
import { DELETE as DELETE_DEVICE, GET as GET_DEVICES } from '@/app/api/auth/devices/route';
import { GET as GET_SESSIONS } from '@/app/api/sessions/route';
import { GET as GET_REPOSITORY } from '@/app/api/repository/status/route';
import { GET as GET_RUNS } from '@/app/api/agent/runs/route';
import { POST as POST_MESSAGE } from '@/app/api/agent/message/route';
import { POST as POST_CANCEL } from '@/app/api/agent/cancel/route';
import { POST as POST_PERMISSION } from '@/app/api/agent/permission/route';
import { DeviceAuthStore } from '@/server/devices/deviceAuthStore';

const MARKER = 'test-tls-marker';

function request(pathname: string, init: RequestInit = {}, credential?: string): Request {
  const headers = new Headers(init.headers);
  headers.set('x-codeai-internal-transport', MARKER);
  if (init.method && !/^(GET|HEAD)$/i.test(init.method)) headers.set('Origin', 'https://codeai.test');
  if (credential) headers.set('Cookie', `__Host-codeai-device=${credential}`);
  return new Request(`https://codeai.test${pathname}`, { ...init, headers });
}

function credentialFrom(response: Response): string {
  const cookie = response.headers.get('set-cookie') || '';
  expect(cookie).toContain('HttpOnly');
  expect(cookie).toContain('Secure');
  expect(cookie).toContain('SameSite=Strict');
  expect(cookie).not.toContain('Domain=');
  return cookie.match(/__Host-codeai-device=([^;]+)/)![1];
}

async function pair(label = 'Test tablet'): Promise<{ credential: string; code: string }> {
  const challenge = await new DeviceAuthStore(routeState.dataDir).issuePairingCode();
  const response = await POST_PAIR(request('/api/auth/pair', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label, code: challenge.code }),
  }));
  expect(response.status).toBe(201);
  return { credential: credentialFrom(response), code: challenge.code };
}

describe.sequential('paired device route boundary', () => {
  beforeEach(async () => {
    routeState.dataDir = await mkdtemp(path.join(os.tmpdir(), 'codeai-device-routes-'));
    (globalThis as typeof globalThis & { __codeaiInternalTlsMarker?: string })
      .__codeaiInternalTlsMarker = MARKER;
  });

  it('exposes only bounded bootstrap status and requires the dedicated secure origin', async () => {
    const insecure = await GET_STATUS(new Request('http://codeai.test/api/auth/status'));
    expect(await insecure.json()).toEqual({
      mode: 'paired', authenticated: false, transportSecure: false, hostLabel: 'Home desktop',
    });
    expect((await GET_SESSIONS(new Request('http://codeai.test/api/sessions'))).status).toBe(426);
    const wrongHost = new Request('https://other.test/api/sessions', {
      headers: { 'x-codeai-internal-transport': MARKER },
    });
    expect((await GET_SESSIONS(wrongHost)).status).toBe(426);

    const unpaired = await GET_STATUS(request('/api/auth/status'));
    expect(await unpaired.json()).toEqual({
      mode: 'paired', authenticated: false, transportSecure: true, hostLabel: 'Home desktop',
    });
  });

  it('rejects every sensitive read and action class before parsing or domain work', async () => {
    expect((await GET_SESSIONS(request('/api/sessions'))).status).toBe(401);
    expect((await GET_REPOSITORY(request('/api/repository/status'))).status).toBe(401);
    expect((await GET_RUNS(request('/api/agent/runs'))).status).toBe(401);
    expect((await POST_MESSAGE(request('/api/agent/message', { method: 'POST' }))).status).toBe(401);
    expect((await POST_CANCEL(request('/api/agent/cancel', { method: 'POST' }))).status).toBe(401);
    expect((await POST_PERMISSION(request('/api/agent/permission', { method: 'POST' }))).status).toBe(401);
  });

  it('pairs once, authenticates without exposing secrets, and rejects cross-origin actions', async () => {
    const paired = await pair();
    const replay = await POST_PAIR(request('/api/auth/pair', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'Replay', code: paired.code }),
    }));
    expect(replay.status).toBe(401);

    const status = await GET_STATUS(request('/api/auth/status', {}, paired.credential));
    expect(await status.json()).toMatchObject({
      mode: 'paired', authenticated: true, transportSecure: true,
      device: { label: 'Test tablet' },
    });
    expect((await GET_RUNS(request('/api/agent/runs', {}, paired.credential))).status).toBe(200);

    const wrongOrigin = request('/api/agent/cancel', { method: 'POST' }, paired.credential);
    wrongOrigin.headers.set('Origin', 'https://attacker.test');
    expect((await POST_CANCEL(wrongOrigin)).status).toBe(403);

    const devices = await GET_DEVICES(request('/api/auth/devices', {}, paired.credential));
    const body = await devices.json();
    expect(body.devices).toEqual([expect.objectContaining({ label: 'Test tablet', current: true })]);
    expect(JSON.stringify(body)).not.toMatch(/digest|salt|credential|pairingChallenge/i);
    const persisted = await readFile(path.join(routeState.dataDir, 'device-auth-v1.json'), 'utf8');
    expect(persisted).not.toContain(paired.credential);
  });

  it('revokes another device and self-signs out with immediate server-side effect', async () => {
    const first = await pair('Laptop');
    const second = await pair('Headset');
    const list = await (await GET_DEVICES(request('/api/auth/devices', {}, first.credential))).json();
    const headset = list.devices.find((device: { label: string }) => device.label === 'Headset');

    const revoked = await DELETE_DEVICE(request('/api/auth/devices', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: headset.id }),
    }, first.credential));
    expect(await revoked.json()).toEqual({ ok: true, signedOut: false });
    expect((await GET_RUNS(request('/api/agent/runs', {}, second.credential))).status).toBe(401);

    const selfId = (await (await GET_STATUS(request('/api/auth/status', {}, first.credential))).json()).device.id;
    const signedOut = await DELETE_DEVICE(request('/api/auth/devices', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: selfId }),
    }, first.credential));
    expect((await signedOut.json()).signedOut).toBe(true);
    expect(signedOut.headers.get('set-cookie')).toContain('Max-Age=0');
    expect((await GET_RUNS(request('/api/agent/runs', {}, first.credential))).status).toBe(401);
  });
});
