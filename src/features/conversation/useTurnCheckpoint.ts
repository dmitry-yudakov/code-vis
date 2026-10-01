import { useCallback, useEffect, useRef, useState } from 'react';
import { checkpointSummarySchema, type CheckpointSummary } from '@/shared/turnCheckpoint';

export interface TurnCheckpointControls {
  checkpoint?: CheckpointSummary;
  busy: boolean;
  confirming: boolean;
  error?: string;
  onAsk(): void;
  onDismiss(): void;
  onConfirm(): void;
}

/** One owner for desktop and VR; requests and confirmations stay bound to the shown session. */
export function useTurnCheckpoint(input: {
  sessionId?: string; revision?: number; running: boolean; apiPath(path: string): string;
  onRestored(): void;
}): TurnCheckpointControls {
  const { sessionId, revision, running, apiPath, onRestored } = input;
  const key = sessionId ? apiPath(`/api/agent/checkpoint?sessionId=${encodeURIComponent(sessionId)}`) : '';
  const [state, setState] = useState<{ key: string; checkpoint?: CheckpointSummary; error?: string }>({ key: '' });
  const [confirmingId, setConfirmingId] = useState<string>();
  const [busyKey, setBusyKey] = useState<string>();
  const currentKey = useRef(key); currentKey.current = key;
  const inFlight = useRef(false);
  const undoKey = useRef<string | undefined>(undefined);
  const statusSequence = useRef(0);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!key || (inFlight.current && undoKey.current === key)) return;
    const sequence = ++statusSequence.current;
    try {
      const response = await fetch(key, { cache: 'no-store', signal });
      const data = await response.json() as { checkpoint?: unknown; error?: string };
      if (!response.ok) throw new Error(data.error || 'Could not read recovery status.');
      const checkpoint = data.checkpoint == null ? undefined : checkpointSummarySchema.parse(data.checkpoint);
      if (!signal?.aborted && currentKey.current === key && statusSequence.current === sequence) setState({ key, checkpoint });
    } catch (error) {
      if (!signal?.aborted && currentKey.current === key && statusSequence.current === sequence) setState({ key, error: error instanceof Error ? error.message : 'Could not read recovery status.' });
    }
  }, [key]);
  useEffect(() => {
    setConfirmingId(undefined);
    const controller = new AbortController();
    void refresh(controller.signal);
    const focus = () => { void refresh(controller.signal); };
    window.addEventListener('focus', focus);
    return () => { controller.abort(); window.removeEventListener('focus', focus); };
  }, [refresh, revision, running]);
  const checkpoint = state.key === key ? state.checkpoint : undefined;
  const busy = running || busyKey !== undefined;
  const confirm = () => {
    if (!sessionId || !checkpoint || checkpoint.state !== 'ready' || busy || inFlight.current || confirmingId !== checkpoint.id) return;
    inFlight.current = true; undoKey.current = key; statusSequence.current++; setBusyKey(key); setConfirmingId(undefined);
    void (async () => {
      try {
        const response = await fetch(apiPath('/api/agent/undo'), { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, checkpointId: checkpoint.id }),
        });
        const data = await response.json() as { checkpoint?: unknown; error?: string };
        if (!response.ok) throw new Error(data.error || 'Undo could not be completed.');
        const restored = checkpointSummarySchema.parse(data.checkpoint);
        if (currentKey.current === key) { setState({ key, checkpoint: restored }); onRestored(); }
      } catch (error) {
        inFlight.current = false;
        if (currentKey.current === key) {
          await refresh();
          setState((current) => current.key === key ? { ...current, error: error instanceof Error ? error.message : 'Undo could not be completed.' } : current);
        }
      } finally { inFlight.current = false; undoKey.current = undefined; setBusyKey(undefined); }
    })();
  };
  return {
    checkpoint, busy, confirming: checkpoint?.id === confirmingId && checkpoint?.state === 'ready' && !busy,
    error: state.key === key ? state.error : undefined,
    onAsk: () => { if (checkpoint?.state === 'ready' && !busy) setConfirmingId(checkpoint.id); },
    onDismiss: () => setConfirmingId(undefined), onConfirm: confirm,
  };
}
