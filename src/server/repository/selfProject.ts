import { realpath } from 'node:fs/promises';
import type { AppConfig } from '@/server/config';
import { getCheckoutRegistry } from '@/server/repository/checkoutRegistry';
import { getSessionStore, primaryRepository, sessionStoreErrorCode } from '@/server/storage/sessionStore';
import type { DurableProject } from '@/shared/types';

/**
 * A self project's primary repository belongs to this machine and resolves to the same real path as
 * the running installation. Names, request origin, and client claims never make a project eligible,
 * so this is re-checked on every request that reads or attaches reports.
 */
export async function resolveSelfProject(
  projectId: string | undefined,
  config: AppConfig,
): Promise<DurableProject | undefined> {
  if (!projectId) return undefined;
  const store = getSessionStore(config.dataDir, config.hostLabel);
  let project: DurableProject;
  try {
    project = await store.getProject(projectId);
  } catch (error) {
    if (sessionStoreErrorCode(error) === 'unknown') return undefined;
    throw error;
  }
  const primary = primaryRepository(project);
  if (!primary || primary.hostId !== (await store.host()).id) return undefined;
  const [checkout, installation] = await Promise.all([
    getCheckoutRegistry(config.repositoriesRoot, config.repositoryDiscoveryDepth)
      .resolve(primary.checkoutId).catch(() => undefined),
    realpath(config.installationRoot).catch(() => undefined),
  ]);
  return checkout && installation && checkout.realPath === installation ? project : undefined;
}
