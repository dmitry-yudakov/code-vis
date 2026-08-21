import type { ChatThread, TranscriptContextMessage } from '@/shared/types';
import { MAX_WIRE_TRANSCRIPT_MESSAGES, truncateTextHeadTail } from '@/shared/limits';

/**
 * Starts at the addressed agent's last completed answer and applies a fixed wire bound. If the
 * server owns an older cursor, it safely treats this window as conservatively unanchored.
 */
export function transcriptContext(thread: ChatThread, participantId: string): TranscriptContextMessage[] {
  let anchor = -1;
  for (let index = thread.messages.length - 1; index >= 0; index -= 1) {
    const message = thread.messages[index];
    if (message.role === 'assistant' && message.authorId === participantId && message.status === 'complete') {
      anchor = index;
      break;
    }
  }
  const eligible = thread.messages.slice(anchor >= 0 ? anchor : 0).filter((message) => (
    message.role === 'assistant'
      ? message.status !== 'failed'
      : message.status !== 'sending'
        && message.delivery !== 'not-sent'
        && (message.status !== 'failed' || message.delivery === 'possibly-sent')
  ));
  return eligible.slice(-MAX_WIRE_TRANSCRIPT_MESSAGES).map((message) => ({
    id: message.id,
    authorId: message.authorId,
    createdAt: message.createdAt,
    text: truncateTextHeadTail(message.role === 'user' ? message.text : message.rawMarkdown),
    status: message.status,
    ...(message.role === 'user' && message.delivery ? { delivery: message.delivery } : {}),
  }));
}
