import { mkdtemp, readFile, readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/immersive/report/route';
import { getDeviceAuthStore } from '@/server/devices/deviceAuthStore';
import { MAX_IMMERSIVE_REPORT_BYTES, MAX_RETAINED_IMMERSIVE_REPORTS, type ImmersiveReport } from '@/shared/immersiveReport';

let credential: string;
let dataDir: string;
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0xff, 0xd9]);

function report(overrides: Partial<ImmersiveReport> = {}): ImmersiveReport {
  return {
    version: 1, kind: 'capture', at: '2026-09-19T10:20:30.000Z', browser: 'Quest Browser',
    view: 'home:project:session', availability: 'active', note: 'Reported from the workspace',
    errors: [], diagnostics: { version: 1, browser: 'Quest Browser', events: [{ event: 'page-ready', pageStartedAt: 12 }] },
    ...overrides,
  };
}

function request(body: unknown, signal?: AbortSignal) {
  return new Request('https://codeai.test/api/immersive/report', {
    method: 'POST', signal,
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: {
      Origin: 'https://codeai.test', 'x-codeai-internal-transport': 'report-test',
      Cookie: `__Host-codeai-device=${credential}`, 'Content-Type': 'application/json',
    },
  });
}

describe.sequential('paired home immersive report route', () => {
  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'codeai-report-'));
    vi.stubEnv('CODEAI_REMOTE_ACCESS', 'paired'); vi.stubEnv('CODEAI_PUBLIC_ORIGIN', 'https://codeai.test');
    vi.stubEnv('CODEAI_DATA_DIR', dataDir);
    (globalThis as typeof globalThis & { __codeaiInternalTlsMarker?: string }).__codeaiInternalTlsMarker = 'report-test';
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const store = getDeviceAuthStore(dataDir);
    const challenge = await store.issuePairingCode();
    credential = (await store.pair(challenge.code, 'Headset')).credential;
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('stores an authorized capture as readable evidence beside the session store', async () => {
    const response = await POST(request(report({ screenshot: jpeg.toString('base64') })));
    expect(response.status).toBe(200);
    // Named by arrival on this machine; the headset's own clock stays inside the report.
    const { name } = await response.json();
    expect(name).toMatch(/^\d{4}-\d{2}-\d{2}T[\d-]+\.\d{3}Z-capture$/);
    const directory = path.join(dataDir, 'diagnostics');
    expect((await readdir(directory)).sort()).toEqual([`${name}.jpg`, `${name}.json`]);
    const stored = JSON.parse(await readFile(path.join(directory, `${name}.json`), 'utf8'));
    expect(stored).toMatchObject({
      kind: 'capture', view: 'home:project:session', browser: 'Quest Browser', at: '2026-09-19T10:20:30.000Z',
    });
    // The image travels beside the report rather than inflating it.
    expect(stored.screenshot).toBeUndefined();
    expect(await readFile(path.join(directory, `${name}.jpg`))).toEqual(jpeg);
    for (const file of await readdir(directory)) {
      expect((await stat(path.join(directory, file))).mode & 0o777).toBe(0o600);
    }
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('[vr-report]'));
  });

  it('keeps the error message that device storage deliberately omits', async () => {
    const errors = [{ at: '2026-09-19T10:20:31.000Z', kind: 'window-error', message: 'TypeError: panel is undefined', stack: 'at panel' }];
    const response = await POST(request(report({ kind: 'error', at: '2026-09-19T10:20:31.000Z', errors })));
    expect(response.status).toBe(200);
    const { name } = await response.json();
    expect(name).toContain('-error');
    const stored = JSON.parse(await readFile(path.join(dataDir, 'diagnostics', `${name}.json`), 'utf8'));
    expect(stored.errors[0]).toMatchObject({ message: 'TypeError: panel is undefined', stack: 'at panel' });
  });

  it('refuses an unpaired device, a malformed payload, an oversized body, and a screenshot that is not a JPEG', async () => {
    const unpaired = request(report()); unpaired.headers.delete('Cookie');
    expect((await POST(unpaired)).status).toBe(401);
    const foreign = request(report()); foreign.headers.set('Origin', 'https://other.test');
    expect((await POST(foreign)).status).toBe(403);
    expect((await POST(request('{'))).status).toBe(400);
    expect((await POST(request({ ...report(), version: 2 }))).status).toBe(400);
    expect((await POST(request(report({ screenshot: Buffer.from('not a jpeg').toString('base64') })))).status).toBe(400);
    const oversized = request(report({ note: 'x'.repeat(10) }));
    oversized.headers.set('content-length', String(MAX_IMMERSIVE_REPORT_BYTES + 1));
    expect((await POST(oversized)).status).toBe(413);
    expect(await readdir(path.join(dataDir, 'diagnostics')).catch(() => [])).toEqual([]);
  });

  it('prunes to the newest reports, by arrival, so a long run cannot fill the disk', async () => {
    const names: string[] = [];
    for (let index = 0; index < MAX_RETAINED_IMMERSIVE_REPORTS + 3; index++) {
      // A drifting headset clock counts backwards; pruning must still keep what arrived last.
      const at = new Date(Date.UTC(2026, 8, 19, 10, 0, 60 - index)).toISOString();
      const response = await POST(request(report({ at, screenshot: jpeg.toString('base64') })));
      expect(response.status).toBe(200);
      names.push((await response.json()).name);
    }
    const files = await readdir(path.join(dataDir, 'diagnostics'));
    expect(files.filter((file) => file.endsWith('.json'))).toHaveLength(MAX_RETAINED_IMMERSIVE_REPORTS);
    expect(files.filter((file) => file.endsWith('.jpg'))).toHaveLength(MAX_RETAINED_IMMERSIVE_REPORTS);
    expect(files).not.toContain(`${names[0]}.json`);
    expect(files).not.toContain(`${names[0]}.jpg`);
    expect(files).toContain(`${names.at(-1)}.json`);
  });
});
