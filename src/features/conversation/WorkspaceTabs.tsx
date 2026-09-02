'use client';

import { useRef } from 'react';
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
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const openSessions = openSessionIds.flatMap((id) => {
    const session = sessionById.get(id);
    return session ? [session] : [];
  });

  if (!openSessions.length) return <div className="workspace-tabs workspace-tabs-empty" aria-hidden="true" />;

  const focusedSession = openSessions.find((session) => session.id === focusedSessionId);
  const focusedLive = Boolean(focusedSession && runsBySession[focusedSession.id]);

  return (
    <div className="workspace-tabs">
      <div className="workspace-tablist" role="tablist" aria-label="Open session views">
        {openSessions.map((session, index) => {
          const selected = session.id === focusedSessionId;
          const run = runsBySession[session.id];
          const running = run?.state === 'running';
          const queued = run?.state === 'queued';
          const needsYou = run?.state === 'needs-you';
          const unread = unreadBySession[session.id] || 0;
          return (
            <button
              type="button"
              role="tab"
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
              onClick={() => onFocus(session.id)}
              onKeyDown={(event) => {
                if (event.key === 'Delete' && !run) {
                  event.preventDefault();
                  const next = openSessions[index === openSessions.length - 1 ? index - 1 : index + 1];
                  onClose(session.id);
                  if (next) requestAnimationFrame(() => tabRefs.current.get(next.id)?.focus());
                  return;
                }
                const direction = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
                if (!direction) return;
                event.preventDefault();
                const next = openSessions[(index + direction + openSessions.length) % openSessions.length];
                onFocus(next.id);
                tabRefs.current.get(next.id)?.focus();
              }}
            >
              <span className="workspace-tab-state" aria-hidden="true" />
              <span>{session.title}</span>
              {queued && <span className="queue-badge">Q{run.queuePosition || 1}</span>}
              {needsYou && run.pendingApprovals > 0 && <span className="approval-badge">{run.pendingApprovals}</span>}
              {unread > 0 && <span className="unread-badge">{unread}</span>}
            </button>
          );
        })}
      </div>
      {focusedSession && (
        <button
          type="button"
          className="workspace-tab-close"
          disabled={focusedLive}
          aria-label={focusedLive
            ? `Cannot close ${focusedSession.title} while its turn is active`
            : `Close ${focusedSession.title} view`}
          title={focusedLive ? 'This view stays open until its turn finishes' : 'Close focused view'}
          onClick={() => onClose(focusedSession.id)}
        >×</button>
      )}
    </div>
  );
}
