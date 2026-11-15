'use client';

import Paper from '@mui/material/Paper';
import type { ReactNode } from 'react';
import type { SideTab } from '@/features/shell/panelLayout';

const SIDE_PANEL_LABELS: Record<SideTab, string> = { files: 'Files', changes: 'Repository', history: 'Canvas history', reports: 'CodeAI reports' };
const SIDE_PANEL_TITLES: Record<SideTab, string> = { files: 'Files', changes: 'Repository', history: 'History', reports: 'Reports' };

/**
 * The side panel's chrome. Individual views own their data and actions; this shell owns only the
 * view's title and layout. The activity bar picks the view and closes the
 * panel. Files, the repository's changes, the session's canvas history, and — in CodeAI's own project —
 * its reports share it, so none competes with the conversation for the other dock.
 */
export function RepositorySidebar({ repositoryName, open, tab, actions, manager, files, history, reports, children, paneControl }: {
  repositoryName: string;
  open: boolean;
  tab: SideTab;
  actions?: ReactNode;
  paneControl?: ReactNode;
  manager?: ReactNode;
  files?: ReactNode;
  history: ReactNode;
  /** Present only while the selected project is a self project. */
  reports?: ReactNode;
  children: ReactNode;
}) {
  if (!open) return null;
  // A remembered Reports tab falls back to Changes wherever reports are unavailable.
  const shown: SideTab = tab === 'reports' && !reports ? 'changes' : tab;
  const changes = shown === 'changes';
  const repository = changes || shown === 'files';

  return (
    <Paper component="aside" square variant="elevation" elevation={0} className="repository-sidebar" aria-label={SIDE_PANEL_LABELS[shown]}>
      <section className="repository-summary-panel">
        <header className="repository-panel-header">
          <h2 className="side-panel-title">{SIDE_PANEL_TITLES[shown]}</h2>
          <div className="repository-header-actions">{repository && actions}{paneControl}</div>
        </header>
        <div className="repository-panel-body" hidden={!repository}>
          {manager || <strong className="repository-name">{repositoryName}</strong>}
          <div className="repository-view-content" hidden={!changes}>{children}</div>
          <div className="repository-view-content" hidden={shown !== 'files'}>{files}</div>
        </div>
        {shown === 'reports' ? reports : shown === 'history' ? history : null}
      </section>
    </Paper>
  );
}
