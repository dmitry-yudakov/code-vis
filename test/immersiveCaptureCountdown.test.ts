import { describe, expect, it } from 'vitest';
import { createCaptureCountdown, IMMERSIVE_CAPTURE_DELAY_MS } from '@/features/shell/immersive/captureCountdown';

describe('immersive capture countdown', () => {
  it('counts whole seconds down from activation on the clock it is given', () => {
    const countdown = createCaptureCountdown();
    expect(countdown.advance(5, true)).toEqual({ phase: 'idle' });
    expect(countdown.toggle(1_000)).toBe(true);
    expect(countdown.advance(1_000, true)).toEqual({ phase: 'counting', status: 'Capturing in 3…' });
    expect(countdown.advance(1_999, true)).toEqual({ phase: 'counting', status: 'Capturing in 3…' });
    expect(countdown.advance(2_000, true)).toEqual({ phase: 'counting', status: 'Capturing in 2…' });
    expect(countdown.advance(3_500, true)).toEqual({ phase: 'counting', status: 'Capturing in 1…' });
    expect(countdown.advance(1_000 + IMMERSIVE_CAPTURE_DELAY_MS - 1, true)).toEqual({ phase: 'counting', status: 'Capturing in 1…' });
    expect(IMMERSIVE_CAPTURE_DELAY_MS).toBe(3_000);
  });

  it('captures no earlier than the delay, and only once the countdown has left the rendered status', () => {
    const countdown = createCaptureCountdown();
    countdown.toggle(0);
    expect(countdown.advance(IMMERSIVE_CAPTURE_DELAY_MS, true)).toEqual({ phase: 'clearing' });
    // The status texture still shows the countdown until the cleared line is committed and rasterized.
    expect(countdown.advance(IMMERSIVE_CAPTURE_DELAY_MS + 11, false)).toEqual({ phase: 'clearing' });
    expect(countdown.advance(IMMERSIVE_CAPTURE_DELAY_MS + 22, false)).toEqual({ phase: 'clearing' });
    expect(countdown.advance(IMMERSIVE_CAPTURE_DELAY_MS + 33, true)).toEqual({ phase: 'capture' });
    // One capture per activation.
    expect(countdown.advance(IMMERSIVE_CAPTURE_DELAY_MS + 44, true)).toEqual({ phase: 'idle' });
  });

  it('cancels on a second press or on leaving, and a later press starts afresh', () => {
    const countdown = createCaptureCountdown();
    expect(countdown.toggle(0)).toBe(true);
    expect(countdown.toggle(1_000)).toBe(false);
    expect(countdown.advance(IMMERSIVE_CAPTURE_DELAY_MS + 100, true)).toEqual({ phase: 'idle' });
    countdown.toggle(2_000);
    expect(countdown.advance(2_000 + IMMERSIVE_CAPTURE_DELAY_MS, true)).toEqual({ phase: 'clearing' });
    countdown.cancel();
    expect(countdown.advance(2_000 + IMMERSIVE_CAPTURE_DELAY_MS + 20, true)).toEqual({ phase: 'idle' });
    countdown.cancel();
    expect(countdown.toggle(9_000)).toBe(true);
    expect(countdown.advance(9_000 + IMMERSIVE_CAPTURE_DELAY_MS - 1, true)).toEqual({ phase: 'counting', status: 'Capturing in 1…' });
  });
});
