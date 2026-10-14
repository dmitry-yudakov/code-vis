import type { TurnRecord } from '@/shared/turnActivity';

/** One in-flight write plus one replaceable snapshot, regardless of provider/storage speed. */
export class TurnHistoryWriter {
  private pending?: TurnRecord;
  private writing?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private failed = false;
  constructor(private readonly save: (turn: TurnRecord) => Promise<unknown>, private readonly publish: (turn: TurnRecord) => void) {}

  set(turn: TurnRecord): void {
    this.pending = this.failed ? { ...turn, incomplete: true } : turn;
    if (!this.timer && !this.writing) {
      this.timer = setTimeout(() => { this.timer = undefined; void this.flush(); }, 1000);
      this.timer.unref?.();
    }
  }

  flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    if (this.writing) return this.writing;
    this.writing = this.drain().finally(() => { this.writing = undefined; });
    return this.writing;
  }

  private async drain(): Promise<void> {
    while (this.pending) {
      const snapshot = this.pending;
      this.pending = undefined;
      try {
        const saved: TurnRecord = { ...snapshot, history: 'saved', incomplete: snapshot.incomplete || this.failed };
        await this.save(saved);
        this.publish(saved);
      } catch {
        this.failed = true;
        this.publish({ ...snapshot, history: 'unsaved', incomplete: true });
      }
    }
  }

  async close(): Promise<void> { await this.flush(); }
}
