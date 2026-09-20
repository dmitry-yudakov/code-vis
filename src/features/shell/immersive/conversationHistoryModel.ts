import type { SessionSnapshot } from '@/shared/types';
import type { ImmersiveTranscriptEntry } from '@/features/diagram/spatial/immersiveTypes';
import { immersiveChatLines, immersiveMessageEntry, IMMERSIVE_CHAT_LINE_HEIGHT } from '@/features/diagram/spatial/immersiveTranscript';

export const HISTORY_SIZE = 1_280;
export const HISTORY_TOP = 100;
export const HISTORY_VIEW_HEIGHT = 960;

export interface HistoryEntry {
  entry: ImmersiveTranscriptEntry;
  lines: string[];
  top: number;
  height: number;
}

export interface ConversationHistoryScrollState {
  offset: number;
  maxOffset: number;
  atBottom: boolean;
  newActivity: boolean;
}

// Wrapping walks every character, so a streaming delta must not re-wrap the settled transcript.
// Lines are reused per message while its text is unchanged, and the cache is replaced by the live
// transcript on each call so it cannot outgrow the conversation or serve a stale wrap.
let wrappedLines = new Map<string, { text: string; lines: string[] }>();

export function buildConversationHistory(session?: SessionSnapshot, preview = ''): { entries: HistoryEntry[]; height: number } {
  const participants = new Map(session?.participants.map((participant) => [participant.id, participant]));
  const entries = session?.messages.map((message) => immersiveMessageEntry(message, participants)) || [];
  if (preview) entries.push({
    id: 'live-preview', role: 'assistant',
    author: participants.get(session?.addressedAgentId || session?.primaryAgentId || '')?.displayName || 'Agent',
    meta: '', text: preview, state: 'Writing…',
  });
  let height = 0;
  const wrapped = new Map<string, { text: string; lines: string[] }>();
  const layout = entries.map((entry) => {
    const cached = wrappedLines.get(entry.id);
    const lines = cached?.text === entry.text ? cached.lines : immersiveChatLines(entry.text);
    wrapped.set(entry.id, { text: entry.text, lines });
    const item = { entry, lines, top: height, height: (lines.length + 2) * IMMERSIVE_CHAT_LINE_HEIGHT };
    height += item.height;
    return item;
  });
  wrappedLines = wrapped;
  return { entries: layout, height };
}

export function historyScrollState(offset: number, height: number, newActivity = false): ConversationHistoryScrollState {
  const maxOffset = Math.max(0, height - HISTORY_VIEW_HEIGHT);
  const clamped = Math.max(0, Math.min(Number.isFinite(offset) ? offset : maxOffset, maxOffset));
  const atBottom = maxOffset - clamped < 1;
  return { offset: clamped, maxOffset, atBottom, newActivity: !atBottom && newActivity };
}

/** A reader at the bottom follows output; an older reading position stays anchored to the top. */
export function updateHistoryScroll(previous: ConversationHistoryScrollState, height: number, changed: boolean): ConversationHistoryScrollState {
  return historyScrollState(previous.atBottom ? Infinity : previous.offset, height, previous.newActivity || changed);
}

export interface ConversationScrollFlags {
  atTop: boolean;
  atBottom: boolean;
  newActivity: boolean;
}

/**
 * A thumbstick moves the offset every XR frame. The surrounding chrome reads only these flags, so
 * the previous value is returned unchanged while they hold, leaving the workspace tree untouched.
 */
export function conversationScrollFlags(previous: ConversationScrollFlags, state: ConversationHistoryScrollState): ConversationScrollFlags {
  const next = { atTop: state.offset <= 0, atBottom: state.atBottom, newActivity: state.newActivity };
  return next.atTop === previous.atTop && next.atBottom === previous.atBottom && next.newActivity === previous.newActivity
    ? previous : next;
}

export function visibleHistoryEntries(entries: HistoryEntry[], offset: number): HistoryEntry[] {
  // Binary search skips old messages without touching their text during each scroll frame.
  let low = 0;
  let high = entries.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (entries[middle].top + entries[middle].height <= offset) low = middle + 1;
    else high = middle;
  }
  const visible: HistoryEntry[] = [];
  for (let index = low; index < entries.length && entries[index].top < offset + HISTORY_VIEW_HEIGHT; index += 1) visible.push(entries[index]);
  return visible;
}
