import type { ImmersiveSessionChoice } from '@/features/diagram/spatial/immersiveTypes';

export const CONVERSATION_LIST_BATCH_SIZE = 20;

function activityTime(value?: string): number {
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? time : 0;
}

export function sortConversationChoices(choices: readonly ImmersiveSessionChoice[]): ImmersiveSessionChoice[] {
  return [...choices].sort((a, b) => activityTime(b.updatedAt) - activityTime(a.updatedAt)
    || a.machineId.localeCompare(b.machineId) || a.sessionId.localeCompare(b.sessionId));
}

export function formatConversationActivityTime(value: string | undefined, now: number): string {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Update time unavailable';
  const minutes = Math.max(0, Math.floor((now - Date.parse(value)) / 60_000));
  if (minutes < 1) return 'Updated just now';
  if (minutes < 60) return `Updated ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Updated ${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `Updated ${days}d ago`;
  return `Updated ${new Date(value).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })}`;
}
