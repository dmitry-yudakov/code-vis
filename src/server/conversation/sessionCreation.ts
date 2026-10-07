import type { AppConfig } from '@/server/config';
import { getCheckoutRegistry } from '@/server/repository/checkoutRegistry';
import { createManagedWorktree } from '@/server/repository/managedWorktrees';
import { getDockerRuntime } from '@/server/execution/dockerRuntime';
import { validateDockerCheckout } from '@/server/execution/dockerProfile';
import { getSessionStore, SessionStoreError } from '@/server/storage/sessionStore';
import { creationFingerprint, replaySessionCreation, withSessionCreationLock, type SessionCreationRequest } from '@/server/storage/creationRequests';

export async function createRequestedSession(request: SessionCreationRequest, config: AppConfig, beforeCreate?: () => Promise<void>) {
  if (request.checkoutMode === 'worktree') return createManagedWorktree(request, config, beforeCreate);
  return withSessionCreationLock(config.dataDir, async () => {
    const prior = await replaySessionCreation(request, config);
    if (prior) return prior;
    await beforeCreate?.();
    const store = getSessionStore(config.dataDir, config.hostLabel);
    const source = request.sourceSessionId ? await store.getSession(request.sourceSessionId) : undefined;
    const project = request.projectId ? await store.getProject(request.projectId) : undefined;
    const registry = getCheckoutRegistry(config.repositoriesRoot, config.repositoryDiscoveryDepth);
    if (request.checkoutId) await registry.resolve(request.checkoutId);
    if (request.execution === 'docker') {
      const health = await getDockerRuntime(config).health();
      if (!health.available) throw new SessionStoreError('conflict', health.message || 'Docker is unavailable.');
      const host = await store.host();
      const bindings = source?.repositories || project?.repositories || (request.checkoutId ? [{
        checkoutId: request.checkoutId, role: 'primary', hostId: host.id,
      }] : []);
      if (bindings.length !== 1 || bindings[0].role !== 'primary' || bindings[0].hostId !== host.id) {
        throw new Error('Docker requires exactly one primary repository on this machine.');
      }
      await validateDockerCheckout((await registry.resolve(bindings[0].checkoutId)).realPath, config);
    }
    return store.createSession({ ...request, ...(source ? { expectedSourceRevision: source.revision } : {}),
      ...(request.creationRequestId ? { creationReceipt: { requestId: request.creationRequestId, fingerprint: creationFingerprint(request) } } : {}) });
  });
}
