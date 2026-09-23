import type {
  AvailableLifecycleSnapshot, CodeAiLifecycleOperation, CodeAiLifecycleSnapshot,
} from '@/shared/codeAiLifecycle';

/**
 * The browser's side of Build & restart, shared by the flat More menu and the headset's CodeAI
 * section: confirm → building → restarting → reconnect → outcome. Pure, so it is tested without a
 * component environment; `useCodeAiLifecycle` performs the requests and the reload it asks for.
 */

/** The operation this view follows, whether it started it or found it running. */
export interface LifecycleWatch {
  operationId: string;
  formerReleaseId: string;
  /** The server announced the restart. */
  restarting: boolean;
  /** Requests failed since the last answer: the server may be gone. */
  failures: number;
  unreachableSince?: number;
}

export interface LifecycleFlow {
  snapshot?: CodeAiLifecycleSnapshot;
  confirming: boolean;
  submitting: boolean;
  watch?: LifecycleWatch;
  /** The operation ended on a server this page was not loaded from; reload for its canonical state. */
  reload: boolean;
  error?: string;
}

export type LifecycleEvent =
  | { type: 'ask' }
  | { type: 'dismiss' }
  | { type: 'confirm' }
  | { type: 'accepted'; snapshot: AvailableLifecycleSnapshot }
  | { type: 'rejected'; message: string }
  | { type: 'snapshot'; snapshot: CodeAiLifecycleSnapshot }
  | { type: 'unreachable'; at: number };

export const INITIAL_LIFECYCLE: LifecycleFlow = { confirming: false, submitting: false, reload: false };
/** How long a view waits for CodeAI to come back before it stops and points at the terminal. */
export const RECONNECT_LIMIT_MS = 5 * 60_000;
const BUILD_POLL_MS = 2_000;
const RECONNECT_POLL_MS = { first: 1_000, factor: 1.5, max: 5_000 };

function canRequest(flow: LifecycleFlow): boolean {
  return flow.snapshot?.available === true && flow.snapshot.phase === 'idle' && !flow.watch && !flow.submitting;
}

function watchFor(snapshot: AvailableLifecycleSnapshot): LifecycleWatch | undefined {
  return snapshot.phase !== 'idle' && snapshot.operationId ? {
    operationId: snapshot.operationId, formerReleaseId: snapshot.releaseId,
    restarting: snapshot.phase === 'restarting', failures: 0,
  } : undefined;
}

/** The server that loaded this page may be gone: it announced a restart, or stopped answering. */
const serverMayBeGone = (watch: LifecycleWatch) => watch.restarting || watch.failures > 0;

/** Applies what the server answered to the operation being followed. A new answer replaces any error. */
function observe(flow: LifecycleFlow, snapshot: CodeAiLifecycleSnapshot): LifecycleFlow {
  const answered = { ...flow, snapshot, error: undefined };
  if (!snapshot.available) {
    // A server that answers after the old one went away is new, whatever it offers.
    const reload = Boolean(flow.watch && serverMayBeGone(flow.watch));
    return { ...answered, confirming: false, watch: undefined, reload: flow.reload || reload };
  }
  const watch = flow.watch || watchFor(snapshot);
  if (!watch) return answered;
  if (snapshot.phase !== 'idle') {
    return {
      ...answered,
      watch: { ...watch, restarting: watch.restarting || snapshot.phase === 'restarting', failures: 0, unreachableSince: undefined },
    };
  }
  // An idle answer ends the operation. Its recorded outcome says whether the page is still current;
  // without one, a server that may have been replaced, or a different release, means reload.
  const outcome = snapshot.lastOperation?.operationId === watch.operationId ? snapshot.lastOperation : undefined;
  const reload = outcome ? outcome.outcome !== 'build-failed' : serverMayBeGone(watch) || snapshot.releaseId !== watch.formerReleaseId;
  return { ...answered, watch: undefined, reload: flow.reload || reload };
}

