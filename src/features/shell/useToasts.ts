'use client';

import { useCallback, useRef, useState } from 'react';
import { withoutToast, withToast, type Toast, type ToastInput } from './toasts';

/** The shell's raised toasts: raise one, dismiss one by key, and the latest news for one-line statuses. */
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Raises up to this serial are no longer news for a one-line status such as VR's, which cannot dismiss.
  const [settled, setSettled] = useState(0);
  const serial = useRef(0);
  const notify = useCallback((input: ToastInput) => {
    const raised = ++serial.current;
    setToasts((current) => withToast(current, input, raised));
  }, []);
  const dismiss = useCallback((key: string) => setToasts((current) => withoutToast(current, key)), []);
  /** An action starts again: its own earlier toast goes, and every older toast stops being the latest news. */
  const supersede = useCallback((key: string) => {
    dismiss(key);
    setSettled(serial.current);
  }, [dismiss]);
  const latest = toasts.findLast((toast) => toast.serial > settled);
  return { toasts, latest, notify, dismiss, supersede };
}
