'use client';

import { useState, useSyncExternalStore } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import InputAdornment from '@mui/material/InputAdornment';
import TextField from '@mui/material/TextField';
import { AttachmentChip } from '@/features/conversation/AttachmentChip';
import { pastedImageFiles, pendingImageDetail } from '@/features/conversation/imageAttachments';
import { MAX_MESSAGE_TEXT_CHARS } from '@/shared/limits';
import type { ArenaMachineSnapshot } from '@/shared/types';
import type { ArenaSessionCard } from './arenaModel';
import type { ArenaReplyOptions, useArenaReplies } from './useArenaReplies';

export function ArenaTileBody({ machine, card, replies, replyOptions, onDecidePermission }: {
  machine: ArenaMachineSnapshot;
  card: ArenaSessionCard;
  replies: ReturnType<typeof useArenaReplies>;
  replyOptions(machine: ArenaMachineSnapshot, session: ArenaSessionCard['session']): ArenaReplyOptions;
  onDecidePermission(machineId: string, runId: string, requestId: string, decision: 'allow' | 'deny'): Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [deciding, setDeciding] = useState<string>();
  const [permissionError, setPermissionError] = useState<string>();
  const { session, run } = card;
  const draft = useSyncExternalStore(listener => replies.subscribe(machine.machine.id, session.id, listener),
    () => replies.get(machine.machine.id, session.id), () => replies.get(machine.machine.id, session.id));
  const options = replyOptions(machine, session);
  const mode = draft.delivery?.mode ?? options.mode;
  const fresh = machine.machine.state === 'online' && machine.snapshotFresh !== false;
  const disabled = !fresh || draft.busy || Boolean(replies.blockedReason);
  const frozen = Boolean(draft.delivery);
  const locked = disabled || frozen;
  const message = session.lastMessage;
  const missingImages = (draft.delivery?.imageCount || 0) > (draft.images?.length || 0);
  const sendLabel = draft.busy ? 'Sending…' : frozen ? missingImages ? 'Check delivery' : 'Check / retry' : 'Send';
  const canSend = !draft.busy && !draft.preparing && Boolean(draft.text.trim() || draft.images?.length || draft.delivery) && (frozen
    ? machine.machine.state === 'online'
    : !disabled && !run && !options.unavailableReason && options.modes.includes(mode));
  const send = () => { if (canSend) void replies.send(machine, session, options); };
  return (
    <div className="arena-tile-body">
      <div className="arena-tile-preview">
        <span className="arena-tile-caption">{message ? `Latest message · ${message.author}` : session.lastActivity ? 'Preview unavailable' : 'No messages yet'}</span>
        <p className={expanded ? 'expanded' : ''}>{message?.text || (message ? 'This message contains code or canvas content. Open the session to view it.' : session.lastActivity ? 'Open the session to read its latest message.' : 'Send an instruction to start this session.')}{message?.truncated ? '…' : ''}</p>
        {message && (message.text.length > 180 || message.text.split('\n').length > 6) && <Button type="button" variant="text" color="inherit" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'Show less' : 'Show more'}</Button>}
      </div>
      {run?.pendingPermissions.map(permission => <div className="arena-tile-permission" key={permission.requestId}>
        <strong>{permission.tool}</strong><pre>{permission.detail}</pre>
        <div>{(['deny', 'allow'] as const).map(decision => <Button type="button" key={decision} disabled={!fresh || Boolean(deciding)}
          variant={decision === 'allow' ? 'contained' : 'outlined'} onClick={() => {
            setDeciding(permission.requestId); setPermissionError(undefined);
            void onDecidePermission(machine.machine.id, run.runId, permission.requestId, decision)
              .catch(() => setPermissionError('Could not resolve this permission. Refresh and try again.')).finally(() => setDeciding(undefined));
          }}>{decision === 'allow' ? 'Allow' : 'Deny'}</Button>)}</div>
      </div>)}
      {permissionError && <Alert severity="error">{permissionError}</Alert>}
      <form className="arena-tile-reply" aria-label={`Reply to ${session.title}`} onSubmit={event => { event.preventDefault(); send(); }}>
        {Boolean(draft.images?.length) && <div className="attachment-chips" aria-label="Attached images">
          {draft.images!.map((image, index) => <AttachmentChip key={image.id} className="image" removeLabel={`Remove image ${index + 1}`} disabled={Boolean(locked)}
            onRemove={() => replies.removeImage(machine.machine.id, session.id, image.id)}>
            <img src={image.dataUrl} alt="" /><span title={pendingImageDetail(image)}>Image {index + 1}</span>
          </AttachmentChip>)}
        </div>}
        <TextField className="arena-tile-reply-field" variant="standard" multiline minRows={1} maxRows={3} fullWidth placeholder="Quick reply…" value={draft.text}
          disabled={!fresh} slotProps={{ input: { disableUnderline: true, readOnly: Boolean(locked), endAdornment: <InputAdornment position="end">
            <Button type="submit" className="send-button" variant="contained" disabled={!canSend}
              aria-label={sendLabel} title={sendLabel}>
              <span aria-hidden="true">{draft.busy ? '…' : frozen ? '↻' : '↑'}</span>
            </Button>
          </InputAdornment> }, htmlInput: { 'aria-label': `Reply to ${session.title}`, maxLength: MAX_MESSAGE_TEXT_CHARS } }}
          onChange={event => replies.edit(machine.machine.id, session.id, { text: event.target.value })}
          onPaste={event => {
            const files = pastedImageFiles(event.clipboardData);
            if (!files.length) return;
            event.preventDefault();
            if (!locked) void replies.addImages(machine.machine.id, session.id, files);
          }}
          onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && !event.repeat) { event.preventDefault(); send(); } }} />
        {draft.preparing && <span role="status" className="arena-tile-caption">Preparing images…</span>}
        {draft.error && <Alert severity="warning">{draft.error}</Alert>}
        {replies.blockedReason ? <span role="status" className="arena-tile-caption">{replies.blockedReason}</span>
          : draft.sent ? <span role="status" className="arena-tile-caption">Sent</span>
          : options.unavailableReason ? <span className="arena-tile-caption">{options.unavailableReason}</span>
          : run && !frozen ? <span className="arena-tile-caption">Reply when this turn finishes. You can prepare a draft.</span>
          : !fresh ? <span className="arena-tile-caption">{machine.machine.state === 'online' ? 'Reconnecting. Your draft is kept.' : 'Machine offline. Your draft is kept.'}</span> : null}
      </form>
    </div>
  );
}
