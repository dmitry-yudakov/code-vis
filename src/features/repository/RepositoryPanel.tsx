'use client';

import IconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';

import { useEffect, useId, useState, type ReactNode } from 'react';

import { RepositoryChangesView, pushOffer } from './RepositoryChangesView';
import { RepositoryHistoryView } from './RepositoryHistoryView';
import { useRepositoryHistory } from './useRepositoryHistory';
import { ShellIcon } from '@/features/shell/ShellIcon';
import { RepositoryDiffInspector } from './RepositoryDiffInspector';
import { RepositorySidebar } from './RepositorySidebar';
import type { SideTab } from '@/features/shell/panelLayout';
import type { useRepositoryChanges } from './useRepositoryChanges';
import type { RepositoryDiffState } from './useRepositoryDiff';

/**
 * Repository-view composition point. A future file-tree view belongs here beside `changes`,
 * while the sidebar chrome and each view's data controller remain independent.
 */
export function RepositoryPanel({ checkoutId, repositoryName, manager, history, reports, changes, diffState, open, tab, onInspectorOpenChange, onPush, paneControl, apiBase = '/api' }: {
  checkoutId?: string;
  repositoryName: string;
  manager?: ReactNode;
  history: ReactNode;
  reports?: ReactNode;
  changes: ReturnType<typeof useRepositoryChanges>;
  diffState: RepositoryDiffState;
  open: boolean;
  tab: SideTab;
  paneControl?: ReactNode;
  apiBase?: string;
  onInspectorOpenChange(open: boolean): void;
  onPush?(): void;
}) {
  const [view, setView] = useState<'changes' | 'history'>('changes');
  const id = useId();
  const repositoryShown = tab === 'changes' || (tab === 'reports' && !reports);
  const gitHistory = useRepositoryHistory(checkoutId || '', open && repositoryShown && view === 'history', changes.revision, apiBase);
  const offer = changes.tree && onPush ? pushOffer(changes.tree) : undefined;
  const inspectorOpen = view === 'changes' && Boolean(changes.selectedFile);

  useEffect(() => {
    onInspectorOpenChange(inspectorOpen);
  }, [inspectorOpen, onInspectorOpenChange]);

  return (
    <RepositorySidebar
      repositoryName={repositoryName}
      manager={manager}
      history={history}
      reports={reports}
      open={open}
      tab={tab}
      paneControl={paneControl}
      actions={<IconButton className="repository-refresh-button" type="button" aria-label="Refresh Git status" title="Refresh repository" disabled={changes.loading || gitHistory.loading} onClick={changes.refresh}><ShellIcon name="refresh" /></IconButton>}
      inspectorVisible={inspectorOpen}
      inspector={checkoutId && changes.selectedFile ? (
        <RepositoryDiffInspector
          hidden={!inspectorOpen}
          key={`${checkoutId}:${changes.selectedFile.path}`}
          file={changes.selectedFile}
          state={diffState}
          onClose={changes.closeInspector}
          onRetry={changes.refresh}
        />
      ) : undefined}
    >
      {checkoutId ? (
        <div className="repository-git-view">
          {changes.tree?.isRepository && <div className="git-branch-summary" aria-label="Current branch">
            <ShellIcon name="changes" />
            <strong title={changes.tree.branch}>{changes.tree.branch || 'Unknown branch'}</strong>
            {(changes.tree.ahead || changes.tree.behind) ? <em aria-label={`${changes.tree.ahead || 0} commits ahead, ${changes.tree.behind || 0} behind`}>{changes.tree.ahead ? `↑${changes.tree.ahead}` : ''}{changes.tree.ahead && changes.tree.behind ? ' ' : ''}{changes.tree.behind ? `↓${changes.tree.behind}` : ''}</em> : null}
            {offer && <Button type="button" variant="outlined" title={offer.description} aria-label={offer.description} disabled={changes.pushing || changes.loading} onClick={onPush}>{changes.pushing ? `${offer.label}ing…` : offer.label}</Button>}
          </div>}
          <Tabs value={view} onChange={(_, value: 'changes' | 'history') => setView(value)} aria-label="Repository views" className="repository-view-tabs">
            <Tab value="changes" label={changes.tree?.files.length ? `Changes (${changes.tree.files.length})` : 'Changes'} id={`${id}-changes`} aria-controls={`${id}-panel`} />
            <Tab value="history" label="History" id={`${id}-history`} aria-controls={`${id}-panel`} />
          </Tabs>
          <div className="repository-tab-panel" role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${view}`} tabIndex={0}>
            {view === 'history' ? <RepositoryHistoryView {...gitHistory} onRetry={changes.refresh} /> : (
              <RepositoryChangesView
                tree={changes.tree}
                loading={changes.loading}
                error={changes.error}
                selectedPath={changes.selectedPath}
                onSelect={changes.selectPath}
                onRetry={changes.refresh}
              />
            )}
          </div>
        </div>
      ) : (
        <div className="repository-summary-scroll">
          <div className="repository-state">
            <span className="repository-state-mark">＋</span>
            <strong>No repository attached</strong>
            <p>Choose a repository above to get started.</p>
          </div>
        </div>
      )}
    </RepositorySidebar>
  );
}
