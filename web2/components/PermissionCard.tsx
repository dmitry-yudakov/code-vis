'use client';

import { permissionLabel, type PendingPermission } from '@/lib/client/toolActivity';

export function PermissionCard({ request, busy, onDecide }: {
  request: PendingPermission;
  busy: boolean;
  onDecide(requestId: string, decision: 'allow' | 'deny'): void;
}) {
  return (
    <article className="permission-card" aria-label={`Approval required: ${request.tool}`}>
      <div className="permission-meta"><span>Approval required</span><span>{request.tool}</span></div>
      <p>{permissionLabel(request)}</p>
      <div className="permission-actions">
        <button type="button" className="permission-deny" disabled={busy} onClick={() => onDecide(request.requestId, 'deny')}>Deny</button>
        <button type="button" className="permission-allow" disabled={busy} onClick={() => onDecide(request.requestId, 'allow')}>Allow</button>
      </div>
    </article>
  );
}
