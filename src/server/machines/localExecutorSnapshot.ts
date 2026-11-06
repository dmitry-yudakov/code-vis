import { cachedLocalProviderHealth } from '@/server/agents/providerRegistry';
import { getConfig } from '@/server/config';
import { getCheckoutRegistry } from '@/server/repository/checkoutRegistry';
import { recentCheckoutIds } from '@/server/repository/recentCheckouts';
import { runRegistry } from '@/server/runs/runRegistry';
import { getSessionStore } from '@/server/storage/sessionStore';
import { autoArchiveSessions } from '@/server/storage/autoArchiveSessions';
import type { ExecutorSnapshot } from '@/shared/types';
import { worktreeCapability } from '@/server/repository/managedWorktrees';

/** Builds only this executor's projection; attached peers are intentionally never traversed. */
export async function localExecutorSnapshot(config = getConfig()): Promise<ExecutorSnapshot> {
  const store = getSessionStore(config.dataDir, config.hostLabel);
  await autoArchiveSessions(config);
  const [machine, projects, checkouts, sessions, archivedSessions, providers] = await Promise.all([
    store.host(),
    store.listProjects(),
    getCheckoutRegistry(config.repositoriesRoot, config.repositoryDiscoveryDepth).list(),
    store.listSessionSummaries(),
    store.listSessionSummaries({ archived: true }),
    cachedLocalProviderHealth(config),
  ]);
  return {
    worktrees: await worktreeCapability(config),
    machine,
    ...(config.securityLevel === 'native' ? { securityLevel: 'native' as const } : {}),
    projects,
    checkouts,
    recentCheckoutIds: recentCheckoutIds(checkouts, sessions, machine.id),
    providers,
    sessions: sessions.map(({ repositories, ...summary }) => summary),
    archivedSessions: archivedSessions.map(({ repositories, ...summary }) => summary),
    runs: runRegistry.list(),
  };
}
