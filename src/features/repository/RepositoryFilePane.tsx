'use client';

import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ShellIcon } from '@/features/shell/ShellIcon';
import { RepositoryFileViewer, useRepositoryFiles } from './RepositoryFilesProvider';
import { RepositoryDiffInspector } from './RepositoryDiffInspector';
import { useRepositoryDiff } from './useRepositoryDiff';
import type { FileTab } from './repositoryFileTabs';

function DiffTab({ tab, apiBase, revision }: { tab: Extract<FileTab, { kind: 'diff' }>; apiBase: string; revision: number }) {
  const [retry, setRetry] = useState(0);
  const files = useRepositoryFiles()!;
  const state = useRepositoryDiff(tab.checkoutId, tab.file.path, revision + retry + tab.navigation, apiBase);
  return <RepositoryDiffInspector file={tab.file} state={state} onClose={() => files.close(tab.id)}
    onRetry={() => setRetry(value => value + 1)} />;
}

/** One tabbed surface for repository source, Markdown and working-tree diffs. */
export function RepositoryFilePane({ paneControl, onHide, revision, visible }: {
  paneControl: ReactNode; onHide(): void; revision: number; visible: boolean;
}) {
  const files = useRepositoryFiles()!;
  const id = useId();
  const root = useRef<HTMLElement>(null);
  const navigation = files.tabs.find(tab => tab.id === files.activeId)?.navigation;
  useEffect(() => {
    if (visible) root.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus({ preventScroll: true });
  }, [files.activeId, navigation, visible]);
  const close = (tabId: number) => {
    files.close(tabId);
    // Closing a tab removes the focused close button. Keep the keyboard in the pane.
    requestAnimationFrame(() => {
      const selected = root.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
      (selected || root.current)?.focus();
    });
  };
  return <Paper ref={root} component="section" tabIndex={-1} elevation={0} className="repository-file-pane" aria-label="File view"
    onKeyDown={event => { if (event.key !== 'Escape') event.stopPropagation(); }}>
    <header className="repository-panel-header">
      <h2 className="side-panel-title">File view</h2>
      <div className="repository-header-actions">{paneControl}<IconButton aria-label="Hide file view" title="Hide file view" onClick={onHide}>×</IconButton></div>
    </header>
    {files.tabs.length ? <>
      <Tabs value={files.activeId ?? false} onChange={(_, value: number) => files.select(value)} variant="scrollable" scrollButtons="auto"
        aria-label="Open files" className="file-view-tabs">
        {files.tabs.map(tab => {
          const path = tab.resolved?.path || (tab.kind === 'file' ? tab.link.path : tab.file.path);
          const label = `${path.split('/').pop()}${tab.kind === 'diff' ? ' · Diff' : ''}`;
          const repository = files.repositories.find(item => item.id === (tab.resolved?.checkoutId || tab.checkoutId))?.name;
          return <Tab key={tab.id} component="div" aria-label={label} value={tab.id} id={`${id}-tab-${tab.id}`} aria-controls={`${id}-panel-${tab.id}`}
            title={`${repository ? `${repository} · ` : ''}${path}${tab.kind === 'diff' ? ' (diff)' : ''}`}
            onKeyDown={event => {
              if (event.key === 'Delete') { event.preventDefault(); close(tab.id); }
              if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); files.select(tab.id); }
            }}
            label={<span className="file-view-tab-label"><ShellIcon name={tab.kind === 'diff' ? 'changes' : 'file'} /><span>{label}</span>
              <IconButton component="span" role="button" tabIndex={-1} aria-label={`Close ${path}${tab.kind === 'diff' ? ' diff' : ''}`}
                onClick={event => { event.stopPropagation(); close(tab.id); }}>×</IconButton></span>} />;
        })}
      </Tabs>
      {files.tabs.map(tab => <div key={tab.id} id={`${id}-panel-${tab.id}`} role="tabpanel" aria-labelledby={`${id}-tab-${tab.id}`}
        hidden={files.activeId !== tab.id} className="file-view-content">
        {tab.kind === 'file' ? <RepositoryFileViewer link={tab.link} checkoutId={tab.checkoutId} repositories={files.repositories}
          apiBase={files.apiBase} active={visible && files.activeId === tab.id} navigation={tab.navigation}
          onResolved={(checkoutId, path) => files.resolved(tab.id, checkoutId, path)} />
          : <DiffTab tab={tab} apiBase={files.apiBase} revision={revision} />}
      </div>)}
    </> : <div className="repository-state"><ShellIcon name="files" /><strong>No open files</strong><p>Open a file from Files, Changes or a conversation link.</p></div>}
  </Paper>;
}
