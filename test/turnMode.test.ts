import { describe, expect, it } from 'vitest';
import { TurnMode } from '@/server/runs/turnMode';

describe('live turn mode', () => {
  it('interrupts an attempt on a changed mode, coalesces rapid changes, and keeps same-mode requests running', () => {
    const mode = new TurnMode('agent');
    const first = mode.begin();
    expect(mode.change('agent')).toBe(true);
    expect(first.signal.aborted).toBe(false);
    expect(mode.change('auto')).toBe(true);
    expect(first.signal.aborted).toBe(true);
    mode.change('plan');
    expect(mode.begin().mode).toBe('plan');
  });

  it('accepts queued changes but refuses changes once publication starts', () => {
    const mode = new TurnMode('ask');
    mode.change('agent');
    expect(mode.begin().mode).toBe('agent');
    mode.close();
    expect(mode.change('auto')).toBe(false);
    expect(mode.mode).toBe('agent');
  });
});
