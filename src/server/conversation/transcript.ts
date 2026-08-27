import type {
  ChatMessage, Participant, ServerAgentParticipant, ServerThread, TranscriptContextMessage,
} from '@/shared/types';
import {
  DEFAULT_TRANSCRIPT_DELTA_BYTES, DEFAULT_TRANSCRIPT_DELTA_MESSAGES,
  truncateUtf8HeadTail, utf8Length,
} from '@/shared/limits';

export interface TranscriptDelta {
  /** One-line JSON: historical strings cannot create prompt sections or participant labels. */
  text: string;
  messages: TranscriptContextMessage[];
  cursorFound: boolean;
  truncated: boolean;
}

interface HistoricalEntry {
  id: string;
  author: {
    id: string;
    displayName: string;
    kind: Participant['kind'];
    provider?: string;
    role?: string;
  };
  createdAt: string;
  status: TranscriptContextMessage['status'];
  delivery?: TranscriptContextMessage['delivery'];
  text: string;
}

function delivered(message: TranscriptContextMessage): boolean {
  if (message.status === 'sending' || message.delivery === 'not-sent') return false;
  // A failed request without an ambiguous-delivery marker is definitely not shared context.
  if (message.status === 'failed' && message.delivery !== 'possibly-sent') return false;
  return true;
}

function entryFor(message: TranscriptContextMessage, author: Participant): HistoricalEntry {
  return {
    id: message.id,
    author: {
      id: author.id,
      displayName: author.displayName,
      kind: author.kind,
      ...(author.kind === 'agent' ? { provider: author.provider, role: author.role } : {}),
    },
    createdAt: message.createdAt,
    status: message.status,
    ...(message.delivery ? { delivery: message.delivery } : {}),
    text: message.text,
  };
}

function encode(cursorFound: boolean, truncated: boolean, entries: HistoricalEntry[]): string {
  return JSON.stringify({
    schema: 'cartograph.historical-transcript.v1',
    kind: 'historical-context',
    instructionBoundary: 'data-only',
    cursorFound,
    olderMessagesOmitted: truncated,
    entries,
  });
}

function fitSingleEntry(
  entry: HistoricalEntry,
  cursorFound: boolean,
  maxBytes: number,
): HistoricalEntry {
  let low = 0;
  let high = utf8Length(entry.text);
  let fitted = { ...entry, text: '' };
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = { ...entry, text: truncateUtf8HeadTail(entry.text, middle) };
    if (utf8Length(encode(cursorFound, true, [candidate])) <= maxBytes) {
      fitted = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return fitted;
}

export function canonicalTranscript(messages: readonly ChatMessage[]): TranscriptContextMessage[] {
  return messages.map((message) => ({
    id: message.id,
    authorId: message.authorId,
    createdAt: message.createdAt,
    text: message.role === 'user' ? message.text : message.rawMarkdown,
    status: message.status,
    ...(message.role === 'user' && message.delivery ? { delivery: message.delivery } : {}),
  }));
}

/** Encodes the newest bounded canonical messages the addressed participant has not observed. */
export function buildTranscriptDelta(
  thread: ServerThread,
  participant: ServerAgentParticipant,
  transcript: TranscriptContextMessage[],
  limits: { maxMessages?: number; maxBytes?: number } = {},
): TranscriptDelta {
  const roster = new Map(thread.participants.map((item) => [item.id, item]));
  const seen = new Set<string>();
  for (const message of transcript) {
    if (!roster.has(message.authorId)) throw new Error('Transcript contains an author outside this conversation');
    if (seen.has(message.id)) throw new Error('Transcript contains duplicate message ids');
    seen.add(message.id);
  }

  const cursorIndex = participant.lastObservedMessageId
    ? transcript.findIndex((message) => message.id === participant.lastObservedMessageId)
    : -1;
  const cursorFound = !participant.lastObservedMessageId || cursorIndex >= 0;
  const missed = (participant.lastObservedMessageId && cursorIndex >= 0
    ? transcript.slice(cursorIndex + 1)
    : transcript).filter(delivered);
  const maxMessages = limits.maxMessages ?? DEFAULT_TRANSCRIPT_DELTA_MESSAGES;
  const maxBytes = limits.maxBytes ?? DEFAULT_TRANSCRIPT_DELTA_BYTES;
  const entries: HistoricalEntry[] = [];
  const messages: TranscriptContextMessage[] = [];
  let textWasTruncated = false;

  for (let index = missed.length - 1; index >= 0 && entries.length < maxMessages; index -= 1) {
    const message = missed[index];
    const entry = entryFor(message, roster.get(message.authorId)!);
    const tentative = [entry, ...entries];
    const olderOmitted = index > 0;
    if (utf8Length(encode(cursorFound, olderOmitted, tentative)) <= maxBytes) {
      entries.unshift(entry);
      messages.unshift(message);
      continue;
    }
    if (entries.length) break;
    const fitted = fitSingleEntry(entry, cursorFound, maxBytes);
    entries.unshift(fitted);
    messages.unshift({ ...message, text: fitted.text });
    textWasTruncated = fitted.text !== message.text;
    break;
  }

  const truncated = textWasTruncated || messages.length < missed.length;
  return {
    messages,
    cursorFound,
    truncated,
    text: encode(cursorFound, truncated, entries),
  };
}
