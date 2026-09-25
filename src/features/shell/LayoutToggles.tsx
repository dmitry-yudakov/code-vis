'use client';

import { ShellIcon } from './ShellIcon';

/**
 * The header's layout icons. The activity bar owns the side panel, so these show and hide the canvas
 * and the conversation. A closed conversation carries what it holds: approvals first, else unread
 * replies.
 */
export function LayoutToggles({ canvasShown, canvasToggleable, conversationShown, approvals, unread, onToggleCanvas, onToggleConversation }: {
  canvasShown: boolean;
  /** False below the overlay band, where the panels float over a canvas that always shows. */
  canvasToggleable: boolean;
  conversationShown: boolean;
  approvals: number;
  unread: number;
  onToggleCanvas(): void;
  onToggleConversation(): void;
}) {
  const badge = conversationShown ? 0 : approvals || unread;
  const conversationLabel = conversationShown || !badge ? 'Conversation'
    : approvals ? `Conversation, ${approvals} action${approvals === 1 ? '' : 's'} waiting for your approval`
    : `Conversation, ${unread} unread`;
  return (
    <div className="layout-toggles" role="group" aria-label="Layout">
      {canvasToggleable && (
        <button
          type="button"
          className="layout-toggle"
          aria-label="Canvas"
          aria-pressed={canvasShown}
          title={canvasShown ? 'Hide the canvas' : 'Show the canvas'}
          onClick={onToggleCanvas}
        ><ShellIcon name="canvas" /></button>
      )}
      <button
        type="button"
        className="layout-toggle"
        aria-label={conversationLabel}
        aria-pressed={conversationShown}
        title={conversationShown ? 'Close the conversation' : 'Open the conversation'}
        onClick={onToggleConversation}
      >
        <ShellIcon name="conversation" />
        {badge > 0 && <span className={`layout-badge ${approvals ? 'attention' : ''}`.trim()} aria-hidden="true">{badge}</span>}
      </button>
    </div>
  );
}
