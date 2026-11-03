import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  remoteAccess: 'local' as 'local' | 'paired',
  publicOrigin: undefined as string | undefined,
  publicOrigins: undefined as string[] | undefined,
  denied: undefined as Response | undefined,
  resolve: vi.fn(),
  push: vi.fn(),
}));

vi.mock('@/server/config', () => ({
  getConfig: () => ({ remoteAccess: state.remoteAccess, publicOrigin: state.publicOrigin, publicOrigins: state.publicOrigins, repositoriesRoot: '/repositories', repositoryDiscoveryDepth: 1 }),
}));
vi.mock('@/server/devices/deviceAuthorization', async (original) => ({
  ...await original<typeof import('@/server/devices/deviceAuthorization')>(),
  authorizeDeviceRequest: async () => state.denied,
}));
vi.mock('@/server/repository/checkoutRegistry', () => ({
  getCheckoutRegistry: () => ({ resolve: state.resolve }),
}));
vi.mock('@/server/repository/gitPush', () => ({ pushCurrentBranch: state.push }));

import { POST } from '@/app/api/repository/push/route';
import { machineOperationAllowed } from '@/server/machines/machineRoutePolicy';

const post = (body: unknown, origin: string | null = 'http://localhost:3023',
  host = state.publicOrigin ? new URL(state.publicOrigin).host : 'localhost:3023') => POST(new Request('http://localhost:3023/api/repository/push', {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}), host },
  body: typeof body === 'string' ? body : JSON.stringify(body),
}));

beforeEach(() => {
  state.denied = undefined;
  state.remoteAccess = 'local';
  state.publicOrigin = undefined;
  state.publicOrigins = undefined;
  state.resolve.mockReset().mockResolvedValue({ realPath: '/repositories/alpha' });
  state.push.mockReset().mockResolvedValue('origin/main');
});

describe('POST /api/repository/push', () => {
  it('pushes the resolved checkout and returns where the branch went', async () => {
    const response = await post({ checkoutId: 'alpha-id', target: 'origin/main' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ target: 'origin/main' });
    expect(state.resolve).toHaveBeenCalledWith('alpha-id');
    expect(state.push).toHaveBeenCalledWith('/repositories/alpha', 'origin/main');
  });

  it.each([
    ['another site', 'https://attacker.example'],
    ['no origin', null],
  ])('rejects %s in local mode, before doing anything', async (_label, origin) => {
    const response = await post({ checkoutId: 'alpha-id', target: 'origin/main' }, origin);
    expect(response.status).toBe(403);
    expect(state.resolve).not.toHaveBeenCalled();
    expect(state.push).not.toHaveBeenCalled();
  });

  it('demands the public origin in paired mode too', async () => {
    state.remoteAccess = 'paired';
    state.publicOrigin = 'https://codeai.test';
    expect((await post({ checkoutId: 'alpha-id', target: 'origin/main' })).status).toBe(403);
    expect((await post({ checkoutId: 'alpha-id', target: 'origin/main' }, 'https://codeai.test')).status).toBe(200);
  });

  it('allows the second address while rejecting requests between the allowed origins', async () => {
    state.remoteAccess = 'paired';
    state.publicOrigin = 'https://codeai.test';
    state.publicOrigins = [state.publicOrigin, 'https://100.64.0.10'];
    const body = { checkoutId: 'alpha-id', target: 'origin/main' };
    expect((await post(body, 'https://100.64.0.10', '100.64.0.10')).status).toBe(200);
    state.push.mockClear();
    expect((await post(body, 'https://codeai.test', '100.64.0.10')).status).toBe(403);
    expect((await post(body, 'https://100.64.0.10', 'codeai.test')).status).toBe(403);
    expect(state.push).not.toHaveBeenCalled();
  });

  it('rejects an unauthorized device before doing anything', async () => {
    state.denied = new Response(null, { status: 401 });
    expect((await post({ checkoutId: 'alpha-id', target: 'origin/main' })).status).toBe(401);
    expect(state.push).not.toHaveBeenCalled();
  });

  it.each([
    ['malformed JSON', '{'],
    ['a missing target', { checkoutId: 'alpha-id' }],
    ['a missing checkout', { target: 'origin/main' }],
    ['an empty target', { checkoutId: 'alpha-id', target: '' }],
    ['an unexpected field', { checkoutId: 'alpha-id', target: 'origin/main', force: true }],
    ['an oversized target', { checkoutId: 'alpha-id', target: 'b'.repeat(2048) }],
  ])('rejects %s', async (_label, body) => {
    expect((await post(body)).status).toBeGreaterThanOrEqual(400);
    expect(state.push).not.toHaveBeenCalled();
  });

  it('reports a refusal in its own words', async () => {
    state.push.mockRejectedValue(new Error('This repository has a pre-push hook.'));
    const response = await post({ checkoutId: 'alpha-id', target: 'origin/main' });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'This repository has a pre-push hook.' });
  });

  it('is not an operation an attached home machine may ask for', () => {
    expect(machineOperationAllowed('POST', ['repository', 'push'])).toBe(false);
  });
});
