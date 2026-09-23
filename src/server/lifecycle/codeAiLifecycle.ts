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
 * process, and answers the parent's lease requests. Nothing here is durable: a new server starts
 * with an empty scheduler, no lease, and the last outcome its parent hands it.
 */
export class CodeAiLifecycle {
  private state: AvailableLifecycleSnapshot;

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
    const admission = this.lease.acquireMaintenance();
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
      this.lease.releaseMaintenance();
      return { accepted: false, reason: 'not-managed' };
    }
    return { accepted: true, snapshot: this.state };
  }

  private receive(raw: unknown): void {
    const parsed = parentLifecycleMessageSchema.safeParse(raw);
    if (!parsed.success) return;
    const message = parsed.data;
    if (message.type === 'lifecycle-state') this.state = message.snapshot;
    else if (message.type === 'lifecycle-lease' && message.request === 'release') this.lease.releaseMaintenance();
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
