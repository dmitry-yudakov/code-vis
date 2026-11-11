import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  remoteAccess: 'local' as 'local' | 'paired',
  publicOrigin: undefined as string | undefined,
  publicOrigins: undefined as string[] | undefined,
  denied: undefined as Response | undefined,
  resolve: vi.fn(),
  switch: vi.fn(),
  list: vi.fn(),
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
vi.mock('@/server/repository/gitBranches', () => ({ switchGitBranch: state.switch, listGitBranches: state.list }));

import { GET, POST } from '@/app/api/repository/branches/route';
import { machineOperationAllowed } from '@/server/machines/machineRoutePolicy';

const post = (body: unknown, origin: string | null = 'http://localhost:3023',
  host = state.publicOrigin ? new URL(state.publicOrigin).host : 'localhost:3023') => POST(new Request('http://localhost:3023/api/repository/branches', {
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
  state.switch.mockReset().mockResolvedValue('feature');
});

describe('POST /api/repository/branches', () => {
  it('switches the resolved checkout and returns where the branch went', async () => {
    const response = await post({ checkoutId: 'alpha-id', branch: 'feature', head: 'refs/heads/main:abc' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ branch: 'feature' });
    expect(state.resolve).toHaveBeenCalledWith('alpha-id');
    expect(state.switch).toHaveBeenCalledWith('/repositories/alpha', 'feature', 'refs/heads/main:abc');
  });

  it.each([
    ['another site', 'https://attacker.example'],
    ['no origin', null],
  ])('rejects %s in local mode, before resolving the checkout', async (_label, origin) => {
    const response = await post({ checkoutId: 'alpha-id', branch: 'feature', head: 'refs/heads/main:abc' }, origin);
    expect(response.status).toBe(403);
    expect(state.resolve).not.toHaveBeenCalled();
    expect(state.switch).not.toHaveBeenCalled();
  });

  it('demands the public origin in paired mode too', async () => {
    state.remoteAccess = 'paired';
    state.publicOrigin = 'https://codeai.test';
    expect((await post({ checkoutId: 'alpha-id', branch: 'feature', head: 'refs/heads/main:abc' })).status).toBe(403);
    expect((await post({ checkoutId: 'alpha-id', branch: 'feature', head: 'refs/heads/main:abc' }, 'https://codeai.test')).status).toBe(200);
  });

  it('allows the second address while rejecting requests between the allowed origins', async () => {
    state.remoteAccess = 'paired';
    state.publicOrigin = 'https://codeai.test';
    state.publicOrigins = [state.publicOrigin, 'https://100.64.0.10'];
    const body = { checkoutId: 'alpha-id', branch: 'feature', head: 'refs/heads/main:abc' };
    expect((await post(body, 'https://100.64.0.10', '100.64.0.10')).status).toBe(200);
    state.switch.mockClear();
    expect((await post(body, 'https://codeai.test', '100.64.0.10')).status).toBe(403);
    expect((await post(body, 'https://100.64.0.10', 'codeai.test')).status).toBe(403);
    expect(state.switch).not.toHaveBeenCalled();
  });

  it('rejects an unauthorized device before resolving the checkout', async () => {
    state.denied = new Response(null, { status: 401 });
    expect((await post({ checkoutId: 'alpha-id', branch: 'feature', head: 'refs/heads/main:abc' })).status).toBe(401);
    expect(state.switch).not.toHaveBeenCalled();
  });

  it.each([
    ['malformed JSON', '{'],
    ['a missing branch', { checkoutId: 'alpha-id' }],
    ['a missing checkout', { branch: 'feature', head: 'refs/heads/main:abc' }],
    ['an empty branch', { checkoutId: 'alpha-id', branch: '', head: 'abc' }],
    ['an unexpected field', { checkoutId: 'alpha-id', branch: 'feature', head: 'refs/heads/main:abc', force: true }],
    ['an oversized branch', { checkoutId: 'alpha-id', branch: 'b'.repeat(2048), head: 'abc' }],
  ])('rejects %s', async (_label, body) => {
    expect((await post(body)).status).toBeGreaterThanOrEqual(400);
    expect(state.switch).not.toHaveBeenCalled();
  });

  it('reports a refusal in its own words', async () => {
    state.switch.mockRejectedValue(new Error('This checkout is busy.'));
    const response = await post({ checkoutId: 'alpha-id', branch: 'feature', head: 'refs/heads/main:abc' });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'This checkout is busy.' });
  });

  it('is not an operation an attached home machine may ask for', () => {
    expect(machineOperationAllowed('POST', ['repository', 'branches'])).toBe(false);
  });
});

const get = (query = 'checkoutId=alpha-id') => GET(new Request(`http://localhost:3023/api/repository/branches?${query}`));
it('lists only the resolved checkout', async () => {
  const branches = { head: 'refs/heads/main:abc', current: 'main', branches: [{ name: 'main', occupied: true }] };
  state.list.mockResolvedValue(branches);
  expect(await (await get()).json()).toEqual({ branches });
  expect(state.list).toHaveBeenCalledWith('/repositories/alpha');
});
it('authorizes branch reads before checkout resolution', async () => {
  state.denied = new Response(null, { status: 401 });
  expect((await get()).status).toBe(401);
  expect(state.resolve).not.toHaveBeenCalled();
});
it.each(['', 'checkoutId=', `checkoutId=${'x'.repeat(129)}`])('rejects invalid list query %s', async query => {
  expect((await get(query)).status).toBe(400);
  expect(state.resolve).not.toHaveBeenCalled();
});
it('rejects missing HEAD and unknown checkout without switching', async () => {
  expect((await post({ checkoutId: 'alpha-id', branch: 'feature' })).status).toBe(400);
  state.resolve.mockRejectedValue(new Error('Unknown checkout.'));
  expect((await post({ checkoutId: 'unknown', branch: 'feature', head: 'abc' })).status).toBe(409);
  expect(state.switch).not.toHaveBeenCalled();
});
