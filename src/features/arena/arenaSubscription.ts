import type { ArenaSnapshot } from '@/shared/types';
import { ARENA_SNAPSHOT_BYTES, WORKSPACE_STALE_MS, WORKSPACE_STREAM_TYPE, readWorkspaceStream } from '@/shared/workspaceStream';

/** One stream per browser tab, with fresh snapshots after interruption and explicit refresh. */
export function subscribeArena(input: {
  snapshot(value: ArenaSnapshot): void;
  connected(value: boolean): void;
  error(message: string | undefined): void;
  unauthorized(): void;
}, fetcher: typeof fetch = fetch): { refresh(): Promise<void>; stop(): void } {
  let stopped = false;
  let generation = 0;
  let controller: AbortController | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let refreshPromise: Promise<void> | undefined;
  let delay = 1_000;
  const apply = (value: ArenaSnapshot) => {
    if (!value || !Array.isArray(value.machines)) throw new Error('Invalid workspace snapshot.');
    input.snapshot(value);
  };
  const connect = async (refreshed = false) => {
    if (stopped) return;
    const current = ++generation;
    const abort = controller = new AbortController();
    let observed = false;
    // A just-read JSON snapshot remains fresh while its replacement stream starts, preserving
    // command focus/availability. Heartbeats alone cannot extend that temporary freshness.
    const freshness = refreshed ? setTimeout(() => {
      if (!stopped && current === generation && !observed) {
        input.connected(false); input.error('Waiting for the current workspace snapshot.');
      }
    }, WORKSPACE_STALE_MS) : undefined;
    let watchdog: ReturnType<typeof setTimeout>;
    const alive = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => abort.abort(), WORKSPACE_STALE_MS);
      if (!observed) return; // Heartbeats prove transport liveness, not recovery of cached cards.
      input.connected(true);
      input.error(undefined);
      delay = 1_000;
    };
    watchdog = setTimeout(() => abort.abort(), WORKSPACE_STALE_MS);
    try {
      const response = await fetcher('/api/arena', { cache: 'no-store', signal: abort.signal,
        headers: { Accept: WORKSPACE_STREAM_TYPE } });
      if (response.status === 401 || response.status === 403) input.unauthorized();
      if (response.status === 429) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error('Live overview updates are paused while agent connections are busy. Reconnecting…');
      }
      if (!response.ok || !response.headers.get('content-type')?.includes(WORKSPACE_STREAM_TYPE)) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error('Could not subscribe to workspace updates.');
      }
      await readWorkspaceStream<ArenaSnapshot>(response, {
        snapshot(value) { if (stopped || current !== generation) return; apply(value); observed = true; alive(); },
        heartbeat() { if (!stopped && current === generation) alive(); },
      }, ARENA_SNAPSHOT_BYTES);
      throw new Error('Workspace connection closed. Reconnecting…');
    } catch (cause) {
      if (stopped || current !== generation) return;
      input.connected(false);
      input.error(cause instanceof Error ? cause.message : 'Workspace connection lost. Reconnecting…');
      retry = setTimeout(() => void connect(), delay);
      delay = Math.min(delay * 2, 30_000);
    } finally { clearTimeout(watchdog); clearTimeout(freshness); }
  };
  const refresh = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    // Preserve best-effort refresh semantics: a command need not wait for another caller's read.
    if (refreshPromise) return Promise.resolve();
    const current = ++generation;
    controller?.abort();
    if (retry) clearTimeout(retry);
    const abort = controller = new AbortController();
    const timeout = setTimeout(() => abort.abort(), WORKSPACE_STALE_MS);
    refreshPromise = (async () => {
      let refreshed = false;
      try {
        const response = await fetcher('/api/arena', { cache: 'no-store', signal: abort.signal });
        if (response.status === 401 || response.status === 403) input.unauthorized();
        if (!response.ok) throw new Error('Could not refresh the Arena.');
        const value = await response.json() as ArenaSnapshot;
        if (stopped || generation !== current) return;
        apply(value);
        refreshed = true;
        input.connected(true);
        input.error(undefined);
      } catch (cause) {
        if (!stopped && generation === current) {
          input.connected(false);
          input.error(cause instanceof Error ? cause.message : 'Could not refresh the Arena.');
        }
      } finally {
        clearTimeout(timeout);
        refreshPromise = undefined;
        if (!stopped && generation === current) void connect(refreshed);
      }
    })();
    return refreshPromise;
  };
  void connect();
  return { refresh, stop() {
    stopped = true;
    generation++;
    controller?.abort();
    if (retry) clearTimeout(retry);
  } };
}
