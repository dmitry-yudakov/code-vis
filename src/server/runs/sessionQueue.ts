import path from 'node:path';
import type { getCheckoutRegistry } from '@/server/repository/checkoutRegistry';
import { primaryRepository, type SessionStore } from '@/server/storage/sessionStore';
import type { DurableSession, ServerCheckout } from '@/shared/types';

/** Read-only checkout discovery is safe inside the store's serialized admission snapshot. */
export async function sessionQueueBlockers(
  sessions: Awaited<ReturnType<SessionStore['listSessionSummaries']>>,
  session: DurableSession,
  checkout: ServerCheckout,
  registry: Pick<ReturnType<typeof getCheckoutRegistry>, 'refresh'>,
): Promise<string[]> {
  const primary = primaryRepository(session)!;
  let paths: Map<string, string> | undefined;
  const blockers: string[] = [];
  for (const earlier of sessions) {
    const repository = primaryRepository(earlier);
    if (earlier.id === session.id || !earlier.lastActivity || repository?.hostId !== primary.hostId) continue;
    if (repository.checkoutId === checkout.id) { blockers.push(earlier.id); continue; }
    paths ??= new Map((await registry.refresh()).filter(item => !item.unavailableReason).map(item => [item.id, item.realPath]));
    const otherPath = paths.get(repository.checkoutId);
    if (otherPath && (contains(checkout.realPath, otherPath) || contains(otherPath, checkout.realPath))) blockers.push(earlier.id);
  }
  return blockers;
}

function contains(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}
