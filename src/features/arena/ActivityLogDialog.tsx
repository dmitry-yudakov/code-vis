'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import LinearProgress from '@mui/material/LinearProgress';
import MuiLink from '@mui/material/Link';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { activityLabels, activitySources, mcpActivityLabels, type ActivityActor, type ActivityEntry, type ActivityPage } from '@/shared/activityLog';
import type { ArenaMachineSnapshot } from '@/shared/types';

const sourceNames = { web: 'Web', mcp: 'MCP', automatic: 'Automatic' };
const outcomes = { succeeded: 'Succeeded', denied: 'Denied', failed: 'Failed', partial: 'Partial', replayed: 'Already archived' };
type SourceFilter = ActivityActor['source'] | '';

function ActivityRow({ entry, machine, onClose }: { entry: ActivityEntry; machine?: ArenaMachineSnapshot; onClose(): void }) {
  const session = machine?.sessions.find(item => item.id === entry.sessionId);
  const archived = machine?.archivedSessions.find(item => item.id === entry.sessionId);
  const project = machine?.projects.find(item => item.id === entry.projectId);
  const mcp = entry.action === 'mcp.call' ? entry : undefined;
  const details = [
    ['Actor ID', entry.actor.id], ['Session ID', entry.sessionId], ['Project ID', entry.projectId],
    ['Message ID', entry.messageId], ['Agent ID', entry.participantId], ['Run ID', entry.runId],
    ['Request ID', entry.requestId], ['Repository ID', entry.checkoutId], ['Commit', entry.commitHash], ['Mode', entry.mode],
    ['MCP operation', mcp?.operation], ['HTTP status', mcp?.status],
  ].filter(([, value]) => value !== undefined);

  return <Box component="li" sx={{ py: 1.5, borderBottom: 1, borderColor: 'divider', overflowWrap: 'anywhere' }}>
    <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
      <Typography variant="subtitle2">{entry.action === 'mcp.call' ? mcpActivityLabels[entry.operation] : activityLabels[entry.action]}</Typography>
      {mcp && <Chip size="small" variant="outlined" label={outcomes[mcp.outcome]}
        color={mcp.outcome === 'denied' || mcp.outcome === 'failed' ? 'error' : mcp.outcome === 'partial' ? 'warning' : 'default'} />}
    </Stack>
    <Typography variant="body2" color="text.secondary">
      {sourceNames[entry.actor.source]}{entry.actor.label && ` · ${entry.actor.label}`} ·{' '}
      <time dateTime={entry.at} title={entry.at}>{new Date(entry.at).toLocaleString()}</time>
    </Typography>
    {(project || entry.sessionId) && <Typography variant="body2">
      {project?.name}{project && entry.sessionId && ' · '}
      {session ? <MuiLink component={Link} href={`/?session=${session.id}`} prefetch={false} onClick={onClose}>{session.title}</MuiLink>
        : archived ? `${archived.title} · Archived` : entry.sessionId && `Session ${entry.sessionId.slice(0, 8)}`}
    </Typography>}
    {details.length > 0 && <Box component="details" sx={{ mt: 0.5, typography: 'body2' }}>
      <Box component="summary" sx={{ cursor: 'pointer', color: 'text.secondary', width: 'fit-content' }}>Details</Box>
      <Box component="dl" sx={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', gap: '2px 12px', my: 0.5 }}>
        {details.map(([label, value]) => <Box key={label} sx={{ display: 'contents' }}>
          <Box component="dt" sx={{ color: 'text.secondary' }}>{label}</Box><Box component="dd" sx={{ m: 0 }}>{value}</Box>
        </Box>)}
      </Box>
    </Box>}
  </Box>;
}

export function ActivityLogDialog({ compact, machine, onClose }: { compact: boolean; machine?: ArenaMachineSnapshot; onClose(): void }) {
  const [source, setSource] = useState<SourceFilter>('');
  const [page, setPage] = useState<ActivityPage>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const requestRef = useRef<AbortController | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const load = useCallback(async (source: SourceFilter, before?: string) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    if (!before) contentRef.current?.scrollTo({ top: 0 });
    setLoading(true);
    setError(undefined);
    try {
      const query = new URLSearchParams();
      if (source) query.set('source', source);
      if (before) query.set('before', before);
      const response = await fetch(`/api/activity?${query}`, { signal: controller.signal, cache: 'no-store' });
      const result = await response.json() as ActivityPage & { error?: string };
      if (!response.ok) throw new Error(result.error || 'Could not load activity.');
      if (controller.signal.aborted) return;
      setPage(current => before && current ? {
        entries: [...current.entries, ...result.entries],
        nextCursor: result.nextCursor,
        incomplete: current.incomplete || result.incomplete,
      } : result);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof TypeError ? 'Could not load activity. Try refreshing.'
        : cause instanceof Error ? cause.message : 'Could not load activity.');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load('');
    return () => requestRef.current?.abort();
  }, [load]);

  const nextCursor = page?.nextCursor;
  return <Dialog open onClose={onClose} fullScreen={compact} fullWidth maxWidth="sm" aria-labelledby="activity-log-title">
    <DialogTitle id="activity-log-title">Activity log</DialogTitle>
    <Stack direction="row" spacing={1.5} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap', px: 3, pb: 1.5 }}>
      <TextField select label="Source" size="small" value={source} sx={{ minWidth: 120 }}
        onChange={event => {
          const next = event.target.value as SourceFilter;
          setSource(next);
          setPage(undefined);
          void load(next);
        }}>
        <MenuItem value="">All sources</MenuItem>
        {activitySources.map(value => <MenuItem key={value} value={value}>{sourceNames[value]}</MenuItem>)}
      </TextField>
      <Button onClick={() => void load(source)} disabled={loading}>Refresh</Button>
      <Typography variant="body2" color="text.secondary" sx={{ ml: 'auto' }}>This machine</Typography>
    </Stack>
    <DialogContent ref={contentRef} dividers sx={{ pt: 0 }}>
      {loading && <LinearProgress aria-label="Loading activity" sx={{ mt: 1 }} />}
      {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
      {page?.incomplete && <Alert severity="warning" sx={{ mt: 1 }}>Some activity entries could not be saved or read.</Alert>}
      {!loading && !error && page?.entries.length === 0 && <Typography color="text.secondary" sx={{ py: 2 }}>No activity recorded.</Typography>}
      {!!page?.entries.length && <Box component="ul" aria-label="Activity entries" sx={{ listStyle: 'none', p: 0, m: 0 }}>
        {page.entries.map(entry => <ActivityRow key={entry.id} entry={entry} machine={machine} onClose={onClose} />)}
      </Box>}
      {nextCursor && <Button sx={{ mt: 1 }} disabled={loading}
        onClick={() => void load(source, nextCursor)}>Load older activity</Button>}
    </DialogContent>
    <DialogActions><Button onClick={onClose}>Close</Button></DialogActions>
  </Dialog>;
}
