import { beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ denied: undefined as Response | undefined, resolve: vi.fn(), file: vi.fn(), directory: vi.fn(), search: vi.fn() }));
vi.mock('@/server/config', () => ({ getConfig: () => ({ repositoriesRoot: '/repositories', repositoryDiscoveryDepth: 1 }) }));
vi.mock('@/server/devices/deviceAuthorization', () => ({ authorizeDeviceRequest: async () => state.denied }));
vi.mock('@/server/repository/checkoutRegistry', () => ({ getCheckoutRegistry: () => ({ resolve: state.resolve }) }));
vi.mock('@/server/repository/repositoryFiles', async importOriginal => ({
  ...await importOriginal<typeof import('@/server/repository/repositoryFiles')>(),
  readRepositoryFile: state.file, listRepositoryDirectory: state.directory, listRepositoryFiles: state.search,
}));
import { GET as file } from '@/app/api/repository/file/route';
import { GET as files } from '@/app/api/repository/files/route';
import { GET as search } from '@/app/api/repository/file-search/route';
import { RepositoryFileError } from '@/server/repository/repositoryFiles';
import { machineOperationAllowed } from '@/server/machines/machineRoutePolicy';

beforeEach(() => {
  state.denied = undefined;
  state.resolve.mockReset().mockResolvedValue({ realPath: '/repositories/alpha' });
  state.file.mockReset().mockResolvedValue({ path: 'README.md', text: '# Read me' });
  state.directory.mockReset().mockResolvedValue({ path: '', entries: [] });
  state.search.mockReset().mockResolvedValue({ paths: ['README.md'] });
});

for (const [operation, get, read] of [['file', file, state.file], ['files', files, state.directory]] as const) {
  const request = (query = 'checkoutId=alpha&path=README.md') => get(new Request(`http://localhost:3023/api/repository/${operation}?${query}`));
  it(`${operation}: authorizes before resolving the checkout or reading files`, async () => {
    state.denied = new Response(null, { status: 401 });
    expect((await request()).status).toBe(401);
    expect(state.resolve).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });
  it.each(['', 'checkoutId=', `checkoutId=${'x'.repeat(129)}`, `checkoutId=alpha&path=${'a'.repeat(4097)}`])(`${operation}: validates query %s`, async query => {
    expect((await request(query)).status).toBe(400);
    expect(state.resolve).not.toHaveBeenCalled();
  });
  it(`${operation}: reads only the registry-resolved root`, async () => {
    expect((await request()).status).toBe(200);
    expect(state.resolve).toHaveBeenCalledWith('alpha');
    expect(read).toHaveBeenCalledWith('/repositories/alpha', 'README.md');
  });
  it(`${operation}: rejects an unknown checkout and supports recoverable failures`, async () => {
    state.resolve.mockRejectedValueOnce(new Error('Unknown checkout.'));
    expect((await request()).status).toBe(400);
    expect(read).not.toHaveBeenCalled();
    read.mockRejectedValueOnce(new RepositoryFileError('Not found.', 404));
    const response = await request();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Not found.' });
  });
  it(`${operation}: permits only GET through the attached-machine gateway`, () => {
    expect(machineOperationAllowed('GET', ['repository', operation])).toBe(true);
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) expect(machineOperationAllowed(method, ['repository', operation])).toBe(false);
  });
}

it('lists the root with an omitted path, while file reads require a path', async () => {
  expect((await files(new Request('http://localhost/api/repository/files?checkoutId=alpha'))).status).toBe(200);
  expect(state.directory).toHaveBeenCalledWith('/repositories/alpha', '');
  expect((await file(new Request('http://localhost/api/repository/file?checkoutId=alpha'))).status).toBe(400);
});

it('search authorizes before resolving and listing, and serves only the resolved checkout', async () => {
  const request = () => search(new Request('http://localhost/api/repository/file-search?checkoutId=alpha'));
  state.denied = new Response(null, { status: 401 });
  expect((await request()).status).toBe(401);
  expect(state.resolve).not.toHaveBeenCalled();
  expect(state.search).not.toHaveBeenCalled();
  state.denied = undefined;
  const response = await request();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ files: { paths: ['README.md'] } });
  expect(state.search).toHaveBeenCalledWith('/repositories/alpha');
});

it.each(['', 'checkoutId=', `checkoutId=${'x'.repeat(129)}`])('search rejects invalid checkout query %s', async query => {
  expect((await search(new Request(`http://localhost/api/repository/file-search?${query}`))).status).toBe(400);
  expect(state.resolve).not.toHaveBeenCalled();
});

it('search returns recoverable failures and is a read-only attached-machine operation', async () => {
  state.search.mockRejectedValueOnce(new RepositoryFileError('Busy. Try again.', 409));
  const response = await search(new Request('http://localhost/api/repository/file-search?checkoutId=alpha'));
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: 'Busy. Try again.' });
  expect(machineOperationAllowed('GET', ['repository', 'file-search'])).toBe(true);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) expect(machineOperationAllowed(method, ['repository', 'file-search'])).toBe(false);
});
