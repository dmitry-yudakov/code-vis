import { describe, expect, it, vi } from 'vitest';
import { DraftIdentity, immutableEvidence, reconcileMessageAcceptance } from '@/features/conversation/draftLifecycle';

describe('submitted draft ownership', () => {
  it('consumes the submitted text and report identities at acceptance', () => {
    const draft = new DraftIdentity();
    const submitted = draft.capture(['report-a']);
    expect(draft.remainingText(submitted, 'submitted')).toBe('');
    expect(draft.remainingReports(submitted, ['report-a'])).toEqual([]);
  });

  it('keeps a newer text generation even when its text equals the submitted text', () => {
    const draft = new DraftIdentity();
    const submitted = draft.capture([]);
    draft.editText();
    expect(draft.remainingText(submitted, 'same text')).toBe('same text');
  });

  it('consumes only unchanged submitted reports and preserves a removed/readded report', () => {
    const draft = new DraftIdentity();
    const submitted = draft.capture(['report-a', 'report-b']);
    draft.changeReports(['report-a']);
    draft.changeReports(['report-a', 'report-b', 'report-c']);
    expect(draft.remainingReports(submitted, ['report-a', 'report-b', 'report-c'])).toEqual(['report-b', 'report-c']);
  });

  it('copies evidence before asynchronous export while retaining the exact submitted identities', () => {
    const first = { id: 'a', marks: [{ points: [1, 2] }] };
    const submitted = immutableEvidence([first]);
    first.marks[0].points.push(3);
    const next = { id: 'b', marks: [] };
    expect(submitted.payload).toEqual([{ id: 'a', marks: [{ points: [1, 2] }] }]);
    expect(submitted.remaining([first, next])).toEqual([next]);
    const edited = { ...first, marks: [] };
    expect(submitted.remaining([edited, next])).toEqual([edited, next]);
  });

  it('keeps draft identities independent across sessions and consumes a generation only once', () => {
    const first = new DraftIdentity();
    const second = new DraftIdentity();
    const submitted = first.capture([]);
    second.editText();
    expect(first.remainingText(submitted, 'first')).toBe('');
    first.editText();
    expect(first.remainingText(submitted, 'new first')).toBe('new first');
  });
});

describe('message acceptance reconciliation', () => {
  const session = { id: 'session-a', messages: [{ role: 'user', id: 'message-a', status: 'failed' }] };

  it('recognizes a durably appended failed message by exact client id', async () => {
    const request = vi.fn().mockResolvedValue(Response.json({ session }));
    const result = await reconcileMessageAcceptance('/session', 'message-a', request);
    expect(result).toEqual({ state: 'accepted', session });
    expect(request).toHaveBeenCalledWith('/session', { cache: 'no-store' });
  });

  it('does not infer acceptance from another message or an assistant message using the id', async () => {
    const request = vi.fn().mockResolvedValue(Response.json({ session: { ...session, messages: [{ role: 'assistant', id: 'message-b' }] } }));
    expect(await reconcileMessageAcceptance('/session', 'message-b', request)).toMatchObject({ state: 'absent' });
  });

  it.each([
    () => Promise.reject(new Error('offline')),
    () => Promise.resolve(Response.json({ error: 'unavailable' }, { status: 503 })),
    () => Promise.resolve(Response.json({})),
  ])('keeps failed reconciliation unknown instead of allowing a duplicate send', async (request) => {
    expect(await reconcileMessageAcceptance('/session', 'message-a', request as typeof fetch)).toEqual({ state: 'unknown' });
  });
});
