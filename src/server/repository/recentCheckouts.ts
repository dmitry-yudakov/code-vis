import type { CheckoutSummary, DurableSession } from '@/shared/types';

export const RECENT_CHECKOUT_LIMIT = 5;

type ActivitySession = Pick<DurableSession, 'repositories' | 'updatedAt'>;

/** Derives host-local checkout activity from canonical session records. */
export function recentCheckoutIds(
  checkouts: readonly Pick<CheckoutSummary, 'id'>[],
  sessions: readonly ActivitySession[],
  hostId: string,
  limit = RECENT_CHECKOUT_LIMIT,
): string[] {
  const checkoutOrder = new Map(checkouts.map((checkout, index) => [checkout.id, index]));
  const newestActivity = new Map<string, string>();

  for (const session of sessions) {
    const primary = session.repositories.find((repository) => repository.role === 'primary');
    if (!primary || primary.hostId !== hostId || !checkoutOrder.has(primary.checkoutId)) continue;
    const previous = newestActivity.get(primary.checkoutId);
    if (!previous || session.updatedAt > previous) newestActivity.set(primary.checkoutId, session.updatedAt);
  }

  return [...newestActivity]
    .sort(([leftId, leftUpdatedAt], [rightId, rightUpdatedAt]) => (
      rightUpdatedAt.localeCompare(leftUpdatedAt)
      || checkoutOrder.get(leftId)! - checkoutOrder.get(rightId)!
    ))
    .slice(0, Math.max(0, limit))
    .map(([id]) => id);
}
