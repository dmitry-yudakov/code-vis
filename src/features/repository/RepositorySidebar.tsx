'use client';

import Paper from '@mui/material/Paper';
import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { SideTab } from '@/features/shell/panelLayout';

const SIDE_PANEL_LABELS: Record<SideTab, string> = { changes: 'Repository', history: 'Canvas history', reports: 'CodeAI reports' };
const SIDE_PANEL_TITLES: Record<SideTab, string> = { changes: 'Repository', history: 'History', reports: 'Reports' };

/**
 * The side panel's chrome. Individual views own their data and actions; this shell owns only the
 * view's title and the primary/inspector layout. The activity bar picks the view and closes the
 * panel. The repository's changes, the session's canvas history, and — in CodeAI's own project —
 * its reports share it, so none competes with the conversation for the other dock.
 */
export function RepositorySidebar({ repositoryName, open, tab, actions, manager, inspector, inspectorVisible = true, history, reports, children, paneControl }: {
  repositoryName: string;
  open: boolean;
  tab: SideTab;
  actions?: ReactNode;
  paneControl?: ReactNode;
  manager?: ReactNode;
  inspector?: ReactNode;
  inspectorVisible?: boolean;
  history: ReactNode;
  /** Present only while the selected project is a self project. */
  reports?: ReactNode;
  children: ReactNode;
}) {
  const sidebar = useRef<HTMLElement>(null);
  const summary = useRef<HTMLElement>(null);
  const [summaryPercent, setSummaryPercent] = useState<number>();
  const [resizing, setResizing] = useState(false);
  const resize = (width: number) => {
    const total = sidebar.current?.clientWidth ?? 0;
    if (total) setSummaryPercent(Math.max(180, Math.min(total - 220, width)) / total * 100);
  };
  if (!open) return null;
  // A remembered Reports tab falls back to Changes wherever reports are unavailable.
  const shown: SideTab = tab === 'reports' && !reports ? 'changes' : tab;
  const changes = shown === 'changes';

  return (
    <Paper ref={sidebar} component="aside" square variant="elevation" elevation={0} className={`repository-sidebar ${changes && inspector && inspectorVisible ? 'has-inspector' : ''} ${resizing ? 'panel-resizing' : ''}`} aria-label={SIDE_PANEL_LABELS[shown]}
      style={summaryPercent === undefined ? undefined : { '--repository-summary-width': `${summaryPercent}%` } as CSSProperties}>
      <section ref={summary} className="repository-summary-panel">
        <header className="repository-panel-header">
          <h2 className="side-panel-title">{SIDE_PANEL_TITLES[shown]}</h2>
          <div className="repository-header-actions">{changes && actions}{paneControl}</div>
        </header>
        {changes ? (
          <div className="repository-panel-body">
            {manager || <strong className="repository-name">{repositoryName}</strong>}
            {children}
          </div>
        ) : shown === 'reports' ? reports : history}
      </section>
      {changes && inspector && inspectorVisible && <div className="panel-resize-handle repository-inspector-resize" role="separator" tabIndex={0}
        aria-label="Resize file review" aria-orientation="vertical" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(summaryPercent ?? 50)}
        onPointerDown={event => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          setResizing(true);
        }}
        onPointerMove={event => { if (resizing) resize(event.clientX - sidebar.current!.getBoundingClientRect().left); }}
        onPointerUp={event => { event.currentTarget.releasePointerCapture(event.pointerId); setResizing(false); }}
        onLostPointerCapture={() => setResizing(false)}
        onKeyDown={event => {
          const width = summary.current?.getBoundingClientRect().width ?? 0;
          const step = event.shiftKey ? 24 : 8;
          const next = event.key === 'ArrowLeft' ? width - step : event.key === 'ArrowRight' ? width + step
            : event.key === 'Home' ? 180 : event.key === 'End' ? sidebar.current!.clientWidth - 220 : undefined;
          if (next === undefined) return;
          event.preventDefault();
          event.stopPropagation();
          resize(next);
        }} />}
      {changes && inspector}
    </Paper>
  );
}
