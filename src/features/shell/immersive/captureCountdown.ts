/** How long a deliberate report gives the user to turn toward the problem before it captures. */
export const IMMERSIVE_CAPTURE_DELAY_MS = 3_000;

export type CaptureCountdownStep =
  | { phase: 'idle' }
  /** Show this in the status line. */
  | { phase: 'counting'; status: string }
  /** The delay has passed: clear the status line and render it, capturing nothing yet. */
  | { phase: 'clearing' }
  /** The status line on screen is free of the countdown: capture from this frame's head pose. */
  | { phase: 'capture' };

/**
 * The aim-before-capture countdown of a deliberate report. It is advanced once per rendered frame
 * with the clock it was started on, so no timer callback can capture from a stale renderer or after
 * the workspace has gone, and tests never wait. Capture is offered only once the caller confirms the
 * rendered status no longer shows the countdown, so the countdown never appears in the image.
 */
export function createCaptureCountdown() {
  let deadline: number | undefined;
  let cleared = false;
  const cancel = () => { deadline = undefined; cleared = false; };
  return {
    /** Starts the countdown, or cancels the pending one; returns whether one is now pending. */
    toggle(now: number): boolean {
      if (deadline !== undefined) { cancel(); return false; }
      deadline = now + IMMERSIVE_CAPTURE_DELAY_MS;
      return true;
    },
    cancel,
    /** `statusClear` says whether the status line as rendered is free of the countdown. */
    advance(now: number, statusClear: boolean): CaptureCountdownStep {
      if (deadline === undefined) return { phase: 'idle' };
      if (cleared) {
        if (!statusClear) return { phase: 'clearing' };
        cancel();
        return { phase: 'capture' };
      }
      const remaining = deadline - now;
      if (remaining > 0) return { phase: 'counting', status: `Capturing in ${Math.ceil(remaining / 1_000)}…` };
      cleared = true;
      return { phase: 'clearing' };
    },
  };
}

export type CaptureCountdown = ReturnType<typeof createCaptureCountdown>;
