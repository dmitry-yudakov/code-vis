import { describe, expect, it } from 'vitest';
import type { AssistantMessage, PublicSession, UserMessage } from '@/shared/types';
import { sessionPage, SESSION_PAGE_LIMITS } from '@/shared/sessionPaging';
import { createTurn, serializedBytes } from '@/shared/turnActivity';
import { hydrateSession, mergeSessionPage, serializeSessionExport } from '@/features/conversation/sessionStore';

function fixture(count = 80): PublicSession {
  return { id: 'session', version: 13, revision: 3, title: 'Paged conversation', createdAt: '', updatedAt: '',
    primaryAgentId: 'agent', repositories: [], participants: [
      { id: 'human', kind: 'human', displayName: 'You' },
      { id: 'agent', kind: 'agent', displayName: 'Claude', provider: 'claude', role: 'coder', defaultMode: 'ask' },
    ], sketches: [], annotations: {}, pinnedDiagramIds: [],
    messages: Array.from({ length: count }, (_, index) => index % 2 ? {
      id: `message-${index}`, role: 'assistant', authorId: 'agent', createdAt: '', status: 'complete',
      rawMarkdown: `Answer ${index}`, blocks: [{ kind: 'markdown', markdown: `Answer ${index}` }],
    } : { id: `message-${index}`, role: 'user', authorId: 'human', addressedParticipantId: 'agent', createdAt: '', status: 'sent',
      text: `Question ${index}`, diagramAttachments: [] }),
  };
}

