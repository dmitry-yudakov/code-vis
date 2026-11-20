import type { ChatMessage, PublicSession, SessionCanvases, SessionPage } from './types';
import { serializedBytes } from './turnActivity';

/** Transfer budgets, not limits on stored conversation content. Metadata is outside pageBytes. */
export const SESSION_PAGE_LIMITS = { messages: 20, pageBytes: 64 * 1024, messageBytes: 24 * 1024 } as const;
const encoder = new TextEncoder();

function excerpt(text: string, bytes: number): string {
  const encoded = encoder.encode(text);
  if (encoded.length <= bytes) return text;
  let end = bytes;
  while (end > 0 && (encoded[end] & 0xc0) === 0x80) end--;
  return new TextDecoder().decode(encoded.subarray(0, end));
}

function previewMessage(original: ChatMessage): { message: ChatMessage; deferred: boolean } {
  const message = structuredClone(original);
  let deferred = false;
  if (message.role === 'user') {
    if (message.turn) {
      delete message.turn.evicted;
      for (const entry of message.turn.entries) {
        if (entry.kind === 'tool') for (const field of ['input', 'output', 'diff', 'error'] as const) {
          if (entry[field] !== undefined) { delete entry[field]; deferred = true; }
        }
        if (entry.kind === 'approval' && entry.review?.text) {
          entry.review = { completeness: 'unavailable', reason: 'Load message details to read this saved review.' };
          deferred = true;
        }
      }
      if (serializedBytes(message.turn) > 8 * 1024) {
        deferred = true;
        message.turn.entries = message.turn.entries.slice(-8).map(entry => entry.kind === 'assistant'
          ? { ...entry, text: excerpt(entry.text, 512) }
          : entry.kind === 'tool' || entry.kind === 'approval' ? { ...entry, summary: excerpt(entry.summary || '', 512) } : entry);
      }
    }
    if (message.diagramAttachments.length) { message.diagramAttachments = []; deferred = true; }
    if (message.fileAttachments?.length) {
      message.fileAttachments = message.fileAttachments.map(file => ({ ...file, text: '' }));
      deferred = true;
    }
  } else if (message.blocks.some(block => block.kind === 'diagram')) {
    message.blocks = message.blocks.filter(block => block.kind !== 'diagram');
    deferred = true;
  }
  // Bound even a single enormous answer, including JSON escaping and multibyte text.
  for (let bytes = 12 * 1024; ; bytes = Math.floor(bytes / 2)) {
    if (message.role === 'user') {
      const text = excerpt(message.text, bytes);
      deferred ||= text !== message.text;
      message.text = text;
    } else {
      const markdown = excerpt(message.rawMarkdown, bytes);
      deferred ||= markdown !== message.rawMarkdown;
      message.rawMarkdown = markdown;
      let remaining = bytes;
      message.blocks = message.blocks.flatMap(block => {
        if (block.kind === 'diagram') return [];
        const source = block.kind === 'markdown' ? block.markdown : block.source;
        const text = excerpt(source, remaining);
        remaining -= encoder.encode(text).length;
        deferred ||= text !== source;
        return [block.kind === 'markdown' ? { ...block, markdown: text } : { ...block, source: text }];
      });
    }
    if (serializedBytes(message) <= SESSION_PAGE_LIMITS.messageBytes) break;
    if (bytes === 0) {
      if (message.role === 'user' && message.turn) message.turn.entries = [];
      else if (message.role === 'assistant') message.blocks = [];
      deferred = true;
      break;
    }
    deferred = true;
    // Evidence is available from the complete-message read, never silently discarded.
    if (message.role === 'user') {
      message.diagramAttachments = [];
      message.fileAttachments = [];
      message.reportAttachments = [];
      message.imageAttachments = [];
    } else message.blocks = message.blocks.slice(0, 8);
  }
  return { message, deferred };
}

export function sessionCanvases(session: PublicSession): SessionCanvases {
  return { revision: session.revision,
    canvases: session.messages.flatMap(message => message.role === 'assistant'
      ? message.blocks.flatMap(block => block.kind === 'diagram' ? [block.artifact] : []) : []),
    sketches: session.sketches, annotations: session.annotations, pinnedDiagramIds: session.pinnedDiagramIds };
}

/** Input is the validated, sanitized public record; partial output has its own explicit marker. */
export function sessionPage(session: PublicSession, before?: string): SessionPage {
  const end = before === undefined ? session.messages.length : session.messages.findIndex(message => message.id === before);
  if (end < 0) throw new Error('This history position is no longer available. Reopen the conversation.');
  const messages: ChatMessage[] = [], deferredMessageIds: string[] = [];
  let bytes = 2, start = end;
  while (start > 0 && messages.length < SESSION_PAGE_LIMITS.messages) {
    const preview = previewMessage(session.messages[start - 1]);
    const size = serializedBytes(preview.message) + 1;
    if (messages.length && bytes + size > SESSION_PAGE_LIMITS.pageBytes) break;
    messages.unshift(preview.message);
    if (preview.deferred) deferredMessageIds.unshift(preview.message.id);
    bytes += size;
    start--;
  }
  const canvas = sessionCanvases(session);
  return { session: { ...session, messages, annotations: {}, sketches: [] }, history: {
    ...(start > 0 && messages.length ? { before: messages[0].id } : {}), deferredMessageIds,
    canvasIds: [...canvas.canvases.map(item => item.id), ...canvas.sketches.map(item => item.id)], canvasesLoaded: false,
  } };
}
