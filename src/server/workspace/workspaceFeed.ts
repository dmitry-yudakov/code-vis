import type { AppConfig } from '@/server/config';
import { getConfig } from '@/server/config';
import { getSessionStore } from '@/server/storage/sessionStore';
import { SESSION_INACTIVITY_MS } from '@/server/storage/autoArchiveSessions';
import { runRegistry } from '@/server/runs/runRegistry';
import { localExecutorSnapshot } from '@/server/machines/localExecutorSnapshot';
import { getMachineRegistry, type MachineConnection } from '@/server/machines/machineRegistry';
import { machineAuthorization } from '@/server/machines/machineClient';
import { executorSnapshotSchema } from '@/shared/machineSchema';
import type { ArenaMachineSnapshot, ArenaSnapshot, ExecutorSnapshot, ProviderHealth } from '@/shared/types';
import {
  EXECUTOR_SNAPSHOT_BYTES, WORKSPACE_STALE_MS, WORKSPACE_STREAM_TYPE, readWorkspaceStream,
} from '@/shared/workspaceStream';
import { SnapshotFeed } from './snapshotFeed';
import { subscribeWorkspaceChanges } from './workspaceChanges';
import { watchWorkspaceFiles } from './watchWorkspaceFiles';

const unavailable: ProviderHealth = { available: false, authenticated: 'unknown', supportedModes: [], message: 'This execution machine is offline.' };

export function remoteProjection(connection: MachineConnection, snapshot: ExecutorSnapshot | undefined,
  online: boolean, lastSeenAt = connection.lastSeenAt): ArenaMachineSnapshot {
  const cached = snapshot ?? connection.cachedSnapshot;
  return {
    machine: { id: connection.machine.id, label: cached?.machine.label ?? connection.machine.label, kind: 'remote',
      state: online ? 'online' : 'offline', ...(lastSeenAt ? { lastSeenAt } : {}) },
    projects: cached?.projects ?? [], checkouts: cached?.checkouts ?? [], recentCheckoutIds: cached?.recentCheckoutIds ?? [],
    ...(cached?.securityLevel === 'native' ? { securityLevel: 'native' as const } : {}),
    providers: online && cached ? cached.providers : { claude: unavailable, codex: unavailable },
    sessions: cached?.sessions ?? [], archivedSessions: cached?.archivedSessions ?? [],
    runs: online && cached ? cached.runs : { active: [], recent: [] },
    ...(cached?.worktrees ? { worktrees: cached.worktrees } : {}),
  };
}

interface Peer {
  connection: MachineConnection;
  key: string;
  snapshot?: ExecutorSnapshot;
  online: boolean;
  lastSeenAt?: string;
  restart(): void;
  stop(): void;
}

/** A single upstream per attached executor. Heartbeats only renew liveness, never fetch snapshots. */
function subscribePeer(connection: MachineConnection, config: AppConfig, changed: () => void): Peer {
  let stopped = false;
  let attempt: AbortController | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  let delay = 1_000;
  const peer: Peer = {
    connection, key: JSON.stringify([connection.origin, connection.credential, connection.expiresAt]),
    online: false, lastSeenAt: connection.lastSeenAt,
    restart() { attempt?.abort(); if (retry) clearTimeout(retry); delay = 1_000; void connect(); },
    stop() { stopped = true; attempt?.abort(); if (retry) clearTimeout(retry); if (expiry) clearTimeout(expiry); },
  };
  async function connect() {
    if (stopped || Date.parse(connection.expiresAt) <= Date.now()) return;
    const controller = attempt = new AbortController();
    let watchdog = setTimeout(() => controller.abort(), 5_000);
    const alive = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => controller.abort(), WORKSPACE_STALE_MS);
      watchdog.unref?.();
      peer.lastSeenAt = new Date().toISOString();
    };
    try {
      const response = await fetch(`${connection.origin}/api/machine/snapshot`, {
        headers: { Authorization: machineAuthorization(connection.credential), Accept: WORKSPACE_STREAM_TYPE },
        redirect: 'error', cache: 'no-store', signal: controller.signal,
      });
      if (!response.ok || !response.headers.get('content-type')?.includes(WORKSPACE_STREAM_TYPE)) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error('Executor workspace subscription is unavailable.');
      }
      alive();
      await readWorkspaceStream<unknown>(response, {
        heartbeat: alive,
        snapshot(value) {
          const snapshot = executorSnapshotSchema.parse(value) as ExecutorSnapshot;
          if (snapshot.machine.id !== connection.machine.id) throw new Error('Executor returned a different machine identity.');
          if (attempt !== controller || stopped) return;
          alive();
          peer.snapshot = snapshot;
          peer.online = true;
          delay = 1_000;
          changed();
          // Persistence is for recovery; observe never emits topology notifications.
          void getMachineRegistry(config.dataDir).observe(connection.machine.id, snapshot, peer.lastSeenAt).catch(() => undefined);
        },
      }, EXECUTOR_SNAPSHOT_BYTES + 1_024);
      throw new Error('Executor workspace subscription ended.');
    } catch {
      if (attempt !== controller || stopped) return;
      peer.online = false;
      changed();
      retry = setTimeout(() => void connect(), delay);
      retry.unref?.();
      delay = Math.min(delay * 2, 30_000);
    } finally { clearTimeout(watchdog); }
  }
  const untilExpiry = () => {
    const remaining = Date.parse(connection.expiresAt) - Date.now();
    if (remaining <= 0) { peer.stop(); peer.online = false; changed(); return; }
    expiry = setTimeout(untilExpiry, Math.min(remaining, 2_147_483_647));
    expiry.unref?.();
  };
  untilExpiry();
  void connect();
  return peer;
}

