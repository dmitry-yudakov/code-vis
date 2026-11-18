import { randomUUID } from 'node:crypto';
import { runRegistry, type MaintenanceLease } from '@/server/runs/runRegistry';
import { parentLifecycleMessageSchema, type AvailableLifecycleSnapshot } from '@/shared/codeAiLifecycle';
import { managedBridge, type ManagedBridge } from './managedBridge';

export type LifecycleStart =
  | { accepted: true; snapshot: AvailableLifecycleSnapshot }
  | { accepted: false; reason: 'not-managed' | 'busy' | 'live-runs' };

/**
 * This server's side of the managed build-and-restart. The parent owns the operation; this mirrors
 * its status for the browser, holds the scheduler's maintenance lease while a build may end this
 * process, and answers the parent's lease requests. Planned continuations live in the separate
 * suspended-turn journal; this status mirror is reconstructed from the parent on startup.
 */
export class CodeAiLifecycle {
  private state: AvailableLifecycleSnapshot;
  private suspended = false;
  private drained = false;

  constructor(private readonly bridge: ManagedBridge, private readonly lease: MaintenanceLease) {
    const { releaseId, lastOperation } = bridge.init;
    this.state = { available: true, phase: 'idle', releaseId, ...(lastOperation ? { lastOperation } : {}) };
    bridge.listen((message) => this.receive(message));
  }

  /** Managed only while the parent's channel is live. */
  get managed(): boolean {
    return this.bridge.connected();
  }

  get releaseId(): string {
    return this.bridge.init.releaseId;
  }

  snapshot(): AvailableLifecycleSnapshot {
    return this.state;
  }

  /**
   * Admits one build-and-restart. The lease is the concurrency boundary: it is refused while any run
   * is live or another operation holds it, and it stays held until a build fails or this process ends.
   */
  start(): LifecycleStart {
    if (!this.managed) return { accepted: false, reason: 'not-managed' };
    if (this.state.phase === 'paused' && !this.drained) return { accepted: false, reason: 'busy' };
    if (this.state.phase !== 'idle' && this.state.phase !== 'paused') return { accepted: false, reason: 'busy' };
    const admission = this.state.phase === 'paused' && this.suspended ? 'acquired' : this.lease.acquireMaintenance();
    if (admission === 'live-runs' && this.lease.beginDrain && this.lease.drain) {
      const drain = this.lease.beginDrain();
      if (drain !== 'acquired') return { accepted: false, reason: drain === 'held' ? 'busy' : 'live-runs' };
      this.suspended = true;
      const operationId = randomUUID();
      this.state = { ...this.state, phase: 'suspending', operationId, startedAt: new Date().toISOString(), detail: undefined, retryable: undefined };
      void this.lease.drain().then(() => {
        this.drained = true;
        this.state = { ...this.state, phase: 'building' };
        this.bridge.send({ type: 'lifecycle-request', operationId, action: 'build-and-restart' });
      }).catch(() => {
        this.state = { ...this.state, phase: 'paused', retryable: false, detail: 'Restart preparation stopped. Work remains paused; check the server terminal before restarting.' };
        console.error('CodeAI could not finish saving suspended turns. No build was started. Restart recovery records were retained.');
      });
      return { accepted: true, snapshot: this.state };
    }
    if (admission !== 'acquired') return { accepted: false, reason: admission === 'held' ? 'busy' : 'live-runs' };
    const idle = this.state;
    const operationId = randomUUID();
    this.state = {
      available: true, phase: 'building', releaseId: idle.releaseId, operationId, startedAt: new Date().toISOString(),
      ...(idle.lastOperation ? { lastOperation: idle.lastOperation } : {}),
    };
    try {
      this.bridge.send({ type: 'lifecycle-request', operationId, action: 'build-and-restart' });
    } catch {
      this.state = idle;
      if (!this.suspended) this.lease.releaseMaintenance();
      else this.state = { ...idle, phase: 'paused', detail: 'The build could not start. Sessions remain suspended until CodeAI restarts.' };
      return { accepted: false, reason: 'not-managed' };
    }
    return { accepted: true, snapshot: this.state };
  }

  private receive(raw: unknown): void {
    const parsed = parentLifecycleMessageSchema.safeParse(raw);
    if (!parsed.success) return;
    const message = parsed.data;
    if (message.type === 'lifecycle-state') {
      this.state = this.suspended && message.snapshot.phase === 'idle' && message.snapshot.lastOperation?.outcome === 'build-failed'
        ? { ...message.snapshot, phase: 'paused', detail: 'The build failed. Sessions remain suspended; fix the build and retry or restart CodeAI from the terminal.' }
        : message.snapshot;
    }
    else if (message.type === 'lifecycle-lease' && message.request === 'release') {
      if (!this.suspended) this.lease.releaseMaintenance();
    }
    else if (message.type === 'lifecycle-lease') {
      // `kill -USR2`: the parent may stop this server only if no run is live and nothing else holds the lease.
      this.bridge.send({ type: 'lifecycle-lease', request: 'acquire', granted: this.lease.acquireMaintenance() === 'acquired' });
    }
  }
}

const globalScope = globalThis as typeof globalThis & { __codeAiLifecycle?: CodeAiLifecycle };

/**
 * The process-wide lifecycle, or undefined for a server `start:managed` did not start. Like the run
 * registry it lives on `globalThis`, because the instrumentation hook, which binds it before the
 * first request, and each route are separate bundles.
 */
export function getCodeAiLifecycle(): CodeAiLifecycle | undefined {
  if (globalScope.__codeAiLifecycle) return globalScope.__codeAiLifecycle;
  const bridge = managedBridge();
  if (!bridge || !parentLifecycleMessageSchema.safeParse(bridge.init).success) return undefined;
  return (globalScope.__codeAiLifecycle = new CodeAiLifecycle(bridge, runRegistry));
}
