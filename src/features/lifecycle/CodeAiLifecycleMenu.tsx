'use client';

import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import LinearProgress from '@mui/material/LinearProgress';
import { useDialogFocus } from '@/features/shell/useDialogFocus';

import { lifecycleConfirmation } from './lifecycleFlow';
import type { CodeAiLifecycleOwner } from './useCodeAiLifecycle';

/** The menu closes before its confirmation opens in the shell. */
export function CodeAiLifecycleMenu({ lifecycle, onRequest }: { lifecycle: CodeAiLifecycleOwner; onRequest(): void }) {
  return (
    <section className="lifecycle-menu" aria-label="Build and restart CodeAI">
      <Button type="button" disabled={!lifecycle.canRequest} onClick={onRequest}>Build &amp; restart CodeAI</Button>
      {lifecycle.status && <p role="status">{lifecycle.status}</p>}
    </section>
  );
}

/** Owns confirmation, blocking progress, and recovery outside the More popover. */
export function CodeAiLifecycleDialog({ lifecycle }: { lifecycle: CodeAiLifecycleOwner }) {
  const open = lifecycle.confirming || lifecycle.busy || Boolean(lifecycle.error);
  const restoreFocus = useDialogFocus(open, '.more-menu > button');
  return <Dialog open={open} maxWidth="xs" disableRestoreFocus sx={{ zIndex: theme => theme.zIndex.modal + 2 }}
    aria-labelledby="lifecycle-confirmation-title" aria-describedby="lifecycle-confirmation-description"
    onClose={lifecycle.busy ? undefined : lifecycle.dismiss} slotProps={{ transition: { onExited: restoreFocus } }}>
    <DialogTitle id="lifecycle-confirmation-title">{lifecycle.busy ? lifecycle.badge : lifecycle.error ? 'Build and restart stopped' : 'Build and restart CodeAI?'}</DialogTitle>
    <DialogContent aria-busy={lifecycle.busy}>
      <DialogContentText id="lifecycle-confirmation-description" role={lifecycle.error ? 'alert' : 'status'} sx={{ overflowWrap: 'anywhere' }}>
        {lifecycle.busy ? lifecycle.status : lifecycle.error || lifecycleConfirmation()}
      </DialogContentText>
      {lifecycle.busy && <LinearProgress aria-label="CodeAI build and restart progress" sx={{ mt: 2 }} />}
    </DialogContent>
    {!lifecycle.busy && <DialogActions>
      <Button type="button" autoFocus onClick={lifecycle.dismiss}>{lifecycle.error ? 'Close' : 'Cancel'}</Button>
      {lifecycle.error
        ? <Button type="button" onClick={lifecycle.canRequest ? lifecycle.ask : () => void lifecycle.refresh()}>{lifecycle.canRequest ? 'Try again' : 'Check again'}</Button>
        : <Button type="button" color="warning" variant="contained" disabled={!lifecycle.canRequest} onClick={lifecycle.confirm}>Build and restart</Button>}
    </DialogActions>}
  </Dialog>;
}