function createWorkspaceFeeds(config: AppConfig) {
  const peers = new Map<string, Peer>();
  let local: ExecutorSnapshot | undefined;
  let archiveTimer: ReturnType<typeof setTimeout> | undefined;
  let executorGeneration = 0;
  let arenaGeneration = 0;
  const executor = new SnapshotFeed<ExecutorSnapshot>(async () => {
    const generation = executorGeneration;
    const snapshot = await localExecutorSnapshot(config);
    if (generation !== executorGeneration) return undefined;
    if (archiveTimer) clearTimeout(archiveTimer);
    const now = Date.now();
    let delay = Infinity;
    for (const session of snapshot.sessions) {
      const remaining = Date.parse(session.updatedAt) + SESSION_INACTIVITY_MS + 1 - now;
      if (remaining > 0) delay = Math.min(delay, remaining);
      // Overdue live turns wake us at finish/release. Failed housekeeping retries at a bounded rate.
      else if (!runRegistry.hasLiveSession(session.id)) delay = Math.min(delay, 30_000);
    }
    if (Number.isFinite(delay)) {
      archiveTimer = setTimeout(() => executor.refresh(), Math.min(delay, 2_147_483_647));
      archiveTimer.unref?.();
    }
    return snapshot;
  }, async (invalidate, fail) => {
    const generation = ++executorGeneration;
    await getSessionStore(config.dataDir, config.hostLabel).host();
    const releaseRuns = runRegistry.subscribeChanges(invalidate);
    const releaseChanges = subscribeWorkspaceChanges(config.dataDir, scope => { if (scope === 'local') invalidate(); });
    const releaseFiles = watchWorkspaceFiles(config.dataDir, scope => {
      if (scope === 'local') invalidate();
      else arena.refresh();
    }, fail);
    return () => {
      releaseRuns(); releaseChanges(); releaseFiles();
      if (generation === executorGeneration) {
        executorGeneration++;
        if (archiveTimer) clearTimeout(archiveTimer);
      }
    };
  });
  const arena = new SnapshotFeed<ArenaSnapshot>(async () => {
    const generation = arenaGeneration;
    const connections = await getMachineRegistry(config.dataDir).list();
    if (generation !== arenaGeneration) return undefined;
    const retained = new Set(connections.map(connection => connection.machine.id));
    for (const [id, peer] of peers) if (!retained.has(id)) { peer.stop(); peers.delete(id); }
    for (const connection of connections) {
      const existing = peers.get(connection.machine.id);
      const key = JSON.stringify([connection.origin, connection.credential, connection.expiresAt]);
      if (existing?.key === key) { existing.connection = connection; continue; }
      existing?.stop();
      peers.set(connection.machine.id, subscribePeer(connection, config, () => arena.refresh()));
    }
    if (!local) return undefined;
    return { machines: [{ ...local, machine: { ...local.machine, kind: 'local', state: 'online' } },
      ...connections.map(connection => {
        const peer = peers.get(connection.machine.id)!;
        return remoteProjection(connection, peer.snapshot, peer.online, peer.lastSeenAt);
      })] };
  }, (invalidate, fail) => {
    const generation = ++arenaGeneration;
    const releaseLocal = executor.subscribe(snapshot => {
      if (generation === arenaGeneration) { local = snapshot; invalidate(); }
    }, fail);
    const releaseChanges = subscribeWorkspaceChanges(config.dataDir, scope => { if (scope === 'machines') invalidate(); });
    return () => {
      releaseLocal(); releaseChanges();
      if (generation === arenaGeneration) {
        arenaGeneration++;
        local = undefined;
        for (const peer of peers.values()) peer.stop();
        peers.clear();
      }
    };
  });
  return { executor, arena, refresh() { executor.refresh(); arena.refresh(); for (const peer of peers.values()) peer.restart(); } };
}

type WorkspaceFeeds = ReturnType<typeof createWorkspaceFeeds>;
const state = globalThis as typeof globalThis & { __codeaiWorkspaceFeeds?: Map<string, WorkspaceFeeds> };
const feeds = state.__codeaiWorkspaceFeeds ??= new Map<string, WorkspaceFeeds>();

export function workspaceFeeds(config = getConfig()): WorkspaceFeeds {
  let feed = feeds.get(config.dataDir);
  if (!feed) { feed = createWorkspaceFeeds(config); feeds.set(config.dataDir, feed); }
  return feed;
}

/** Explicit refresh/activation also rechecks discovery and provider readiness, without an idle timer. */
export function refreshWorkspaceFeeds(config = getConfig()): void {
  feeds.get(config.dataDir)?.refresh();
}
