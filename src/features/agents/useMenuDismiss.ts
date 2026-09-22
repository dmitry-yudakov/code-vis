'use client';

import { useEffect, type RefObject } from 'react';

/** Closes a `<details>` menu on Escape (returning focus to its summary) or a pointer press outside it. */
export function useMenuDismiss(menuRef: RefObject<HTMLDetailsElement | null>): void {
  useEffect(() => {
    const close = (event: Event) => {
      const menu = menuRef.current;
      if (!menu?.open) return;
      if (event.type === 'keydown' && (event as KeyboardEvent).key === 'Escape') {
        menu.removeAttribute('open');
        (menu.querySelector('summary') as HTMLElement | null)?.focus();
      } else if (event.type === 'pointerdown' && !menu.contains(event.target as Node)) {
        menu.removeAttribute('open');
      }
    };
    document.addEventListener('keydown', close);
    document.addEventListener('pointerdown', close);
    return () => {
      document.removeEventListener('keydown', close);
      document.removeEventListener('pointerdown', close);
    };
  }, [menuRef]);
}
