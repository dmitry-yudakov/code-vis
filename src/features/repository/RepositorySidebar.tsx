'use client';

import type { ReactNode } from 'react';
import type { SideTab } from '@/features/shell/panelLayout';

const SIDE_PANEL_LABELS: Record<SideTab, string> = { changes: 'Repository', history: 'Canvas history', reports: 'CodeAI reports' };

/**
 * The side panel's chrome. Individual views own their data and actions; this shell owns only the
 * tabs, close behavior, and primary/inspector layout. The repository's changes, the session's
 * canvas history, and — in CodeAI's own project — its reports share it, so none competes with the
 * conversation for the other dock.
 */
export function RepositorySidebar({ repositoryName, open, tab, actions, manager, inspector, history, reports, children, onTab, onClose }: {
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
  onTab(tab: SideTab): void;
  onClose(): void;
}) {
  if (!open) return null;
  // A remembered Reports tab falls back to Changes wherever reports are unavailable.
  const shown: SideTab = tab === 'reports' && !reports ? 'changes' : tab;
  const changes = shown === 'changes';

  return (
    <aside className={`repository-sidebar ${changes && inspector ? 'has-inspector' : ''}`} aria-label={SIDE_PANEL_LABELS[shown]}>
      <section className="repository-summary-panel">
        <header className="repository-panel-header">
          <div className="side-panel-tabs" role="group" aria-label="Side panel">
            <button type="button" aria-pressed={changes} onClick={() => onTab('changes')}>Changes</button>
            <button type="button" aria-pressed={shown === 'history'} onClick={() => onTab('history')}>History</button>
            {reports && <button type="button" aria-pressed={shown === 'reports'} onClick={() => onTab('reports')}>Reports</button>}
          </div>
          <div className="repository-header-actions">
            {changes && actions}
            <button type="button" aria-label="Close side panel" onClick={onClose}>×</button>
          </div>
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
