import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ createServer: vi.fn(), lookup: vi.fn(), request: vi.fn() }));
vi.mock('node:http', () => ({ default: { createServer: mocks.createServer } }));
vi.mock('node:https', () => ({ default: { request: mocks.request } }));
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }));
// @ts-expect-error The same plain ESM gateway runs in the pinned image.
import { startGateway } from '../docker/gateway.mjs';

interface Upstream {
  status?: number;
  location?: string;
  body?: object;
}

function fixture(responses: Upstream[]) {
  const handlers: Array<(request: object, response: object) => Promise<void>> = [];
  mocks.createServer.mockImplementation((handler) => {
    handlers.push(handler);
    return Object.assign(new EventEmitter(), { listen: vi.fn() });
  });
  mocks.lookup.mockResolvedValue([{ address: '104.16.24.34', family: 4 }]);
  mocks.request.mockImplementation((_options, onResponse) => Object.assign(new EventEmitter(), {
    end() {
      const next = responses.shift();
      if (!next) throw new Error('Unexpected upstream request');
      const upstream = Object.assign(new EventEmitter(), {
        statusCode: next.status || 200,
        headers: { 'content-type': 'application/json', ...(next.location ? { location: next.location } : {}) },
        resume: vi.fn(),
      });
      onResponse(upstream);
      queueMicrotask(() => {
        upstream.emit('data', Buffer.from(JSON.stringify(next.body || {})));
        upstream.emit('end');
      });
    },
    destroy: vi.fn(),
  }));
  startGateway('codex');
  return async (method = 'GET', url = '/fixture') => {
    const response = { headersSent: false, writeHead: vi.fn(), end: vi.fn() };
    await handlers[1]({ method, url, headers: { authorization: 'synthetic-token', cookie: 'synthetic-cookie', host: 'attacker.invalid' } }, response);
    return response;
  };
}

afterEach(() => vi.resetAllMocks());

describe('npm gateway upstream enforcement', () => {
  it('strips caller credentials, pins TLS authority and rewrites approved tarballs', async () => {
    const send = fixture([{ body: { dist: { tarball: 'http://registry.npmjs.org/fixture/-/fixture.tgz' } } }]);
    const response = await send();
    expect(mocks.request.mock.calls[0][0]).toMatchObject({
      hostname: '104.16.24.34', servername: 'registry.npmjs.org', method: 'GET', path: '/fixture',
      headers: { host: 'registry.npmjs.org', accept: 'application/json', 'accept-encoding': 'identity' },
    });
    expect(JSON.stringify(mocks.request.mock.calls[0][0])).not.toMatch(/synthetic|attacker/);
    expect(response.end.mock.calls[0][0].toString()).toContain('http://egress:8081/fixture/-/fixture.tgz');
  });

  it('allows same-origin redirects while rejecting alternate origins and redirect loops', async () => {
    const send = fixture([{ status: 302, location: '/approved' }, { status: 302, location: 'https://attacker.invalid/secret' }]);
    const response = await send();
    expect(response.writeHead.mock.calls[0][0]).toBe(403);
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(mocks.request.mock.calls[1][0].path).toBe('/approved');
    mocks.request.mockClear();
    const looping = fixture(Array.from({ length: 4 }, () => ({ status: 302, location: '/loop' })));
    expect((await looping()).writeHead.mock.calls[0][0]).toBe(403);
    expect(mocks.request).toHaveBeenCalledTimes(4);
  });

  it('rejects a public-to-private DNS change before the redirected connection', async () => {
    const send = fixture([{ status: 302, location: '/rebound' }]);
    mocks.lookup.mockResolvedValueOnce([{ address: '104.16.24.34', family: 4 }])
      .mockResolvedValueOnce([{ address: '169.254.169.254', family: 4 }]);
    expect((await send()).writeHead.mock.calls[0][0]).toBe(403);
    expect(mocks.request).toHaveBeenCalledOnce();
  });

  it('rejects prohibited methods and absolute-origin requests before any upstream access', async () => {
    const send = fixture([]);
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
      expect((await send(method)).writeHead.mock.calls[0][0]).toBe(403);
    }
    expect((await send('GET', 'https://attacker.invalid/')).writeHead.mock.calls[0][0]).toBe(403);
    expect(mocks.lookup).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
  });
});
