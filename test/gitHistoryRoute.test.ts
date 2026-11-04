import { beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ denied: undefined as Response | undefined, resolve: vi.fn(), history: vi.fn() }));
vi.mock('@/server/config', () => ({ getConfig: () => ({ repositoriesRoot: '/repositories', repositoryDiscoveryDepth: 1 }) }));
vi.mock('@/server/devices/deviceAuthorization', () => ({ authorizeDeviceRequest: async () => state.denied }));
vi.mock('@/server/repository/checkoutRegistry', () => ({ getCheckoutRegistry: () => ({ resolve: state.resolve }) }));
vi.mock('@/server/repository/gitHistory', () => ({ readGitHistory: state.history }));
import { GET } from '@/app/api/repository/history/route';
import { machineOperationAllowed } from '@/server/machines/machineRoutePolicy';
const get = (query = 'checkoutId=alpha') => GET(new Request(`http://localhost:3023/api/repository/history?${query}`));

beforeEach(() => {
  state.denied = undefined;
  state.resolve.mockReset().mockResolvedValue({ realPath: '/repositories/alpha' });
  state.history.mockReset().mockResolvedValue({ isRepository: true, commits: [], truncated: false });
});
it('authorizes before resolving or reading a checkout', async () => {
  state.denied = new Response(null, { status: 401 });
  expect((await get()).status).toBe(401);
  expect(state.resolve).not.toHaveBeenCalled();
  expect(state.history).not.toHaveBeenCalled();
});
it.each(['', 'checkoutId=', `checkoutId=${'x'.repeat(129)}`])('rejects an invalid checkout query: %s', async query => {
  expect((await get(query)).status).toBe(400);
  expect(state.resolve).not.toHaveBeenCalled();
});
it('reads only the resolved checkout path', async () => {
  const response = await get();
  expect(await response.json()).toEqual({ history: { isRepository: true, commits: [], truncated: false } });
  expect(state.resolve).toHaveBeenCalledWith('alpha');
  expect(state.history).toHaveBeenCalledWith('/repositories/alpha');
});
it('refuses an unknown checkout without reading Git', async () => {
  state.resolve.mockRejectedValue(new Error('Unknown checkout.'));
  expect((await get()).status).toBe(400);
  expect(state.history).not.toHaveBeenCalled();
});
it('reports a recoverable read failure', async () => {
  state.history.mockRejectedValue(new Error('Could not read Git history. Try again.'));
  expect(await (await get()).json()).toEqual({ error: 'Could not read Git history. Try again.' });
});
it('allows only the read through the attached-machine gateway', () => {
  expect(machineOperationAllowed('GET', ['repository', 'history'])).toBe(true);
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) expect(machineOperationAllowed(method, ['repository', 'history'])).toBe(false);
});
