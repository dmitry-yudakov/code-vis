import { afterEach, describe, expect, it, vi } from 'vitest';
import { subscribeArena } from '@/features/arena/arenaSubscription';
import { WORKSPACE_HEARTBEAT_MS } from '@/shared/workspaceStream';
import type { ArenaSnapshot } from '@/shared/types';

const stops: Array<() => void> = [];
afterEach(() => { for (const stop of stops.splice(0)) stop(); vi.useRealTimers(); });

function fixture() {
  const controllers: ReadableStreamDefaultController<Uint8Array>[] = [];
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => new Response(new ReadableStream({ start(controller) {
    controllers.push(controller);
    init!.signal!.addEventListener('abort', () => controller.error(new Error('aborted')), { once: true });
  } }), { headers: { 'content-type': 'application/x-ndjson' } }));
  const snapshot = vi.fn(), connected = vi.fn(), error = vi.fn(), unauthorized = vi.fn();
  const owner = subscribeArena({ snapshot, connected, error, unauthorized }, fetcher);
  stops.push(owner.stop);
  const send = (event: object, index = controllers.length - 1) => controllers[index].enqueue(new TextEncoder().encode(`${JSON.stringify(event)}\n`));
  return { owner, fetcher, controllers, snapshot, connected, error, unauthorized, send };
}

describe('browser workspace subscription', () => {
  it('keeps one idle connection alive with heartbeats and makes no polling requests', async () => {
    vi.useFakeTimers();
    const setup = fixture();
    await vi.advanceTimersByTimeAsync(0);
    setup.send({ type: 'snapshot', snapshot: { machines: [] } });
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 12; i++) {
      setup.send({ type: 'heartbeat' });
      await vi.advanceTimersByTimeAsync(WORKSPACE_HEARTBEAT_MS);
    }
    expect(setup.fetcher).toHaveBeenCalledOnce();
    expect(setup.snapshot).toHaveBeenCalledOnce();
    expect(setup.connected).toHaveBeenLastCalledWith(true);
    expect(setup.error).toHaveBeenLastCalledWith(undefined);
  });

  it('retains cards through disconnect and reconnects to a fresh snapshot', async () => {
    vi.useFakeTimers();
    const setup = fixture();
    await vi.advanceTimersByTimeAsync(0);
    setup.send({ type: 'snapshot', snapshot: { machines: [] } });
    await vi.advanceTimersByTimeAsync(0);
    setup.controllers[0].error(new Error('network lost'));
    await vi.advanceTimersByTimeAsync(0);
    expect(setup.connected).toHaveBeenLastCalledWith(false);
    expect(setup.snapshot).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(setup.fetcher).toHaveBeenCalledTimes(2);
    setup.send({ type: 'snapshot', snapshot: { machines: [{ changed: true }] } });
    await vi.advanceTimersByTimeAsync(0);
    expect(setup.snapshot).toHaveBeenLastCalledWith({ machines: [{ changed: true }] });
    expect(setup.connected).toHaveBeenLastCalledWith(true);
  });

  it('coalesces explicit refresh, abandons its old stream and resumes one subscription', async () => {
    vi.useFakeTimers();
    const setup = fixture();
    await vi.advanceTimersByTimeAsync(0);
    let resolve!: (value: Response) => void;
    setup.fetcher.mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }));
    const first = setup.owner.refresh(), second = setup.owner.refresh();
    await second;
    expect(setup.fetcher).toHaveBeenCalledTimes(2);
    const value: ArenaSnapshot = { machines: [] };
    resolve(Response.json(value));
    await vi.advanceTimersByTimeAsync(0);
    await first;
    expect(setup.snapshot).toHaveBeenLastCalledWith(value);
    expect(setup.fetcher).toHaveBeenCalledTimes(3);
    setup.owner.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(setup.fetcher).toHaveBeenCalledTimes(3);
  });

  it('keeps cached cards stale when a reconnect has heartbeats but no initial snapshot yet', async () => {
    vi.useFakeTimers();
    const setup = fixture();
    await vi.advanceTimersByTimeAsync(0);
    setup.send({ type: 'snapshot', snapshot: { machines: [] } });
    await vi.advanceTimersByTimeAsync(0);
    setup.controllers[0].error(new Error('network lost'));
    await vi.advanceTimersByTimeAsync(1_000);
    setup.send({ type: 'heartbeat' });
    await vi.advanceTimersByTimeAsync(0);
    expect(setup.connected).toHaveBeenLastCalledWith(false);
    expect(setup.error).not.toHaveBeenLastCalledWith(undefined);
    setup.send({ type: 'snapshot', snapshot: { machines: [] } });
    await vi.advanceTimersByTimeAsync(0);
    expect(setup.connected).toHaveBeenLastCalledWith(true);
    expect(setup.error).toHaveBeenLastCalledWith(undefined);
  });

  it('bounds fresh JSON state while a replacement stream has only heartbeats', async () => {
    vi.useFakeTimers();
    const setup = fixture();
    await vi.advanceTimersByTimeAsync(0);
    setup.fetcher.mockResolvedValueOnce(Response.json({ machines: [] }));
    const refreshed = setup.owner.refresh();
    await vi.advanceTimersByTimeAsync(0);
    await refreshed;
    expect(setup.connected).toHaveBeenLastCalledWith(true);
    for (let index = 0; index < 5; index++) {
      setup.send({ type: 'heartbeat' });
      await vi.advanceTimersByTimeAsync(5_000);
    }
    expect(setup.connected).toHaveBeenLastCalledWith(false);
    expect(setup.error).toHaveBeenLastCalledWith('Waiting for the current workspace snapshot.');
    setup.send({ type: 'snapshot', snapshot: { machines: [] } });
    await vi.advanceTimersByTimeAsync(0);
    expect(setup.connected).toHaveBeenLastCalledWith(true);
  });

  it('detects a silent connection and retries with backoff', async () => {
    vi.useFakeTimers();
    const setup = fixture();
    await vi.advanceTimersByTimeAsync(21_001);
    expect(setup.fetcher).toHaveBeenCalledTimes(2);
    expect(setup.connected).toHaveBeenLastCalledWith(false);
  });

  it('refreshes device authorization after a rejected connection', async () => {
    vi.useFakeTimers();
    const unauthorized = vi.fn();
    const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 401 }));
    const owner = subscribeArena({ snapshot: vi.fn(), connected: vi.fn(), error: vi.fn(), unauthorized }, fetcher);
    stops.push(owner.stop);
    await vi.advanceTimersByTimeAsync(0);
    expect(unauthorized).toHaveBeenCalledOnce();
  });
});
