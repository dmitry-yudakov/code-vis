import type { ChatMessage, SessionSnapshot } from '@/shared/types';
import type { ImmersiveTranscriptEntry } from './immersiveTypes';

// History layout and rasterization share text geometry.
export const IMMERSIVE_CHAT_FONT_SIZE = 54;
export const IMMERSIVE_CHAT_LINE_HEIGHT = 64;
export const IMMERSIVE_CHAT_TEXT_WIDTH = 1_024;

/** Conservative sans-serif advances keep wrapping independent of browser/font loading. */
function characterAdvance(point: string): number {
  if (point.codePointAt(0)! > 0x7f) return 1.2;
  if (/[ ilI.,'`!:;|]/u.test(point)) return 0.35;
  if (/[MWmw@%&]/u.test(point)) return 1.1;
  if (/[A-Z]/u.test(point)) return 0.8;
  return 0.65;
}

/** Wrap at spaces where possible, retaining whitespace, indentation, and complete code points. */
export function immersiveChatLines(
  text: string, maxWidth = IMMERSIVE_CHAT_TEXT_WIDTH, fontSize = IMMERSIVE_CHAT_FONT_SIZE,
): string[] {
  const width = maxWidth / fontSize;
  return text.replaceAll('\t', '  ').split('\n').flatMap((paragraph) => {
    const result: string[] = [];
    let line: string[] = [];
    let advance = 0;
    for (const point of paragraph) {
      while (advance + characterAdvance(point) > width && line.length) {
        const space = line.lastIndexOf(' ');
        // Keep whitespace on the preceding line instead of silently deleting it.
        const boundary = space >= 0 ? space + 1 : line.length;
        result.push(line.slice(0, boundary).join(''));
        line = line.slice(boundary);
        advance = line.reduce((total, character) => total + characterAdvance(character), 0);
      }
      line.push(point);
      advance += characterAdvance(point);
    }
    result.push(line.join(''));
    return result;
  });
}

function titleCase(value: string): string {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}

function attachmentSummary(message: Extract<ChatMessage, { role: 'user' }>): string {
  if (message.diagramAttachments.length === 0) return '';
  const summaries = message.diagramAttachments.map((attachment) => {
    const kind = attachment.kind === 'sketch' ? 'sketch' : 'diagram';
    const marks = attachment.marksSnapshot.length;
    return `${kind}${marks ? ` with ${marks} ${marks === 1 ? 'mark' : 'marks'}` : ''}`;
  });
  return `\n\nAttachments: ${summaries.join(', ')}.`;
}

function assistantText(message: Extract<ChatMessage, { role: 'assistant' }>): string {
  const blocks = message.blocks.map((block) => {
    if (block.kind === 'markdown') return block.markdown;
    if (block.kind === 'code') {
      return `[${block.language ? `${block.language} ` : ''}code]\n${block.source}`;
    }
    return `[Diagram ${block.artifact.ordinal} is available on the canvas]`;
  });
  return blocks.join('\n\n') || message.rawMarkdown;
}

export function immersiveMessageEntry(
  message: ChatMessage,
  participants: ReadonlyMap<string, SessionSnapshot['participants'][number]>,
): ImmersiveTranscriptEntry {
  const participant = participants.get(message.authorId);
  const author = participant?.displayName || (message.role === 'user' ? 'You' : 'Agent');
  const mode = message.mode ? ` · ${titleCase(message.mode)}` : '';
  const participantRole = participant?.kind === 'agent' ? ` · ${titleCase(participant.role)}` : '';
  const delivery = message.role === 'user' && message.delivery === 'possibly-sent' ? ' · delivery uncertain' : '';
  return {
    id: message.id,
    role: message.role,
    author,
    meta: `${message.role === 'user' ? 'You' : 'Assistant'}${participantRole}${mode}`,
    text: message.role === 'user' ? `${message.text}${attachmentSummary(message)}` : assistantText(message),
    state: `${message.status}${delivery}`,
  };
}

export function immersiveConversationVersion(session: Pick<SessionSnapshot, 'revision' | 'messages'>, preview: string): string {
  const last = session.messages.at(-1);
  return `${session.revision}:${session.messages.length}:${last?.id || ''}:${last?.status || ''}:${preview}`;
}
