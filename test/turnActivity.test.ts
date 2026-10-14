import { describe, expect, it } from 'vitest';
import { createTurn, updateActivity, finishTurn, ACTIVITY_LIMITS, serializedBytes, reviewPayload, boundTurn, cleanDisplay } from '@/shared/turnActivity';
import { turnRecordSchema } from '@/shared/turnActivitySchema';

const turn = () => createTurn('run', 'message', 'agent', '2026-10-13T10:00:00.000Z');

describe('ordered turn history', () => {
  it('keeps first-observed order, independent calls, block boundaries and attempt identity', () => {
    let record = turn();
    record = updateActivity(record, 1, { kind: 'assistant', key: 'a', text: 'Before', complete: true });
    record = updateActivity(record, 1, { kind: 'tool', key: 't', tool: 'Read', status: 'running' });
    record = updateActivity(record, 1, { kind: 'assistant', key: 'b', text: 'After', complete: true });
    record = updateActivity(record, 1, { kind: 'tool', key: 't', tool: 'Read', status: 'succeeded', output: 'data' });
    record = updateActivity(record, 2, { kind: 'tool', key: 't', tool: 'Read', status: 'running' });
    expect(record.entries.map(e => e.id)).toEqual(['1:a', '1:t', '1:b', '2:t']);
    expect(record.entries[1]).toMatchObject({ firstSequence: 2, sequence: 4, status: 'succeeded', output: 'data' });
    expect(finishTurn(record, 'completed').entries[3]).toMatchObject({ status: 'unknown' });
  });

  it('handles completion first without downgrading it; reconciles final by identity, never equal text', () => {
    let record = updateActivity(turn(), 1, { kind: 'tool', key: 't', tool: 'tool', status: 'failed', error: 'Oops' });
    record = updateActivity(record, 1, { kind: 'tool', key: 't', tool: 'Run', status: 'running', input: 'false' });
    record = updateActivity(record, 1, { kind: 'assistant', key: 'comment', text: 'Same', phase: 'commentary' });
    record = updateActivity(record, 1, { kind: 'assistant', key: 'final', text: 'Same', phase: 'final' });
    record = finishTurn(record, 'completed', { attempt: 1, key: 'final', messageId: 'canonical' });
    expect(record.entries[0]).toMatchObject({ status: 'failed', tool: 'Run' });
    expect(record.entries[1]).not.toHaveProperty('canonicalMessageId');
    expect(record.entries[2]).toMatchObject({ canonicalMessageId: 'canonical' });
  });

  it('bounds unfinished activity and bookkeeping, preserves recent rows and does not resurrect evicted calls', () => {
    let record = turn();
    for (let i = 0; i < 1200; i++) record = updateActivity(record, 1, { kind: 'tool', key: `t${i}`, tool: 'Run', status: 'running', input: 'x'.repeat(100) });
    expect(record.entries.length).toBeLessThanOrEqual(ACTIVITY_LIMITS.entries);
    expect(serializedBytes(record)).toBeLessThanOrEqual(ACTIVITY_LIMITS.turnBytes);
    expect(record.entries[0]).toMatchObject({ kind: 'gap' });
    expect(record.entries.at(-1)?.id).toBe('1:t1199');
    record = updateActivity(record, 1, { kind: 'tool', key: 't0', tool: 'Run', status: 'succeeded' });
    expect(record.entries.find(e => e.id === '1:t0')).toBeUndefined();
    record = updateActivity(record, 1, { kind: 'assistant', key: 'huge', text: '😀'.repeat(600_000) });
    expect(serializedBytes(record)).toBeLessThanOrEqual(ACTIVITY_LIMITS.turnBytes);
    expect(record.incomplete).toBe(true);
    expect(record.entries.at(-1)).toMatchObject({ kind: 'assistant', omittedBytes: expect.any(Number) });
  });

  it('strips terminal escapes, counts UTF-8 fields and gates review independently of history', () => {
    const record = updateActivity(turn(), 1, { kind: 'tool', key: 'x', tool: 'Run', status: 'running', output: '\x1b[31mred\x1b[0m\x1b]8;;https://bad\x07link\x1b]8;;\x07' + '😀'.repeat(10_000) });
    const entry = record.entries[0];
    expect(entry.kind === 'tool' && entry.output).toMatch(/^redlink/);
    expect(entry.kind === 'tool' && serializedBytes(entry.output)).toBeLessThan(ACTIVITY_LIMITS.fieldBytes + 10);
    expect(reviewPayload('a'.repeat(64 * 1024))).toMatchObject({ completeness: 'complete' });
    expect(reviewPayload('a'.repeat(64 * 1024 + 1))).toMatchObject({ completeness: 'unavailable', omittedBytes: 1 });
  });

  it('keeps later deltas after ordering boundaries and reconciles every segment by source identity', () => {
    let record = updateActivity(turn(), 1, { kind: 'assistant', key: 'a', text: 'Before ', phase: 'final' });
    record = updateActivity(record, 1, { kind: 'tool', key: 't', tool: 'Run', status: 'running' });
    record = updateActivity(record, 1, { kind: 'assistant', key: 'a', text: 'after', append: true });
    expect(record.entries.map(entry => entry.kind === 'assistant' ? entry.text : entry.kind)).toEqual(['Before ', 'tool', 'after']);
    const ids = record.entries.map(entry => entry.id);
    record = updateActivity(record, 1, { kind: 'assistant', key: 'a', text: 'Before after', complete: true });
    expect(record.entries.map(entry => entry.id)).toEqual(ids);
    expect(record.entries.filter(entry => entry.kind === 'assistant').map(entry => entry.text)).toEqual(['Before ', 'after']);
    record = finishTurn(record, 'completed', { attempt: 1, key: 'a', messageId: 'canonical' });
    for (const entry of record.entries.filter(entry => entry.kind === 'assistant')) {
      expect(entry).toMatchObject({ complete: true, canonicalMessageId: 'canonical', sequence: record.sequence });
    }
    expect(turnRecordSchema.safeParse(record).success).toBe(true);
  });

  it('omits unsafe or oversized identities instead of merging distinct calls', () => {
    let record = updateActivity(turn(), 1, { kind: 'tool', key: 'x'.repeat(1000) + 'a', tool: 'First', status: 'running' });
    record = updateActivity(record, 1, { kind: 'tool', key: 'x'.repeat(1000) + 'b', tool: 'Second', status: 'succeeded' });
    record = updateActivity(record, 1, { kind: 'tool', key: '\u001b[31mplain', tool: 'Third', status: 'running' });
    record = updateActivity(record, 1, { kind: 'tool', key: 'plain', tool: 'Fourth', status: 'running' });
    expect(record.entries.filter(entry => entry.kind === 'tool')).toMatchObject([{ id: '1:plain', tool: 'Fourth' }]);
    expect(record.entries.filter(entry => entry.kind === 'gap')).toHaveLength(1);
    expect(record.incomplete).toBe(true);
  });

  it('keeps unfinished rows before evicting completed rows and orders the omission marker', () => {
    const record = turn();
    record.sequence = 1001;
    record.entries = Array.from({ length: 1001 }, (_, i) => ({ id: `1:t${i}`, attempt: 1, firstSequence: i + 1, sequence: i + 1,
      kind: 'tool' as const, tool: 'Run', status: i === 0 ? 'running' as const : 'succeeded' as const }));
    const bounded = boundTurn(record);
    expect(bounded.entries[0]).toMatchObject({ id: '1:t0', status: 'running' });
    expect(bounded.entries[1]).toMatchObject({ kind: 'gap', firstSequence: 2 });
    expect(bounded.entries.at(-1)?.id).toBe('1:t1000');
    expect(turnRecordSchema.safeParse(bounded).success).toBe(true);
  });

  it('omits unfinished display detail before removing unfinished identities', () => {
    const record = turn();
    record.sequence = 100;
    record.entries = Array.from({ length: 100 }, (_, i) => ({ id: `1:t${i}`, attempt: 1, firstSequence: i + 1, sequence: i + 1,
      kind: 'tool' as const, tool: 'Run', status: 'running' as const, output: 'x'.repeat(ACTIVITY_LIMITS.fieldBytes) }));
    const bounded = boundTurn(record);
    expect(bounded.entries).toHaveLength(100);
    expect(bounded.entries[0]).toMatchObject({ id: '1:t0', omittedBytes: ACTIVITY_LIMITS.fieldBytes });
    expect(bounded.entries.at(-1)).toHaveProperty('output');
    expect(serializedBytes(bounded)).toBeLessThanOrEqual(ACTIVITY_LIMITS.turnBytes);
  });

  it('bounds gaps and every approval metadata field, including a single oversized entry', () => {
    let record = turn();
    for (let i = 0; i < 80; i++) record = updateActivity(record, 1, { kind: 'gap', key: `g${i}`, reason: 'x'.repeat(16000) });
    expect(serializedBytes(record)).toBeLessThanOrEqual(ACTIVITY_LIMITS.turnBytes);
    expect(turnRecordSchema.safeParse(record).success).toBe(true);
    record = updateActivity(turn(), 1, { kind: 'approval', key: 'a', requestId: 'req', tool: 'Run', summary: 'x', state: 'pending', toolKey: 'x'.repeat(2 * 1024 * 1024),
      review: { completeness: 'unavailable', reason: 'x'.repeat(2 * 1024 * 1024) } });
    expect(serializedBytes(record)).toBeLessThanOrEqual(ACTIVITY_LIMITS.turnBytes);
    expect(turnRecordSchema.safeParse(record).success).toBe(true);
    expect(record.incomplete).toBe(true);
  });

  it('still updates retained calls when the conservative eviction filter matches their identities', () => {
    let record = updateActivity(turn(), 1, { kind: 'tool', key: 't', tool: 'Run', status: 'running' });
    record.evicted = 'f'.repeat(8192);
    record = updateActivity(record, 1, { kind: 'tool', key: 't', tool: 'Run', status: 'failed', error: 'Failed' });
    expect(record.entries[0]).toMatchObject({ id: '1:t', status: 'failed' });
  });

  it('strips C1 and string terminal controls and tolerates omitted actor properties', () => {
    expect(cleanDisplay('\u009b31mred\u009b0m\u001bPprivate\u001b\\ visible')).toBe('red visible');
    const record = updateActivity(turn(), 1, { kind: 'tool', key: 't', tool: 'Run', status: 'running', actor: { provider: 'claude', name: undefined } });
    expect(record.entries[0].actor).toEqual({ provider: 'claude' });
  });

  it('marks provider gaps incomplete and preserves review evidence on a resolution update', () => {
    const gap = updateActivity(turn(), 1, { kind: 'gap', key: 'unsupported', reason: 'Provider did not supply results.' });
    expect(gap.incomplete).toBe(true);
    let record = updateActivity(turn(), 1, { kind: 'approval', key: 'approval', requestId: 'request', tool: 'Run', summary: 'Run command', state: 'pending', toolKey: 'tool', review: reviewPayload('pwd') });
    record = updateActivity(record, 1, { kind: 'approval', key: 'approval', requestId: 'request', tool: 'Run', summary: 'Run command', state: 'resolved', decision: 'allow' });
    expect(record.entries[0]).toMatchObject({ toolId: '1:tool', review: { text: 'pwd' }, state: 'resolved', decision: 'allow' });
  });

  it('reconciles multiple final blocks without suppressing commentary or another attempt', () => {
    let record = updateActivity(turn(), 1, { kind: 'assistant', key: 'one', text: 'Same' });
    record = updateActivity(record, 2, { kind: 'assistant', key: 'comment', text: 'Same', phase: 'commentary' });
    record = updateActivity(record, 2, { kind: 'assistant', key: 'one', text: 'Same', phase: 'final' });
    record = updateActivity(record, 2, { kind: 'assistant', key: 'two', text: 'Second', phase: 'final' });
    record = finishTurn(record, 'completed', { attempt: 2, keys: ['one', 'two'], messageId: 'canonical' });
    expect(record.entries.slice(0, 2).every(entry => !('canonicalMessageId' in entry))).toBe(true);
    expect(record.entries.slice(2)).toMatchObject([{ canonicalMessageId: 'canonical' }, { canonicalMessageId: 'canonical' }]);
  });

  it('does not claim a complete approval review after changing action control characters', () => {
    const review = reviewPayload('echo safe\u001b[8m; delete hidden\u001b[0m');
    expect(review).toMatchObject({ completeness: 'unavailable', reason: expect.stringMatching(/control/i) });
    expect(review).not.toHaveProperty('text');
    expect(reviewPayload('echo safe\nls')).toMatchObject({ completeness: 'complete', text: 'echo safe\nls' });
  });

  it('does not recreate an evicted assistant prefix from a later full-block snapshot', () => {
    let record = updateActivity(turn(), 1, { kind: 'assistant', key: 'a', text: 'Before ', complete: true });
    record = updateActivity(record, 1, { kind: 'tool', key: 't', tool: 'Run', status: 'running' });
    record = updateActivity(record, 1, { kind: 'assistant', key: 'a', text: 'after', append: true });
    for (let i = 0; i < 998; i++) record.entries.push({ kind: 'tool', id: `1:extra${i}`, attempt: 1, firstSequence: i + 4, sequence: i + 4, tool: 'Run', status: 'running' });
    record.sequence = 1001;
    record = boundTurn(record);
    expect(record.entries.find(entry => entry.id === '1:a')).toBeUndefined();
    record = updateActivity(record, 1, { kind: 'assistant', key: 'a', text: 'Before after', complete: true });
    expect(record.entries.filter(entry => entry.kind === 'assistant')).toMatchObject([{ text: 'after', complete: true }]);
    expect(record.incomplete).toBe(true);
    expect(turnRecordSchema.safeParse(record).success).toBe(true);
  });

  it('keeps a known tool name when a late provider result has only a generic placeholder', () => {
    let record = updateActivity(turn(), 1, { kind: 'tool', key: 'read', tool: 'Read', status: 'running' });
    record = updateActivity(record, 1, { kind: 'tool', key: 'read', tool: 'Tool', status: 'succeeded', output: 'data' });
    expect(record.entries[0]).toMatchObject({ tool: 'Read', status: 'succeeded', output: 'data' });
  });
});
