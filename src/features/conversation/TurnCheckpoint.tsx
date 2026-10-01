import { CHECKPOINT_SCOPE } from '@/shared/turnCheckpoint';
import type { TurnCheckpointControls } from './useTurnCheckpoint';

export function TurnCheckpoint({ controls }: { controls: TurnCheckpointControls }) {
  const { checkpoint, busy, confirming, error, onAsk, onDismiss, onConfirm } = controls;
  if (!checkpoint && !error) return null;
  return <div className="turn-checkpoint" aria-label="Turn recovery" aria-live="polite">
    <span>{error || (confirming ? `${checkpoint?.changedFiles} file(s). ${CHECKPOINT_SCOPE}`
      : checkpoint?.state === 'ready' ? `${checkpoint.changedFiles} file(s) changed · Checkpoint expires ${new Date(checkpoint.expiresAt).toLocaleDateString()}`
        : checkpoint?.reason)}</span>
    {checkpoint?.state === 'ready' && (confirming ? <>
      <button type="button" disabled={busy} onClick={onConfirm}>Confirm Undo</button>
      <button type="button" disabled={busy} onClick={onDismiss}>Keep changes</button>
    </> : <button type="button" disabled={busy} title={CHECKPOINT_SCOPE} onClick={onAsk}>Undo this turn</button>)}
  </div>;
}
