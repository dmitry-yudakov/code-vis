type Listener<T> = { receive(value: T): void; error(cause: unknown): void };
type Active<T> = {
  stop?: () => void; timer?: ReturnType<typeof setTimeout>; loading: boolean; dirty: boolean;
  value?: T; serialized?: string;
};

/** One source subscription and one coalesced snapshot build, shared by all consumers. */
export class SnapshotFeed<T> {
  private readonly listeners = new Set<Listener<T>>();
  private active?: Active<T>;

  constructor(
    private readonly load: () => Promise<T | undefined>,
    private readonly start: (invalidate: () => void, fail: (cause: unknown) => void) => (() => void) | Promise<() => void>,
  ) {}

  subscribe(receive: (value: T) => void, error: (cause: unknown) => void): () => void {
    const listener = { receive, error };
    this.listeners.add(listener);
    if (!this.active) {
      const active: Active<T> = this.active = { loading: false, dirty: false };
      // Install producers before taking the first snapshot. A change during a load marks it dirty.
      void Promise.resolve().then(() => this.active !== active ? () => undefined : this.start(
        () => { if (this.active === active) this.refresh(); },
        cause => { if (this.active === active) this.fail(cause); },
      ))
        .then(stop => {
          if (this.active !== active) { stop(); return; }
          active.stop = stop;
          this.refresh();
        }, cause => { if (this.active === active) this.fail(cause); });
    } else if (this.active.value !== undefined) this.deliver(listener, this.active.value);
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) this.stop();
    };
  }

  refresh(): void {
    const active = this.active;
    if (!active) return;
    active.dirty = true;
    if (active.loading || active.timer) return;
    active.timer = setTimeout(() => {
      active.timer = undefined;
      if (this.active !== active) return;
      active.dirty = false;
      active.loading = true;
      void this.load().then(value => {
        if (this.active !== active || value === undefined) return;
        const serialized = JSON.stringify(value);
        if (serialized === active.serialized) return;
        active.value = value;
        active.serialized = serialized;
        for (const listener of [...this.listeners]) this.deliver(listener, value);
      }).catch(cause => { if (this.active === active) this.fail(cause); }).finally(() => {
        active.loading = false;
        if (this.active === active && active.dirty) this.refresh();
      });
    }, 50);
    active.timer.unref?.();
  }

  private deliver(listener: Listener<T>, value: T): void {
    try { listener.receive(value); } catch (cause) {
      this.listeners.delete(listener);
      try { listener.error(cause); } catch { /* One consumer cannot starve others. */ }
      if (!this.listeners.size) this.stop();
    }
  }

  private fail(cause: unknown): void {
    const listeners = [...this.listeners];
    this.listeners.clear();
    this.stop();
    for (const listener of listeners) {
      try { listener.error(cause); } catch { /* Consumer teardown is independent. */ }
    }
  }

  private stop(): void {
    const active = this.active;
    this.active = undefined;
    if (active?.timer) clearTimeout(active.timer);
    active?.stop?.();
  }
}
