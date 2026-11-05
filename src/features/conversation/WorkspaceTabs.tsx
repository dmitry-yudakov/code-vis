'use client';

import Link from 'next/link';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import IconButton from '@mui/material/IconButton';
import { useEffect, useRef } from 'react';
import type { RunState, SessionSnapshot } from '@/shared/types';

export interface WorkspaceRunState {
  state: Exclude<RunState, 'finished'>;
  status: string;
  queuePosition?: number;
  pendingApprovals: number;
}

export function WorkspaceTabs({
  sessions,
  openSessionIds,
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
  sessions: SessionSnapshot[];
  openSessionIds: string[];
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
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const openSessions = openSessionIds.flatMap((id) => {
    const session = sessionById.get(id);
    return session ? [session] : [];
  });

  // MUI owns selection scrolling. Its scrollButtons=false mode needs help only when the
  // clipping viewport changes size without changing the selected tab's own geometry.
  useEffect(() => {
    const scroller = tablistRef.current;
    if (!scroller) return;
    let width = scroller.clientWidth;
    const observer = new ResizeObserver(() => {
      const nextWidth = scroller.clientWidth;
      if (nextWidth === width) return;
      width = nextWidth;
      const tab = focusedSessionId && tabRefs.current.get(focusedSessionId);
      if (!tab) return;
      const bounds = scroller.getBoundingClientRect();
      const selected = tab.getBoundingClientRect();
      if (selected.left < bounds.left) scroller.scrollLeft += selected.left - bounds.left;
      else if (selected.right > bounds.right) scroller.scrollLeft += selected.right - bounds.right;
    });
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [focusedSessionId]);

  function closeView(id: string) {
    if (runsBySession[id] || closeDisabledReasons[id]) return;
    const index = openSessions.findIndex((session) => session.id === id);
    const next = id === focusedSessionId
      ? openSessions[index === openSessions.length - 1 ? index - 1 : index + 1]
      : openSessions.find(session => session.id === focusedSessionId);
    onClose(id);
    requestAnimationFrame(() => {
      if (next) tabRefs.current.get(next.id)?.focus();
      else document.getElementById('all-sessions')?.focus();
    });
  }

  async function archiveSession(id: string) {
    if (runsBySession[id] || closeDisabledReasons[id] || archiveDisabledReasons[id]) return;
    const trigger = document.activeElement as HTMLElement | null;
    const archived = await onArchive(id);
    requestAnimationFrame(() => {
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
        const picker = document.getElementById('all-sessions') as HTMLSelectElement | null;
        if (picker && !picker.disabled) picker.focus();
        else document.querySelector<HTMLElement>('.new-session-menu > button')?.focus();
      }
    });
  }

  if (!openSessions.length) return null;

  return (
    <div className="workspace-tabs" style={{ maxWidth: openSessions.length * 180 }}>
      <Tabs className="workspace-tablist" aria-label="Open session views" value={focusedSessionId ?? false}
        variant="scrollable" scrollButtons={false} slotProps={{ scroller: { ref: tablistRef, style: { containerType: 'inline-size' } } }}
        onChange={(_, id: string) => onFocus(id)}>
        {openSessions.map((session, index) => {
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
              sx={{ width: 180, maxWidth: 'min(180px, 100cqw)', flex: '0 0 180px', flexDirection: 'row' }}
              value={session.id}
              className={`workspace-tab ${selected ? 'active' : ''} ${running ? 'working' : ''} ${queued ? 'queued' : ''} ${needsYou ? 'awaiting-approval' : ''}`.trim()}
              key={session.id}
              ref={(node) => {
                if (node) tabRefs.current.set(session.id, node);
                else tabRefs.current.delete(session.id);
              }}
              aria-selected={selected}
              aria-controls="active-session-view"
              tabIndex={selected ? 0 : -1}
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
                const next = openSessions[(index + direction + openSessions.length) % openSessions.length];
                onFocus(next.id);
                tabRefs.current.get(next.id)?.focus();
              }}
              label={<>
              <span className="workspace-tab-state" aria-hidden="true" />
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
