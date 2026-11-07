import { describe, expect, it } from 'vitest';
import { createArenaReplyStore, parseArenaReplies, serializeArenaReplies, type ArenaReplyState } from '@/features/arena/arenaReplyDrafts';

const key = `${crypto.randomUUID()}:${crypto.randomUUID()}`;
describe('tab-local Arena reply recovery', () => {
  it('updates only the edited tile among a hundred subscriptions and exposes the latest text synchronously', () => {
    const store = createArenaReplyStore(), notifications = Array.from({ length: 100 }, () => 0);
    const unsubscribe = notifications.map((_, i) => store.subscribe(String(i), () => { notifications[i]++; }));
    for (const text of ['L', 'Latest']) store.patch('42', { text });
    expect(store.get('42').text).toBe('Latest');
    expect(notifications[42]).toBe(2);
    expect(notifications.reduce((sum, count) => sum + count, 0)).toBe(2);
    unsubscribe.forEach(stop => stop());
    store.patch('42', { text: 'After unmount' });
    expect(notifications[42]).toBe(2);
  });
  it('retains text and exact uncertain request choices across reload, excluding transient UI state', () => {
    const draft: ArenaReplyState = { text: 'Keep this instruction', busy: true, error: 'Connection lost',
      delivery: { messageId: crypto.randomUUID(), participantId: 'main-agent', mode: 'plan', modelSelection: { model: 'opus', effort: 'high' } } };
    const serialized = serializeArenaReplies({ [key]: draft });
    expect(parseArenaReplies(serialized)[key]).toEqual({ text: draft.text, delivery: draft.delivery });
    expect(serialized).not.toContain('busy');
    expect(serialized).not.toContain('Connection lost');
    expect(parseArenaReplies(serializeArenaReplies({ [key]: { text: '', sent: true } }))).toEqual({});
  });
  it('ignores malformed records and oversized or invalid requests without losing valid drafts', () => {
    for (const value of [null, '{broken', '{"version":2}', '{"version":1,"drafts":null}']) expect(parseArenaReplies(value)).toEqual({});
    expect(parseArenaReplies(JSON.stringify({ version: 1, drafts: { [key]: { text: 'Valid', mode: 'plan' },
      unknown: { text: 'wrong key' }, [`${crypto.randomUUID()}:${crypto.randomUUID()}`]: { text: 'x'.repeat(8001) } } }))).toEqual({ [key]: { text: 'Valid' } });
    expect(parseArenaReplies(JSON.stringify({ version: 1, drafts: { [key]: { text: 'Unsafe retry', delivery: { messageId: 'bad', mode: 'full' } } } }))).toEqual({});
  });
  it('drops old tile mode overrides while preserving the exact mode of a pending Native reply', () => {
    const delivery = { messageId: crypto.randomUUID(), participantId: 'main-agent', mode: 'full', modelSelection: {} };
    const restored = parseArenaReplies(JSON.stringify({ version: 1, drafts: { [key]: { text: 'Original instruction', mode: 'ask', delivery } } }));
    expect(restored[key]).toEqual({ text: 'Original instruction', delivery });
    expect(parseArenaReplies(serializeArenaReplies(restored))).toEqual(restored);
  });
  it('keeps pending image count for recovery without writing image pixels or preparation state to storage', () => {
    const image = { id: 'clipboard-image', dataUrl: 'data:image/png;base64,PRIVATE_PIXELS', mediaType: 'image/png' as const, bytes: 12, width: 2, height: 2 };
    const draft: ArenaReplyState = { text: '', images: [image], preparing: true,
      delivery: { messageId: crypto.randomUUID(), participantId: 'main-agent', mode: 'ask', modelSelection: {}, imageCount: 1 } };
    const serialized = serializeArenaReplies({ [key]: draft });
    expect(serialized).not.toContain('PRIVATE_PIXELS');
    expect(serialized).not.toContain('preparing');
    expect(parseArenaReplies(serialized)[key]).toEqual({ text: '', delivery: draft.delivery });
    expect(serializeArenaReplies({ [key]: { text: 'Keep text', images: [image] } })).not.toContain('data:image');
    expect(parseArenaReplies(JSON.stringify({ version: 1, drafts: { [key]: { ...draft, delivery: { ...draft.delivery, imageCount: 5 } } } }))).toEqual({});
  });
});
