'use client';

import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';

import { permissionLabel, type PendingPermission } from '@/features/agents/toolActivity';
import type { AgentParticipant } from '@/shared/types';
import { PROVIDER_LABELS } from '@/shared/participants';

export function PermissionCard({ request, participant, busy, onDecide }: {
  request: PendingPermission;
  participant?: AgentParticipant;
  busy: boolean;
  onDecide(requestId: string, decision: 'allow' | 'deny'): void;
}) {
  return (
    <Paper component="article" sx={{ p: 1.5, borderColor: 'warning.main' }} className="permission-card" aria-label={`Approval required: ${request.tool}`}>
      <div className="permission-meta"><span>Approval required · {participant?.displayName || 'Agent'}{participant ? ` (${PROVIDER_LABELS[participant.provider]})` : ''}</span><span>{request.tool}</span></div>
      <p>{permissionLabel(request)}</p>
      <div className="permission-actions">
        <Button type="button" className="permission-deny" color="warning" disabled={busy} onClick={() => onDecide(request.requestId, 'deny')}>Deny</Button>
        <Button type="button" className="permission-allow" variant="contained" color="warning" disabled={busy} onClick={() => onDecide(request.requestId, 'allow')}>Allow</Button>
      </div>
    </Paper>
  );
}
