import { describe, expect, it, vi } from 'vitest';
import { TurnHistoryWriter } from '@/server/conversation/turnHistoryWriter';
import { createTurn, updateActivity } from '@/shared/turnActivity';

describe('history write backpressure', () => {
  it('keeps one pending snapshot during slow storage and flushes the latest boundary', async () => {
    let release!: () => void;
    const writes: number[] = [];
    const saved = vi.fn();
    const writer = new TurnHistoryWriter(async record => {
      writes.push(record.sequence);
      if (writes.length === 1) await new Promise<void>(resolve => { release = resolve; });
    }, saved);
    let record = createTurn('run', 'message', 'agent', new Date().toISOString());
    writer.set(record);
    const flush = writer.flush();
    for (let i = 0; i < 100; i++) {
      record = updateActivity(record, 1, { kind: 'assistant', key: 'a', text: 'x', append: true });
      writer.set(record);
    }
    expect(writes).toEqual([0]);
    release();
    await flush;
    await writer.close();
    expect(writes).toEqual([0, 100]);
    expect(saved).toHaveBeenLastCalledWith(expect.objectContaining({ sequence: 100, history: 'saved' }));
  });

  it('schedules text within one second and reports failed writes as incomplete without throwing', async () => {
    vi.useFakeTimers();
    try {
      const publish = vi.fn();
      const save = vi.fn().mockRejectedValue(new Error('disk'));
      const writer = new TurnHistoryWriter(save, publish);
      writer.set(createTurn('run', 'message', 'agent', new Date().toISOString()));
      await vi.advanceTimersByTimeAsync(1000);
      expect(save).toHaveBeenCalledOnce();
      expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ incomplete: true, history: 'unsaved' }));
      await writer.close();
    } finally { vi.useRealTimers(); }
  });
});
