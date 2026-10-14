
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import { DesktopPopover } from '@/features/shell/DesktopPopover';
import { CHECKPOINT_SCOPE } from '@/shared/turnCheckpoint';
import type { TurnCheckpointControls } from './useTurnCheckpoint';

export function TurnCheckpoint({ controls }: { controls: TurnCheckpointControls }) {
  const { checkpoint, busy, confirming, error, onAsk, onDismiss, onConfirm } = controls;
  if (!checkpoint && !error) return null;
  return <Paper sx={{ p: 1 }} className="turn-checkpoint" aria-label="Turn recovery" aria-live="polite">
    {error ? <span role="alert">{error}</span> : confirming ? <span>{checkpoint?.changedFiles} file(s). {CHECKPOINT_SCOPE}</span>
      : checkpoint?.state === 'ready' ? <small>{checkpoint.changedFiles} file(s) changed</small>
        : checkpoint?.state === 'undone' ? <small>Checkout files restored.</small>
        : <DesktopPopover className="recovery-details" label="Undo unavailable" summary="Undo unavailable">
          {() => <p>{checkpoint?.reason}</p>}
        </DesktopPopover>}
    {checkpoint?.state === 'ready' && (confirming ? <>
      <Button type="button" disabled={busy} onClick={onConfirm}>Confirm Undo</Button>
      <Button type="button" disabled={busy} onClick={onDismiss}>Keep changes</Button>
    </> : <Button type="button" disabled={busy} title={CHECKPOINT_SCOPE} onClick={onAsk}>Undo this turn</Button>)}
  </Paper>;
}
