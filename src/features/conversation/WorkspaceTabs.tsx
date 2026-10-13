'use client';

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
  onClose,
}: {
  sessions: SessionSnapshot[];
  openSessionIds: string[];
  focusedSessionId?: string;
  runsBySession: Record<string, WorkspaceRunState>;
  unreadBySession: Record<string, number>;
  onFocus(sessionId: string): void;
  onClose(sessionId: string): void;
}) {
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const tablistRef = useRef<HTMLDivElement>(null);
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const openSessions = openSessionIds.flatMap((id) => {
    const session = sessionById.get(id);
    return session ? [session] : [];
  });

  const focusedSession = openSessions.find((session) => session.id === focusedSessionId);
  const focusedLive = Boolean(focusedSession && runsBySession[focusedSession.id]);


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
    if (runsBySession[id]) return;
    const index = openSessions.findIndex((session) => session.id === id);
    const next = openSessions[index === openSessions.length - 1 ? index - 1 : index + 1];
    onClose(id);
    requestAnimationFrame(() => {
      if (next) tabRefs.current.get(next.id)?.focus();
      else document.getElementById('all-sessions')?.focus();
    });
  }

  if (!openSessions.length) return null;

  return (
    <div className="workspace-tabs" style={{ maxWidth: openSessions.length * 180 + 34 }}>
      <Tabs className="workspace-tablist" aria-label="Open session views" value={focusedSessionId ?? false}
        variant="scrollable" scrollButtons={false} slotProps={{ scroller: { ref: tablistRef, style: { containerType: 'inline-size' } } }}
        onChange={(_, id: string) => onFocus(id)}>
        {openSessions.map((session, index) => {
          const selected = session.id === focusedSessionId;
          const run = runsBySession[session.id];
          const running = run?.state === 'running';
          const queued = run?.state === 'queued';
          const needsYou = run?.state === 'needs-you';
          const unread = unreadBySession[session.id] || 0;
          return (
            <Tab component="button"
              sx={{ width: 180, maxWidth: 'min(180px, 100cqw)', flex: '0 0 180px', flexDirection: 'row' }}
              value={session.id}
              type="button"
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
                if (event.key === 'Delete' && !run) {
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
              <span>{session.title}</span>
              {queued && <span className="queue-badge">Q{run.queuePosition || 1}</span>}
              {needsYou && run.pendingApprovals > 0 && <span className="approval-badge">{run.pendingApprovals}</span>}
              {unread > 0 && <span className="unread-badge">{unread}</span>}
              </>}
            />
          );
        })}
      </Tabs>
      {focusedSession && (
        <IconButton
          type="button"
          className="workspace-tab-close"
          disabled={focusedLive}
          aria-label={focusedLive
            ? `Cannot close ${focusedSession.title} while its turn is active`
            : `Close ${focusedSession.title} view`}
          title={focusedLive ? 'This view stays open until its turn finishes' : 'Close focused view'}
          onClick={() => closeView(focusedSession.id)}
        >×</IconButton>
      )}
    </div>
  );
}
