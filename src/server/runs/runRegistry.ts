import type { AgentEvent, RunDescriptor, RunDiscovery } from '@/shared/types';
import type { PermissionBroker } from './permissionBroker';

export type PermissionDecisionOutcome = 'accepted' | 'unknown-run' | 'unknown-request';

/** How long a finished run stays directly replayable after its result becomes canonical. */
const RETENTION_MS = 300_000;
export const MAX_CONCURRENT_RUNS = 1;
/** Replay bound. Tool activity and status are droppable; permissions and errors never are. */
const MAX_TRANSCRIPT = 1_000;
const DROPPABLE = new Set(['tool-activity', 'status']);

interface RunRecord extends RunDescriptor {
  cancel(): void;
  permissions?: PermissionBroker;
  /** Every event except assistant-delta, which is accumulated into `deltaText` instead. */
  transcript: AgentEvent[];
  deltaText: string;
  subscriber?: (event: AgentEvent) => void;
  finishedAt?: number;
}

export interface RunAttachment {
  runId: string;
  replay: AgentEvent[];
  finished: boolean;
}

/**
 * Owns the lifetime of agent runs, deliberately decoupled from the HTTP request that started one.
 * A browser that reloads mid-run would otherwise kill the child process — losing work the user has
 * already approved — so a disconnect only detaches the stream. Runs end on completion, their own
 * timeout, or an explicit cancel.
 */
export class RunRegistry {
  private readonly liveByRunId = new Map<string, RunRecord>();
  private readonly recentByRunId = new Map<string, RunRecord>();

  /** Returns false when another turn is already running; only one runs at a time. */
  start(input: { runId: string; threadId: string; participantId: string; cancel(): void }): boolean {
    this.evictExpired();
    if (this.liveByRunId.size >= MAX_CONCURRENT_RUNS) return false;
    this.liveByRunId.set(input.runId, {
      ...input,
      startedAt: Date.now(),
      transcript: [],
      deltaText: '',
    });
    return true;
  }

  attachPermissions(runId: string, permissions: PermissionBroker): void {
    const run = this.liveByRunId.get(runId);
    if (run) run.permissions = permissions;
  }

  /** Buffers an event for replay and forwards it to the attached stream, if any. */
  record(runId: string, event: AgentEvent): void {
    const run = this.liveByRunId.get(runId);
    if (run) {
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
    run?.subscriber?.(event);
  }

  /** Attaches a stream directly to a live or retained run, replaying what it has missed. */
  subscribe(runId: string, subscriber: (event: AgentEvent) => void): RunAttachment | undefined {
    this.evictExpired();
    const run = this.liveByRunId.get(runId) || this.recentByRunId.get(runId);
    if (!run) return undefined;
    run.subscriber = subscriber;
    const replay = [...run.transcript];
    if (run.deltaText) replay.push({ type: 'assistant-delta', runId: run.runId, delta: run.deltaText });
    return { runId: run.runId, replay, finished: Boolean(run.finishedAt) };
  }

  unsubscribe(runId: string): void {
    const run = this.liveByRunId.get(runId) || this.recentByRunId.get(runId);
    if (run) run.subscriber = undefined;
  }

  decide(runId: string, requestId: string, decision: 'allow' | 'deny'): PermissionDecisionOutcome {
    const run = this.liveByRunId.get(runId);
    if (!run?.permissions) return 'unknown-run';
    return run.permissions.decide(requestId, decision) ? 'accepted' : 'unknown-request';
  }

  cancel(runId: string): boolean {
    const run = this.liveByRunId.get(runId);
    if (!run) return false;
    run.cancel();
    return true;
  }

  /** Frees the slot for the next turn while keeping the record reattachable for a while. */
  finish(runId: string): void {
    const run = this.liveByRunId.get(runId);
    if (!run) return;
    run.finishedAt = Date.now();
    run.subscriber = undefined;
    this.liveByRunId.delete(runId);
    this.recentByRunId.set(runId, run);
    this.evictExpired();
  }

  list(threadId?: string): RunDiscovery {
    this.evictExpired();
    const descriptors = (runs: Iterable<RunRecord>) => [...runs]
      .filter((run) => !threadId || run.threadId === threadId)
      .map((run) => this.descriptor(run));
    return {
      active: descriptors(this.liveByRunId.values()),
      recent: descriptors(this.recentByRunId.values()),
    };
  }

  get currentRuns(): readonly RunDescriptor[] {
    return this.list().active;
  }

  private descriptor(run: RunRecord): RunDescriptor {
    return {
      runId: run.runId,
      threadId: run.threadId,
      participantId: run.participantId,
      startedAt: run.startedAt,
      ...(run.finishedAt === undefined ? {} : { finishedAt: run.finishedAt }),
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
 * route its own registry — approvals would 404 and reattach would never find a run.
 */
const globalScope = globalThis as typeof globalThis & { __codeAiWeb2RunRegistry?: RunRegistry };
export const runRegistry = (globalScope.__codeAiWeb2RunRegistry ??= new RunRegistry());
