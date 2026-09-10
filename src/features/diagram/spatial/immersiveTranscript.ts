import { workspaceTextLines } from '@/features/shell/immersive/workspaceText';
import type { AgentParticipant, ChatMessage, SessionSnapshot } from '@/shared/types';
import {
  MAX_IMMERSIVE_CHAT_CHARS,
  type ImmersiveConversationProjection, type ImmersiveTranscriptEntry,
} from './immersiveTypes';

export interface ImmersiveConversationPage {
  projection: ImmersiveConversationProjection;
  pageFromNewest: number;
  pageCount: number;
  hasOlder: boolean;
  hasNewer: boolean;
}

function titleCase(value: string): string {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}

/** Counts displayed Unicode code points rather than UTF-16 storage units. */
export function immersiveDisplayLength(value: string): number {
  return [...value].length;
}

export function truncateImmersiveText(value: string, limit: number): string {
  const points = [...value];
  if (points.length <= limit) return value;
  if (limit <= 0) return '';
  if (limit === 1) return '…';
  return `${points.slice(0, limit - 1).join('')}…`;
}

export function immersiveEntryCharacters(entry: ImmersiveTranscriptEntry): number {
  return immersiveDisplayLength(entry.author)
    + immersiveDisplayLength(entry.meta)
    + immersiveDisplayLength(entry.text)
    + immersiveDisplayLength(entry.state || '');
}

export function immersiveProjectionCharacters(projection: ImmersiveConversationProjection): number {
  return projection.entries.reduce((total, entry) => total + immersiveEntryCharacters(entry), 0)
    + immersiveDisplayLength(projection.preview || '');
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

function messageEntry(
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
    author,
    meta: `${message.role === 'user' ? 'You' : 'Assistant'}${participantRole}${mode}`,
    text: message.role === 'user' ? `${message.text}${attachmentSummary(message)}` : assistantText(message),
    state: `${message.status}${delivery}`,
  };
}

export function buildImmersiveTranscriptPages(
  session: Pick<SessionSnapshot, 'messages' | 'participants'>,
  newestPageCharacterLimit = MAX_IMMERSIVE_CHAT_CHARS,
  newestPageLineLimit = 22,
): ImmersiveTranscriptEntry[][] {
  const participants = new Map(session.participants.map((participant) => [participant.id, participant]));
  const entries = session.messages.map((message) => messageEntry(message, participants));
  const pages: ImmersiveTranscriptEntry[][] = [[]];
  let remaining = Math.max(4, Math.min(22, newestPageLineLimit, Math.floor(newestPageCharacterLimit / 56)));
  for (const entry of entries.reverse()) {
    const lines = workspaceTextLines(entry.text);
    let end = lines.length;
    while (end > 0) {
      if (remaining < 4) { pages.push([]); remaining = 22; }
      const start = Math.max(0, end - (remaining - 3));
      pages[pages.length - 1].unshift({ ...entry, text: lines.slice(start, end).join('\n') });
      remaining -= end - start + 3;
      end = start;
    }
  }
  return pages;
}

export function projectImmersiveConversation({
  session,
  preview = '',
  runStatus,
  pendingApprovals,
  unread,
  pageFromNewest = 0,
}: {
  session: SessionSnapshot;
  preview?: string;
  runStatus: string;
  pendingApprovals: number;
  unread: number;
  pageFromNewest?: number;
}): ImmersiveConversationPage {
  const boundedPreview = workspaceTextLines(truncateImmersiveText(preview, 4_000)).slice(-8).join('\n');
  const newestLimit = Math.max(1, MAX_IMMERSIVE_CHAT_CHARS - immersiveDisplayLength(boundedPreview));
  const pages = buildImmersiveTranscriptPages(session, newestLimit, 22 - (boundedPreview ? workspaceTextLines(boundedPreview).length + 3 : 0));
  const resolvedPage = Math.max(0, Math.min(pageFromNewest, pages.length - 1));
  const agent = session.participants.find((participant): participant is AgentParticipant => (
    participant.kind === 'agent' && participant.id === (session.addressedAgentId || session.primaryAgentId)
  ));
  const projection: ImmersiveConversationProjection = {
    sessionTitle: session.title,
    ...(agent ? { addressedAgent: agent.displayName } : {}),
    entries: pages[resolvedPage],
    ...(resolvedPage === 0 && boundedPreview ? { preview: boundedPreview } : {}),
    runStatus,
    pendingApprovals,
    unread,
  };
  return {
    projection,
    pageFromNewest: resolvedPage,
    pageCount: pages.length,
    hasOlder: resolvedPage < pages.length - 1,
    hasNewer: resolvedPage > 0,
  };
}

export function immersiveConversationVersion(session: Pick<SessionSnapshot, 'revision' | 'messages'>, preview: string): string {
  const last = session.messages.at(-1);
  return `${session.revision}:${session.messages.length}:${last?.id || ''}:${last?.status || ''}:${preview}`;
}
