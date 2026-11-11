'use client';

import { useEffect, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import LinearProgress from '@mui/material/LinearProgress';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import TextField from '@mui/material/TextField';
import type { GitBranches } from '@/shared/types';

/** Mounted per machine/checkout so late responses cannot affect a different repository. */
export function RepositoryBranchPicker({ checkoutId, repositoryName, branch, disabled, onRefresh, onBusyChange }: {
  checkoutId: string; repositoryName: string; branch?: string; disabled: boolean;
  onRefresh(): void; onBusyChange(busy: boolean): void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [data, setData] = useState<GitBranches>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [readError, setReadError] = useState<string>();
  const [revision, setRevision] = useState(0);
  const [switching, setSwitching] = useState<string>();
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; onBusyChange(false); };
  }, [onBusyChange]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true); setReadError(undefined); setData(undefined);
    void fetch(`/api/repository/branches?${new URLSearchParams({ checkoutId })}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const result = await response.json() as { branches?: GitBranches; error?: string };
        if (!response.ok || !result.branches) throw new Error(result.error || 'Could not load branches.');
        if (!controller.signal.aborted) setData(result.branches);
      })
      .catch(reason => { if (!controller.signal.aborted) setReadError(reason instanceof Error ? reason.message : 'Could not load branches.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [checkoutId, open, revision]);

  const switchBranch = async (target: string) => {
    if (!data || pending.current) return;
    pending.current = true; setSwitching(target); onBusyChange(true); setError(undefined);
    try {
      const response = await fetch('/api/repository/branches', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkoutId, branch: target, head: data.head }),
      });
      const result = await response.json() as { branch?: string; error?: string };
      if (!response.ok || result.branch !== target) throw new Error(result.error || 'Could not switch branches.');
      if (mounted.current) setOpen(false);
    } catch (reason) {
      if (mounted.current) {
        setError(reason instanceof Error ? reason.message : 'Could not switch branches. Refresh to check the current branch.');
        setRevision(value => value + 1);
      }
    } finally {
      pending.current = false;
      if (mounted.current) { setSwitching(undefined); onBusyChange(false); onRefresh(); }
    }
  };
  const filtered = data?.branches.filter(item => item.name.toLowerCase().includes(query.toLowerCase()));
  return <>
    <Button className="repository-branch-picker" title={`Switch branch: ${branch || 'Unknown branch'}`}
      aria-label={`Switch branch: ${branch || 'Unknown branch'}`} disabled={disabled || Boolean(switching)}
      onClick={() => { setQuery(''); setError(undefined); setOpen(true); }}>
      <strong>{branch || 'Unknown branch'}</strong><span aria-hidden="true">▾</span>
    </Button>
    <Dialog open={open} onClose={() => { if (!pending.current) setOpen(false); }} fullWidth maxWidth="xs" aria-labelledby="branch-picker-title">
      <DialogTitle id="branch-picker-title">Switch branch</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2, overflowWrap: 'anywhere' }}>{repositoryName} · All sessions using this checkout will follow the switch.</DialogContentText>
        <TextField autoFocus fullWidth size="small" label="Find local branch" value={query} onChange={event => setQuery(event.target.value)} disabled={Boolean(switching)} />
        {loading && <LinearProgress aria-label="Loading branches" sx={{ mt: 1 }} />}
        {(error || readError) && <Alert severity="error" sx={{ mt: 1 }}>{error || readError}</Alert>}
        {switching && <Alert severity="info" sx={{ mt: 1, overflowWrap: 'anywhere' }}>Switching to {switching}…</Alert>}
        <List aria-label="Local branches" sx={{ maxHeight: 320, overflowY: 'auto' }}>
          {filtered?.map(item => <ListItemButton key={item.name} selected={item.name === data?.current}
            disabled={Boolean(switching) || item.occupied || item.name === data?.current}
            onClick={() => void switchBranch(item.name)}>
            <ListItemText primary={item.name} secondary={item.name === data?.current ? 'Current' : item.occupied ? 'In another worktree' : undefined}
              slotProps={{ primary: { sx: { overflowWrap: 'anywhere', fontFamily: 'var(--mono)', fontSize: 13 } } }} />
          </ListItemButton>)}
        </List>
        {!loading && data && !filtered?.length && <DialogContentText>{data.branches.length ? 'No matching branches.' : 'No local branches yet.'}</DialogContentText>}
      </DialogContent>
      <DialogActions>
        <Button disabled={loading || Boolean(switching)} onClick={() => { setError(undefined); setRevision(value => value + 1); }}>Refresh branches</Button>
        <Button disabled={Boolean(switching)} onClick={() => setOpen(false)}>Cancel</Button>
      </DialogActions>
    </Dialog>
  </>;
}
