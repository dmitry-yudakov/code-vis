import { describe, expect, it } from 'vitest';
import { repairClaudeActivity } from '@/server/storage/claudeActivityRepair';
import { createTurn, updateActivity, finishTurn, type TurnRecord } from '@/shared/turnActivity';

function historicalPair(parent = ''): TurnRecord {
  let turn = createTurn('run', 'user', 'claude', '2026-10-28T10:00:00.000Z');
  const snapshot = JSON.stringify(['text', parent, JSON.stringify(['msg_final']), 0]);
  for (const key of [JSON.stringify(['text', parent, 'anonymous-18', 1]), snapshot]) {
    turn = updateActivity(turn, 1, { kind: 'assistant', key, text: 'Answer', complete: true,
      actor: { provider: 'claude', ...(parent ? { parentToolId: parent, name: 'Subagent' } : {}) } });
  }
  return finishTurn(turn, 'completed', { attempt: 1, key: snapshot, messageId: 'answer' });
}

describe('historical Claude activity compatibility', () => {
  it.each(['', 'delegation'])('keeps the identified snapshot and canonical reference for parent %s without mutating history', parent => {
    const turn = historicalPair(parent), before = structuredClone(turn);
    const repaired = repairClaudeActivity(turn);
    expect(repaired.entries).toEqual([turn.entries[1]]);
    expect(repaired.entries[0]).toMatchObject({ canonicalMessageId: 'answer' });
    expect(repairClaudeActivity(repaired)).toBe(repaired);
    expect(turn).toEqual(before);
  });

  const counterexamples: Array<[string, (turn: TurnRecord) => void]> = [
    ['a live turn', turn => { turn.lifecycle = 'running'; }],
    ['a queued turn', turn => { turn.lifecycle = 'queued'; }],
    ['another provider', turn => { turn.entries[0].actor = { provider: 'codex' }; }],
    ['another actor', turn => { turn.entries[1].actor!.parentToolId = 'other-agent'; }],
    ['another attempt', turn => { turn.entries[1].attempt = 2; }],
    ['an unfinished block', turn => { if (turn.entries[0].kind === 'assistant') turn.entries[0].complete = false; }],
    ['omitted text', turn => { turn.entries[0].omittedBytes = 10; }],
    ['explicit commentary', turn => { if (turn.entries[0].kind === 'assistant') turn.entries[0].phase = 'commentary'; }],
    ['a linked earlier answer', turn => { if (turn.entries[0].kind === 'assistant') turn.entries[0].canonicalMessageId = 'earlier'; }],
    ['different text', turn => { if (turn.entries[1].kind === 'assistant') turn.entries[1].text = 'Another answer'; }],
    ['a split stream block', turn => { turn.entries[0].id += '#segment'; }],
    ['different completion sequences', turn => { turn.entries[0].sequence--; }],
    ['an intervening tool', turn => { turn.entries.splice(1, 0, { kind: 'tool', id: 'tool', attempt: 1, sequence: 2, firstSequence: 1, tool: 'Read', status: 'succeeded' }); }],
    ['independent identified messages', turn => {
      const entry = turn.entries[0];
      entry.id = `1:${JSON.stringify(['text', '', JSON.stringify(['msg_commentary']), 0])}`;
      if (entry.kind === 'assistant') entry.sourceBlockId = entry.id;
    }],
    ['an unknown identity', turn => {
      const entry = turn.entries[1]; entry.id = '1:opaque';
      if (entry.kind === 'assistant') entry.sourceBlockId = entry.id;
    }],
  ];
  it.each(counterexamples)('preserves ambiguous history with %s', (_name, mutate) => {
    const turn = historicalPair(); mutate(turn);
    expect(repairClaudeActivity(turn)).toBe(turn);
  });
});
