import type { AgentEvent } from '@/lib/shared/types';
import type { PermissionBroker } from './permissionBroker';

export type PermissionDecisionOutcome = 'accepted' | 'unknown-run' | 'unknown-request';

/** How long a finished run stays reattachable, so a reloading browser can still collect its result. */
const RETENTION_MS = 300_000;
/** Replay bound. Tool activity and status are droppable; permissions and errors never are. */
const MAX_TRANSCRIPT = 1_000;
const DROPPABLE = new Set(['tool-activity', 'status']);

interface RunRecord {
  runId: string;
  threadId: string;
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
  private active?: RunRecord;
  private readonly recent = new Map<string, RunRecord>();

  /** Returns false when another turn is already running; only one runs at a time. */
  start(input: { runId: string; threadId: string; cancel(): void }): boolean {
    if (this.active) return false;
    this.recent.delete(input.threadId);
    this.active = { ...input, transcript: [], deltaText: '' };
    return true;
  }

  attachPermissions(runId: string, permissions: PermissionBroker): void {
    if (this.active?.runId === runId) this.active.permissions = permissions;
  }

  /** Buffers an event for replay and forwards it to the attached stream, if any. */
  record(runId: string, event: AgentEvent): void {
    const run = this.active?.runId === runId ? this.active : undefined;
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

  /** Attaches a stream to this thread's run, replaying what it has missed. */
  subscribe(threadId: string, subscriber: (event: AgentEvent) => void): RunAttachment | undefined {
    const run = this.active?.threadId === threadId ? this.active : this.liveRecent(threadId);
    if (!run) return undefined;
    run.subscriber = subscriber;
    const replay = [...run.transcript];
    if (run.deltaText) replay.push({ type: 'assistant-delta', runId: run.runId, delta: run.deltaText });
    return { runId: run.runId, replay, finished: Boolean(run.finishedAt) };
  }

  unsubscribe(runId: string): void {
    if (this.active?.runId === runId) this.active.subscriber = undefined;
    for (const run of this.recent.values()) if (run.runId === runId) run.subscriber = undefined;
  }

  decide(runId: string, requestId: string, decision: 'allow' | 'deny'): PermissionDecisionOutcome {
    if (this.active?.runId !== runId || !this.active.permissions) return 'unknown-run';
    return this.active.permissions.decide(requestId, decision) ? 'accepted' : 'unknown-request';
  }

  cancel(runId: string): boolean {
    if (this.active?.runId !== runId) return false;
    this.active.cancel();
    return true;
  }

  /** Frees the slot for the next turn while keeping the record reattachable for a while. */
  finish(runId: string): void {
    if (this.active?.runId !== runId) return;
    const run = this.active;
    run.finishedAt = Date.now();
    run.subscriber = undefined;
    this.recent.set(run.threadId, run);
    this.active = undefined;
    this.evictExpired();
  }

  get current(): Readonly<{ runId: string; threadId: string }> | undefined {
    return this.active && { runId: this.active.runId, threadId: this.active.threadId };
  }

  private liveRecent(threadId: string): RunRecord | undefined {
    this.evictExpired();
    return this.recent.get(threadId);
  }

  private evictExpired(): void {
    const cutoff = Date.now() - RETENTION_MS;
    for (const [threadId, run] of this.recent) {
      if ((run.finishedAt ?? 0) < cutoff) this.recent.delete(threadId);
    }
  }
}

/**
 * Route handlers are compiled as separate bundles, so a plain module-level singleton gives each
 * route its own registry — approvals would 404 and reattach would never find a run.
 */
const globalScope = globalThis as typeof globalThis & { __codeAiWeb2RunRegistry?: RunRegistry };
export const runRegistry = (globalScope.__codeAiWeb2RunRegistry ??= new RunRegistry());
