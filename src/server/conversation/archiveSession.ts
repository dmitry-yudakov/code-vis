import type { AppConfig } from '@/server/config';
import { recoverDockerExecution } from '@/server/execution/dockerRecovery';
import { runRegistry } from '@/server/runs/runRegistry';
import { getSessionStore, SessionStoreError } from '@/server/storage/sessionStore';
import type { ActivityActor } from '@/shared/activityLog';

/** The browser and integration share live-run exclusion, Docker recovery and queue release. */
export async function archiveSession(sessionId: string, expectedRevision: number, config: AppConfig, authorize?: () => Promise<void>, actor?: ActivityActor) {
  if (runRegistry.hasLiveSession(sessionId)) throw new SessionStoreError('conflict', 'This session has an agent turn reserved, queued, running, or waiting for approval.');
  await recoverDockerExecution(config);
  const release = runRegistry.acquireSessionArchive(sessionId);
  if (!release) throw new SessionStoreError('conflict', 'This session is busy or is already being archived.');
  try {
    const session = await getSessionStore(config.dataDir, config.hostLabel).archiveSession(sessionId, expectedRevision, undefined, authorize, actor);
    runRegistry.sessionArchived(sessionId);
    return session;
  } finally { release(); }
}
