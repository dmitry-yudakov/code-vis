'use client';

import type { ReactNode } from 'react';

/**
 * Repository-level navigation chrome. Individual views own their data and actions; this shell
 * owns only the stable panel header, close behavior, and primary/inspector layout.
 */
export function RepositorySidebar({ repositoryName, open, actions, manager, inspector, children, onClose }: {
  repositoryName: string;
  open: boolean;
  actions?: ReactNode;
  manager?: ReactNode;
  inspector?: ReactNode;
  children: ReactNode;
  onClose(): void;
}) {
  if (!open) return null;

  return (
    <aside className={`repository-sidebar ${inspector ? 'has-inspector' : ''}`} aria-label="Repository">
      <section className="repository-summary-panel">
        <header className="repository-panel-header">
          <div><span className="eyebrow">Repository</span><strong>{repositoryName}</strong></div>
          <div className="repository-header-actions">
            {actions}
            <button type="button" aria-label="Close repository sidebar" onClick={onClose}>×</button>
          </div>
        </header>
        <div className="repository-panel-body">
          {manager}
          {children}
        </div>
      </section>
      {inspector}
    </aside>
  );
}
