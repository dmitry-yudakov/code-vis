'use client';

import { useId, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import type { PublicSession } from '@/shared/types';
import { ShellIcon } from '@/features/shell/ShellIcon';

export function SessionArchiveSettings({ session, running, onAllowedChange, onCheck }: {
  session: PublicSession;
  running: boolean;
  onAllowedChange(allowed: boolean): Promise<void>;
  onCheck(messageId: string): Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const controlsId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [pendingAllowed, setPendingAllowed] = useState<boolean>();
  const perform = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError(undefined);
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save. Try again.'); }
    finally { setBusy(false); }
  };
  const check = session.agentArchiveCheck;
  const reply = session.messages.at(-1);
  const canCheck = session.allowAgentArchive && !running && reply?.role === 'assistant' && !reply.planProposed;
  return <Box sx={{ display: 'contents' }} onKeyDown={event => {
    if (event.key !== 'Escape' || !expanded) return;
    event.preventDefault();
    event.stopPropagation();
    setExpanded(false);
    trigger.current?.focus();
  }}>
    <IconButton ref={trigger} type="button" aria-label="Session settings" title="Session settings"
      aria-expanded={expanded} aria-controls={expanded ? controlsId : undefined}
      onClick={() => setExpanded(current => !current)}>
      <ShellIcon name="ellipsis" />
    </IconButton>
    {expanded && <Box id={controlsId} role="group" aria-label="Session settings" className="session-settings-options"
      sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 1, rowGap: 0.5, minWidth: 0, maxWidth: '100%' }}>
      <Tooltip describeChild title="After a successful reply, a separate check may archive this session and release queued work. You can restore it later. Turning this off prevents pending decisions.">
        <FormControlLabel label="Allow agent to archive" sx={{ m: 0, flexShrink: 0 }}
          control={<Checkbox checked={pendingAllowed ?? Boolean(session.allowAgentArchive)} disabled={busy}
            onChange={(_, allowed) => {
              setPendingAllowed(allowed);
              void perform(() => onAllowedChange(allowed)).finally(() => setPendingAllowed(undefined));
            }} />} />
      </Tooltip>
      {session.allowAgentArchive && <>
        {check && <Typography role="status" variant="caption" color="text.secondary">
          {check.status === 'checking' ? 'Completion check pending.'
            : check.status === 'kept-open' ? 'Agent kept this session open.'
            : check.status === 'failed' ? 'Completion check unavailable. Session kept open.'
            : 'Checks completion after the next successful reply.'}
        </Typography>}
        {canCheck && <Button size="small" disabled={busy} onClick={() => { void perform(() => onCheck(reply.id)); }}>
          {check?.status === 'failed' || check?.status === 'checking' ? 'Retry check' : 'Check completion'}
        </Button>}
      </>}
      {error && <Alert severity="error">{error}</Alert>}
    </Box>}
  </Box>;
}
