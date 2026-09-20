'use client';

import type { ReactNode } from 'react';
import type { SideTab } from '@/features/shell/panelLayout';

/**
 * The side panel's chrome. Individual views own their data and actions; this shell owns only the
 * tabs, close behavior, and primary/inspector layout. The repository's changes and the session's
 * canvas history share it, so neither competes with the conversation for the other dock.
 */
export function RepositorySidebar({ repositoryName, open, tab, actions, manager, inspector, history, children, onTab, onClose }: {
  repositoryName: string;
  open: boolean;
  tab: SideTab;
  actions?: ReactNode;
  manager?: ReactNode;
  inspector?: ReactNode;
  history: ReactNode;
  children: ReactNode;
  onTab(tab: SideTab): void;
  onClose(): void;
}) {
  if (!open) return null;
  const changes = tab === 'changes';

  return (
    <aside className={`repository-sidebar ${changes && inspector ? 'has-inspector' : ''}`} aria-label={changes ? 'Repository' : 'Canvas history'}>
      <section className="repository-summary-panel">
        <header className="repository-panel-header">
          <div className="side-panel-tabs" role="group" aria-label="Side panel">
            <button type="button" aria-pressed={changes} onClick={() => onTab('changes')}>Changes</button>
            <button type="button" aria-pressed={!changes} onClick={() => onTab('history')}>History</button>
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
        ) : history}
      </section>
      {changes && inspector}
    </aside>
  );
}