export function lifecycleReducer(flow: LifecycleFlow, event: LifecycleEvent): LifecycleFlow {
  switch (event.type) {
    case 'ask':
      return canRequest(flow) ? { ...flow, confirming: true, error: undefined } : flow;
    case 'dismiss':
      return { ...flow, confirming: false };
    case 'confirm':
      return flow.confirming && canRequest(flow) ? { ...flow, confirming: false, submitting: true } : { ...flow, confirming: false };
    case 'accepted':
      return { ...flow, submitting: false, error: undefined, snapshot: event.snapshot, watch: watchFor(event.snapshot) };
    case 'rejected':
      return { ...flow, submitting: false, error: event.message };
    case 'snapshot':
      return observe(flow, event.snapshot);
    case 'unreachable': {
      if (!flow.watch) return flow;
      const since = flow.watch.unreachableSince ?? event.at;
      if (event.at - since > RECONNECT_LIMIT_MS) {
        return {
          ...flow, watch: undefined,
          error: 'CodeAI did not come back within five minutes. The terminal running start:managed says why.',
        };
      }
      return { ...flow, watch: { ...flow.watch, failures: flow.watch.failures + 1, unreachableSince: since } };
    }
  }
}

/** When to ask the server again, or undefined when nothing is being followed. */
export function lifecyclePollDelay(flow: LifecycleFlow): number | undefined {
  const { watch } = flow;
  if (!watch || flow.reload) return undefined;
  if (!serverMayBeGone(watch)) return BUILD_POLL_MS;
  const backoff = RECONNECT_POLL_MS.first * RECONNECT_POLL_MS.factor ** Math.max(0, watch.failures - 1);
  return Math.min(RECONNECT_POLL_MS.max, backoff);
}

function elapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

const OUTCOME_TEXT: Record<CodeAiLifecycleOperation['outcome'], string> = {
  succeeded: 'the new release is running',
  'build-failed': 'the build failed, so the release that was running kept serving',
  'rolled-back': 'the previous release is running again',
};

export interface LifecycleView {
  /** The control is shown only where this server can build and restart itself. */
  available: boolean;
  canRequest: boolean;
  /** Building or restarting: new agent turns wait. */
  busy: boolean;
  /** A few words for a header pill while busy. */
  badge?: string;
  status?: string;
}

export function lifecycleView(flow: LifecycleFlow, now: number): LifecycleView {
  const snapshot = flow.snapshot?.available ? flow.snapshot : undefined;
  const view = { available: Boolean(snapshot), canRequest: canRequest(flow), busy: Boolean(flow.watch || flow.submitting) };
  if (flow.reload) return { ...view, busy: true, badge: 'Reloading CodeAI', status: 'CodeAI is back. Reloading…' };
  if (flow.submitting) return { ...view, badge: 'Starting build', status: 'Starting the build…' };
  if (flow.watch && serverMayBeGone(flow.watch)) {
    return {
      ...view, badge: 'Restarting CodeAI',
      status: 'Restarting CodeAI. This page reloads when it is back; a VR session has to be entered again.',
    };
  }
  if (flow.watch && snapshot) {
    const time = elapsed(now - (snapshot.startedAt ? Date.parse(snapshot.startedAt) : now));
    return {
      ...view, badge: `Building CodeAI · ${time}`,
      status: `Building CodeAI · ${time}. The current release keeps serving; new agent turns wait until it restarts.`,
    };
  }
  if (flow.error) return { ...view, status: flow.error };
  if (!snapshot) return view;
  const last = snapshot.lastOperation;
  return {
    ...view,
    status: [
      `Serving release ${snapshot.releaseId}.`,
      last ? `Last build & restart, ${new Date(last.finishedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}: ${OUTCOME_TEXT[last.outcome]}.` : '',
      last?.detail || '',
    ].filter(Boolean).join(' '),
  };
}

/** The one warning both confirmations show. */
export function lifecycleConfirmation(checkoutName: string): string {
  return `Build and restart CodeAI from ${checkoutName}? This builds the checkout as it is now, uncommitted changes included, and runs it on this machine. CodeAI is unavailable while it restarts, and a VR session ends; enter VR again afterwards.`;
}
