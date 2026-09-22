import { cachedLocalProviderHealth } from '@/server/agents/providerRegistry';
import { getConfig } from '@/server/config';
import { getCheckoutRegistry } from '@/server/repository/checkoutRegistry';
import { recentCheckoutIds } from '@/server/repository/recentCheckouts';
import { runRegistry } from '@/server/runs/runRegistry';
import { arenaSessionSummary, getSessionStore } from '@/server/storage/sessionStore';
import type { ExecutorSnapshot } from '@/shared/types';

/** Builds only this executor's projection; attached peers are intentionally never traversed. */
export async function localExecutorSnapshot(): Promise<ExecutorSnapshot> {
  const config = getConfig();
  const store = getSessionStore(config.dataDir, config.hostLabel);
  const [machine, projects, checkouts, sessions, archivedSessions, providers] = await Promise.all([
    store.host(),
    store.listProjects(),
    getCheckoutRegistry(config.repositoriesRoot, config.repositoryDiscoveryDepth).list(),
    store.listSessions(),
    store.listArchivedSessions(),
    cachedLocalProviderHealth(config),
  ]);
  return {
    machine,
    projects,
    checkouts,
    recentCheckoutIds: recentCheckoutIds(checkouts, sessions, machine.id),
    providers,
    sessions: sessions.map(arenaSessionSummary),
    archivedSessions: archivedSessions.map(arenaSessionSummary),
    runs: runRegistry.list(),
  };
}
