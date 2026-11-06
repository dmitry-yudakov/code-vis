import { afterEach, describe, expect, it, vi } from 'vitest';
import { SnapshotFeed } from '@/server/workspace/snapshotFeed';
import { snapshotStream } from '@/server/workspace/snapshotStream';
import { readWorkspaceStream, WORKSPACE_HEARTBEAT_MS } from '@/shared/workspaceStream';
import { RunRegistry } from '@/server/runs/runRegistry';

afterEach(() => vi.useRealTimers());

describe('shared workspace snapshots', () => {
  it('expires recent run discovery without a later polling request', async () => {
    vi.useFakeTimers();
    const registry = new RunRegistry(2);
    const changed = vi.fn();
    const release = registry.subscribeChanges(changed);
    const runId = crypto.randomUUID();
    registry.start({ runId, sessionId: crypto.randomUUID(), participantId: 'agent', cancel() {} });
    registry.finish(runId);
    expect(registry.list().recent).toHaveLength(1);
    changed.mockClear();
    await vi.advanceTimersByTimeAsync(300_001);
    expect(changed).toHaveBeenCalledOnce();
    expect(registry.list().recent).toEqual([]);
    release();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('shares initial work, coalesces bursts, and does no snapshot work while idle', async () => {
    vi.useFakeTimers();
    let changed = () => undefined as void;
    let value = 1;
    const load = vi.fn(async () => ({ value }));
    const stop = vi.fn();
    const feed = new SnapshotFeed(load, invalidate => { changed = invalidate; return stop; });
    const first = vi.fn(), second = vi.fn();
    const detach = feed.subscribe(first, vi.fn());
    const other = feed.subscribe(second, vi.fn());
    await vi.advanceTimersByTimeAsync(100);
    expect(load).toHaveBeenCalledOnce();
    expect(first).toHaveBeenLastCalledWith({ value: 1 });
    expect(second).toHaveBeenLastCalledWith({ value: 1 });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(load).toHaveBeenCalledOnce();
    value = 2;
    for (let i = 0; i < 1_000; i++) changed();
    await vi.advanceTimersByTimeAsync(100);
    expect(load).toHaveBeenCalledTimes(2);
    expect(first).toHaveBeenLastCalledWith({ value: 2 });
    detach();
    expect(stop).not.toHaveBeenCalled();
    other();
    expect(stop).toHaveBeenCalledOnce();
    changed();
    await vi.advanceTimersByTimeAsync(100);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('reconciles changes during a load and ignores late work after the last subscriber leaves', async () => {
    vi.useFakeTimers();
    let changed = () => undefined as void;
    let release!: (value: number) => void;
    const load = vi.fn(() => new Promise<number>(resolve => { release = resolve; }));
    const feed = new SnapshotFeed(load, invalidate => { changed = invalidate; return () => undefined; });
    const receive = vi.fn();
    const detach = feed.subscribe(receive, vi.fn());
    await vi.advanceTimersByTimeAsync(100);
    changed();
    release(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(load).toHaveBeenCalledTimes(2);
    detach();
    release(2);
    await vi.advanceTimersByTimeAsync(100);
    expect(receive).toHaveBeenCalledTimes(1);
    const again = feed.subscribe(receive, vi.fn());
    await vi.advanceTimersByTimeAsync(100);
    release(3);
    await vi.advanceTimersByTimeAsync(100);
    expect(receive).toHaveBeenLastCalledWith(3);
    again();
  });

  it('keeps only the latest pending snapshot and rechecks authorization during quiet streams', async () => {
    vi.useFakeTimers();
    let publish!: (value: number) => void;
    const release = vi.fn();
    let denied = false;
    const response = snapshotStream(new Request('http://localhost/api/arena'), {
      subscribe: receive => { publish = receive; return release; },
      authorize: async () => denied ? new Response(null, { status: 401 }) : undefined,
    });
    publish(1);
    publish(2);
    publish(3);
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('{"type":"snapshot","snapshot":3}\n');
    denied = true;
    await vi.advanceTimersByTimeAsync(WORKSPACE_HEARTBEAT_MS);
    await expect(reader.read()).rejects.toThrow();
    expect(release).toHaveBeenCalledOnce();
  });

  it('tears down failed sources and allows a fresh subscription to recover', async () => {
    vi.useFakeTimers();
    const stop = vi.fn(), failed = vi.fn();
    const load = vi.fn(async () => 1).mockRejectedValueOnce(new Error('read failed'));
    const feed = new SnapshotFeed(load, () => stop);
    const receive = vi.fn();
    const old = feed.subscribe(receive, failed);
    await vi.advanceTimersByTimeAsync(100);
    expect(failed).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
    const current = feed.subscribe(receive, failed);
    old(); // An old connection's cleanup cannot stop its replacement.
    await vi.advanceTimersByTimeAsync(100);
    expect(receive).toHaveBeenLastCalledWith(1);
    current();
    expect(stop).toHaveBeenCalledTimes(2);
  });

  it('ends subscriptions on request abort and refuses oversized frames', async () => {
    const abort = new AbortController();
    const release = vi.fn();
    const response = snapshotStream(new Request('http://localhost', { signal: abort.signal }), {
      subscribe: receive => { receive('too large'); return release; }, authorize: async () => undefined,
      maximumBytes: 8,
    });
    await expect(response.body!.getReader().read()).rejects.toThrow();
    expect(release).toHaveBeenCalledOnce();
    const other = snapshotStream(new Request('http://localhost', { signal: abort.signal }), {
      subscribe: () => release, authorize: async () => undefined,
    });
    abort.abort();
    await expect(other.body!.getReader().read()).rejects.toThrow();
    expect(release).toHaveBeenCalledTimes(2);
  });
});

describe('workspace stream framing', () => {
  it('decodes split Unicode frames and heartbeats without an EOF requirement', async () => {
    const bytes = new TextEncoder().encode('{"type":"snapshot","snapshot":"✓"}\n{"type":"heartbeat"}\n');
    const response = new Response(new ReadableStream({ start(controller) {
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    } }));
    const snapshot = vi.fn(), heartbeat = vi.fn();
    await readWorkspaceStream(response, { snapshot, heartbeat }, 100);
    expect(snapshot).toHaveBeenCalledWith('✓');
    expect(heartbeat).toHaveBeenCalledOnce();
  });

  it.each(['{"type":"unknown"}\n', '{bad}\n', '{"type":"snapshot"}\n', 'unfinished'])('rejects malformed or incomplete frames: %s', async body => {
    await expect(readWorkspaceStream(new Response(body), { snapshot: vi.fn(), heartbeat: vi.fn() }, 100)).rejects.toThrow();
  });

  it('rejects an oversized unterminated frame', async () => {
    await expect(readWorkspaceStream(new Response('123456789'), { snapshot: vi.fn(), heartbeat: vi.fn() }, 8)).rejects.toThrow();
  });
});
