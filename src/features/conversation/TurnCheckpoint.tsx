
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import { CHECKPOINT_RESTORE_INTERRUPTED, CHECKPOINT_SCOPE } from '@/shared/turnCheckpoint';
import type { TurnCheckpointControls } from './useTurnCheckpoint';

export function TurnCheckpoint({ controls }: { controls: TurnCheckpointControls }) {
  const { checkpoint, busy, confirming, onAsk, onDismiss, onConfirm } = controls;
  const error = controls.error || (checkpoint?.state === 'unavailable' && checkpoint.reason === CHECKPOINT_RESTORE_INTERRUPTED
    ? checkpoint.reason : undefined);
  if (!error && (!checkpoint || checkpoint.state === 'unavailable')) return null;
  return <Paper sx={{ p: 1 }} className="turn-checkpoint" aria-label="Turn recovery" aria-live="polite">
    {error ? <span role="alert">{error}</span> : confirming ? <span>{checkpoint?.changedFiles} file(s). {CHECKPOINT_SCOPE}</span>
      : checkpoint?.state === 'ready' ? <small>{checkpoint.changedFiles} file(s) changed</small>
        : checkpoint?.state === 'undone' ? <small>Checkout files restored.</small> : null}
    {checkpoint?.state === 'ready' && (confirming ? <>
      <Button type="button" disabled={busy} onClick={onConfirm}>Confirm restore</Button>
      <Button type="button" disabled={busy} onClick={onDismiss}>Keep changes</Button>
    </> : <Button type="button" disabled={busy} title={CHECKPOINT_SCOPE} onClick={onAsk}>Restore files</Button>)}
  </Paper>;
}
