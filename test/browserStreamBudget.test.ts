import { afterEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ paired: false }));
vi.mock('@/server/config', () => ({ getConfig: () => ({ dataDir: '/budget-test', remoteAccess: state.paired ? 'paired' : 'local' }) }));
import { reserveBrowserWorkspace, withBrowserRunBudget } from '@/server/workspace/browserStreamBudget';
import { snapshotStream } from '@/server/workspace/snapshotStream';

const cleanup: Array<() => Promise<unknown> | void> = [];
afterEach(async () => { for (const release of cleanup.splice(0)) await release(); state.paired = false; });

function request(host: string, headers: HeadersInit = {}, signal?: AbortSignal) {
  return new Request(`http://${host}/api/agent/stream`, { headers: { 'user-agent': 'Browser', ...headers }, signal });
}
function run(req: Request) {
  const cancelled = vi.fn();
  const response = withBrowserRunBudget(req, new Response(new ReadableStream({ cancel: cancelled }, { highWaterMark: 0 }), {
    headers: { 'content-type': 'application/x-ndjson' },
  }));
  cleanup.push(() => response.body!.cancel().catch(() => undefined));
  return { response, cancelled };
}
function workspace(req: Request) {
  const detached = vi.fn();
  const response = snapshotStream(req, { subscribe(receive) { receive({ current: true }); return detached; }, authorize: async () => undefined });
  return { response, detached };
}

describe('browser-origin stream budget', () => {
  it('evicts workspace before a fifth run can pin the last command connection, then recovers', async () => {
    const req = request(`${crypto.randomUUID()}.test`);
    const source = workspace(req);
    const reader = source.response.body!.getReader();
    cleanup.push(() => reader.cancel().catch(() => undefined));
    await reader.read();
    const held = Array.from({ length: 5 }, () => run(req));
    expect((await reader.read()).done).toBe(true);
    expect(source.detached).toHaveBeenCalledOnce();
    expect(held.every(value => value.cancelled.mock.calls.length === 0)).toBe(true);
    expect(reserveBrowserWorkspace(req)).toBe(false);
    expect(workspace(req).response.status).toBe(429);
    await held[0].response.body!.cancel();
    const admitted = reserveBrowserWorkspace(req);
    expect(admitted).not.toBe(false);
    admitted && cleanup.push(admitted.release);
  });

  it('accounts across cold tabs and reserves one command slot even with several workspace tabs', async () => {
    const host = `${crypto.randomUUID()}.test`;
    const first = workspace(request(host));
    const other = workspace(request(host));
    const one = first.response.body!.getReader(), two = other.response.body!.getReader();
    cleanup.push(() => one.cancel().catch(() => undefined), () => two.cancel().catch(() => undefined));
    await Promise.all([one.read(), two.read()]);
    Array.from({ length: 4 }, () => run(request(host)));
    expect((await two.read()).done).toBe(true);
    expect(first.detached).not.toHaveBeenCalled();
    run(request(host));
    expect((await one.read()).done).toBe(true);
    expect(first.detached).toHaveBeenCalledOnce();
  });

  it('does not merge different origins or personal-device identities', () => {
    state.paired = true;
    const host = `${crypto.randomUUID()}.test`;
    const cookie = { cookie: '__Host-codeai-device=first-device' };
    Array.from({ length: 5 }, () => run(request(host, cookie)));
    expect(reserveBrowserWorkspace(request(host, cookie))).toBe(false);
    for (const req of [request(`other-${host}`, cookie), request(host, { cookie: '__Host-codeai-device=another-device' })]) {
      const admitted = reserveBrowserWorkspace(req);
      expect(admitted).not.toBe(false);
      admitted && cleanup.push(admitted.release);
    }
    // Paired machine requests without a personal cookie have already passed bearer authorization.
    expect(reserveBrowserWorkspace(request(host, { authorization: 'Bearer machine-credential' }))).toBeUndefined();
  });

  it('does not let a bare Authorization header escape Local browser accounting', () => {
    const req = request(`${crypto.randomUUID()}.test`, { authorization: 'Bearer invented' });
    Array.from({ length: 5 }, () => run(req));
    expect(reserveBrowserWorkspace(req)).toBe(false);
  });

  it('releases counts exactly once after EOF, error, cancellation and abort', async () => {
    const req = request(`${crypto.randomUUID()}.test`);
    Array.from({ length: 4 }, () => run(req));
    const finished = withBrowserRunBudget(req, new Response('complete', { headers: { 'content-type': 'application/x-ndjson' } }));
    expect(reserveBrowserWorkspace(req)).toBe(false);
    expect(await finished.text()).toBe('complete');
    let fail!: ReadableStreamDefaultController<Uint8Array>;
    const failed = withBrowserRunBudget(req, new Response(new ReadableStream({ start(controller) { fail = controller; } }), {
      headers: { 'content-type': 'application/x-ndjson' },
    }));
    const reader = failed.body!.getReader();
    fail.error(new Error('transport failed'));
    await expect(reader.read()).rejects.toThrow('transport failed');
    const abort = new AbortController();
    const aborted = run(request(new URL(req.url).host, {}, abort.signal));
    abort.abort();
    await expect(aborted.response.body!.getReader().read()).rejects.toThrow();
    const admitted = reserveBrowserWorkspace(req);
    expect(admitted).not.toBe(false);
    admitted && cleanup.push(admitted.release);
  });
});
