import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const REMOTE_ID = '11111111-1111-4111-8111-111111111111';
const CREDENTIAL = `22222222-2222-4222-8222-222222222222.${'a'.repeat(43)}`;
const fetchMock = vi.fn();

vi.mock('@/server/config', () => ({ getConfig: () => ({ dataDir: '/test-data' }) }));
vi.mock('@/server/machines/machineRegistry', () => ({
  getMachineRegistry: () => ({
    get: async () => ({
      machine: { id: REMOTE_ID, label: 'Laptop' },
      origin: 'https://laptop.test:3023',
      credential: CREDENTIAL,
      expiresAt: '2099-01-01T00:00:00.000Z',
      attachedAt: '2026-09-04T10:00:00.000Z',
    }),
  }),
}));

import { proxyMachineRequest } from '@/server/machines/machineGateway';

describe('machine API gateway', () => {
  beforeEach(() => vi.stubGlobal('fetch', fetchMock));
  afterEach(() => { fetchMock.mockReset(); vi.unstubAllGlobals(); });

  it('forwards only safe headers and streams the remote response', async () => {
    fetchMock.mockResolvedValue(new Response('first\nsecond\n', {
      headers: { 'Content-Type': 'application/x-ndjson', 'X-CodeAI-Run-Finished': 'false', 'Set-Cookie': 'secret=bad' },
    }));
    const request = new Request(`https://home.test/api/machines/${REMOTE_ID}/agent/stream?runId=run`, {
      headers: { Cookie: 'device=secret', Origin: 'https://home.test', Accept: 'application/x-ndjson' },
    });
    const response = await proxyMachineRequest(REMOTE_ID, ['agent', 'stream'], request);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('first\nsecond\n');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('x-codeai-run-finished')).toBe('false');
    const [target, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(target.href).toBe('https://laptop.test:3023/api/agent/stream?runId=run');
    expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${CREDENTIAL}`);
    expect(new Headers(init.headers).get('cookie')).toBeNull();
    expect(new Headers(init.headers).get('origin')).toBeNull();
  });

  it('denies arbitrary/auth paths and bounds request bodies before network work', async () => {
    const denied = await proxyMachineRequest(REMOTE_ID, ['auth', 'devices'], new Request('https://home.test', { method: 'GET' }));
    expect(denied.status).toBe(404);
    const oversized = await proxyMachineRequest(REMOTE_ID, ['agent', 'message'], new Request('https://home.test', {
      method: 'POST', headers: { 'Content-Length': '7000001' }, body: '{}',
    }));
    expect(oversized.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('turns redirects and connection failures into a bounded offline response', async () => {
    fetchMock.mockRejectedValue(new TypeError('redirect mode is set to error'));
    const response = await proxyMachineRequest(REMOTE_ID, ['sessions'], new Request('https://home.test/api/sessions'));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'The execution machine is unreachable.' });
  });

  it('forwards worktree choices to the named executor and never retries them on the home machine', async () => {
    const body = JSON.stringify({ provider: 'claude', execution: 'local', checkoutId: 'executor-checkout',
      checkoutMode: 'worktree', creationRequestId: '33333333-3333-4333-8333-333333333333' });
    const request = () => new Request(`https://home.test/api/machines/${REMOTE_ID}/sessions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    });
    fetchMock.mockResolvedValueOnce(new Response('{"session":{"id":"executor-session"}}', { status: 201 }));
    expect((await proxyMachineRequest(REMOTE_ID, ['sessions'], request())).status).toBe(201);
    const [target, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(target.href).toBe('https://laptop.test:3023/api/sessions');
    expect(new TextDecoder().decode(init.body as ArrayBuffer)).toBe(body);
    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    const offline = await proxyMachineRequest(REMOTE_ID, ['sessions'], request());
    expect(offline.status).toBe(502); expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(([url]) => (url as URL).origin === 'https://laptop.test:3023')).toBe(true);
  });
});
