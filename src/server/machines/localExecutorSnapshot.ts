import { getProviderAdapters } from '@/server/agents/providerRegistry';
import { getConfig } from '@/server/config';
import { getCheckoutRegistry } from '@/server/repository/checkoutRegistry';
import { recentCheckoutIds } from '@/server/repository/recentCheckouts';
import { runRegistry } from '@/server/runs/runRegistry';
import { arenaSessionSummary, getSessionStore } from '@/server/storage/sessionStore';
import type { AgentProvider, ExecutorSnapshot, ProviderHealth } from '@/shared/types';

const HEALTH_TTL_MS = 10_000;
let cachedHealth: { key: string; checkedAt: number; providers: Record<AgentProvider, ProviderHealth> } | undefined;
let healthPromise: Promise<Record<AgentProvider, ProviderHealth>> | undefined;

async function providerHealth(): Promise<Record<AgentProvider, ProviderHealth>> {
  const config = getConfig();
  const key = `${config.claudeBin}\0${config.claudeModel || ''}\0${config.codexBin}\0${config.codexModel || ''}\0${config.codexAgentEnabled}`;
  if (cachedHealth?.key === key && Date.now() - cachedHealth.checkedAt < HEALTH_TTL_MS) {
    return structuredClone(cachedHealth.providers);
  }
  if (!healthPromise) {
    const adapters = getProviderAdapters(config);
    healthPromise = Promise.all([adapters.claude.checkHealth(), adapters.codex.checkHealth()])
      .then(([claude, codex]) => {
        const providers = { claude, codex };
        cachedHealth = { key, checkedAt: Date.now(), providers };
        return providers;
      })
      .finally(() => { healthPromise = undefined; });
  }
  return structuredClone(await healthPromise);
}

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
    providerHealth(),
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