describe('incremental session reads', () => {
  it('pages by stable exclusive ids and eventually delivers the entire history exactly once', () => {
    const canonical = fixture();
    let page = sessionPage(canonical);
    const ids = page.session.messages.map(message => message.id);
    expect(ids).toHaveLength(20);
    expect(ids.slice(-2)).toEqual(['message-78', 'message-79']);
    while (page.history.before) {
      page = sessionPage(canonical, page.history.before);
      expect(serializedBytes(page.session.messages)).toBeLessThanOrEqual(SESSION_PAGE_LIMITS.pageBytes);
      ids.unshift(...page.session.messages.map(message => message.id));
    }
    expect(ids).toEqual(canonical.messages.map(message => message.id));
    expect(() => sessionPage(canonical, 'removed')).toThrow('history position');
  });

  it('bounds oversized messages including Unicode and JSON escaping, deferring complete evidence and activity', () => {
    const canonical = fixture(2);
    const user = canonical.messages[0] as UserMessage;
    user.turn = { ...createTurn('run', user.id, 'agent', ''), lifecycle: 'completed', entries: [{
      kind: 'tool', id: 'tool', firstSequence: 1, sequence: 1, attempt: 0, tool: 'shell', status: 'succeeded', output: 'output'.repeat(100_000),
    }] };
    user.fileAttachments = [{ name: 'notes.txt', text: 'private file contents'.repeat(10_000), bytes: 210_000, digest: 'a'.repeat(64) }];
    const answer = canonical.messages[1] as AssistantMessage;
    answer.rawMarkdown = '🙂\n"\\'.repeat(100_000);
    answer.blocks = [{ kind: 'markdown', markdown: answer.rawMarkdown }];
    const page = sessionPage(canonical);
    expect(serializedBytes(page.session.messages)).toBeLessThanOrEqual(SESSION_PAGE_LIMITS.pageBytes);
    for (const message of page.session.messages) expect(serializedBytes(message)).toBeLessThanOrEqual(SESSION_PAGE_LIMITS.messageBytes);
    expect(page.history.deferredMessageIds).toEqual([user.id, answer.id]);
    expect(page.history.inlineDeferredMessageIds).toEqual([answer.id]);
    expect(JSON.stringify(page)).not.toContain('private file contents');
    expect(JSON.stringify(page)).not.toContain('outputoutput');
    expect(JSON.stringify(page)).not.toContain('�');
    expect(user.fileAttachments[0].text).toContain('private file contents');
    expect(sessionPage(fixture(0)).history.before).toBeUndefined();
  });

  it('preserves newer live/optimistic messages and ignores stale or repeated history responses', () => {
    const canonical = fixture();
    const page = sessionPage(canonical);
    const initial = mergeSessionPage(page);
    const earlier = sessionPage(canonical, page.history.before);
    const live = { ...initial, revision: 5, title: 'Renamed', messages: [...initial.messages,
      { ...(canonical.messages[0] as UserMessage), id: 'optimistic', status: 'sending' as const }] };
    const merged = mergeSessionPage(earlier, live, undefined, page.history.before);
    expect(merged.revision).toBe(5);
    expect(merged.title).toBe('Renamed');
    expect(merged.messages.at(-1)?.id).toBe('optimistic');
    expect(merged.messages).toHaveLength(41);
    expect(mergeSessionPage(earlier, merged, undefined, page.history.before)).toBe(merged);
    expect(mergeSessionPage(page, merged)).toBe(merged);
  });

  it('also bounds oversized activity metadata when no tool output exists to remove', () => {
    const canonical = fixture(1);
    const user = canonical.messages[0] as UserMessage;
    user.turn = { ...createTurn('run', user.id, 'agent', ''), entries: Array.from({ length: 8 }, (_, index) => ({
      kind: 'gap', id: `gap-${index}`, firstSequence: index, sequence: index, attempt: 0,
      reason: 'gap reason'.repeat(1600), count: 1,
    })) };
    const page = sessionPage(canonical);
    expect(serializedBytes(page.session.messages[0])).toBeLessThanOrEqual(SESSION_PAGE_LIMITS.messageBytes);
    expect(page.history.deferredMessageIds).toEqual([user.id]);
    expect(page.history.inlineDeferredMessageIds).toEqual([user.id]);
    expect(user.turn.entries).toHaveLength(8);
  });

  it('loads a sent queued message with deferred file evidence so it can be edited', () => {
    const canonical = fixture(1);
    const user = canonical.messages[0] as UserMessage;
    user.fileAttachments = [{ name: 'evidence.txt', bytes: 8, text: 'evidence', digest: 'a'.repeat(64) }];
    user.turn = { ...createTurn('run', user.id, 'agent', ''), lifecycle: 'queued' };
    const page = sessionPage(canonical);
    expect(page.history.inlineDeferredMessageIds).toEqual([user.id]);
    expect((page.session.messages[0] as UserMessage).fileAttachments?.[0].text).toBe('');
  });

  it('preserves inline detail ids on prepend and refresh, including older executor pages', () => {
    const canonical = fixture(22);
    const answer = canonical.messages[1] as AssistantMessage;
    answer.rawMarkdown = 'Answer '.repeat(3000);
    answer.blocks = [{ kind: 'markdown', markdown: answer.rawMarkdown }];
    const recent = mergeSessionPage(sessionPage(canonical));
    const before = recent.history!.before!;
    const older = sessionPage(canonical, before);
    expect(older.history.inlineDeferredMessageIds).toEqual([answer.id]);
    delete older.history.inlineDeferredMessageIds;
    const completeRange = mergeSessionPage(older, recent, undefined, before);
    const refreshed = mergeSessionPage(sessionPage(canonical), completeRange);
    expect(refreshed.history?.inlineDeferredMessageIds).toEqual([answer.id]);
  });

  it('refreshes recent content without discarding loaded older messages or full message details', () => {
    const canonical = fixture();
    const recent = mergeSessionPage(sessionPage(canonical));
    const earlier = mergeSessionPage(sessionPage(canonical, recent.history!.before), recent, undefined, recent.history!.before);
    canonical.revision++;
    const refreshed = mergeSessionPage(sessionPage(canonical), earlier);
    expect(refreshed.messages.map(message => message.id)).toEqual(earlier.messages.map(message => message.id));
    expect(refreshed.history?.before).toBe(earlier.history?.before);
    expect(() => serializeSessionExport(refreshed)).toThrow('complete session');
    expect(serializeSessionExport(hydrateSession(canonical)).entries).toHaveLength(80);
  });

  it('pages in a steered message that moved outside the recent window without keeping a stale queued copy', () => {
    const canonical = fixture(2);
    const waiting = Array.from({ length: 21 }, (_, i): UserMessage => ({
      ...(canonical.messages[0] as UserMessage), id: `pending-${i}`, status: 'sending',
      turn: createTurn(`run-${i}`, `pending-${i}`, 'agent', ''),
    }));
    canonical.messages.push(...waiting);
    const beforeSteer = mergeSessionPage(sessionPage(canonical));
    const selected = waiting.at(-1)!;
    expect(beforeSteer.messages.at(-1)?.id).toBe(selected.id);
    canonical.messages.pop();
    canonical.messages.splice(1, 0, { ...selected, status: 'sent', steeredRunId: 'active', turn: undefined });
    canonical.revision += 1;
    const refresh = mergeSessionPage(sessionPage(canonical), beforeSteer);
    expect(refresh.messages.some(message => message.id === selected.id)).toBe(false);
    const cursor = refresh.history!.before!;
    const full = mergeSessionPage(sessionPage(canonical, cursor), refresh, undefined, cursor);
    expect(full.messages.filter(message => message.id === selected.id)).toMatchObject([{ status: 'sent', steeredRunId: 'active' }]);
    expect(full.messages.map(message => message.id)).toEqual(canonical.messages.map(message => message.id));
  });

  it('retains device canvas selection while the canvas is deferred', () => {
    const page = sessionPage(fixture());
    page.history.canvasIds = ['older-canvas', 'newest-canvas'];
    const hydrated = mergeSessionPage(page, undefined, { activeDiagramId: 'older-canvas' });
    expect(hydrated.activeDiagramId).toBe('older-canvas');
    expect(hydrated.history?.canvasesLoaded).toBe(false);
  });

  it('can recover every intervening message after more than a page arrives while away', () => {
    const canonical = fixture(80);
    const prior = mergeSessionPage(sessionPage(canonical));
    const current = { ...fixture(130), revision: 4 };
    let loaded = mergeSessionPage(sessionPage(current), prior);
    while (loaded.history?.before) {
      const before = loaded.history.before;
      loaded = mergeSessionPage(sessionPage(current, before), loaded, undefined, before);
    }
    expect(loaded.messages.map(message => message.id)).toEqual(current.messages.map(message => message.id));
    const fromComplete = mergeSessionPage(sessionPage(current), hydrateSession(canonical));
    expect(fromComplete.history?.before).toBe(current.messages[110].id);
  });
});
