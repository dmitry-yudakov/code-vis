'use client';

import IconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import { ShellIcon } from './ShellIcon';

/** Attention stays reachable when narrow maximize hides navigation. */
export function PaneMaximizeButton({ label, maximized, approvals = 0, unread = 0, onToggle, onOpenConversation }: {
  label: string;
  maximized: boolean;
  approvals?: number;
  unread?: number;
  onToggle(): void;
  onOpenConversation?(): void;
}) {
  const badge = maximized ? approvals || unread : 0;
  const attention = badge ? approvals ? `${approvals} action${approvals === 1 ? '' : 's'} waiting for your approval` : `${unread} unread replies` : undefined;
  const action = maximized ? 'Restore layout' : `Maximize ${label}`;
  return <>
    {maximized && approvals > 0 && onOpenConversation && <Button className="pane-review" color="warning" onClick={onOpenConversation} aria-label={`Review ${attention}`}>Review</Button>}
    <IconButton className="pane-maximize" aria-label={action} aria-description={attention} title={attention ? `${action} · ${attention}` : action} onClick={onToggle}>
      <ShellIcon name={maximized ? 'restore' : 'maximize'} />
      {badge > 0 && <span className={`layout-badge ${approvals ? 'attention' : ''}`} aria-hidden="true">{badge > 99 ? '99+' : badge}</span>}
    </IconButton>
  </>;
}
