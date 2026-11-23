import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/activity/route';
import { DEVICE_COOKIE_NAME } from '@/server/devices/deviceAuthorization';
import { DeviceAuthStore } from '@/server/devices/deviceAuthStore';
import { MachineAuthStore } from '@/server/machines/machineAuthStore';
import { readActivity, recordActivity } from '@/server/storage/activityLog';
import { machineOperationAllowed } from '@/server/machines/machineRoutePolicy';
import { webActivityActor } from '@/shared/activityLog';

let root: string;
let current: string;
const web = (sessionId = crypto.randomUUID()) => ({ actor: webActivityActor, action: 'session.create' as const, sessionId });
const mcp = { actor: { source: 'mcp' as const, id: crypto.randomUUID(), label: 'External observer' },
  action: 'mcp.call' as const, operation: 'read_session' as const, outcome: 'succeeded' as const, status: 200 };
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'codeai-activity-'));
  current = path.join(root, 'activity.ndjson');
  vi.stubEnv('CODEAI_DATA_DIR', root);
  vi.stubEnv('CODEAI_REMOTE_ACCESS', 'local');
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

it('pages saved activity newest first, while new writes leave a cursor in place', async () => {
  expect(await readActivity(root)).toEqual({ entries: [], nextCursor: null, incomplete: false });
  const inputs = Array.from({ length: 51 }, () => web());
  await Promise.all(inputs.map(entry => recordActivity(root, entry)));
  await recordActivity(root, mcp);
  const first = (await readActivity(root, 'web'))!;
  expect(first.entries.map(entry => entry.sessionId)).toEqual(inputs.slice(1).reverse().map(entry => entry.sessionId));
  expect(first.nextCursor).toBeTruthy();
  await recordActivity(root, web());
  expect((await readActivity(root, 'web', first.nextCursor!))?.entries).toEqual([expect.objectContaining(inputs[0])]);
  expect((await readActivity(root, 'mcp'))?.entries).toEqual([expect.objectContaining(mcp)]);
  expect((await stat(current)).mode & 0o077).toBe(0);
});

it('rotates both private segments and expires cursors only after their segment is dropped', async () => {
  const segmentSize = 1024 * 1024;
  const fill = async () => {
    const retained = await readFile(current);
    await writeFile(current, Buffer.concat([retained, Buffer.alloc(segmentSize - retained.length, 0x0a)]));
  };
  await recordActivity(root, web());
  const before = (await readActivity(root))!.entries[0].id;
  await fill();
  await recordActivity(root, mcp);
  expect((await readActivity(root))?.entries).toHaveLength(2);
  expect(await readActivity(root, undefined, before)).toMatchObject({ entries: [], nextCursor: null });
  await fill();
  const newest = web();
  await recordActivity(root, newest);
  expect(await readActivity(root, undefined, before)).toBeUndefined();
  expect((await readActivity(root))?.entries).toEqual([expect.objectContaining(newest), expect.objectContaining(mcp)]);
  const stats = await Promise.all([stat(current), stat(path.join(root, 'activity.previous.ndjson'))]);
  expect(stats.reduce((bytes, item) => bytes + item.size, 0)).toBeLessThanOrEqual(2 * segmentSize);
});

it('reports an interrupted line or storage failure and resumes saving without poisoning writes', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  await writeFile(current, '\n{"interrupted":');
  await recordActivity(root, mcp);
  expect(await readActivity(root)).toMatchObject({ entries: [expect.objectContaining(mcp)], incomplete: true });
  const backup = `${current}.saved`;
  await rename(current, backup);
  await mkdir(current);
  await expect(recordActivity(root, web())).resolves.toBeUndefined();
  expect(warn).toHaveBeenCalledTimes(1);
  await rm(current, { recursive: true });
  await rename(backup, current);
  await recordActivity(root, web());
  expect(await readActivity(root)).toMatchObject({ entries: [expect.objectContaining({ action: 'session.create' }),
    expect.objectContaining(mcp)], incomplete: true });
});

it('bounds pending log writes and makes overload visible', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  await Promise.all(Array.from({ length: 129 }, () => recordActivity(root, web())));
  const lines = (await readFile(current, 'utf8')).split('\n').filter(Boolean);
  expect(lines).toHaveLength(128);
  expect((await readActivity(root))?.incomplete).toBe(true);
  expect(warn).toHaveBeenCalledTimes(1);
  await recordActivity(root, mcp);
  expect((await readActivity(root, 'mcp'))?.entries).toEqual([expect.objectContaining(mcp)]);
});

it('requires a personal device over paired transport and returns an uncached filtered page', async () => {
  await recordActivity(root, mcp);
  vi.stubEnv('CODEAI_REMOTE_ACCESS', 'paired');
  vi.stubEnv('CODEAI_PUBLIC_ORIGIN', 'https://codeai.test');
  vi.stubEnv('CODEAI_ADDITIONAL_ORIGINS', '');
  const marker = '__codeaiInternalTlsMarker';
  vi.stubGlobal(marker, 'activity-test-tls');
  try {
    const devices = new DeviceAuthStore(root);
    const challenge = await devices.issuePairingCode();
    const { credential } = await devices.pair(challenge.code, 'Desk');
    const headers = { 'x-codeai-internal-transport': 'activity-test-tls', host: 'codeai.test' };
    const peers = new MachineAuthStore(root);
    const peer = await peers.issuePairingCode();
    const paired = await peers.pair(peer.code, { id: crypto.randomUUID(), label: 'Peer' });
    const request = 'https://codeai.test/api/activity?source=mcp';
    expect((await GET(new Request(request))).status).toBe(426);
    expect((await GET(new Request(request, { headers: { ...headers, Authorization: `Bearer ${paired.credential}` } }))).status).toBe(401);
    const response = await GET(new Request(request, { headers: { ...headers, cookie: `${DEVICE_COOKIE_NAME}=${credential}` } }));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ entries: [expect.objectContaining(mcp)] });
    expect(machineOperationAllowed('GET', ['activity'])).toBe(false);
  } finally { vi.unstubAllGlobals(); }
});
