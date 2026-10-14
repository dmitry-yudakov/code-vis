import type { ChatMessage } from '@/shared/types';

/** Display history only. Execution/approval ownership never depends on these bounded records. */
export const ACTIVITY_LIMITS = { entries: 1000, turnBytes: 1024 * 1024, sessionBytes: 8 * 1024 * 1024, fieldBytes: 16 * 1024, reviewBytes: 64 * 1024 } as const;
export interface ApprovalReview {
  completeness: 'complete' | 'unavailable' | 'unknown';
  text?: string;
  reason?: string;
  omittedBytes?: number;
}
export interface ActivityActor { provider?: 'claude' | 'codex'; name?: string; threadId?: string; parentToolId?: string }
export type ToolStatus = 'running' | 'succeeded' | 'failed' | 'denied' | 'cancelled' | 'unknown';
export type ProcessActivity = { key: string; actor?: ActivityActor; omittedBytes?: number } & (
  | { kind: 'assistant'; text: string; append?: boolean; complete?: boolean; phase?: 'commentary' | 'final' }
  | { kind: 'tool'; tool: string; summary?: string; input?: string; output?: string; appendOutput?: boolean; diff?: string; error?: string; status: ToolStatus; startedAt?: string; finishedAt?: string; durationMs?: number; exitCode?: number }
  | { kind: 'approval'; requestId: string; tool: string; summary: string; toolKey?: string; state: 'pending' | 'resolved'; decision?: 'allow' | 'deny' | 'timeout' | 'cancelled'; review?: ApprovalReview }
  | { kind: 'gap'; reason: string }
);
type EntryBase = { id: string; firstSequence: number; sequence: number; attempt: number; actor?: ActivityActor; omittedBytes?: number };
export type TurnEntry = EntryBase & (
  | { kind: 'assistant'; text: string; complete: boolean; sourceBlockId?: string; phase?: 'commentary' | 'final'; canonicalMessageId?: string }
  | { kind: 'tool'; tool: string; summary?: string; input?: string; output?: string; diff?: string; error?: string; status: ToolStatus; startedAt?: string; finishedAt?: string; durationMs?: number; exitCode?: number }
  | { kind: 'approval'; requestId: string; tool: string; summary: string; toolId?: string; state: 'pending' | 'resolved'; decision?: 'allow' | 'deny' | 'timeout' | 'cancelled'; review?: ApprovalReview }
  | { kind: 'gap'; reason: string; count: number }
);
export type TurnLifecycle = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export interface TurnRecord {
  version: 1; runId: string; userMessageId: string; participantId: string; acceptedAt: string;
  lifecycle: TurnLifecycle; sequence: number; entries: TurnEntry[]; incomplete: boolean;
  history: 'saved' | 'unsaved';
  /** Fixed-size conservative membership filter. False positives omit display only, never execution. */
  evicted?: string;
}
const encoder = new TextEncoder();
export function serializedBytes(value: unknown): number { return encoder.encode(JSON.stringify(value)).length; }
export function cleanDisplay(text: string): string {
  return text
    .replace(/(?:\x1b\]|\u009d)[\s\S]*?(?:\x07|\x1b\\|\u009c)/g, '')
    .replace(/(?:\x1b[PX^_]|[\u0090\u0098\u009e\u009f])[\s\S]*?(?:\x1b\\|\u009c)/g, '')
    .replace(/(?:\x1b\[|\u009b)[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[ -/]*[@-~]/g, '')
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
}
export function boundedDisplay(text: string, limit = ACTIVITY_LIMITS.fieldBytes): { text: string; omittedBytes: number } {
  const bytes = encoder.encode(cleanDisplay(text));
  if (bytes.length <= limit) return { text: cleanDisplay(text), omittedBytes: 0 };
  // fatal decoding avoids replacing a cut multibyte code point with a larger replacement character.
  let end = limit;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return { text: new TextDecoder().decode(bytes.subarray(0, end)), omittedBytes: bytes.length - end };
}
export function reviewPayload(text: string, reason?: string): ApprovalReview {
  if (cleanDisplay(text) !== text) return { completeness: 'unavailable', reason: 'Control characters prevent complete review of this action.' };
  const bounded = boundedDisplay(text, ACTIVITY_LIMITS.reviewBytes);
  return bounded.omittedBytes || reason
    ? { completeness: 'unavailable', reason: boundedDisplay(reason || 'The complete action exceeds the review limit.').text, omittedBytes: bounded.omittedBytes }
    : { completeness: 'complete', text: bounded.text };
}
export function createTurn(runId: string, userMessageId: string, participantId: string, acceptedAt: string): TurnRecord {
  return { version: 1, runId, userMessageId, participantId, acceptedAt, lifecycle: 'queued', sequence: 0, entries: [], incomplete: false, history: 'saved' };
}

/** Apply the same retention after durable writes, browser snapshots, and live replay merges. */
export function boundSessionActivity(messages: ChatMessage[], preserveRunId?: string): ChatMessage[] {
  const turns = messages.flatMap(message => message.role === 'user' && message.turn ? [message.turn] : []);
  let bytes = turns.reduce((sum, turn) => sum + serializedBytes(turn), 0);
  if (bytes <= ACTIVITY_LIMITS.sessionBytes) return messages;
  const active = messages.findLast(message => message.role === 'user' && message.status === 'sending' && message.turn);
  preserveRunId ??= active?.role === 'user' ? active.turn?.runId : undefined;
  const retained = new Map<TurnRecord, TurnRecord>();
  // Completed turns go first; unfinished records keep their lifecycle summary.
  const candidates = [...turns.filter(turn => !['queued', 'running'].includes(turn.lifecycle)), ...turns.filter(turn => ['queued', 'running'].includes(turn.lifecycle))];
  for (const older of candidates) {
    if (bytes <= ACTIVITY_LIMITS.sessionBytes) break;
    if (older.runId === preserveRunId) continue;
    const bounded: TurnRecord = { ...older, incomplete: true, entries: [{
      kind: 'gap', id: 'session-retention', attempt: 0, firstSequence: 0, sequence: older.sequence,
      count: older.entries.reduce((sum, entry) => sum + (entry.kind === 'gap' ? entry.count : 1), 0),
      reason: 'Older turn activity omitted to keep this session within its history limit.',
    }] };
    delete bounded.evicted;
    const savedBytes = serializedBytes(older) - serializedBytes(bounded);
    if (savedBytes <= 0) continue;
    retained.set(older, bounded);
    bytes -= savedBytes;
  }
  return messages.map(message => message.role === 'user' && message.turn && retained.has(message.turn)
    ? { ...message, turn: retained.get(message.turn)! } : message);
}
// 8192 bytes of serialized hex, included in the turn budget, no unbounded tombstone map.
function hashes(id: string): number[] {
  let a = 2166136261, b = 5381;
  for (let i = 0; i < id.length; i++) { a = Math.imul(a ^ id.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ id.charCodeAt(i); }
  return [a >>> 0, b >>> 0, (a + b) >>> 0].map(n => n % 32768);
}
function wasEvicted(record: TurnRecord, id: string): boolean {
  return Boolean(record.evicted && hashes(id).every(n => (parseInt(record.evicted![n >> 2], 16) & (1 << (n & 3))) !== 0));
}
function rememberEvicted(record: TurnRecord, id: string): void {
  const chars = (record.evicted || '0'.repeat(8192)).split('');
  for (const n of hashes(id)) chars[n >> 2] = (parseInt(chars[n >> 2], 16) | (1 << (n & 3))).toString(16);
  record.evicted = chars.join('');
}
function noteGap(record: TurnRecord, sequence: number, reason: string, count = 1): void {
  record.incomplete = true;
  const gap = record.entries.find(e => e.id === 'retention-gap');
  if (gap?.kind === 'gap') {
    gap.count += count; gap.sequence = record.sequence; gap.firstSequence = Math.min(gap.firstSequence, sequence);
    if (gap.reason !== reason) gap.reason = 'Some activity was omitted; unfinished outcomes may not have been retained.';
  } else record.entries.push({ kind: 'gap', id: 'retention-gap', attempt: 0, firstSequence: sequence, sequence: record.sequence, reason: boundedDisplay(reason).text, count });
  record.entries.sort((a, b) => a.firstSequence - b.firstSequence);
}
function completed(entry: TurnEntry): boolean {
  return entry.kind === 'tool' ? entry.status !== 'running' : entry.kind === 'assistant' ? entry.complete : entry.kind === 'approval' ? entry.state === 'resolved' : true;
}
function omitDetail(record: TurnRecord, entry: TurnEntry): void {
  let omitted = 0;
  if (entry.kind === 'tool') {
    for (const field of ['input', 'output', 'diff', 'error'] as const) {
      if (entry[field]) { omitted += encoder.encode(entry[field]).length; delete entry[field]; }
    }
  } else if (entry.kind === 'assistant' && entry.text) {
    omitted += encoder.encode(entry.text).length; entry.text = '';
  } else if (entry.kind === 'approval' && entry.review?.text) {
    omitted += encoder.encode(entry.review.text).length;
    entry.review = { completeness: 'unavailable', reason: 'Historical review detail was omitted.' };
  }
  if (omitted) {
    entry.omittedBytes = (entry.omittedBytes || 0) + omitted;
    entry.sequence = record.sequence; record.incomplete = true;
  }
}
export function boundTurn(record: TurnRecord): TurnRecord {
  // Leave room for a terminal update/omission marker. Old completed detail goes first.
  const fits = () => record.entries.length <= ACTIVITY_LIMITS.entries && serializedBytes(record) <= ACTIVITY_LIMITS.turnBytes - 2048;
  if (fits()) return record;
  for (const finished of [true, false]) {
    if (record.entries.length <= ACTIVITY_LIMITS.entries) {
      for (const entry of record.entries) {
        if (completed(entry) !== finished) continue;
        omitDetail(record, entry);
        if (fits()) return record;
      }
    }
    while (!fits()) {
      const index = record.entries.findIndex(entry => entry.id !== 'retention-gap' && completed(entry) === finished);
      if (index < 0) break;
      const [removed] = record.entries.splice(index, 1);
      rememberEvicted(record, removed.kind === 'assistant' ? removed.sourceBlockId || removed.id : removed.id);
      noteGap(record, removed.firstSequence, finished ? 'Older completed activity was omitted.' : 'Older activity omitted; unfinished outcomes were not retained.', removed.kind === 'gap' ? removed.count : 1);
    }
    if (fits()) return record;
  }
  return record;
}
function activityId(attempt: number, key: string): string | undefined {
  // Identity is never display text: truncation or control stripping could merge unrelated calls.
  return key && encoder.encode(key).length <= 1000 && cleanDisplay(key) === key ? `${attempt}:${key}` : undefined;
}
export function updateActivity(previous: TurnRecord, attempt: number, activity: ProcessActivity): TurnRecord {
  const record: TurnRecord = { ...previous, sequence: previous.sequence + 1, history: 'unsaved', entries: previous.entries.map(e => ({ ...e })) };
  const sourceId = activityId(attempt, activity.key);
  if (!sourceId || (activity.kind === 'approval' && !activityId(attempt, activity.requestId))) {
    noteGap(record, record.sequence, 'Activity with an unavailable identity was omitted.'); return boundTurn(record);
  }
  let index = activity.kind === 'assistant'
    ? record.entries.findLastIndex(e => e.kind === 'assistant' && (e.sourceBlockId || e.id) === sourceId)
    : record.entries.findIndex(e => e.id === sourceId);
  let prior: TurnEntry | undefined = record.entries[index];
  if (!prior && wasEvicted(record, sourceId)) { noteGap(record, record.sequence, 'Updates to omitted activity were not retained.'); return boundTurn(record); }
  const sourceBlock = prior?.kind === 'assistant' ? prior : undefined;
  let id = prior?.id || sourceId;
  let assistantText = activity.kind === 'assistant' ? activity.text : '';
  if (activity.kind === 'assistant' && prior?.kind === 'assistant') {
    const segments = record.entries.filter((entry): entry is Extract<TurnEntry, { kind: 'assistant' }> => entry.kind === 'assistant' && (entry.sourceBlockId || entry.id) === sourceId);
    if (activity.append && activity.text && index !== record.entries.length - 1) {
      id = `segment:${record.sequence}:${sourceId}`; index = -1; prior = undefined;
    } else if (!activity.append && (segments[0].id !== sourceId || segments.some(segment => segment.omittedBytes))) {
      noteGap(record, record.sequence, 'A replacement for omitted assistant text could not be retained.');
      assistantText = prior.text;
    } else if (!activity.append && segments.length > 1) {
      const prefix = segments.slice(0, -1).map(entry => entry.text).join('');
      if (assistantText.startsWith(prefix)) assistantText = assistantText.slice(prefix.length);
      else {
        noteGap(record, record.sequence, 'A replacement for a split assistant block could not be retained.');
        assistantText = prior.text;
      }
    }
    if (activity.complete !== undefined || activity.phase) {
      for (const segment of segments) {
        if (activity.complete !== undefined) segment.complete = activity.complete;
        if (activity.phase) segment.phase = activity.phase;
        segment.sequence = record.sequence;
      }
    }
  }
  const base: EntryBase = { id, firstSequence: prior?.firstSequence ?? record.sequence, sequence: record.sequence, attempt,
    ...(activity.actor ? { actor: Object.fromEntries(Object.entries(activity.actor).filter((pair): pair is [string, string] => typeof pair[1] === 'string').map(([k, v]) => [k, boundedDisplay(v, 1000).text])) as ActivityActor } : (prior?.actor || sourceBlock?.actor) ? { actor: prior?.actor || sourceBlock?.actor } : {}),
    ...((prior?.omittedBytes || activity.omittedBytes) ? { omittedBytes: (prior?.omittedBytes || 0) + (activity.omittedBytes || 0) } : {}) };
  if (activity.omittedBytes) record.incomplete = true;
  const field = (text: string, limit?: number) => {
    const result = boundedDisplay(text, limit);
    if (result.omittedBytes) { base.omittedBytes = (base.omittedBytes || 0) + result.omittedBytes; record.incomplete = true; }
    return result.text;
  };
  let entry: TurnEntry;
  if (activity.kind === 'assistant') {
    entry = { ...base, kind: 'assistant', sourceBlockId: sourceId, text: field((activity.append && prior?.kind === 'assistant' ? prior.text : '') + assistantText, 256 * 1024), complete: activity.complete ?? (prior?.kind === 'assistant' && prior.complete),
      ...(activity.phase ? { phase: activity.phase } : sourceBlock?.phase ? { phase: sourceBlock.phase } : {}),
      ...(prior?.kind === 'assistant' && prior.canonicalMessageId ? { canonicalMessageId: prior.canonicalMessageId } : {}) };
  } else if (activity.kind === 'tool') {
    const tool = prior?.kind === 'tool' ? prior : undefined;
    entry = { ...tool, ...base, kind: 'tool', tool: field(/^tool$/i.test(activity.tool) && tool ? tool.tool : activity.tool, 300), status: activity.status === 'running' && tool && tool.status !== 'running' ? tool.status : activity.status };
    for (const key of ['summary', 'input', 'output', 'diff', 'error'] as const) {
      if (activity[key] !== undefined) entry[key] = field((key === 'output' && activity.appendOutput ? tool?.output || '' : '') + activity[key]);
    }
    for (const key of ['startedAt', 'finishedAt', 'durationMs', 'exitCode'] as const) {
      if (activity[key] !== undefined) Object.assign(entry, { [key]: activity[key] });
    }
  } else if (activity.kind === 'approval') {
    // Live full review belongs to the broker stream; history stores only bounded display detail.
    const approval = prior?.kind === 'approval' ? prior : undefined;
    const review = activity.review ? { ...activity.review, ...(activity.review.reason ? { reason: field(activity.review.reason) } : {}), ...(activity.review.text ? { text: field(activity.review.text) } : {}) } : approval?.review;
    if (review?.text && activity.review?.text && encoder.encode(activity.review.text).length > ACTIVITY_LIMITS.fieldBytes) {
      review.completeness = 'unavailable'; review.reason = 'Historical review detail was shortened.';
    }
    const toolId = activity.toolKey ? activityId(attempt, activity.toolKey) : approval?.toolId;
    if (activity.toolKey && !toolId) { record.incomplete = true; base.omittedBytes = (base.omittedBytes || 0) + encoder.encode(activity.toolKey).length; }
    entry = { ...approval, ...base, kind: 'approval', requestId: activity.requestId, tool: field(activity.tool, 300), summary: field(activity.summary), state: activity.state,
      ...(toolId ? { toolId } : {}), ...(activity.decision ? { decision: activity.decision } : {}), ...(review ? { review } : {}) };
  } else {
    record.incomplete = true;
    entry = { ...base, kind: 'gap', reason: field(activity.reason), count: 1 };
  }
  if (base.omittedBytes) entry.omittedBytes = base.omittedBytes;
  if (index >= 0) record.entries[index] = entry; else record.entries.push(entry);
  return boundTurn(record);
}
export function finishTurn(previous: TurnRecord, lifecycle: TurnLifecycle, final?: { attempt: number; key?: string; keys?: readonly string[]; messageId: string }): TurnRecord {
  const finalIds = new Set(final ? [...(final.keys || []), ...(final.key ? [final.key] : [])].map(key => activityId(final.attempt, key)).filter((id): id is string => Boolean(id)) : []);
  return boundTurn({ ...previous, sequence: previous.sequence + 1, lifecycle, history: 'unsaved', incomplete: previous.incomplete || lifecycle === 'interrupted', entries: previous.entries.map(entry => {
    if (entry.kind === 'tool' && entry.status === 'running') return { ...entry, sequence: previous.sequence + 1, status: 'unknown' };
    if (entry.kind === 'approval' && entry.state === 'pending') return { ...entry, sequence: previous.sequence + 1, state: 'resolved', decision: 'cancelled' };
    if (entry.kind === 'assistant') return { ...entry, sequence: previous.sequence + 1, complete: true, ...(final && finalIds.has(entry.sourceBlockId || entry.id) ? { canonicalMessageId: final.messageId } : {}) };
    return { ...entry };
  }) });
}
