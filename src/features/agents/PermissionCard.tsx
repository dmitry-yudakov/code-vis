'use client';

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
    <article className="permission-card" aria-label={`Approval required: ${request.tool}`}>
      <div className="permission-meta"><span>Approval required · {participant?.displayName || 'Agent'}{participant ? ` (${PROVIDER_LABELS[participant.provider]})` : ''}</span><span>{request.tool}</span></div>
      <p>{permissionLabel(request)}</p>
      <div className="permission-actions">
        <button type="button" className="permission-deny" disabled={busy} onClick={() => onDecide(request.requestId, 'deny')}>Deny</button>
        <button type="button" className="permission-allow" disabled={busy} onClick={() => onDecide(request.requestId, 'allow')}>Allow</button>
      </div>
    </article>
  );
}
