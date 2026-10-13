'use client';

import { useLayoutEffect, useRef } from 'react';

/** Return to a visible opener, or the stable shell control when navigation removed it. */
export function useDialogFocus(open: boolean, fallback: string, requested?: HTMLElement | null) {
  const opener = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  useLayoutEffect(() => {
    if (open && !wasOpen.current) {
      opener.current = requested ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    }
    wasOpen.current = open;
  }, [open, requested]);
  return () => {
    const target = opener.current;
    const visible = target?.isConnected && target.getClientRects().length && !target.closest('[inert], [aria-hidden="true"]');
    (visible ? target : document.querySelector<HTMLElement>(fallback))?.focus({ preventScroll: true });
  };
}
