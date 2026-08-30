'use client';

import { useEffect, type ReactNode } from 'react';

import type { GitWorkingTree } from '@/shared/types';
import { RepositoryChangesView } from './RepositoryChangesView';
import { RepositoryDiffInspector } from './RepositoryDiffInspector';
import { RepositorySidebar } from './RepositorySidebar';
import { useRepositoryChanges } from './useRepositoryChanges';

/**
 * Repository-view composition point. A future file-tree view belongs here beside `changes`,
 * while the sidebar chrome and each view's data controller remain independent.
 */
export function RepositoryPanel({ checkoutId, repositoryName, manager, open, onClose, onTreeChange, onInspectorOpenChange }: {
  checkoutId?: string;
  repositoryName: string;
  manager?: ReactNode;
  open: boolean;
  onClose(): void;
  onTreeChange(tree?: GitWorkingTree): void;
  onInspectorOpenChange(open: boolean): void;
}) {
  const changes = useRepositoryChanges(checkoutId || '', onTreeChange);

  useEffect(() => {
    onInspectorOpenChange(Boolean(changes.selectedFile));
  }, [changes.selectedFile, onInspectorOpenChange]);

  return (
    <RepositorySidebar
      repositoryName={repositoryName}
      manager={manager}
      open={open}
      onClose={onClose}
      actions={<button className="repository-refresh-button" type="button" aria-label="Refresh Git status" title="Refresh Git status" disabled={changes.loading} onClick={changes.refresh}>↻</button>}
      inspector={checkoutId && changes.selectedFile ? (
        <RepositoryDiffInspector
          checkoutId={checkoutId}
          file={changes.selectedFile}
          revision={changes.revision}
          onClose={changes.closeInspector}
          onRetry={changes.refresh}
        />
      ) : undefined}
    >
      {checkoutId ? (
        <RepositoryChangesView
          tree={changes.tree}
          loading={changes.loading}
          error={changes.error}
          selectedPath={changes.selectedPath}
          onSelect={changes.selectPath}
          onRetry={changes.refresh}
        />
      ) : (
        <div className="repository-summary-scroll">
          <div className="repository-state">
            <span className="repository-state-mark">＋</span>
            <strong>No repository attached</strong>
            <p>Attach a repository above and make it primary before running an agent turn.</p>
          </div>
        </div>
      )}
    </RepositorySidebar>
  );
}
