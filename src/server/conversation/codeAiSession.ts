import { realpath } from 'node:fs/promises';
import type { AppConfig } from '@/server/config';
import { getCodeAiLifecycle } from '@/server/lifecycle/codeAiLifecycle';
import { getCheckoutRegistry } from '@/server/repository/checkoutRegistry';
import { resolveSelfProject } from '@/server/repository/selfProject';
import { projectBindingsFingerprint } from '@/server/storage/creationRequests';
import { getSessionStore, SessionStoreError } from '@/server/storage/sessionStore';
import type { CodeAiSessionAvailability, PreparedCodeAiContext } from '@/shared/codeAiSession';

export async function codeAiSessionAvailability(config: AppConfig): Promise<CodeAiSessionAvailability> {
  const lifecycle = getCodeAiLifecycle();
  if (!lifecycle?.managed) return { available: false, reason: 'not-managed' };
  const installation = await realpath(config.installationRoot);
  const checkout = (await getCheckoutRegistry(config.repositoriesRoot, config.repositoryDiscoveryDepth).refresh())
    .find((item) => item.realPath === installation && !item.worktree);
  if (!checkout) return { available: false, reason: 'checkout-unavailable', message: 'Add the running CodeAI checkout to repository discovery to start a CodeAI session.' };
  const machine = await getSessionStore(config.dataDir, config.hostLabel).host();
  return { available: true, machineId: machine.id, phase: lifecycle.snapshot().phase, checkoutId: checkout.id, checkoutName: checkout.name };
}

export async function prepareCodeAiSession(config: AppConfig) {
  const availability = await codeAiSessionAvailability(config);
  if (!availability.available) throw new SessionStoreError('conflict', availability.message || 'This CodeAI server is not managed.');
  if (availability.phase !== 'idle') throw new SessionStoreError('conflict', 'CodeAI is building or restarting. Keep the draft and retry once it is ready.');
  const project = await getSessionStore(config.dataDir, config.hostLabel).createProject('CodeAI', [availability.checkoutId], { reusePrimary: true });
  return { availability, project, preparedContext: { projectId: project.id, checkoutId: availability.checkoutId,
    bindingsFingerprint: projectBindingsFingerprint(project) } satisfies PreparedCodeAiContext };
}

export async function validatePreparedCodeAiSession(context: PreparedCodeAiContext, config: AppConfig): Promise<void> {
  const lifecycle = getCodeAiLifecycle();
  if (!lifecycle?.managed) throw new SessionStoreError('conflict', 'This CodeAI server is no longer managed.');
  if (lifecycle.snapshot().phase !== 'idle') throw new SessionStoreError('conflict', 'CodeAI is building or restarting. Keep the draft and retry once it is ready.');
  const project = await resolveSelfProject(context.projectId, config);
  if (!project || project.repositories.find((binding) => binding.role === 'primary')?.checkoutId !== context.checkoutId
    || projectBindingsFingerprint(project) !== context.bindingsFingerprint) {
    throw new SessionStoreError('conflict', 'The prepared CodeAI project repositories changed. Prepare the session again.');
  }
}
