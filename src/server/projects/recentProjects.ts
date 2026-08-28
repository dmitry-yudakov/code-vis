import type { DurableConversation, ProjectSummary } from '@/shared/types';

export const RECENT_PROJECT_LIMIT = 5;

type ActivityConversation = Pick<DurableConversation, 'attachments' | 'updatedAt'>;

/**
 * Derives host-local project activity from canonical conversation records. Project order breaks
 * timestamp ties so the result stays deterministic without exposing paths or adding another store.
 */
export function recentProjectIds(
  projects: readonly Pick<ProjectSummary, 'id'>[],
  conversations: readonly ActivityConversation[],
  hostId: string,
  limit = RECENT_PROJECT_LIMIT,
): string[] {
  const projectOrder = new Map(projects.map((project, index) => [project.id, index]));
  const newestActivity = new Map<string, string>();

  for (const conversation of conversations) {
    const primary = conversation.attachments.find((attachment) => attachment.role === 'primary');
    if (!primary || primary.hostId !== hostId || !projectOrder.has(primary.checkoutId)) continue;
    const previous = newestActivity.get(primary.checkoutId);
    if (!previous || conversation.updatedAt > previous) {
      newestActivity.set(primary.checkoutId, conversation.updatedAt);
    }
  }

  return [...newestActivity]
    .sort(([leftId, leftUpdatedAt], [rightId, rightUpdatedAt]) => (
      rightUpdatedAt.localeCompare(leftUpdatedAt)
      || projectOrder.get(leftId)! - projectOrder.get(rightId)!
    ))
    .slice(0, Math.max(0, limit))
    .map(([id]) => id);
}
