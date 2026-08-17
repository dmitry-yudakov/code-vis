'use client';

import type { ReactNode } from 'react';

/**
 * Repository-level navigation chrome. Individual views own their data and actions; this shell
 * owns only the stable panel header, close behavior, and primary/inspector layout.
 */
export function RepositorySidebar({ projectName, open, actions, inspector, children, onClose }: {
  projectName: string;
  open: boolean;
  actions?: ReactNode;
  inspector?: ReactNode;
  children: ReactNode;
  onClose(): void;
}) {
  if (!open) return null;

  return (
    <aside className={`repository-sidebar ${inspector ? 'has-inspector' : ''}`} aria-label="Repository">
      <section className="repository-summary-panel">
        <header className="repository-panel-header">
          <div><span className="eyebrow">Repository</span><strong>{projectName}</strong></div>
          <div className="repository-header-actions">
            {actions}
            <button type="button" aria-label="Close repository sidebar" onClick={onClose}>×</button>
          </div>
        </header>
        {children}
      </section>
      {inspector}
    </aside>
  );
}
