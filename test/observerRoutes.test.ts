import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/observer/route';
import { getDeviceAuthStore } from '@/server/devices/deviceAuthStore';
import { machineOperationAllowed } from '@/server/machines/machineRoutePolicy';

const mocks = vi.hoisted(() => ({ ask: vi.fn() }));
vi.mock('@/server/observer/observerService', async importOriginal => ({ ...(await importOriginal<object>()), askObserver: mocks.ask }));
let dataDir: string, credential: string, deviceId: string;
function request(data: unknown = { provider: 'claude', text: 'What needs me?' }) {
  return new Request('https://codeai.test/api/observer', { method: 'POST', body: JSON.stringify(data),
    headers: { Origin: 'https://codeai.test', 'x-codeai-internal-transport': 'observer-test', Cookie: `__Host-codeai-device=${credential}` } });
}
describe('Observer personal-device route', () => {
  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'observer-route-'));
    vi.stubEnv('CODEAI_REMOTE_ACCESS', 'paired'); vi.stubEnv('CODEAI_PUBLIC_ORIGIN', 'https://codeai.test');
    vi.stubEnv('CODEAI_ADDITIONAL_ORIGINS', ''); vi.stubEnv('CODEAI_WEB2_ADDITIONAL_ORIGINS', ''); vi.stubEnv('CODEAI_DATA_DIR', dataDir);
    (globalThis as typeof globalThis & { __codeaiInternalTlsMarker?: string }).__codeaiInternalTlsMarker = 'observer-test';
    const store = getDeviceAuthStore(dataDir); const challenge = await store.issuePairingCode();
    const paired = await store.pair(challenge.code, 'Phone'); credential = paired.credential; deviceId = paired.device.id;
    mocks.ask.mockResolvedValue({ answer: 'Ready', mentions: [], total: 0, included: 0, observedAt: new Date().toISOString() });
  });
  afterEach(async () => { vi.clearAllMocks(); vi.unstubAllEnvs(); await rm(dataDir, { recursive: true, force: true }); });
  it('requires a paired device, exact origin and secure transport and excludes machine peers', async () => {
    const missing = request(); missing.headers.delete('Cookie'); expect((await POST(missing)).status).toBe(401);
    const foreign = request(); foreign.headers.set('Origin', 'https://foreign.test'); expect((await POST(foreign)).status).toBe(403);
    const insecure = request(); insecure.headers.delete('x-codeai-internal-transport'); expect((await POST(insecure)).status).toBe(426);
    expect(machineOperationAllowed('POST', ['observer'])).toBe(false);
    expect(mocks.ask).not.toHaveBeenCalled();
  });
  it('bounds and validates requests before inference and returns valid answers', async () => {
    expect((await POST(request({ provider: 'claude', text: 'x'.repeat(8001) }))).status).toBe(400);
    expect((await POST(request({ provider: 'claude', text: 'Status', observations: [] }))).status).toBe(400);
    expect((await POST(request('x'.repeat(170_000)))).status).toBe(400);
    expect(mocks.ask).not.toHaveBeenCalled();
    expect((await POST(request())).status).toBe(200);
  });
  it('rechecks revocation after inference before returning cross-session text', async () => {
    mocks.ask.mockImplementationOnce(async () => {
      await getDeviceAuthStore(dataDir).revoke(deviceId);
      return { answer: 'Must not be returned' };
    });
    expect((await POST(request())).status).toBe(401);
  });
});
