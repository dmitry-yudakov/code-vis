'use client';

import { useEffect } from 'react';

/** Activation refreshes only the repository view the user can currently see. No polling. */
export function useRepositoryAutoRefresh(active: boolean, refresh: () => void) {
  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const activate = () => {
      clearTimeout(timer);
      if (document.visibilityState === 'hidden') return;
      timer = setTimeout(refresh, 150);
    };
    if (document.visibilityState !== 'hidden') refresh();
    window.addEventListener('focus', activate);
    document.addEventListener('visibilitychange', activate);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', activate);
      document.removeEventListener('visibilitychange', activate);
    };
  }, [active, refresh]);
}
