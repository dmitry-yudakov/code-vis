'use client';

import { useEffect } from 'react';

import type { GitWorkingTree } from '@/shared/types';
import { RepositoryChangesView } from './RepositoryChangesView';
import { RepositoryDiffInspector } from './RepositoryDiffInspector';
import { RepositorySidebar } from './RepositorySidebar';
import { useRepositoryChanges } from './useRepositoryChanges';

/**
 * Repository-view composition point. A future file-tree view belongs here beside `changes`,
 * while the sidebar chrome and each view's data controller remain independent.
 */
export function RepositoryPanel({ projectId, projectName, open, onClose, onTreeChange, onInspectorOpenChange }: {
  projectId: string;
  projectName: string;
  open: boolean;
  onClose(): void;
  onTreeChange(tree?: GitWorkingTree): void;
  onInspectorOpenChange(open: boolean): void;
}) {
  const changes = useRepositoryChanges(projectId, onTreeChange);

  useEffect(() => {
    onInspectorOpenChange(Boolean(changes.selectedFile));
  }, [changes.selectedFile, onInspectorOpenChange]);

  return (
    <RepositorySidebar
      projectName={projectName}
      open={open}
      onClose={onClose}
      actions={<button className="repository-refresh-button" type="button" aria-label="Refresh Git status" title="Refresh Git status" disabled={changes.loading} onClick={changes.refresh}>↻</button>}
      inspector={changes.selectedFile ? (
        <RepositoryDiffInspector
          projectId={projectId}
          file={changes.selectedFile}
          revision={changes.revision}
          onClose={changes.closeInspector}
          onRetry={changes.refresh}
        />
      ) : undefined}
    >
      <RepositoryChangesView
        tree={changes.tree}
        loading={changes.loading}
        error={changes.error}
        selectedPath={changes.selectedPath}
        onSelect={changes.selectPath}
        onRetry={changes.refresh}
      />
    </RepositorySidebar>
  );
}
