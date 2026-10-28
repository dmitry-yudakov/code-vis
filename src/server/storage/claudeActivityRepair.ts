import type { TurnEntry, TurnRecord } from '@/shared/turnActivity';

type TextEntry = Extract<TurnEntry, { kind: 'assistant' }>;

function textIdentity(entry: TextEntry): [string, string, number] | undefined {
  if (entry.sourceBlockId !== entry.id || !entry.id.startsWith(`${entry.attempt}:`)) return;
  try {
    const parts: unknown = JSON.parse(entry.id.slice(`${entry.attempt}:`.length));
    if (Array.isArray(parts) && parts.length === 4 && parts[0] === 'text'
      && typeof parts[1] === 'string' && typeof parts[2] === 'string' && Number.isInteger(parts[3])) {
      return [parts[1], parts[2], parts[3]];
    }
  } catch { /* Other providers and opaque identities are left untouched. */ }
}

/** Public display compatibility for the pre-117 Claude parser; never rewrites durable history. */
export function repairClaudeActivity(turn: TurnRecord): TurnRecord {
  if (turn.lifecycle === 'queued' || turn.lifecycle === 'running') return turn;
  const entries = turn.entries.filter((entry, index) => {
    const next = turn.entries[index + 1];
    if (entry.kind !== 'assistant' || next?.kind !== 'assistant' || !entry.complete || !next.complete
      || entry.actor?.provider !== 'claude' || next.actor?.provider !== 'claude'
      || entry.attempt !== next.attempt || entry.sequence !== next.sequence
      || JSON.stringify(entry.actor) !== JSON.stringify(next.actor)
      || entry.omittedBytes || next.omittedBytes || entry.phase || next.phase || entry.canonicalMessageId
      || !entry.text || entry.text !== next.text) return true;
    const streamed = textIdentity(entry), snapshot = textIdentity(next);
    if (!streamed || !snapshot || streamed[0] !== snapshot[0]
      || streamed[0] !== (entry.actor.parentToolId || '')
      || !/^anonymous-\d+$/.test(streamed[1]) || streamed[2] !== 1 || snapshot[2] !== 0) return true;
    try {
      const message: unknown = JSON.parse(snapshot[1]);
      return !(Array.isArray(message) && message.length === 1 && typeof message[0] === 'string' && message[0].startsWith('msg_'));
    } catch { return true; }
  });
  return entries.length === turn.entries.length ? turn : { ...turn, entries };
}
