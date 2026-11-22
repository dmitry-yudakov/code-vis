'use client';

import { useCallback, useEffect, useId, useImperativeHandle, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import ClickAwayListener from '@mui/material/ClickAwayListener';
import Paper from '@mui/material/Paper';
import Popper from '@mui/material/Popper';
import { hasVisibleKeyboardOverlay } from './keyboardOverlays';

/** A desktop picker containing forms or several selections; other controls remain reachable. */
export interface DesktopPopoverHandle { close(): void; trigger: HTMLButtonElement | null }

export function DesktopPopover({ className, label, summary, disabled = false, color = 'inherit', placement = 'top-start', anchorSelector,
  control, onOpenChange, triggerClassName, description, shortcutKey, icon = false, width = 320, keepMounted = false, group, children }: {
  className: string;
  label: string;
  summary: ReactNode;
  disabled?: boolean;
  color?: 'primary' | 'warning' | 'error' | 'inherit';
  placement?: 'top-start' | 'bottom-start' | 'bottom-end' | 'right-end';
  anchorSelector?: string;
  control?: RefObject<DesktopPopoverHandle | null>;
  onOpenChange?(open: boolean): void;
  triggerClassName?: string;
  description?: string;
  shortcutKey?: string;
  icon?: boolean;
  width?: number;
  keepMounted?: boolean;
  group?: string;
  children(close: () => void): ReactNode;
}) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = () => { setAnchor(null); trigger.current?.focus({ preventScroll: true }); };
  useImperativeHandle(control, () => ({ close, trigger: trigger.current }));
  const opened = Boolean(anchor);
  const open = useCallback((element: HTMLButtonElement) => {
    if (group) document.dispatchEvent(new CustomEvent('codeai:desktop-picker-open', { detail: { group, id } }));
    setAnchor(element);
  }, [group, id]);
  useEffect(() => {
    if (!group || !opened) return;
    const closePeer = (event: Event) => {
      const peer = (event as CustomEvent<{ group: string; id: string }>).detail;
      if (peer.group === group && peer.id !== id) setAnchor(null);
    };
    document.addEventListener('codeai:desktop-picker-open', closePeer);
    return () => document.removeEventListener('codeai:desktop-picker-open', closePeer);
  }, [group, id, opened]);
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  useEffect(() => { onOpenChangeRef.current?.(opened); }, [opened]);
  useEffect(() => { if (disabled) setAnchor(null); }, [disabled]);
  useEffect(() => {
    if (!shortcutKey || disabled) return;
    const openFromShortcut = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.altKey || event.shiftKey
        || event.ctrlKey === event.metaKey || event.key.toLowerCase() !== shortcutKey.toLowerCase()) return;
      const button = trigger.current;
      if (!button?.getClientRects().length || hasVisibleKeyboardOverlay(panel.current)) return;
      event.preventDefault();
      if (anchor || event.repeat) return;
      open(button);
      requestAnimationFrame(() => {
        const option = panel.current?.querySelector<HTMLElement>('button[role="option"][aria-selected="true"]:not(:disabled)')
          ?? panel.current?.querySelector<HTMLElement>('button[role="option"]:not(:disabled)');
        (option ?? trigger.current)?.focus();
      });
    };
    document.addEventListener('keydown', openFromShortcut, true);
    return () => document.removeEventListener('keydown', openFromShortcut, true);
  }, [anchor, disabled, open, shortcutKey]);
  useEffect(() => {
    if (!anchor) return;
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setAnchor(null);
      trigger.current?.focus({ preventScroll: true });
    };
    // Capture before a containing dialog sees Escape; the picker closes first.
    document.addEventListener('keydown', escape, true);
    return () => document.removeEventListener('keydown', escape, true);
  }, [anchor]);
  const focusItem = (last: boolean) => {
    const items = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)');
    if (items?.length) items[last ? items.length - 1 : 0].focus();
  };
  const shortcut = disabled ? undefined : shortcutKey?.toUpperCase();
  const triggerProps = {
    ref: trigger, disabled, color, className: triggerClassName,
    'aria-label': label, 'aria-description': description,
    'aria-keyshortcuts': shortcut ? `Control+${shortcut} Meta+${shortcut}` : undefined,
    title: [label, description, shortcut && `Ctrl/Cmd+${shortcut}`].filter(Boolean).join(' · '),
    'aria-expanded': opened, 'aria-controls': anchor ? id : undefined,
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (anchor) focusItem(event.key === 'ArrowUp');
            else { open(event.currentTarget); requestAnimationFrame(() => focusItem(event.key === 'ArrowUp')); }
          }
    },
    onClick: (event: React.MouseEvent<HTMLButtonElement>) => { if (anchor) setAnchor(null); else open(event.currentTarget); },
  };
  return <ClickAwayListener mouseEvent="onPointerDown" touchEvent="onTouchStart" onClickAway={() => setAnchor(null)}>
    <div className={className}>
      {icon ? <IconButton {...triggerProps}>{summary}</IconButton>
        : <Button {...triggerProps} variant={color === 'warning' || color === 'error' ? 'contained' : 'text'} sx={{ maxWidth: '100%', gap: 0.5 }}>{summary}</Button>}
      <Popper keepMounted={keepMounted} open={Boolean(anchor)} anchorEl={anchorSelector ? anchor?.closest(anchorSelector) ?? anchor : anchor} placement={placement}
        container={() => trigger.current?.closest('.MuiDialog-container') ?? document.body}
        popperOptions={{ strategy: 'fixed' }}
        modifiers={[{ name: 'preventOverflow', options: { padding: 12 } }, { name: 'offset', options: { offset: [0, 6] } }]}
        sx={{ zIndex: (theme) => theme.zIndex.modal + 1 }}>
        <Paper ref={panel} id={id} className="desktop-picker-paper"
          sx={{ p: 1.5, width: anchorSelector && anchor ? Math.min(width, (anchor.closest(anchorSelector) as HTMLElement | null)?.clientWidth ?? width) : width, maxWidth: 'calc(100vw - 24px)', maxHeight: 'min(60dvh, 520px)', overflow: 'auto' }}
          onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
            if (!(event.target instanceof HTMLButtonElement) || !['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft'].includes(event.key)) return;
            const listbox = shortcut && event.target.matches('[role="option"]') ? event.target.closest('[role="listbox"]') : null;
            const group = listbox ?? event.target.closest('[role="radiogroup"]') ?? panel.current;
            const items = [...(group?.querySelectorAll<HTMLButtonElement>(listbox ? 'button[role="option"]:not(:disabled)' : 'button:not(:disabled)') ?? [])];
            if (!items.length) return;
            event.preventDefault();
            const index = items.indexOf(event.target);
            const direction = ['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : -1;
            items[(index + direction + items.length) % items.length].focus();
          }}>{children(close)}</Paper>
      </Popper>
    </div>
  </ClickAwayListener>;
}
