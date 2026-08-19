import type { ServerAgentParticipant, ServerThread, TranscriptContextMessage } from '@/lib/shared/types';

const DEFAULT_MAX_MESSAGES = 40;
const DEFAULT_MAX_BYTES = 24_000;

export interface TranscriptDelta {
  text: string;
  messages: TranscriptContextMessage[];
  cursorFound: boolean;
  truncated: boolean;
}

/**
 * Validates browser-held transcript identity against the server roster, then keeps the newest
 * bounded messages the addressed participant has not yet observed.
 */
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
  const missed = participant.lastObservedMessageId && cursorIndex >= 0
    ? transcript.slice(cursorIndex + 1)
    : transcript;
  const maxMessages = limits.maxMessages ?? DEFAULT_MAX_MESSAGES;
  const maxBytes = limits.maxBytes ?? DEFAULT_MAX_BYTES;
  const bounded: TranscriptContextMessage[] = [];
  let bytes = 0;
  for (let index = missed.length - 1; index >= 0 && bounded.length < maxMessages; index -= 1) {
    const message = missed[index];
    const size = Buffer.byteLength(message.text, 'utf8');
    if (bounded.length && bytes + size > maxBytes) break;
    if (!bounded.length && size > maxBytes) {
      bounded.unshift({ ...message, text: message.text.slice(-maxBytes) });
      bytes = maxBytes;
      break;
    }
    bounded.unshift(message);
    bytes += size;
  }
  const truncated = bounded.length < missed.length;
  const lines = bounded.map((message) => {
    const author = roster.get(message.authorId)!;
    const detail = author.kind === 'agent' ? ` · ${author.provider}/${author.role}` : '';
    return `[${author.displayName}${detail}]\n${message.text}`;
  });
  const notices = [
    !cursorFound ? 'The prior cursor was outside the supplied local transcript window.' : '',
    truncated ? 'Older missed messages were omitted by the server context bound.' : '',
  ].filter(Boolean);
  return {
    messages: bounded,
    cursorFound,
    truncated,
    text: [...notices, ...lines].join('\n\n'),
  };
}
