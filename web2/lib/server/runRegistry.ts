import type { PermissionBroker } from './permissionBroker';

export type PermissionDecisionOutcome = 'accepted' | 'unknown-run' | 'unknown-request';

export class RunRegistry {
  private active?: { runId: string; threadId: string; permissions?: PermissionBroker };

  acquire(runId: string, threadId: string): boolean {
    if (this.active) return false;
    this.active = { runId, threadId };
    return true;
  }

  /** Publishes the broker so the permission endpoint can answer this run's requests. */
  attachPermissions(runId: string, permissions: PermissionBroker): void {
    if (this.active?.runId === runId) this.active.permissions = permissions;
  }

  decide(runId: string, requestId: string, decision: 'allow' | 'deny'): PermissionDecisionOutcome {
    if (this.active?.runId !== runId || !this.active.permissions) return 'unknown-run';
    return this.active.permissions.decide(requestId, decision) ? 'accepted' : 'unknown-request';
  }

  release(runId: string): void {
    if (this.active?.runId === runId) this.active = undefined;
  }

  get current(): Readonly<{ runId: string; threadId: string }> | undefined {
    return this.active;
  }
}

/**
 * Route handlers are compiled as separate bundles, so a plain module-level singleton gives
 * `/api/agent/message` and `/api/agent/permission` two different registries — every approval would
 * 404. The run registry is pure in-memory state shared by both, so it hangs off globalThis.
 */
const globalScope = globalThis as typeof globalThis & { __codeAiWeb2RunRegistry?: RunRegistry };
export const runRegistry = (globalScope.__codeAiWeb2RunRegistry ??= new RunRegistry());
