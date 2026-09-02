import { getConfig } from '@/server/config';
import type { AgentEvent, RunDescriptor, RunDiscovery, RunState } from '@/shared/types';
import type { PermissionBroker } from './permissionBroker';

export type PermissionDecisionOutcome = 'accepted' | 'unknown-run' | 'unknown-request';
export type RunCancelOutcome = 'accepted' | 'unknown-run' | 'failed';
export type RunAccess = 'read' | 'write';

/** How long a finished run stays directly replayable after its result becomes canonical. */
const RETENTION_MS = 300_000;
export const MAX_QUEUED_RUNS = 32;
/** Replay bound. Tool activity and status are droppable; permissions and errors never are. */
const MAX_TRANSCRIPT = 1_000;
const DROPPABLE = new Set(['tool-activity', 'status']);

interface RunRecord {
  runId: string;
  sessionId: string;
  participantId: string;
  providerKey: string;
  checkoutId: string;
  access: RunAccess;
  state: RunState;
  enqueuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  activated: boolean;
  cancelling: boolean;
  cancelBlocked: boolean;
  cancelPromise?: Promise<RunCancelOutcome>;
  cancel(): void;
  cancelQueued?(): Promise<void>;
  execute?(): Promise<void>;
  permissions?: PermissionBroker;
  pendingPermissionIds: Set<string>;
  /** Every event except assistant-delta, which is accumulated into `deltaText` instead. */
  transcript: AgentEvent[];
  deltaText: string;
  subscribers: Map<string, (event: AgentEvent) => void>;
  lastQueuePosition?: number;
  completion: Promise<void>;
  resolveCompletion(): void;
}

export interface RunAttachment {
  runId: string;
  attachmentId: string;
  replay: AgentEvent[];
  finished: boolean;
}

export type RunReservation =
  | { accepted: true; runId: string }
  | { accepted: false; reason: 'queue-full' }
  | { accepted: false; reason: 'session-conflict' | 'provider-conflict'; activeRun: RunDescriptor };

export interface ReserveRunInput {
  runId: string;
  sessionId: string;
  participantId: string;
  providerKey: string;
  checkoutId: string;
  access: RunAccess;
  cancel(): void;
}

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => { resolve = complete; });
  return { promise, resolve };
}

/**
 * Owns machine-local admission, checkout locks, and the lifetime of agent runs. A browser that
 * reloads mid-run only detaches its stream; provider execution and queued work continue here.
 */
export class RunRegistry {
  private readonly liveByRunId = new Map<string, RunRecord>();
  private readonly recentByRunId = new Map<string, RunRecord>();
  private readonly queue: string[] = [];

  constructor(private readonly maxConcurrentRuns = 2) {
    if (!Number.isSafeInteger(maxConcurrentRuns) || maxConcurrentRuns < 1 || maxConcurrentRuns > 8) {
      throw new Error('maxConcurrentRuns must be an integer between 1 and 8');
    }
  }

  /**
   * Atomically claims the session/provider identity before the durable message append. Reserved
   * records are not discoverable or runnable until `activate` confirms that append succeeded.
   */
  reserve(input: ReserveRunInput): RunReservation {
    this.evictExpired();
    const sessionConflict = [...this.liveByRunId.values()].find((run) => run.sessionId === input.sessionId);
    if (sessionConflict) {
      return { accepted: false, reason: 'session-conflict', activeRun: this.descriptor(sessionConflict) };
    }
    const providerConflict = [...this.liveByRunId.values()].find((run) => run.providerKey === input.providerKey);
    if (providerConflict) {
      return { accepted: false, reason: 'provider-conflict', activeRun: this.descriptor(providerConflict) };
    }
    // Reserved records are already waiting work even before their canonical append finishes. Count
    // them with activated queue entries instead of inferring the queue from machine capacity: a
    // checkout lock can leave capacity idle while all 32 waiting places are still occupied.
    const waiting = [...this.liveByRunId.values()].filter((run) => run.state === 'queued').length;
    if (waiting >= MAX_QUEUED_RUNS) return { accepted: false, reason: 'queue-full' };

    const completion = deferred();
    this.liveByRunId.set(input.runId, {
      ...input,
      state: 'queued',
      enqueuedAt: Date.now(),
      activated: false,
      cancelling: false,
      cancelBlocked: false,
      pendingPermissionIds: new Set(),
      transcript: [],
      deltaText: '',
      subscribers: new Map(),
      completion: completion.promise,
      resolveCompletion: completion.resolve,
    });
    return { accepted: true, runId: input.runId };
  }

  /** Makes a successfully appended reservation runnable and schedules it when eligible. */
  activate(runId: string, input: { execute(): Promise<void>; cancelQueued(): Promise<void> }): boolean {
    const run = this.liveByRunId.get(runId);
    if (!run || run.activated) return false;
    run.activated = true;
    run.execute = input.execute;
    run.cancelQueued = input.cancelQueued;
    this.queue.push(runId);
    this.schedule();
    return true;
  }

