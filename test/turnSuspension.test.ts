import { describe, expect, it } from 'vitest';
import { TurnSuspension } from '@/server/runs/turnSuspension';

describe('deferred maintenance interruption', () => {
  it('waits through text blocks until a complete non-final response boundary', () => {
    const pause = new TurnSuspension();
    pause.running();
    pause.observe({ type: 'turn-started' });
    pause.request();
    pause.observe({ type: 'history', activity: { kind: 'assistant', key: 'block', text: 'Working', complete: true } });
    expect(pause.signal.aborted).toBe(false);
    pause.observe({ type: 'response-boundary', responseFinal: false });
    expect(pause.signal.aborted).toBe(true);
  });

  it('lets observed commands finish and lets final answers complete', () => {
    const pause = new TurnSuspension();
    pause.running();
    pause.observe({ type: 'history', activity: { kind: 'tool', key: 'shell', tool: 'Shell', status: 'running' } });
    pause.observe({ type: 'response-boundary', responseFinal: false });
    pause.request();
    expect(pause.signal.aborted).toBe(false);
    pause.observe({ type: 'history', activity: { kind: 'tool', key: 'shell', tool: 'Shell', status: 'succeeded' } });
    expect(pause.signal.aborted).toBe(true);
    const final = new TurnSuspension();
    final.running();
    final.observe({ type: 'response-boundary', responseFinal: true });
    final.request();
    expect(final.signal.aborted).toBe(false);
  });

  it('can suspend an approval wait or preparation without waiting for a new response', () => {
    const pause = new TurnSuspension();
    pause.running();
    pause.observe({ type: 'permission-request', requestId: 'approval' });
    pause.request();
    expect(pause.signal.aborted).toBe(true);
    const preparing = new TurnSuspension();
    preparing.request();
    expect(preparing.signal.aborted).toBe(true);
  });

  it('does not let an unrelated approval interrupt an executing command', () => {
    const pause = new TurnSuspension();
    pause.running();
    for (const key of ['running-command', 'waiting-command']) pause.observe({ type: 'history', activity: {
      kind: 'tool', key, tool: 'Shell', status: 'running',
    } });
    pause.observe({ type: 'permission-request', requestId: 'approval', toolKey: 'waiting-command' });
    pause.request();
    expect(pause.signal.aborted).toBe(false);
    pause.observe({ type: 'history', activity: { kind: 'tool', key: 'running-command', tool: 'Shell', status: 'succeeded' } });
    expect(pause.signal.aborted).toBe(true);
  });
});
