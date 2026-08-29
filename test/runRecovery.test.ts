import { describe, expect, it, vi } from 'vitest';
import { reconcileSessionRun } from '@/features/conversation/runRecovery';
import type { RunDescriptor } from '@/shared/types';

const active: RunDescriptor = {
  runId: '11111111-2222-4333-8444-555555555555',
  sessionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  participantId: 'agent-a',
  startedAt: 1,
};

describe('run recovery reconciliation', () => {
  it('refetches after a stale hydration when completion happens before discovery', async () => {
    let canonical = 'running';
    let rendered = canonical; // The app list hydrated just before this recovery pass begins.
    const attach = vi.fn();
    const outcome = await reconcileSessionRun({
      async discover() {
        canonical = 'complete';
        return undefined;
      },
      adopt: vi.fn(),
      attach,
      async hydrate() { rendered = canonical; },
      consume: vi.fn(),
    });
    expect(outcome).toBe('idle');
    expect(attach).not.toHaveBeenCalled();
    expect(rendered).toBe('complete');
  });

  it('ends canonical when discovery sees a run that finishes before attachment', async () => {
    let canonical = 'running';
    let rendered = 'stale';
    const adopted: RunDescriptor[] = [];
    const consume = vi.fn();
    const outcome = await reconcileSessionRun({
      async discover() { return active; },
      adopt(run) { adopted.push(run); },
      async attach() {
        canonical = 'complete';
        return { kind: 'finished' as const };
      },
      async hydrate() { rendered = canonical; },
      consume,
    });
    expect(outcome).toBe('finished');
    expect(adopted).toEqual([active]);
    expect(consume).not.toHaveBeenCalled();
    expect(rendered).toBe('complete');
  });

  it('refetches after a successfully attached stream completes', async () => {
    let canonical = 'running';
    let rendered = 'stale';
    const order: string[] = [];
    const outcome = await reconcileSessionRun({
      async discover() { order.push('discover'); return active; },
      adopt() { order.push('adopt'); },
      async attach() { order.push('attach'); return { kind: 'stream' as const, stream: 'events' }; },
      async hydrate() { order.push('hydrate'); rendered = canonical; },
      async consume(stream) {
        order.push(`consume:${stream}`);
        canonical = 'complete';
        rendered = 'stream-preview';
      },
    });
    expect(outcome).toBe('streamed');
    expect(order).toEqual(['discover', 'adopt', 'attach', 'hydrate', 'consume:events', 'hydrate']);
    expect(rendered).toBe('complete');
  });
});
