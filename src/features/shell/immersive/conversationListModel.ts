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

/** "3m ago", for a column that is already about time. Undefined when the record carries no usable time. */
export function relativeActivityTime(value: string | undefined, now: number): string | undefined {
  if (!value || !Number.isFinite(Date.parse(value))) return undefined;
  const minutes = Math.max(0, Math.floor((now - Date.parse(value)) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(value).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatConversationActivityTime(value: string | undefined, now: number): string {
  const time = relativeActivityTime(value, now);
  return time ? `Updated ${time}` : 'Update time unavailable';
}
