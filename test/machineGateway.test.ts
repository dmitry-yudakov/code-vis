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
import { createTurn, updateActivity } from '@/shared/turnActivity';
import { readNdjson } from '@/features/conversation/ndjson';
import type { AgentEvent } from '@/shared/types';

describe('machine API gateway', () => {
  it('serves executor project logos with their image isolation headers and no executor cookies', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"/>';
    const policy = "sandbox; default-src 'none'; frame-ancestors 'none'";
    fetchMock.mockResolvedValue(new Response(svg, { headers: {
      'Content-Type': 'image/svg+xml', 'Content-Security-Policy': policy,
      'X-Content-Type-Options': 'nosniff', 'Set-Cookie': 'private=value',
    } }));
    const response = await proxyMachineRequest(REMOTE_ID, ['projects', REMOTE_ID, 'logo'],
      new Request(`https://home.test/api/machines/${REMOTE_ID}/projects/${REMOTE_ID}/logo?revision=1`));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(svg);
    expect(response.headers.get('Content-Type')).toBe('image/svg+xml');
    expect(response.headers.get('Content-Security-Policy')).toBe(policy);
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Set-Cookie')).toBeNull();
    expect(fetchMock.mock.calls[0][0].href).toBe(`https://laptop.test:3023/api/projects/${REMOTE_ID}/logo?revision=1`);
  });
  it('proxies compared queued-message edits to the executing machine', async () => {
    fetchMock.mockResolvedValue(new Response('{"ok":true}', { headers: { 'Content-Type': 'application/json' } }));
    const body = JSON.stringify({ runId: REMOTE_ID, text: 'Revised idea', expectedText: 'Original idea' });
    const response = await proxyMachineRequest(REMOTE_ID, ['agent', 'queued-message'], new Request('https://home.test/api/agent/queued-message', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    }));
    expect(response.status).toBe(200);
    expect(fetchMock.mock.calls[0][0].pathname).toBe('/api/agent/queued-message');
    expect(new TextDecoder().decode(fetchMock.mock.calls[0][1].body)).toBe(body);
  });
  beforeEach(() => vi.stubGlobal('fetch', fetchMock));
  afterEach(() => { fetchMock.mockReset(); vi.unstubAllGlobals(); });

  it('forwards only safe headers and streams the remote response', async () => {
    fetchMock.mockResolvedValue(new Response('first\nsecond\n', {
      headers: { 'Content-Type': 'application/x-ndjson', 'X-CodeAI-Run-Finished': 'false', 'X-CodeAI-Run-State': 'queued', 'Set-Cookie': 'secret=bad' },
    }));
    const request = new Request(`https://home.test/api/machines/${REMOTE_ID}/agent/stream?runId=run`, {
      headers: { Cookie: 'device=secret', Origin: 'https://home.test', Accept: 'application/x-ndjson' },
    });
    const response = await proxyMachineRequest(REMOTE_ID, ['agent', 'stream'], request);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('first\nsecond\n');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('x-codeai-run-finished')).toBe('false');
    expect(response.headers.get('x-codeai-run-state')).toBe('queued');
    const [target, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(target.href).toBe('https://laptop.test:3023/api/agent/stream?runId=run');
    expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${CREDENTIAL}`);
    expect(new Headers(init.headers).get('cookie')).toBeNull();
    expect(new Headers(init.headers).get('origin')).toBeNull();
  });

  it('round-trips executing-machine turn identities, Unicode tool results and full approval reviews', async () => {
    const runId = crypto.randomUUID();
    const turn = updateActivity(createTurn(runId, crypto.randomUUID(), 'remote-agent', new Date().toISOString()), 2,
      { kind: 'tool', key: 'remote-thread:tool', tool: 'Read', status: 'succeeded', output: 'Remote result 🌍', actor: { provider: 'codex', threadId: 'remote-thread' } });
    const source: AgentEvent[] = [
      { type: 'turn-activity', runId, turn },
      { type: 'permission-request', runId, requestId: crypto.randomUUID(), participantId: 'remote-agent', tool: 'Run', detail: 'pwd', review: { completeness: 'complete', text: 'pwd' }, toolKey: 'remote-thread:next-tool' },
    ];
    fetchMock.mockResolvedValue(new Response(source.map(event => JSON.stringify(event)).join('\n') + '\n', {
      headers: { 'Content-Type': 'application/x-ndjson', 'X-CodeAI-Run-Id': runId, 'X-CodeAI-Replay-Events': '2' },
    }));
    const response = await proxyMachineRequest(REMOTE_ID, ['agent', 'stream'], new Request(`https://home.test/api/agent/stream?runId=${runId}`));
    const received: AgentEvent[] = [];
    for await (const event of readNdjson<AgentEvent>(response)) received.push(event);
    expect(received).toEqual(source);
    expect(response.headers.get('X-CodeAI-Run-Id')).toBe(runId);
    expect(response.headers.get('X-CodeAI-Replay-Events')).toBe('2');
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

  it('preserves a worktree admission conflict from the addressed executor', async () => {
    const body = { error: 'Executor busy', worktreeConflict: { machineId: REMOTE_ID, kind: 'maintenance' } };
    fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status: 409, headers: { 'Content-Type': 'application/json' } }));
    const response = await proxyMachineRequest(REMOTE_ID, ['sessions'], new Request('https://home.test/api/sessions', { method: 'POST', body: '{}' }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual(body);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
