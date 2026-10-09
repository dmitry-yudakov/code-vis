import { describe, expect, it, vi } from 'vitest';
import { CodexSubagentThreads } from '@/server/agents/codexSubagentThreads';

const root = 'root-thread';
const metadata = (id: string, parentThreadId = root) => ({ thread: { id, parentThreadId } });

function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<unknown>((settle, fail) => { resolve = settle; reject = fail; });
  return { promise, resolve, reject };
}

describe('CodexSubagentThreads', () => {
  it('bounds discovered threads and metadata lookups at 64', async () => {
    const read = vi.fn(async (id: string) => metadata(id));
    const threads = new CodexSubagentThreads(root, read);
    const verified = await Promise.all(Array.from({ length: 100 }, (_, index) => threads.verify(`child-${index}`)));
    expect(verified.filter(Boolean)).toHaveLength(64);
    expect(read).toHaveBeenCalledTimes(64);
    expect(await threads.verify('child-99')).toBe(false);
    expect(read).toHaveBeenCalledTimes(64);
    expect(await threads.verify(root)).toBe(true);
  });

  it.each([[16, true], [17, false]] as const)('bounds ancestry depth %i (verified=%s)', async (depth, verified) => {
    const read = vi.fn(async (id: string) => metadata(id));
    const threads = new CodexSubagentThreads(root, read);
    for (let index = 1; index <= depth; index += 1) {
      threads.observe({ id: `child-${index}`, parentThreadId: index === 1 ? root : `child-${index - 1}` });
    }
    threads.started(`child-${depth}`, 'review-turn');
    expect(await threads.verify(`child-${depth}`)).toBe(verified);
    expect(threads.active(`child-${depth}`, 'review-turn')).toBe(verified);
    expect(read).not.toHaveBeenCalled();
  });

  it('refuses a cyclic ancestry chain without repeating lookups', async () => {
    const read = vi.fn(async (id: string) => metadata(id, id === 'first' ? 'second' : 'first'));
    const threads = new CodexSubagentThreads(root, read);
    threads.started('first', 'review-turn');
    expect(await threads.verify('first')).toBe(false);
    expect(threads.active('first', 'review-turn')).toBe(false);
    expect(read.mock.calls.map(([id]) => id)).toEqual(['first', 'second']);
  });

  it('never reopens completed turns after another start or metadata observation', async () => {
    const threads = new CodexSubagentThreads(root, async (id) => metadata(id));
    threads.observe(metadata('reviewer').thread);
    threads.started('reviewer', 'old-turn');
    threads.completed('reviewer', 'old-turn');
    threads.observe(metadata('reviewer').thread);
    threads.started('reviewer', 'old-turn');
    expect(threads.active('reviewer', 'old-turn')).toBe(false);
    threads.started('reviewer', 'new-turn');
    threads.started('reviewer', 'old-turn');
    expect(threads.active('reviewer', 'new-turn')).toBe(true);
    expect(threads.activeTurns()).toEqual([{ threadId: 'reviewer', turnId: 'new-turn' }]);
  });

  it('invalidates a conflicting parent permanently', async () => {
    const threads = new CodexSubagentThreads(root, async (id) => metadata(id));
    threads.observe(metadata('reviewer').thread);
    threads.started('reviewer', 'review-turn');
    expect(threads.active('reviewer', 'review-turn')).toBe(true);
    threads.observe(metadata('reviewer', 'another-root').thread);
    threads.observe(metadata('reviewer').thread);
    expect(await threads.verify('reviewer')).toBe(false);
    expect(threads.active('reviewer', 'review-turn')).toBe(false);
    // A previously verified live worker remains a teardown target after its authority is revoked.
    expect(threads.activeTurns()).toEqual([{ threadId: 'reviewer', turnId: 'review-turn' }]);
  });

  it('retains a verified reviewer for cleanup after its coordinator closes', async () => {
    const threads = new CodexSubagentThreads(root, async (id) => metadata(id));
    threads.observe(metadata('coordinator').thread);
    threads.observe(metadata('reviewer', 'coordinator').thread);
    threads.started('reviewer', 'review-turn');
    expect(await threads.verify('reviewer')).toBe(true);
    threads.closed('coordinator');
    expect(threads.active('reviewer', 'review-turn')).toBe(false);
    expect(threads.activeTurns()).toEqual([{ threadId: 'reviewer', turnId: 'review-turn' }]);
    threads.completed('reviewer', 'review-turn');
    expect(threads.activeTurns()).toEqual([]);
  });

  it.each([
    { parentThreadId: root, source: { subAgent: { thread_spawn: { parent_thread_id: 'another-root' } } } },
    { parentThreadId: 'reviewer' },
    { parentThreadId: '' },
  ])('refuses malformed or contradictory metadata %j', async (fields) => {
    const threads = new CodexSubagentThreads(root, async () => ({ thread: { id: 'reviewer', ...fields } }));
    threads.started('reviewer', 'review-turn');
    expect(await threads.verify('reviewer')).toBe(false);
    expect(threads.active('reviewer', 'review-turn')).toBe(false);
  });

  it('accepts legacy parent metadata and preserves its nickname', async () => {
    const threads = new CodexSubagentThreads(root, async () => ({ thread: {
      id: 'reviewer', parentThreadId: null,
      source: { subAgent: { thread_spawn: { parent_thread_id: root, agent_nickname: 'Reviewer' } } },
    } }));
    threads.started('reviewer', 'review-turn');
    expect(await threads.verify('reviewer')).toBe(true);
    expect(threads.active('reviewer', 'review-turn')).toBe(true);
    expect(threads.label('reviewer')).toBe('Reviewer');
  });

  it('requires thread/read to return the exact requested thread ID', async () => {
    const read = vi.fn(async () => metadata('another-child'));
    const threads = new CodexSubagentThreads(root, read);
    threads.started('reviewer', 'review-turn');
    expect(await threads.verify('reviewer')).toBe(false);
    expect(await threads.verify('reviewer')).toBe(false);
    expect(threads.active('reviewer', 'review-turn')).toBe(false);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent metadata discovery for a child and its parent', async () => {
    const pending = deferred();
    const read = vi.fn((id: string) => id === 'reviewer' ? pending.promise : Promise.resolve(metadata(id)));
    const threads = new CodexSubagentThreads(root, read);
    const first = threads.verify('reviewer');
    const second = threads.verify('reviewer');
    expect(read).toHaveBeenCalledExactlyOnceWith('reviewer');
    pending.resolve(metadata('reviewer', 'coordinator'));
    expect(await Promise.all([first, second])).toEqual([true, true]);
    expect(read.mock.calls.map(([id]) => id)).toEqual(['reviewer', 'coordinator']);
  });

  it('does not revive a completed turn while a metadata lookup is pending', async () => {
    const pending = deferred();
    const threads = new CodexSubagentThreads(root, () => pending.promise);
    threads.started('reviewer', 'review-turn');
    const verification = threads.verify('reviewer');
    threads.completed('reviewer', 'review-turn');
    pending.resolve(metadata('reviewer'));
    expect(await verification).toBe(true);
    expect(threads.active('reviewer', 'review-turn')).toBe(false);
    expect(threads.activeTurns()).toEqual([]);
  });

  it('does not revive a closed thread when pending metadata arrives', async () => {
    const pending = deferred();
    const threads = new CodexSubagentThreads(root, () => pending.promise);
    threads.started('reviewer', 'review-turn');
    const verification = threads.verify('reviewer');
    threads.closed('reviewer');
    pending.resolve(metadata('reviewer'));
    expect(await verification).toBe(false);
    threads.started('reviewer', 'new-turn');
    expect(threads.activeTurns()).toEqual([]);
  });

  it('fails closed after repeated completed turns reach the bounded history', async () => {
    const threads = new CodexSubagentThreads(root, async (id) => metadata(id));
    threads.observe(metadata('reviewer').thread);
    for (let index = 0; index < 129; index += 1) threads.completed('reviewer', `turn-${index}`);
    threads.started('reviewer', 'later-turn');
    expect(await threads.verify('reviewer')).toBe(false);
    expect(threads.activeTurns()).toEqual([]);
  });

  it('caches failed metadata reads so callbacks cannot repeatedly retry discovery', async () => {
    const read = vi.fn(async () => { throw new Error('Thread not found'); });
    const threads = new CodexSubagentThreads(root, read);
    expect(await threads.verify('reviewer')).toBe(false);
    expect(await threads.verify('reviewer')).toBe(false);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it.each(['failed', 'wrong-id'])('notifies revoked eligibility after a pending lookup is %s', async (failure) => {
    const pending = deferred();
    const eligibilityChanges: boolean[] = [];
    let threads!: CodexSubagentThreads;
    threads = new CodexSubagentThreads(root, () => pending.promise,
      () => eligibilityChanges.push(threads.active('reviewer', 'review-turn')));
    threads.started('reviewer', 'review-turn');
    const verification = threads.verify('reviewer');
    // Provider metadata can make the child eligible before the earlier asynchronous read returns.
    threads.observe(metadata('reviewer').thread);
    expect(threads.active('reviewer', 'review-turn')).toBe(true);
    eligibilityChanges.length = 0;
    if (failure === 'failed') pending.reject(new Error('Thread not found'));
    else pending.resolve(metadata('wrong-child'));
    expect(await verification).toBe(false);
    expect(threads.active('reviewer', 'review-turn')).toBe(false);
    expect(eligibilityChanges).toEqual([false]);
  });
});
