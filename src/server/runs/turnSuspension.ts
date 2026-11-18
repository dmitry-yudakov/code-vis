import type { AgentProcessEvent } from '@/shared/types';
export const MAINTENANCE_SUSPENSION = 'codeai-maintenance-suspension';

export interface ContinuationProgress {
  attempt: number;
  spentMs: number;
  usedTurns: number;
  continuation: boolean;
}

export class TurnSuspended extends Error {
  constructor(public readonly progress: ContinuationProgress) {
    super('Suspended for CodeAI restart.');
  }
}

/** Deferred interruption, followed by the runner's ordinary process/descendant cleanup.
 * Provider events do not gate subsequent tools: this is not a provider-side atomic pause. */
export class TurnSuspension {
  private readonly controller = new AbortController();
  private readonly tools = new Map<string, string>();
  private readonly permissions = new Map<string, string | undefined>();
  private boundary = true;
  requested = false;
  get signal(): AbortSignal { return this.controller.signal; }

  request(): void {
    this.requested = true;
    this.stopAtBoundary();
  }

  betweenAttempts(): void { this.tools.clear(); this.boundary = true; this.stopAtBoundary(); }
  running(): void { this.boundary = false; }

  observe(event: AgentProcessEvent): void {
    if (event.type === 'turn-started' || event.type === 'phase' && event.phase === 'thinking') this.boundary = false;
    if (event.type === 'response-boundary') this.boundary = !event.responseFinal;
    if (event.type === 'permission-request' && event.requestId) this.permissions.set(event.requestId, event.toolKey);
    if (event.type === 'permission-resolved' && event.requestId) this.permissions.delete(event.requestId);
    if (event.type === 'history' && event.activity?.kind === 'tool') {
      if (event.activity.status === 'running') this.tools.set(event.activity.key, event.activity.tool);
      else this.tools.delete(event.activity.key);
    }
    this.stopAtBoundary();
  }

  private stopAtBoundary(): void {
    const waiting = new Set(this.permissions.values());
    const executing = [...this.tools].some(([key, tool]) => !waiting.has(key) && !['Agent', 'Task', 'Subagent'].includes(tool));
    if (this.requested && (this.permissions.size && !executing || this.boundary && !this.tools.size)) this.controller.abort(MAINTENANCE_SUSPENSION);
  }
}
