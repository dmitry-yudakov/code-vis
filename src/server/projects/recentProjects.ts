import type { DurableSession, ProjectSummary } from '@/shared/types';

export const RECENT_PROJECT_LIMIT = 5;

type ActivitySession = Pick<DurableSession, 'attachments' | 'updatedAt'>;

/**
 * Derives host-local project activity from canonical session records. Project order breaks
 * timestamp ties so the result stays deterministic without exposing paths or adding another store.
 */
export function recentProjectIds(
  projects: readonly Pick<ProjectSummary, 'id'>[],
  sessions: readonly ActivitySession[],
  hostId: string,
  limit = RECENT_PROJECT_LIMIT,
): string[] {
  const projectOrder = new Map(projects.map((project, index) => [project.id, index]));
  const newestActivity = new Map<string, string>();

  for (const session of sessions) {
    const primary = session.attachments.find((attachment) => attachment.role === 'primary');
    if (!primary || primary.hostId !== hostId || !projectOrder.has(primary.checkoutId)) continue;
    const previous = newestActivity.get(primary.checkoutId);
    if (!previous || session.updatedAt > previous) {
      newestActivity.set(primary.checkoutId, session.updatedAt);
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
