'use client';

import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ListItemButton from '@mui/material/ListItemButton';
import type { GitCommitDetails } from '@/shared/types';
import { Patch } from './RepositoryDiffInspector';

/** A selected immutable commit; changing repository/hash unmounts and cancels all outstanding reads. */
export function RepositoryCommitDetails({ checkoutId, hash, apiBase }: { checkoutId: string; hash: string; apiBase: string }) {
  const [details, setDetails] = useState<GitCommitDetails>();
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);
  const [path, setPath] = useState<string>();
  const [patch, setPatch] = useState<{ path: string; source?: string; error?: string }>();
  const [patchRetry, setPatchRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError(undefined);
    void fetch(`${apiBase}/repository/commit?${new URLSearchParams({ checkoutId, hash })}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const data = await response.json() as { details?: GitCommitDetails; error?: string };
        if (!response.ok || !data.details) throw new Error(data.error || 'Could not load commit details.');
        if (!controller.signal.aborted) setDetails(data.details);
      }).catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not load commit details.'); });
    return () => controller.abort();
  }, [apiBase, checkoutId, hash, retry]);
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    setPatch(undefined);
    void fetch(`${apiBase}/repository/commit?${new URLSearchParams({ checkoutId, hash, path })}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const data = await response.json() as { patch?: string; error?: string };
        if (!response.ok || typeof data.patch !== 'string') throw new Error(data.error || 'Could not load commit patch.');
        if (!controller.signal.aborted) setPatch({ path, source: data.patch });
      }).catch((reason: unknown) => { if (!controller.signal.aborted) setPatch({ path, error: reason instanceof Error ? reason.message : 'Could not load commit patch.' }); });
    return () => controller.abort();
  }, [apiBase, checkoutId, hash, path, patchRetry]);
  return <Box role="region" aria-label={`Commit ${hash.slice(0, 8)} details`} sx={{ mt: 1, overflowWrap: 'anywhere' }}>
    {error ? <Alert severity="error" action={<Button onClick={() => setRetry(value => value + 1)}>Retry</Button>}>{error}</Alert>
      : !details ? <p role="status">Reading commit…</p> : <>
        <code>{details.hash}</code>
        <div className="repository-commit-meta"><span>{details.author} &lt;{details.email}&gt;</span><time dateTime={details.date}>{new Date(details.date).toLocaleString()}</time></div>
        <Box component="pre" sx={{ whiteSpace: 'pre-wrap', font: 'inherit', my: 1 }}>{details.message}</Box>
        {details.parents.length > 0 && <Box sx={{ color: 'text.secondary', fontSize: 11, mb: 1 }}>Parent{details.parents.length > 1 ? 's' : ''}: {details.parents.map(parent => <code key={parent} title={parent}>{parent.slice(0, 8)} </code>)}{details.parents.length > 1 && <span> · Changes from first parent</span>}</Box>}
        <strong>{details.files.length} changed {details.files.length === 1 ? 'file' : 'files'}</strong>
        {details.files.map(file => <ListItemButton key={file.path} component="button" selected={path === file.path} aria-pressed={path === file.path}
          onClick={() => setPath(file.path)} sx={{ width: '100%', gap: 1, minWidth: 0, fontSize: 12, textAlign: 'left' }}>
          <code>{file.status}</code><span>{file.path}{file.previousPath && <small> ← {file.previousPath}</small>}</span>
        </ListItemButton>)}
        {path && <Box className="wrap-lines" role="region" aria-label={`Commit changes in ${path}`} sx={{ maxHeight: 400, overflow: 'auto', mt: 1 }}>
          {patch?.path !== path ? <p role="status">Reading patch…</p> : patch.error ? <Alert severity="error" action={<Button onClick={() => setPatchRetry(value => value + 1)}>Retry</Button>}>{patch.error}</Alert> : <Patch source={patch.source} />}
        </Box>}
      </>}
  </Box>;
}
