'use client';

import { useEffect, useState } from 'react';
import { Alert, Box, Button, Paper, Stack, Typography } from '@mui/material';
import type { McpQueueReview } from '@/shared/mcp';
import { AGENT_ROLE_LABELS, PROVIDER_LABELS } from '@/shared/participants';

async function readReview(endpoint: string, signal?: AbortSignal, fingerprint?: string): Promise<McpQueueReview> {
  const response = await fetch(endpoint, { signal, cache: 'no-store', ...(fingerprint ? {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fingerprint }),
  } : {}) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || data.error || 'Queue review is unavailable.');
  return data;
}

export function McpQueueConfirmation({ endpoint }: { endpoint: string }) {
  const [review, setReview] = useState<McpQueueReview>();
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setReview(undefined);
    setError(undefined);
    void readReview(endpoint, controller.signal).then(setReview, error => {
      if (!controller.signal.aborted) setError(error.message);
    });
    return () => controller.abort();
  }, [endpoint]);

  const confirm = async () => {
    if (!review) return;
    setError(undefined);
    setSaving(true);
    try { setReview(await readReview(endpoint, undefined, review.fingerprint)); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not approve the queue request.'); }
    finally { setSaving(false); }
  };

  const request = review?.request;
  return <Box component="main" sx={{ height: '100dvh', overflow: 'auto', p: { xs: 2, sm: 4 } }}>
    <Paper component="section" variant="outlined" sx={{ mx: 'auto', maxWidth: 680, p: { xs: 2, sm: 3 } }} aria-labelledby="queue-review-title">
      <Stack spacing={2}>
        <Typography id="queue-review-title" component="h1" variant="h5">Confirm queued session</Typography>
        {error && <Alert severity="error">{error}</Alert>}
        {!review && !error && <Typography role="status">Loading queue request…</Typography>}
        {review && request && <>
          <Typography component="h2" variant="subtitle1">{review.projectName}</Typography>
          <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
            {review.grantName} · {request.checkoutMode === 'worktree' ? 'New worktree from' : 'Current checkout'}{' '}
            <Box component="span" title={review.checkoutId}>{review.checkoutName || review.checkoutId}</Box>
          </Typography>
          <Typography variant="body2">{[PROVIDER_LABELS[request.provider], AGENT_ROLE_LABELS[request.role], request.execution,
            request.firstMessage.mode, request.firstMessage.model, request.firstMessage.effort].filter(Boolean).join(' · ')}</Typography>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{request.firstMessage.text}</Typography>
          </Paper>
          {review.approved ? <Alert severity="success">Approved. Return to the MCP caller to submit this request.</Alert> :
            <Button type="button" variant="contained" disabled={saving} onClick={() => void confirm()} sx={{ alignSelf: 'start' }}>Approve queue request</Button>}
        </>}
      </Stack>
    </Paper>
  </Box>;
}
