'use client';

import { useEffect, useId, useState } from 'react';
import Button from '@mui/material/Button';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import type { RepositoryDirectory } from '@/shared/repositoryFiles';
import { ShellIcon } from '@/features/shell/ShellIcon';
import { useOpenRepositoryFile } from './RepositoryFilesProvider';

interface DirectoryProps {
  checkoutId: string;
  apiBase: string;
  active: boolean;
  revision: number;
  path: string;
  expanded: ReadonlySet<string>;
  onToggle(path: string): void;
}

/** A disclosed directory reads only its own children; closing it aborts pending reads. */
function Directory({ checkoutId, apiBase, active, revision, path, expanded, onToggle }: DirectoryProps) {
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ directory?: RepositoryDirectory; error?: string }>();
  const openFile = useOpenRepositoryFile();
  const id = useId();
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ checkoutId, path });
    void fetch(`${apiBase}/repository/files?${query}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const data = await response.json() as { directory?: RepositoryDirectory; error?: string };
        if (!response.ok || !data.directory) throw new Error(data.error || 'Could not load this folder.');
        if (!controller.signal.aborted) setResult({ directory: data.directory });
      }).catch((reason: unknown) => {
        if (!controller.signal.aborted) setResult({ error: reason instanceof Error ? reason.message : 'Could not load this folder.' });
      });
    return () => controller.abort();
  }, [apiBase, checkoutId, path, active, retry, revision]);

  if (!result || result.error || !result.directory?.entries.length) return <ListItem className="repository-tree-feedback">
    {!result ? <span role="status">Reading folder…</span>
      : result.error ? <div role="alert"><span>{result.error}</span><Button size="small" onClick={() => setRetry(value => value + 1)}>Try again</Button></div>
      : <span>This folder is empty.</span>}
  </ListItem>;

  return result.directory.entries.map(entry => {
    const target = path ? `${path}/${entry.name}` : entry.name;
    const folder = entry.kind === 'directory';
    const isExpanded = folder && expanded.has(target);
    const groupId = `${id}-${encodeURIComponent(entry.name)}`;
    return <ListItem key={entry.name} disablePadding sx={{ display: 'block' }}>
      <ListItemButton component="button" className="repository-tree-entry" disabled={!folder && !openFile}
        aria-expanded={folder ? isExpanded : undefined} aria-controls={folder && isExpanded ? groupId : undefined}
        onClick={() => folder ? onToggle(target) : openFile?.({ path: target }, checkoutId)}>
        <span className={`repository-tree-chevron${isExpanded ? ' expanded' : ''}`}>{folder && <ShellIcon name="chevronRight" />}</span>
        <ShellIcon name={folder ? 'folder' : 'file'} />
        <ListItemText primary={entry.name} slotProps={{ primary: { noWrap: true, title: target } }} />
      </ListItemButton>
      {isExpanded && <List dense disablePadding id={groupId} aria-label={`${target} files`} sx={{ pl: 1.5 }}>
        <Directory checkoutId={checkoutId} apiBase={apiBase} active={active} revision={revision}
          path={target} expanded={expanded} onToggle={onToggle} />
      </List>}
    </ListItem>;
  });
}

/** Expansion stays with this checkout and survives refreshes and side-view changes. */
export function RepositoryFilesView({ checkoutId, apiBase, revision, active }: {
  checkoutId: string; apiBase: string; revision: number; active: boolean;
}) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (path: string) => setExpanded(current => {
    const next = new Set(current);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    return next;
  });
  return <div className="repository-summary-scroll">
    <List dense disablePadding aria-label="Repository files">
      <Directory checkoutId={checkoutId} apiBase={apiBase} revision={revision} active={active}
        path="" expanded={expanded} onToggle={toggle} />
    </List>
  </div>;
}
