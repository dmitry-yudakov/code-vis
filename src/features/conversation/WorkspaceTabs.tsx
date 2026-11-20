'use client';

import Link from 'next/link';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import IconButton from '@mui/material/IconButton';
import TabScrollButton, { type TabScrollButtonProps } from '@mui/material/TabScrollButton';
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { RunState, SessionSnapshot } from '@/shared/types';

export interface WorkspaceRunState {
  state: Exclude<RunState, 'finished'>;
  status: string;
  queuePosition?: number;
  pendingApprovals: number;
}

function SessionTabScrollButton(props: TabScrollButtonProps) {
  return <TabScrollButton {...props} component="button" role="button" tabIndex={props.disabled ? -1 : 0} aria-disabled={props.disabled}
    aria-label={`Scroll session tabs ${props.direction}`} sx={{ width: 24, flexShrink: 0 }} />;
}

export function WorkspaceTabs({
  sessions,
  focusedSessionId,
  runsBySession,
  unreadBySession,
  onFocus,
  sessionHref,
  onClose,
  onArchive,
  closeDisabledReasons = {},
  archiveDisabledReasons = {},
}: {
  sessions: Pick<SessionSnapshot, 'id' | 'title'>[];
  focusedSessionId?: string;
  runsBySession: Record<string, WorkspaceRunState>;
  unreadBySession: Record<string, number>;
  onFocus(sessionId: string): void;
  sessionHref?(sessionId: string): string;
  onClose(sessionId: string): void;
  onArchive(sessionId: string): Promise<boolean>;
  closeDisabledReasons?: Record<string, string>;
  archiveDisabledReasons?: Record<string, string>;
}) {
  const tabRefs = useRef(new Map<string, HTMLDivElement>());
  const tablistRef = useRef<HTMLDivElement>(null);
  const archiveTriggers = useRef(new Set<HTMLElement>());
  const keepSelectionVisible = useRef(true);

  function revealSelected() {
    const scroller = tablistRef.current;
    const tab = focusedSessionId && tabRefs.current.get(focusedSessionId);
    if (!scroller || !tab) return;
    const bounds = scroller.getBoundingClientRect();
    const selected = tab.getBoundingClientRect();
    if (selected.left < bounds.left) scroller.scrollLeft += selected.left - bounds.left;
    else if (selected.right > bounds.right) scroller.scrollLeft += selected.right - bounds.right;
  }

  useLayoutEffect(() => { keepSelectionVisible.current = true; }, [focusedSessionId]);

  useLayoutEffect(() => {
    // Keep tab-owned focus when an archived tab disappears, before the new composer mounts.
    // A pending archive must not move focus from a control the user has chosen in the meantime.
    if (document.activeElement !== document.body || !focusedSessionId
      || ![...archiveTriggers.current].some(trigger => !trigger.isConnected)) return;
    tabRefs.current.get(focusedSessionId)?.focus();
  }, [focusedSessionId, sessions]);

  // Reveal selection when the viewport changes without changing the tab's own geometry.
  useEffect(() => {
    const scroller = tablistRef.current;
    if (!scroller) return;
    let width = scroller.clientWidth;
    const observer = new ResizeObserver(() => {
      const nextWidth = scroller.clientWidth;
      if (nextWidth === width) return;
      width = nextWidth;
      revealSelected();
    });
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [focusedSessionId]);

  function closeView(id: string) {
    if (runsBySession[id] || closeDisabledReasons[id]) return;
    onClose(id);
    requestAnimationFrame(() => {
      // Closing a device view keeps its active-session tab available for reopening.
      const selected = [...tabRefs.current.values()].find(tab => tab.getAttribute('aria-selected') === 'true');
      (selected || tabRefs.current.get(id))?.focus();
    });
  }

  async function archiveSession(id: string) {
    if (runsBySession[id] || closeDisabledReasons[id] || archiveDisabledReasons[id]) return;
    const trigger = document.activeElement as HTMLElement | null;
    if (trigger && tablistRef.current?.contains(trigger)) archiveTriggers.current.add(trigger);
    const archived = await onArchive(id);
    requestAnimationFrame(() => {
      if (trigger) archiveTriggers.current.delete(trigger);
      const focused = document.activeElement;
      // A delayed response must not take focus from a composer or another control.
      if (focused !== document.body && !tablistRef.current?.contains(focused)) return;
      if (!archived) {
        if (focused === document.body || focused === trigger) trigger?.focus();
        return;
      }
      // The user may have selected another session while the archive was pending.
      const selected = [...tabRefs.current.values()].find(tab => tab.getAttribute('aria-selected') === 'true');
      if (selected) selected.focus();
      else {
        document.querySelector<HTMLElement>('.session-archive-menu > button')?.focus();
      }
    });
  }

  if (!sessions.length) return null;

  return (
    <div className="workspace-tabs" style={{ maxWidth: sessions.length * 360 }}>
      <Tabs className="workspace-tablist" aria-label="Open session views" value={focusedSessionId ?? false}
        onWheel={() => { keepSelectionVisible.current = false; }}
        onTouchStart={() => { keepSelectionVisible.current = false; }}
        onClickCapture={event => { keepSelectionVisible.current = Boolean((event.target as Element).closest('[role="tab"]')); }}
        variant="scrollable" scrollButtons="auto" slots={{ scrollButtons: SessionTabScrollButton }} slotProps={{
          scroller: { ref: tablistRef, style: { containerType: 'inline-size' },
            // An earlier MUI scroll animation can finish after a newer selection. Keep the
            // selected tab visible until the user deliberately scrolls with arrows/wheel/touch.
            onScroll: () => { if (keepSelectionVisible.current) revealSelected(); },
          },
          list: { sx: { width: '100%' } },
        }}
        onChange={(_, id: string) => onFocus(id)}>
        {sessions.map((session, index) => {
          const selected = session.id === focusedSessionId;
          const run = runsBySession[session.id];
          const running = run?.state === 'running';
          const queued = run?.state === 'queued';
          const needsYou = run?.state === 'needs-you';
          const archiveReason = archiveDisabledReasons[session.id] || closeDisabledReasons[session.id]
            || (run ? 'Wait for this turn to finish.' : undefined);
          const unread = unreadBySession[session.id] || 0;
          return (
            <Tab component="div"
              sx={{ minWidth: 'min(120px, 100cqw)', maxWidth: 'min(360px, 100cqw)', flex: '1 1 360px', flexDirection: 'row' }}
              value={session.id}
              className={`workspace-tab ${selected ? 'active' : ''} ${running ? 'working' : ''} ${queued ? 'queued' : ''} ${needsYou ? 'awaiting-approval' : ''}`.trim()}
              key={session.id}
              ref={(node) => {
                if (node) tabRefs.current.set(session.id, node);
                else tabRefs.current.delete(session.id);
              }}
              aria-selected={selected}
              aria-controls="active-session-view"
              tabIndex={selected || (!focusedSessionId && index === 0) ? 0 : -1}
              aria-label={`${session.title}${run ? ` — ${run.status}` : ''}`}
              title={run ? `${session.title} — ${run.status}` : session.title}
              onKeyDown={(event) => {
                if (event.key === 'Delete') {
                  event.preventDefault();
                  closeView(session.id);
                  return;
                }
                const direction = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
                if (!direction) return;
                event.preventDefault();
                event.stopPropagation();
                const next = sessions[(index + direction + sessions.length) % sessions.length];
                onFocus(next.id);
                tabRefs.current.get(next.id)?.focus();
              }}
              label={<>
              {run && <span className="workspace-tab-state" aria-hidden="true" />}
              {sessionHref ? <Link className="workspace-tab-title" href={sessionHref(session.id)} prefetch={false} tabIndex={-1}
                style={{ color: 'inherit', textDecoration: 'none' }}
                onClick={(event) => {
                  event.stopPropagation();
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  onFocus(session.id);
                  tabRefs.current.get(session.id)?.focus();
                }} onAuxClick={event => event.stopPropagation()}>{session.title}</Link>
                : <span className="workspace-tab-title">{session.title}</span>}
              {queued && <span className="queue-badge">Q{run.queuePosition || 1}</span>}
              {needsYou && run.pendingApprovals > 0 && <span className="approval-badge">{run.pendingApprovals}</span>}
              {unread > 0 && <span className="unread-badge">{unread}</span>}
              <IconButton className="workspace-tab-close" size="small" color="inherit"
                aria-label={`Archive this session: ${session.title}`} title={archiveReason || 'Archive this session'}
                disabled={Boolean(archiveReason)} tabIndex={selected ? 0 : -1}
                sx={{ flex: 'none', width: 24, height: 24, ml: 'auto', p: 0 }}
                onClick={event => { event.stopPropagation(); void archiveSession(session.id); }}
                onKeyDown={event => event.stopPropagation()}
                onKeyUp={event => event.stopPropagation()}
              >×</IconButton>
              </>}
            />
          );
        })}
      </Tabs>
    </div>
  );
}