  /** Releases a reservation whose canonical append failed. */
  release(runId: string): boolean {
    const run = this.liveByRunId.get(runId);
    if (!run || run.activated) return false;
    this.liveByRunId.delete(runId);
    run.resolveCompletion();
    return true;
  }

  /**
   * Compatibility helper for focused registry/route tests. It starts immediately and never queues;
   * production admission uses reserve/activate so canonical persistence brackets the scheduler.
   */
  start(input: {
    runId: string;
    sessionId: string;
    participantId: string;
    cancel(): void;
    providerKey?: string;
    checkoutId?: string;
    access?: RunAccess;
  }): boolean {
    if (this.runningCount() >= this.maxConcurrentRuns) return false;
    const completion = deferred();
    const now = Date.now();
    this.liveByRunId.set(input.runId, {
      ...input,
      providerKey: input.providerKey || `legacy:${input.participantId}:${input.runId}`,
      checkoutId: input.checkoutId || `legacy:${input.runId}`,
      access: input.access || 'read',
      state: 'running',
      enqueuedAt: now,
      startedAt: now,
      activated: true,
      cancelling: false,
      cancelBlocked: false,
      pendingPermissionIds: new Set(),
      transcript: [],
      deltaText: '',
      subscribers: new Map(),
      completion: completion.promise,
      resolveCompletion: completion.resolve,
    });
    return true;
  }

  attachPermissions(runId: string, permissions: PermissionBroker): void {
    const run = this.liveByRunId.get(runId);
    if (run) run.permissions = permissions;
  }

  /** Buffers an event for replay, updates lifecycle state, and forwards it to the attached stream. */
  record(runId: string, event: AgentEvent): void {
    const run = this.liveByRunId.get(runId);
    if (run) {
      if (event.type === 'permission-request') {
        run.pendingPermissionIds.add(event.requestId);
        if (run.state === 'running') run.state = 'needs-you';
      } else if (event.type === 'permission-resolved') {
        run.pendingPermissionIds.delete(event.requestId);
        if (run.state === 'needs-you' && !run.pendingPermissionIds.size) run.state = 'running';
      }
      if (event.type === 'assistant-delta') {
        run.deltaText += event.delta;
      } else {
        run.transcript.push(event);
        if (run.transcript.length > MAX_TRANSCRIPT) {
          const index = run.transcript.findIndex((item) => DROPPABLE.has(item.type));
          run.transcript.splice(index < 0 ? 0 : index, 1);
        }
      }
    }
    for (const subscriber of run?.subscribers.values() || []) {
      try { subscriber(event); } catch { /* a broken attachment must not starve the others */ }
    }
  }

  /** Attaches a stream directly to a live or retained run, replaying what it has missed. */
  subscribe(runId: string, subscriber: (event: AgentEvent) => void): RunAttachment | undefined {
    this.evictExpired();
    const run = this.liveByRunId.get(runId) || this.recentByRunId.get(runId);
    if (!run || !run.activated) return undefined;
    const attachmentId = crypto.randomUUID();
    run.subscribers.set(attachmentId, subscriber);
    const replay = [...run.transcript];
    if (run.deltaText) replay.push({ type: 'assistant-delta', runId: run.runId, delta: run.deltaText });
    return { runId: run.runId, attachmentId, replay, finished: Boolean(run.finishedAt) };
  }

  unsubscribe(runId: string, attachmentId: string): void {
    const run = this.liveByRunId.get(runId) || this.recentByRunId.get(runId);
    run?.subscribers.delete(attachmentId);
  }

  wait(runId: string): Promise<void> | undefined {
    return (this.liveByRunId.get(runId) || this.recentByRunId.get(runId))?.completion;
  }

  decide(runId: string, requestId: string, decision: 'allow' | 'deny'): PermissionDecisionOutcome {
    const run = this.liveByRunId.get(runId);
    if (!run?.permissions) return 'unknown-run';
    return run.permissions.decide(requestId, decision) ? 'accepted' : 'unknown-request';
  }

  async cancel(runId: string): Promise<RunCancelOutcome> {
    const run = this.liveByRunId.get(runId);
    if (!run) return 'unknown-run';
    if (run.cancelPromise) return run.cancelPromise;
    if (run.state !== 'queued') {
      run.cancel();
      return 'accepted';
    }
    if (!run.activated || !run.cancelQueued) return 'unknown-run';
    run.cancelling = true;
    run.cancelBlocked = false;
    const cancellation = run.cancelQueued()
      .then((): RunCancelOutcome => {
        this.finish(runId);
        return 'accepted';
      })
      .catch((): RunCancelOutcome => {
        const current = this.liveByRunId.get(runId);
        if (current === run) {
          // The canonical message still says `sending`, so do not publish a false terminal event or
          // let the provider start. Leave the original queue entry parked for an explicit retry,
          // but do not let that parked entry hold the checkout execution lock.
          run.cancelling = false;
          run.cancelBlocked = true;
          run.cancelPromise = undefined;
          this.emitQueuePositions();
          const position = this.queue.indexOf(runId) + 1;
          this.record(runId, {
            type: 'status',
            runId,
            phase: 'queued',
            label: `Queued · position ${position} · cancellation must be retried`,
          });
          this.schedule();
        }
        return 'failed';
      });
    run.cancelPromise = cancellation;
    return cancellation;
  }

