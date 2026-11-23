import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ denied: undefined as Response | undefined, resolve: vi.fn(), stage: vi.fn(), commit: vi.fn(), details: vi.fn(), patch: vi.fn() }));
vi.mock('@/server/config', () => ({ getConfig: () => ({ remoteAccess: 'local', repositoriesRoot: '/repos', repositoryDiscoveryDepth: 1 }) }));
vi.mock('@/server/devices/deviceAuthorization', async original => ({ ...await original<typeof import('@/server/devices/deviceAuthorization')>(), authorizeDeviceRequest: async () => state.denied }));
vi.mock('@/server/repository/checkoutRegistry', () => ({ getCheckoutRegistry: () => ({ resolve: state.resolve }) }));
vi.mock('@/server/repository/gitChanges', () => ({ changeGitIndex: state.stage, commitGitIndex: state.commit }));
vi.mock('@/server/repository/gitHistory', () => ({ readGitCommit: state.details, readGitCommitPatch: state.patch }));
vi.mock('@/server/storage/activityLog', () => ({ recordActivity: vi.fn() }));
import { POST as INDEX } from '@/app/api/repository/index/route';
import { GET, POST as COMMIT } from '@/app/api/repository/commit/route';
import { machineOperationAllowed } from '@/server/machines/machineRoutePolicy';
const token = 'a'.repeat(64);
const stageBody = { checkoutId: 'alpha', action: 'stage', paths: ['file.txt'], indexState: token };
const commitBody = { checkoutId: 'alpha', message: 'Commit', indexState: token };
const post = (handler: typeof INDEX, body: unknown, origin: string | null = 'http://localhost:3023') => handler(new Request('http://localhost:3023/api/repository/index', {
  method: 'POST', headers: { host: 'localhost:3023', ...(origin ? { origin } : {}) }, body: typeof body === 'string' ? body : JSON.stringify(body),
}));
const get = (query = `checkoutId=alpha&hash=${'b'.repeat(40)}`) => GET(new Request(`http://localhost:3023/api/repository/commit?${query}`));
beforeEach(() => {
  vi.clearAllMocks(); state.denied = undefined; state.resolve.mockResolvedValue({ realPath: '/repos/alpha' });
  state.stage.mockResolvedValue(undefined); state.commit.mockResolvedValue('b'.repeat(40));
  state.details.mockResolvedValue({ hash: 'b'.repeat(40), files: [] }); state.patch.mockResolvedValue('+line');
});
for (const [handler, body] of [[INDEX, stageBody], [COMMIT, commitBody]] as const) {
  it('authorizes mutations and checks exact origin before resolving a checkout', async () => {
    state.denied = new Response(null, { status: 401 }); expect((await post(handler, body)).status).toBe(401);
    state.denied = undefined;
    for (const origin of [null, 'https://evil.invalid']) expect((await post(handler, body, origin)).status).toBe(403);
    expect(state.resolve).not.toHaveBeenCalled(); expect(state.stage).not.toHaveBeenCalled(); expect(state.commit).not.toHaveBeenCalled();
  });
  it('rejects malformed, oversized, stale-token-less and extra-field mutation requests', async () => {
    for (const invalid of ['{', {}, { ...body, indexState: '' }, { ...body, force: true }, { ...body, checkoutId: 'x'.repeat(129) }, 'x'.repeat(300_000)]) {
      expect((await post(handler, invalid)).status).toBe(400);
    }
    expect(state.resolve).not.toHaveBeenCalled();
  });
  it('returns recoverable errors for unknown checkouts', async () => {
    state.resolve.mockRejectedValueOnce(new Error('Unknown checkout.'));
    expect((await post(handler, body)).status).toBe(409);
    expect(state.stage).not.toHaveBeenCalled(); expect(state.commit).not.toHaveBeenCalled();
  });
}
it('stages/unstages only exact supplied paths in the resolved checkout', async () => {
  expect(await (await post(INDEX, stageBody)).json()).toEqual({ ok: true });
  expect(state.stage).toHaveBeenCalledWith('/repos/alpha', 'stage', ['file.txt'], token);
  expect((await post(INDEX, { ...stageBody, action: 'unstage' })).status).toBe(200);
  for (const paths of [[], ['\0'], Array(1001).fill('file')]) expect((await post(INDEX, { ...stageBody, paths })).status).toBe(400);
});
it('commits the staged snapshot and reports a server refusal without hiding it', async () => {
  expect(await (await post(COMMIT, commitBody)).json()).toEqual({ hash: 'b'.repeat(40) });
  expect(state.commit).toHaveBeenCalledWith('/repos/alpha', 'Commit', token);
  state.commit.mockRejectedValue(new Error('Refresh Changes and retry.'));
  expect(await (await post(COMMIT, commitBody)).json()).toEqual({ error: 'Refresh Changes and retry.' });
  for (const message of ['', ' ', '\0', 'm'.repeat(16_001)]) expect((await post(COMMIT, { ...commitBody, message })).status).toBe(400);
});
it('authorizes details before parsing the query or reading Git', async () => {
  state.denied = new Response(null, { status: 401 }); expect((await get()).status).toBe(401);
  expect(state.resolve).not.toHaveBeenCalled(); expect(state.details).not.toHaveBeenCalled();
});
it('reads details and literal-file patches from the resolved checkout', async () => {
  expect((await get()).status).toBe(200); expect(state.details).toHaveBeenCalledWith('/repos/alpha', 'b'.repeat(40));
  expect(await (await get(`checkoutId=alpha&hash=${'b'.repeat(40)}&path=file.txt`)).json()).toEqual({ patch: '+line' });
  expect(state.patch).toHaveBeenCalledWith('/repos/alpha', 'b'.repeat(40), 'file.txt');
});
it.each(['', 'checkoutId=alpha&hash=HEAD', `checkoutId=alpha&hash=${'b'.repeat(41)}`, `checkoutId=alpha&hash=${'b'.repeat(40)}&path=`])('rejects invalid detail query %s', async query => {
  expect((await get(query)).status).toBe(400); expect(state.resolve).not.toHaveBeenCalled();
});
it('exposes commit reads, but no staging or commit mutation to attached machines', () => {
  expect(machineOperationAllowed('GET', ['repository', 'commit'])).toBe(true);
  expect(machineOperationAllowed('POST', ['repository', 'commit'])).toBe(false);
  expect(machineOperationAllowed('POST', ['repository', 'index'])).toBe(false);
});
