'use client';

import { useEffect, useState } from 'react';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Paper from '@mui/material/Paper';
import type { PendingPermission } from '@/features/agents/toolActivity';
import type { AgentParticipant } from '@/shared/types';

export interface PermissionFeedback { message: string; pending: boolean; retryable?: boolean }

/** Both transcript markers and this fixed area use the existing routed decision owner. */
export function ApprovalArea({ requests, agents, deciding, feedback = {}, reviewRequest, onDecide, onStop, onRefresh }: {
  requests: PendingPermission[]; agents: AgentParticipant[]; deciding?: string;
  feedback?: Record<string, PermissionFeedback>;
  reviewRequest?: { id: string; revision: number };
  onDecide(id: string, decision: 'allow' | 'deny'): void;
  onStop(): void; onRefresh?(): void;
}) {
  const [selectedId, setSelectedId] = useState<string>();
  const [reviewedId, setReviewedId] = useState<string>();
  const selected = requests.find(request => request.requestId === selectedId) || requests[0];
  useEffect(() => { if (selected) setSelectedId(selected.requestId); }, [selected]);
  useEffect(() => {
    if (reviewRequest && requests.some(request => request.requestId === reviewRequest.id)) { setSelectedId(reviewRequest.id); setReviewedId(reviewRequest.id); }
  }, [reviewRequest]);
  useEffect(() => {
    if (reviewedId && !requests.some(request => request.requestId === reviewedId)) setReviewedId(undefined);
  }, [requests, reviewedId]);
  if (!selected) return null;
  const index = requests.indexOf(selected);
  const result = feedback[selected.requestId];
  const busy = deciding === selected.requestId || Boolean(result?.pending || result?.retryable);
  const complete = selected.review?.completeness === 'complete' && Boolean(selected.review.text);
  const name = selected.actor?.name || agents.find(agent => agent.id === selected.participantId)?.displayName || 'Agent';
  const actions = <>
    {result?.retryable && onRefresh && <Button onClick={onRefresh}>Check decision</Button>}
    <Button color="warning" disabled={busy} onClick={() => onDecide(selected.requestId, 'deny')}>Deny</Button>
    <Button color="warning" variant="contained" disabled={busy || !complete} onClick={() => onDecide(selected.requestId, 'allow')}>Allow once</Button>
  </>;
  return <Paper component="section" className="conversation-approvals" variant="outlined" aria-label="Pending approvals" sx={{ p: 1, borderColor: 'warning.main' }}>
    <div className="approval-heading"><strong>{name} · {selected.tool}</strong>
      <span aria-live="polite" aria-atomic="true">{index + 1} of {requests.length}</span>
      {requests.length > 1 && <><Button aria-label="Previous approval" onClick={() => setSelectedId(requests[(index + requests.length - 1) % requests.length].requestId)}>‹</Button>
        <Button aria-label="Next approval" onClick={() => setSelectedId(requests[(index + 1) % requests.length].requestId)}>›</Button></>}
    </div>
    <p className="approval-summary" title={selected.detail}>{selected.detail || 'Approval required'}</p>
    {!complete && <small>Full review unavailable · Allow disabled here</small>}
    {result && <small role="status">{result.message}</small>}
    <div className="approval-actions"><Button onClick={() => setReviewedId(selected.requestId)}>Review</Button>{actions}</div>
    <Dialog open={reviewedId === selected.requestId} onClose={() => setReviewedId(undefined)} maxWidth="md" fullWidth aria-labelledby="approval-review-title">
      <DialogTitle id="approval-review-title">Review · {name} · {selected.tool}</DialogTitle>
      <DialogContent dividers className="approval-review-content">
        {complete ? <pre>{selected.review!.text}</pre> : <p>{selected.review?.reason || 'The executing machine did not provide a complete reviewable action.'}</p>}
        {result && <p role="status">{result.message}</p>}
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap' }}><Button onClick={() => setReviewedId(undefined)}>Close</Button><Button onClick={onStop}>Stop</Button>{actions}</DialogActions>
    </Dialog>
  </Paper>;
}
