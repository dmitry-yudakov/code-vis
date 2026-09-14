import { describe, expect, it } from 'vitest';
import type { ImmersiveSessionChoice } from '@/features/diagram/spatial/immersiveTypes';
import { formatConversationActivityTime, sortConversationChoices } from '@/features/shell/immersive/conversationListModel';

describe('immersive conversation list', () => {
  it('sorts activity across machines with deterministic ties and missing dates last', () => {
    const choice = (sessionId: string, machineId: string, updatedAt?: string): ImmersiveSessionChoice => ({ sessionId, machineId, updatedAt, title: sessionId, detail: '' });
    const input = [choice('old', 'a', '2026-08-01'), choice('missing', 'a'), choice('new', 'b', '2026-09-11'),
      choice('same', 'a', '2026-09-11'), choice('invalid', 'b', 'bad')];
    expect(sortConversationChoices(input).map((item) => item.sessionId)).toEqual(['same', 'new', 'old', 'missing', 'invalid']);
    expect(input[0].sessionId).toBe('old');
  });

  it('labels recent activity, future clock skew, older dates, and unavailable timestamps', () => {
    const now = Date.parse('2026-09-11T12:00:00Z');
    const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
    expect(formatConversationActivityTime(ago(-5), now)).toBe('Updated just now');
    expect(formatConversationActivityTime(ago(0), now)).toBe('Updated just now');
    expect(formatConversationActivityTime(ago(17), now)).toBe('Updated 17m ago');
    expect(formatConversationActivityTime(ago(60), now)).toBe('Updated 1h ago');
    expect(formatConversationActivityTime(ago(2_880), now)).toBe('Updated 2d ago');
    expect(formatConversationActivityTime('2025-05-01T12:00:00Z', now)).toBe('Updated May 1, 2025');
    expect(formatConversationActivityTime(undefined, now)).toBe('Update time unavailable');
    expect(formatConversationActivityTime('invalid', now)).toBe('Update time unavailable');
  });
});
