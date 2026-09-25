'use client';

import type { ReactNode } from 'react';
import type { SideTab } from '@/features/shell/panelLayout';

const SIDE_PANEL_LABELS: Record<SideTab, string> = { changes: 'Repository', history: 'Canvas history', reports: 'CodeAI reports' };
const SIDE_PANEL_TITLES: Record<SideTab, string> = { changes: 'Changes', history: 'History', reports: 'Reports' };

/**
 * The side panel's chrome. Individual views own their data and actions; this shell owns only the
 * view's title and the primary/inspector layout. The activity bar picks the view and closes the
 * panel. The repository's changes, the session's canvas history, and — in CodeAI's own project —
 * its reports share it, so none competes with the conversation for the other dock.
 */
export function RepositorySidebar({ repositoryName, open, tab, actions, manager, inspector, history, reports, children }: {
  repositoryName: string;
  open: boolean;
  tab: SideTab;
  actions?: ReactNode;
  manager?: ReactNode;
  inspector?: ReactNode;
  history: ReactNode;
  /** Present only while the selected project is a self project. */
  reports?: ReactNode;
  children: ReactNode;
}) {
  if (!open) return null;
  // A remembered Reports tab falls back to Changes wherever reports are unavailable.
  const shown: SideTab = tab === 'reports' && !reports ? 'changes' : tab;
  const changes = shown === 'changes';

  return (
    <aside className={`repository-sidebar ${changes && inspector ? 'has-inspector' : ''}`} aria-label={SIDE_PANEL_LABELS[shown]}>
      <section className="repository-summary-panel">
        <header className="repository-panel-header">
          <h2 className="side-panel-title">{SIDE_PANEL_TITLES[shown]}</h2>
          {changes && actions && <div className="repository-header-actions">{actions}</div>}
        </header>
        {changes ? (
          <div className="repository-panel-body">
            <div>
              <strong className="repository-name">{repositoryName}</strong>
              {manager}
            </div>
            {children}
          </div>
        ) : shown === 'reports' ? reports : history}
      </section>
      {changes && inspector}
    </aside>
  );
}
