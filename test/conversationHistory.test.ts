import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionSnapshot } from '@/shared/types';
import { buildConversationHistory, conversationScrollFlags, historyScrollState, updateHistoryScroll, visibleHistoryEntries, HISTORY_VIEW_HEIGHT } from '@/features/shell/immersive/conversationHistoryModel';
import { createConversationHistoryResource, paintConversationHistory } from '@/features/shell/immersive/conversationHistoryResource';
import { getImmersiveInstrumentation, SpatialResourceLedger } from '@/features/diagram/spatial/resourceLedger';

function fixture(count = 30): SessionSnapshot {
  return {
    version: 3, revision: 1, id: 'conversation', title: 'History fixture', repositories: [],
    createdAt: '', updatedAt: '', primaryAgentId: 'agent', participants: [{ id: 'human', kind: 'human', displayName: 'Reader' }],
    messages: Array.from({ length: count }, (_, index) => ({
      id: `message-${index}`, role: 'user', authorId: 'human', addressedParticipantId: 'agent',
      text: `Question ${index}`, createdAt: '', status: 'sent', diagramAttachments: [],
    })), pinnedDiagramIds: [], annotations: {}, sketches: [],
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('continuous immersive conversation history', () => {
  it('includes complete long messages and preview while exposing only the visible bubbles', () => {
    const session = fixture();
    if (session.messages[0].role !== 'user') throw new Error('Expected user');
    session.messages[0].text = `  ${'Wide🙂identifier'.repeat(2_000)}\n\n  final instruction`;
    const history = buildConversationHistory(session, 'Streaming '.repeat(2_000));
    expect(history.entries).toHaveLength(31);
    expect(history.entries[0].lines.join('').replaceAll('\n', ''))
      .toBe(session.messages[0].text.replaceAll('\n', ''));
    expect(history.entries.at(-1)?.entry.text).toBe('Streaming '.repeat(2_000));
    expect(visibleHistoryEntries(history.entries, 0).map((item) => item.entry.id)).toEqual(['message-0']);
    const bottom = historyScrollState(Infinity, history.height);
    expect(visibleHistoryEntries(history.entries, bottom.offset).map((item) => item.entry.id)).toEqual(['live-preview']);
    const short = buildConversationHistory(fixture(4));
    expect(visibleHistoryEntries(short.entries, 0)).toHaveLength(4);
  });

  it('follows appended output at the bottom and preserves an older reading offset during streaming', () => {
    const history = buildConversationHistory(fixture());
    const bottom = historyScrollState(Infinity, history.height);
    const grown = updateHistoryScroll(bottom, history.height + 500, true);
    expect(grown).toMatchObject({ offset: bottom.offset + 500, atBottom: true, newActivity: false });
    const older = historyScrollState(bottom.offset - 400, history.height);
    const held = updateHistoryScroll(older, history.height + 500, true);
    expect(held).toMatchObject({ offset: older.offset, atBottom: false, newActivity: true });
    expect(historyScrollState(Infinity, history.height + 500, held.newActivity)).toMatchObject({ atBottom: true, newActivity: false });
  });

  it('re-wraps only the streaming preview while a delta arrives', () => {
    const session = fixture(3);
    const first = buildConversationHistory(session, 'Streaming');
    const delta = buildConversationHistory(session, 'Streaming more');
    // Identity, not equality: wrapping is per character, so a settled message must be reused.
    for (const [index, item] of delta.entries.slice(0, 3).entries()) expect(item.lines).toBe(first.entries[index].lines);
    expect(delta.entries[3].lines).not.toBe(first.entries[3].lines);
    expect(delta.entries[3].lines).toEqual(['Streaming more']);

    if (session.messages[1].role !== 'user') throw new Error('Expected user');
    session.messages[1].text = 'Edited question';
    const edited = buildConversationHistory({ ...session }, 'Streaming more');
    expect(edited.entries[1].lines).toEqual(['Edited question']);
    expect(edited.entries[0].lines).toBe(first.entries[0].lines);

    // The cache holds the live transcript only, so it cannot grow across sessions.
    buildConversationHistory(fixture(2));
    expect(buildConversationHistory(session).entries[2].lines).not.toBe(first.entries[2].lines);
  });

  it('forwards only the scroll flags the workspace chrome reads', () => {
    const start = conversationScrollFlags({ atTop: true, atBottom: true, newActivity: false }, historyScrollState(0, 4_000));
    expect(start).toEqual({ atTop: true, atBottom: false, newActivity: false });
    const moved = conversationScrollFlags(start, historyScrollState(120, 4_000));
    expect(moved).toEqual({ atTop: false, atBottom: false, newActivity: false });
    // A thumbstick moves the offset every frame; the chrome must keep its identity throughout.
    expect(conversationScrollFlags(moved, historyScrollState(400, 4_000))).toBe(moved);
    expect(conversationScrollFlags(moved, historyScrollState(Infinity, 4_000))).toEqual({ atTop: false, atBottom: true, newActivity: false });
    expect(conversationScrollFlags(moved, historyScrollState(200, 4_000, true))).toEqual({ atTop: false, atBottom: false, newActivity: true });
  });

  it('clamps wheel/drag overshoot and history shrinking, including empty conversations', () => {
    expect(historyScrollState(-10_000, 2_000).offset).toBe(0);
    expect(historyScrollState(10_000, 2_000).offset).toBe(2_000 - HISTORY_VIEW_HEIGHT);
    expect(updateHistoryScroll(historyScrollState(700, 4_000), 100, true))
      .toEqual({ offset: 0, maxOffset: 0, atBottom: true, newActivity: false });
    expect(buildConversationHistory()).toEqual({ entries: [], height: 0 });
  });

  it('repaints one fixed GPU texture and only visible text lines even for very long messages', () => {
    const context = Object.fromEntries(['setTransform', 'fillRect', 'fillText', 'save', 'beginPath', 'rect', 'clip', 'roundRect', 'fill', 'restore']
      .map((name) => [name, vi.fn()]));
    context.measureText = vi.fn(() => ({ width: 100 }));
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => context }) });
    vi.stubGlobal('window', {});
    const baseline = { ...getImmersiveInstrumentation() };
    const ledger = new SpatialResourceLedger('immersive');
    try {
      const resource = createConversationHistoryResource(ledger);
      const history = buildConversationHistory(fixture(30), 'long output '.repeat(30_000));
      for (let index = 0; index < 5; index += 1) {
        context.fillText.mockClear();
        paintConversationHistory(resource, history.entries, historyScrollState(index * 15_000, history.height), 'dark', 'Working', 0, 0);
        expect(context.fillText.mock.calls.length).toBeLessThan(40);
        expect(getImmersiveInstrumentation().logicalTexturePixels - baseline.logicalTexturePixels).toBe(Math.ceil(1_024 ** 2 * 4 / 3));
        expect(getImmersiveInstrumentation().liveResources - baseline.liveResources).toBe(3);
      }
      context.fillText.mockImplementationOnce(() => { throw new Error('Raster failed'); });
      expect(() => paintConversationHistory(resource, history.entries, historyScrollState(0, history.height), 'dark', 'Working', 0, 0)).not.toThrow();
      expect(resource.status).toBe('error');
      expect(context.fillText).toHaveBeenCalledWith('Conversation unavailable', 40, 150);
    } finally { ledger.dispose(); }
    expect(getImmersiveInstrumentation().logicalTexturePixels).toBe(baseline.logicalTexturePixels);
  });
});
