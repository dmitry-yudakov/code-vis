import { describe, expect, it } from 'vitest';
import { conversationNavigation } from '@/features/conversation/messageNavigation';
import { createTurn, finishTurn, updateActivity } from '@/shared/turnActivity';
import type { ChatMessage, UserMessage } from '@/shared/types';

const user = (id: string): UserMessage => ({ id, role: 'user', authorId: 'human',
  addressedParticipantId: 'agent', createdAt: '2026-10-28T00:00:00Z', text: id, status: 'sent', diagramAttachments: [] });
const reply = (id: string): ChatMessage => ({ id, role: 'assistant', authorId: 'agent',
  createdAt: '2026-10-28T00:00:00Z', status: 'complete', rawMarkdown: id, blocks: [{ kind: 'markdown', markdown: id }] });
function activity(id: string) {
  let turn = createTurn(`run-${id}`, id, 'agent', '2026-10-28T00:00:00Z');
  turn = updateActivity(turn, 1, { kind: 'assistant', key: 'first', text: 'Working through it.', complete: true });
  turn = updateActivity(turn, 1, { kind: 'tool', key: 'tool', tool: 'Read', status: 'succeeded' });
  return updateActivity(turn, 1, { kind: 'assistant', key: 'last', text: 'Stopped here.', complete: true });
}

describe('conversation navigation stops', () => {
  it('handles empty, unanswered and consecutive user messages', () => {
    expect(conversationNavigation([])).toEqual({ users: [], responses: [] });
    expect(conversationNavigation([user('a'), user('b')])).toEqual({ users: ['message:a', 'message:b'], responses: [] });
  });

  it('selects only the last legacy response between user messages', () => {
    expect(conversationNavigation([user('a'), reply('intermediate'), reply('final-a'), user('b'), reply('final-b'), user('c')]))
      .toEqual({ users: ['message:a', 'message:b', 'message:c'], responses: ['message:final-a', 'message:final-b'] });
  });

  it('uses canonical replies once, including replies nested in turn activity', () => {
    const turn = finishTurn(activity('a'), 'completed', { attempt: 1, messageId: 'final', key: 'last' });
    expect(conversationNavigation([{ ...user('a'), turn }, reply('final'), user('b')]).responses).toEqual(['message:final']);
  });

  it.each(['completed', 'cancelled', 'failed', 'interrupted'] as const)('includes the last assistant activity of a %s turn without a canonical reply', lifecycle => {
    const turn = finishTurn(activity('a'), lifecycle);
    const last = turn.entries.findLast(entry => entry.kind === 'assistant')!;
    expect(conversationNavigation([{ ...user('a'), turn }]).responses).toEqual([`activity:${turn.runId}:${last.id}`]);
  });

  it('uses retained activity if the canonical message is unavailable', () => {
    const turn = finishTurn(activity('a'), 'completed', { attempt: 1, messageId: 'missing', key: 'last' });
    const last = turn.entries.findLast(entry => entry.kind === 'assistant')!;
    expect(conversationNavigation([{ ...user('a'), turn }]).responses).toEqual([`activity:${turn.runId}:${last.id}`]);
  });

  it('skips active text, tool-only turns and empty retained text', () => {
    const running = { ...activity('a'), lifecycle: 'running' as const };
    expect(conversationNavigation([{ ...user('a'), turn: running }]).responses).toEqual([]);
    const empty = finishTurn(updateActivity(createTurn('run', 'a', 'agent', ''), 1,
      { kind: 'assistant', key: 'empty', text: '' }), 'cancelled');
    expect(conversationNavigation([{ ...user('a'), turn: empty }]).responses).toEqual([]);
    const tool = finishTurn(updateActivity(createTurn('run', 'a', 'agent', ''), 1,
      { kind: 'tool', key: 't', tool: 'Read', status: 'failed' }), 'failed');
    expect(conversationNavigation([{ ...user('a'), turn: tool }]).responses).toEqual([]);
  });

  it('includes older activity before another user even if its lifecycle was not recorded', () => {
    const turn = activity('a');
    expect(conversationNavigation([{ ...user('a'), turn }, user('b')]).responses).toEqual([`activity:${turn.runId}:${turn.entries.at(-1)!.id}`]);
  });

  it('uses the newer live turn with the same selection rule as the transcript', () => {
    const saved = activity('a');
    const live = finishTurn(updateActivity(saved, 1, { kind: 'assistant', key: 'new', text: 'New response' }), 'completed');
    expect(conversationNavigation([{ ...user('a'), turn: saved }], live).responses).toEqual([`activity:${live.runId}:${live.entries.at(-1)!.id}`]);
    expect(conversationNavigation([{ ...user('a'), turn: live }], saved).responses).toEqual([`activity:${live.runId}:${live.entries.at(-1)!.id}`]);
  });

  it('keeps fallback targets distinct across turns with repeated entry ids', () => {
    const a = finishTurn(activity('a'), 'completed'), b = finishTurn(activity('b'), 'cancelled');
    const responses = conversationNavigation([{ ...user('a'), turn: a }, { ...user('b'), turn: b }]).responses;
    expect(responses).toHaveLength(2);
    expect(new Set(responses).size).toBe(2);
  });
});
