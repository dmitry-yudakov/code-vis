import type { AgentMode } from '@/shared/types';

/** A mode change interrupts only the current provider attempt, never the whole user turn. */
export class TurnMode {
  private attempt?: AbortController;
  private closed = false;

  constructor(public mode: AgentMode) {}

  change(mode: AgentMode): boolean {
    if (this.closed) return false;
    if (mode !== this.mode) {
      this.mode = mode;
      this.attempt?.abort();
    }
    return true;
  }

  begin(): { mode: AgentMode; signal: AbortSignal } {
    this.attempt = new AbortController();
    return { mode: this.mode, signal: this.attempt.signal };
  }

  close(): void {
    this.closed = true;
    this.attempt = undefined;
  }
}
