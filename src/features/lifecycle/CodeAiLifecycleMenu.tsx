'use client';

import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
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

/** Mounted outside the popover so closing More cannot hide or unmount the confirmation. */
export function CodeAiLifecycleDialog({ lifecycle, checkoutName }: { lifecycle: CodeAiLifecycleOwner; checkoutName: string }) {
  const open = lifecycle.available && lifecycle.confirming;
  const restoreFocus = useDialogFocus(open, '.more-menu > button');
  return <Dialog open={open} maxWidth="xs" disableRestoreFocus
    aria-labelledby="lifecycle-confirmation-title" aria-describedby="lifecycle-confirmation-description"
    onClose={lifecycle.dismiss} slotProps={{ transition: { onExited: restoreFocus } }}>
    <DialogTitle id="lifecycle-confirmation-title">Build and restart CodeAI?</DialogTitle>
    <DialogContent>
      <DialogContentText id="lifecycle-confirmation-description" sx={{ overflowWrap: 'anywhere' }}>
        {lifecycleConfirmation(checkoutName)}
      </DialogContentText>
    </DialogContent>
    <DialogActions>
      <Button type="button" autoFocus onClick={lifecycle.dismiss}>Cancel</Button>
      <Button type="button" color="warning" variant="contained" disabled={!lifecycle.canRequest} onClick={lifecycle.confirm}>Build and restart</Button>
    </DialogActions>
  </Dialog>;
}
