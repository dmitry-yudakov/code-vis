import type { AppConfig } from '@/server/config';
import { recoverDockerExecution } from '@/server/execution/dockerRecovery';
import { runRegistry } from '@/server/runs/runRegistry';
import { getSessionStore, sessionStoreErrorCode, type SessionStore } from './sessionStore';

const INACTIVITY_MS = 48 * 60 * 60 * 1_000;
const scope = globalThis as typeof globalThis & { __codeAiAutoArchiveSweeps?: WeakMap<SessionStore, Promise<void>> };

/** Apply the owner machine's inactivity policy before returning its session collections. */
export function autoArchiveSessions(config: AppConfig, now = Date.now()): Promise<void> {
  const store = getSessionStore(config.dataDir, config.hostLabel);
  // Initial loads and different devices request both collections concurrently. Share the sweep
  // across separately compiled route bundles so none lists files another sweep is moving.
  const sweeps = scope.__codeAiAutoArchiveSweeps ??= new WeakMap();
  let pending = sweeps.get(store);
  if (!pending) {
    pending = sweep(store, config, now).finally(() => { sweeps.delete(store); });
    sweeps.set(store, pending);
  }
  return pending;
}

async function sweep(store: SessionStore, config: AppConfig, now: number): Promise<void> {
  const candidates = (await store.listSessions()).filter((session) => Date.parse(session.updatedAt) < now - INACTIVITY_MS);
  // An orphan worker and its interrupted-delivery record must be recovered before moving its
  // session. A missing daemon keeps Docker records active without blocking Local housekeeping.
  const dockerRecovered = !candidates.some((session) => session.execution === 'docker')
    || await recoverDockerExecution(config).then(() => true, () => false);
  for (const session of candidates) {
    if (session.execution === 'docker' && !dockerRecovered) continue;
    const release = runRegistry.acquireSessionArchive(session.id);
    if (!release) continue;
    try {
      await store.archiveSession(session.id, session.revision);
    } catch (error) {
      const code = sessionStoreErrorCode(error);
      // A newer saved change or another completed sweep wins; reconsider on the next request.
      if (code !== 'conflict' && code !== 'unknown') throw error;
    } finally {
      release();
    }
  }
}
