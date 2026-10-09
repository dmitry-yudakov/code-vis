import type { PermissionGate, PermissionResolution } from '@/shared/types';

interface PendingRequest {
  settle(resolution: PermissionResolution): void;
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * Holds the agent-mode permission requests a run is waiting on. The runner registers each one and
 * the `/api/agent/permission` route resolves it. Zero disables expiry; a positive timeout expires
 * unanswered requests. Cancelling a run settles everything pending before the child is terminated.
 */
export class PermissionBroker implements PermissionGate {
  private readonly pending = new Map<string, PendingRequest>();
  private closed = false;

  constructor(private readonly approvalTimeoutMs: number) {}

  get pendingCount(): number {
    return this.pending.size;
  }

  request(requestId: string, settle: (resolution: PermissionResolution) => void): void {
    if (this.closed || this.pending.has(requestId)) {
      settle('cancelled');
      return;
    }
    const timer = this.approvalTimeoutMs > 0
      ? setTimeout(() => this.finish(requestId, 'timeout'), this.approvalTimeoutMs) : undefined;
    timer?.unref?.();
    this.pending.set(requestId, { settle, timer });
  }

  /** Returns false when the request is unknown — already answered, expired, or never issued. */
  decide(requestId: string, decision: 'allow' | 'deny'): boolean {
    return this.finish(requestId, decision);
  }

  /** Close one provider callback without closing other requests or the run's broker. */
  cancel(requestId: string): void {
    this.finish(requestId, 'cancelled');
  }

  cancelAll(): void {
    this.closed = true;
    for (const requestId of [...this.pending.keys()]) this.finish(requestId, 'cancelled');
  }

  private finish(requestId: string, resolution: PermissionResolution): boolean {
    const entry = this.pending.get(requestId);
    if (!entry) return false;
    if (entry.timer) clearTimeout(entry.timer);
    this.pending.delete(requestId);
    entry.settle(resolution);
    return true;
  }
}
