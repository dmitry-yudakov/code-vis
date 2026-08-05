export class RunRegistry {
  private active?: { runId: string; threadId: string };

  acquire(runId: string, threadId: string): boolean {
    if (this.active) return false;
    this.active = { runId, threadId };
    return true;
  }

  release(runId: string): void {
    if (this.active?.runId === runId) this.active = undefined;
  }

  get current(): Readonly<{ runId: string; threadId: string }> | undefined {
    return this.active;
  }
}

export const runRegistry = new RunRegistry();
