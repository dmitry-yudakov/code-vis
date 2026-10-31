'use client';

import IconButton from '@mui/material/IconButton';
import { ShellIcon } from './ShellIcon';

/**
 * The header's layout icons. The activity bar owns the side panel, so these show and hide the canvas
 * and the conversation. A closed conversation carries what it holds: approvals first, else unread
 * replies.
 */
export function LayoutToggles({ canvasShown, canvasToggleable, conversationShown, approvals, unread, onToggleCanvas, onToggleConversation, compact = false }: {
  compact?: boolean;
  canvasShown: boolean;
  /** Desktop hides this control when another navigation surface owns canvas selection. */
  canvasToggleable: boolean;
  conversationShown: boolean;
  approvals: number;
  unread: number;
  onToggleCanvas(): void;
  onToggleConversation(): void;
}) {
  const badge = conversationShown ? 0 : approvals || unread;
  const name = compact ? 'Chat' : 'Conversation';
  const conversationLabel = conversationShown || !badge ? name
    : approvals ? `${name}, ${approvals} action${approvals === 1 ? '' : 's'} waiting for your approval`
    : `${name}, ${unread} unread`;
  const canvas = canvasToggleable && (
    <IconButton
      type="button"
      className="layout-toggle"
      aria-label="Canvas"
      aria-pressed={canvasShown}
      title={compact ? 'Show the canvas' : canvasShown ? 'Hide the canvas' : 'Show the canvas'}
      onClick={onToggleCanvas}
    ><ShellIcon name="canvas" />{compact && <span className="activity-label">Canvas</span>}</IconButton>
  );
  return (
    <div className="layout-toggles" role="group" aria-label="Layout">
      {!compact && canvas}
      <IconButton
        type="button"
        className="layout-toggle"
        aria-label={conversationLabel}
        aria-pressed={conversationShown}
        title={compact ? 'Show chat' : conversationShown ? 'Close the conversation' : 'Open the conversation'}
        onClick={onToggleConversation}
      >
        <ShellIcon name="conversation" />
        {compact && <span className="activity-label">Chat</span>}
        {badge > 0 && <span className={`layout-badge ${approvals ? 'attention' : ''}`.trim()} aria-hidden="true">{badge}</span>}
      </IconButton>
      {compact && canvas}
    </div>
  );
}