  /** Frees a machine slot while keeping the record reattachable for a while. */
  finish(runId: string): void {
    const run = this.liveByRunId.get(runId);
    if (!run) return;
    const index = this.queue.indexOf(runId);
    if (index >= 0) this.queue.splice(index, 1);
    run.state = 'finished';
    run.finishedAt = Date.now();
    run.pendingPermissionIds.clear();
    run.subscribers.clear();
    this.liveByRunId.delete(runId);
    this.recentByRunId.set(runId, run);
    run.resolveCompletion();
    this.evictExpired();
    this.schedule();
  }

  list(sessionId?: string): RunDiscovery {
    this.evictExpired();
    const descriptors = (runs: Iterable<RunRecord>) => [...runs]
      .filter((run) => run.activated && (!sessionId || run.sessionId === sessionId))
      .map((run) => this.descriptor(run));
    return {
      active: descriptors(this.liveByRunId.values()),
      recent: descriptors(this.recentByRunId.values()),
    };
  }

  get currentRuns(): readonly RunDescriptor[] {
    return this.list().active;
  }

  private runningCount(): number {
    return [...this.liveByRunId.values()].filter((run) => (
      run.activated && (run.state === 'running' || run.state === 'needs-you')
    )).length;
  }

  private eligible(candidate: RunRecord): boolean {
    const running = [...this.liveByRunId.values()].filter((run) => (
      run.runId !== candidate.runId && (run.state === 'running' || run.state === 'needs-you')
    ));
    if (candidate.access === 'write') {
      return !running.some((run) => run.checkoutId === candidate.checkoutId);
    }
    if (running.some((run) => run.checkoutId === candidate.checkoutId && run.access === 'write')) return false;
    // Once a writer waits, later readers on that checkout wait behind it instead of starving it.
    const candidateIndex = this.queue.indexOf(candidate.runId);
    return !this.queue.slice(0, candidateIndex).some((runId) => {
      const earlier = this.liveByRunId.get(runId);
      return earlier?.checkoutId === candidate.checkoutId
        && earlier.access === 'write'
        && !earlier.cancelBlocked;
    });
  }

  private schedule(): void {
    const starting: RunRecord[] = [];
    while (this.runningCount() < this.maxConcurrentRuns) {
      const index = this.queue.findIndex((runId) => {
        const run = this.liveByRunId.get(runId);
        return Boolean(run?.activated && !run.cancelling && !run.cancelBlocked && run.execute && this.eligible(run));
      });
      if (index < 0) break;
      const [runId] = this.queue.splice(index, 1);
      const run = this.liveByRunId.get(runId);
      if (!run?.execute) continue;
      run.state = 'running';
      run.startedAt = Date.now();
      run.lastQueuePosition = undefined;
      starting.push(run);
    }
    this.emitQueuePositions();
    for (const run of starting) {
      void Promise.resolve()
        .then(() => run.execute!())
        .catch(() => undefined)
        .finally(() => this.finish(run.runId));
    }
  }

  private emitQueuePositions(): void {
    this.queue.forEach((runId, index) => {
      const run = this.liveByRunId.get(runId);
      if (!run || run.cancelling) return;
      const position = index + 1;
      if (run.lastQueuePosition === position) return;
      run.lastQueuePosition = position;
      this.record(runId, {
        type: 'status',
        runId,
        phase: 'queued',
        label: run.cancelBlocked
          ? `Queued · position ${position} · cancellation must be retried`
          : `Queued · position ${position}`,
      });
    });
  }

  private descriptor(run: RunRecord): RunDescriptor {
    const queuePosition = run.state === 'queued' ? this.queue.indexOf(run.runId) + 1 : undefined;
    return {
      runId: run.runId,
      sessionId: run.sessionId,
      participantId: run.participantId,
      state: run.state,
      enqueuedAt: run.enqueuedAt,
      ...(run.startedAt === undefined ? {} : { startedAt: run.startedAt }),
      ...(run.finishedAt === undefined ? {} : { finishedAt: run.finishedAt }),
      ...(queuePosition && queuePosition > 0 ? { queuePosition } : {}),
      pendingPermissionCount: run.pendingPermissionIds.size,
    };
  }

  private evictExpired(): void {
    const cutoff = Date.now() - RETENTION_MS;
    for (const [runId, run] of this.recentByRunId) {
      if ((run.finishedAt ?? 0) < cutoff) this.recentByRunId.delete(runId);
    }
  }
}

/**
 * Route handlers are compiled as separate bundles, so a plain module-level singleton gives each
 * route its own registry — approvals, queued promotion, and reattach would otherwise diverge.
 */
const globalScope = globalThis as typeof globalThis & { __codeAiWeb2RunRegistry?: RunRegistry };
export const runRegistry = (globalScope.__codeAiWeb2RunRegistry ??= new RunRegistry(getConfig().maxConcurrentRuns));
