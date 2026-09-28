'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { toastLifetime, type Toast, type ToastTone } from './toasts';

/** How long a leaving toast takes to close its row; matches the `.toast-slot` transition. */
const LEAVE_MS = 200;

const GLYPHS: Record<ToastTone, ReactNode> = {
  success: <path d="m6 12.5 4 4 8-9" />,
  warning: <path d="M12 6.5v7M12 17.5v.01" />,
  error: <path d="m7.5 7.5 9 9M16.5 7.5l-9 9" />,
  info: <path d="M12 11v6.5M12 6.5v.01" />,
};

/**
 * Oldest first in `toasts`, newest on top on screen. A toast times out after its lifetime unless
 * the pointer or focus is on the stack or the page is hidden, and closes its row before it goes.
 * `onRemove` takes a raised toast out of the list; a dismissed toast's own `onDismiss` runs first.
 */
export function ToastStack({ toasts, onRemove, className }: {
  toasts: readonly Toast[];
  onRemove(key: string): void;
  className?: string;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pageHidden, setPageHidden] = useState(false);
  const regionRef = useRef<HTMLElement>(null);
  const removeRef = useRef(onRemove);
  removeRef.current = onRemove;
  const remove = useCallback((toast: Toast, dismissed: boolean) => {
    if (dismissed) toast.onDismiss?.();
    removeRef.current(toast.key);
  }, []);

  useEffect(() => {
    const sync = () => setPageHidden(document.hidden);
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);
  // Hover is read from every pointer move while toasts show: a toast replaced under a resting pointer
  // sends no pointerleave, which would keep the stack paused after the pointer moved away. A tap is
  // not rest.
  const shown = toasts.length > 0;
  useEffect(() => {
    if (!shown) return;
    const track = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') setHovered(Boolean(regionRef.current?.contains(event.target as Node)));
    };
    document.addEventListener('pointermove', track, { passive: true });
    return () => document.removeEventListener('pointermove', track);
  }, [shown]);
  // Not every browser fires blur when a focused button is removed, and the stack unmounts under the
  // pointer when its last toast goes.
  useEffect(() => {
    setFocused(Boolean(regionRef.current?.contains(document.activeElement)));
    if (!toasts.length) setHovered(false);
  }, [toasts]);

  if (!toasts.length) return null;
  const paused = hovered || focused || pageHidden;
  return (
    <section
      ref={regionRef}
      className={className ? `toast-region ${className}` : 'toast-region'}
      aria-label="Notifications"
      onFocus={() => setFocused(true)}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}
    >
      {/* Each raise is its own card, so a raise that replaces a leaving toast cancels its removal. */}
      {[...toasts].reverse().map((toast) => (
        <ToastCard key={`${toast.serial}:${toast.key}`} toast={toast} paused={paused} onRemove={remove} />
      ))}
    </section>
  );
}

function ToastCard({ toast, paused, onRemove }: {
  toast: Toast;
  paused: boolean;
  onRemove(toast: Toast, dismissed: boolean): void;
}) {
  // Why it leaves: dismissed (× or its countdown) or an action chosen; while leaving it is inert.
  const [leaving, setLeaving] = useState<'dismissed' | 'chosen'>();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  // What is left of the lifetime; it runs down only while the stack is not paused.
  const remaining = useRef(toastLifetime(toast));
  useEffect(() => {
    if (paused || leaving || remaining.current === undefined) return;
    const started = Date.now();
    const timer = window.setTimeout(() => setLeaving('dismissed'), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current! -= Date.now() - started;
    };
  }, [leaving, paused]);
  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(() => onRemove(toastRef.current, leaving === 'dismissed'), LEAVE_MS);
    return () => window.clearTimeout(timer);
  }, [leaving, onRemove]);

  return (
    <div className={leaving ? 'toast-slot leaving' : 'toast-slot'} inert={Boolean(leaving)}><div className="toast-clip">
      <div
        className="toast"
        data-tone={toast.tone}
        role={toast.tone === 'error' ? 'alert' : 'status'}
        onKeyDown={(event) => { if (event.key === 'Escape') setLeaving('dismissed'); }}
      >
        <span className="toast-glyph" aria-hidden="true"><svg viewBox="0 0 24 24">{GLYPHS[toast.tone]}</svg></span>
        <div className="toast-body">
          <p>
            {toast.message}
            {toast.count > 1 && (
              <span className="toast-count"><span aria-hidden="true">{`×${toast.count}`}</span><span className="sr-only">{` (${toast.count} times)`}</span></span>
            )}
          </p>
          {Boolean(toast.actions?.length) && (
            <div className="toast-actions">
              {toast.actions!.map((action) => (
                <button key={action.label} type="button" disabled={action.disabled} onClick={() => {
                  action.onSelect();
                  // A persistent toast follows its state: Continue clears a run outcome only once it
                  // sends, and Refresh approval status clears only once the status is confirmed.
                  if (!toast.persistent) setLeaving('chosen');
                }}>{action.label}</button>
              ))}
            </div>
          )}
        </div>
        <button type="button" className="toast-dismiss" aria-label="Dismiss notification" onClick={() => setLeaving('dismissed')}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 7 7 17M7 7l10 10" /></svg>
        </button>
      </div>
    </div></div>
  );
}
