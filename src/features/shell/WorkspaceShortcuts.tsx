'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { QuickFilePicker } from '@/features/repository/QuickFilePicker';
import { useRepositoryFiles } from '@/features/repository/RepositoryFilesProvider';
import { hasVisibleKeyboardOverlay } from './keyboardOverlays';
import type { Pane } from './panelLayout';

const paneSelectors: Record<Pane, string> = {
  conversation: '.conversation-region', files: '.file-view-region', canvas: '.canvas-workspace', side: '.repository-region',
};

/** Mounted only for the focused flat workspace. Remember deliberate pointer/keyboard activity. */
export function WorkspaceShortcuts({ shellRef, layout, arenaLink }: {
  shellRef: RefObject<HTMLElement | null>; layout: { maximized: Pane | null; toggleMaximized(pane: Pane): void };
  arenaLink?: RefObject<HTMLAnchorElement | null>;
}) {
  const files = useRepositoryFiles();
  const [pickerOpen, setPickerOpen] = useState(false);
  const active = useRef<Pane | undefined>(undefined);
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const paneAt = (target: EventTarget | null) => target instanceof Element
      ? (Object.keys(paneSelectors) as Pane[]).find(pane => shell.contains(target) && target.closest(paneSelectors[pane])) : undefined;
    const remember = (event: Event) => { const pane = paneAt(event.target); if (pane) active.current = pane; };
    const visible = (pane: Pane) => Boolean(shell.querySelector(paneSelectors[pane])?.getClientRects().length);
    const shortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.altKey) return;
      const arenaTarget = event.key.toLowerCase() === 'j' && event.ctrlKey !== event.metaKey && !event.shiftKey
        ? arenaLink?.current : null;
      const openFile = (event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'p';
      const maximize = event.key === 'Escape' && event.shiftKey && !event.ctrlKey && !event.metaKey;
      if (!openFile && !maximize && !arenaTarget) return;
      if (openFile && pickerOpen) { event.preventDefault(); return; }
      if (hasVisibleKeyboardOverlay()) return;
      if (arenaTarget) {
        event.preventDefault();
        if (!event.repeat) arenaTarget.click();
      } else if (openFile) {
        if (!files?.repositories.length) return;
        event.preventDefault();
        if (!event.repeat) setPickerOpen(true);
      } else {
        const focused = paneAt(event.target);
        const pane = layout.maximized || (active.current && visible(active.current) ? active.current : undefined)
          || (focused && visible(focused) ? focused : undefined)
          || (['conversation', 'files', 'canvas', 'side'] as const).find(visible);
        if (!pane) return;
        event.preventDefault();
        if (!event.repeat) layout.toggleMaximized(pane);
      }
    };
    shell.addEventListener('pointerdown', remember, true);
    shell.addEventListener('focusin', remember, true);
    // File tabs and editors can stop bubbling keyboard events; shortcuts belong to the workspace.
    document.addEventListener('keydown', shortcut, true);
    return () => {
      shell.removeEventListener('pointerdown', remember, true);
      shell.removeEventListener('focusin', remember, true);
      document.removeEventListener('keydown', shortcut, true);
    };
  }, [shellRef, files?.repositories.length, layout, pickerOpen, arenaLink]);
  return pickerOpen ? <QuickFilePicker onClose={() => setPickerOpen(false)} /> : null;
}
