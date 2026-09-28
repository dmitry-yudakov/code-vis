import type { SessionRunOutcome } from '@/features/conversation/runPresentation';

export type ToastTone = 'info' | 'success' | 'warning' | 'error';

export interface ToastAction {
  label: string;
  onSelect(): void;
  disabled?: boolean;
}

export interface ToastInput {
  tone: ToastTone;
  message: string;
  /** Raising a key already shown replaces that toast; without one, a repeated message merges. */
  key?: string;
  actions?: ToastAction[];
  /** Stays until dismissed, whatever its tone. */
  persistent?: boolean;
  /** Runs when the toast leaves by its × or its countdown, not when a new raise replaces it. */
  onDismiss?(): void;
}

export interface Toast extends ToastInput {
  key: string;
  /** How many times this message was raised while shown. */
  count: number;
  /** Increases on every raise, so a repeated message restarts its countdown. */
  serial: number;
}

/** Raised toasts kept at once; the standing ones (run outcome, newer format) come on top of these. */
export const MAX_TOASTS = 3;

/** News leaves quickly; what the user may need to act on stays longer; errors wait for the user. */
export function toastLifetime(toast: ToastInput): number | undefined {
  if (toast.persistent || toast.tone === 'error') return undefined;
  return toast.tone === 'warning' || toast.actions?.length ? 10_000 : 6_000;
}

/**
 * Oldest first. Over the cap, the oldest earlier toast that can time out goes before any persistent
 * one; the toast being raised always stays.
 */
export function withToast(toasts: readonly Toast[], input: ToastInput, serial: number): Toast[] {
  const key = input.key ?? `${input.tone}:${input.message}`;
  const prior = toasts.find((toast) => toast.key === key);
  const count = prior?.message === input.message ? prior.count + 1 : 1;
  const earlier = toasts.filter((toast) => toast.key !== key);
  while (earlier.length >= MAX_TOASTS) {
    const transient = earlier.findIndex((toast) => toastLifetime(toast) !== undefined);
    earlier.splice(Math.max(transient, 0), 1);
  }
  return [...earlier, { ...input, key, count, serial }];
}

/** A toast derived from state, such as a session's run outcome, rather than raised; its `onDismiss` clears that state. */
export function standingToast(key: string, input: Omit<ToastInput, 'key' | 'persistent'>): Toast {
  return { ...input, key, persistent: true, count: 1, serial: 0 };
}

export function withoutToast(toasts: Toast[], key: string): Toast[] {
  return toasts.some((toast) => toast.key === key) ? toasts.filter((toast) => toast.key !== key) : toasts;
}

/** A turn the user stopped is not a failure, and a turn at its limit asks the user to continue it. */
export function runOutcomeTone(outcome: SessionRunOutcome): ToastTone {
  if (outcome.cancelled) return 'info';
  return outcome.continueMode ? 'warning' : 'error';
}
