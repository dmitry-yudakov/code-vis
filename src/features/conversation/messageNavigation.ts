import type { ChatMessage } from '@/shared/types';
import type { TurnRecord } from '@/shared/turnActivity';
import { displayedTurn } from './runPresentation';

export const activityNavigationId = (runId: string, entryId: string) => `activity:${runId}:${entryId}`;

/** One response per exchange, using the same saved/live records and canonical replies as the view. */
export function conversationNavigation(messages: readonly ChatMessage[], live?: TurnRecord): { users: string[]; responses: string[] } {
  const users: string[] = [], responses: string[] = [];
  const assistantIds = new Set(messages.filter(message => message.role === 'assistant').map(message => message.id));
  const lastUserIndex = messages.findLastIndex(message => message.role === 'user');
  let response: string | undefined;
  messages.forEach((message, index) => {
    if (message.role === 'assistant') {
      response = `message:${message.id}`;
      return;
    }
    if (response) responses.push(response);
    response = undefined;
    users.push(`message:${message.id}`);
    const turn = displayedTurn(message.turn, live?.userMessageId === message.id ? live : undefined);
    if (!turn || index === lastUserIndex && (turn.lifecycle === 'queued' || turn.lifecycle === 'running')) return;
    const last = turn.entries.findLast(entry => entry.kind === 'assistant' && (entry.text.trim() || entry.canonicalMessageId && assistantIds.has(entry.canonicalMessageId)));
    if (last?.kind === 'assistant') response = last.canonicalMessageId && assistantIds.has(last.canonicalMessageId)
      ? `message:${last.canonicalMessageId}` : activityNavigationId(turn.runId, last.id);
  });
  if (response) responses.push(response);
  return { users, responses };
}
