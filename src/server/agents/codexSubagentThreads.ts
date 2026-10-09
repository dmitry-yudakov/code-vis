type JsonRecord = Record<string, unknown>;

const MAX_THREADS = 64;
const MAX_DEPTH = 16;
const MAX_CLOSED_TURNS = 128;

function record(value: unknown): JsonRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : undefined;
}

export function codexThreadId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200;
}

interface ChildThread {
  parent?: string;
  nickname?: string;
  metadata?: Promise<void>;
  known: boolean;
  invalid: boolean;
  closed: boolean;
  verified: boolean;
  turn?: string;
  completed: Set<string>;
}

/** Per-run ancestry and live turns. Shared provider session IDs never grant membership. */
export class CodexSubagentThreads {
  private readonly threads = new Map<string, ChildThread>();

  constructor(
    private readonly root: string,
    private readonly read: (id: string) => Promise<unknown>,
    private readonly changed?: () => void,
  ) {}

  private entry(id: string): ChildThread | undefined {
    if (!codexThreadId(id) || id === this.root) return undefined;
    let entry = this.threads.get(id);
    if (!entry && this.threads.size < MAX_THREADS) {
      entry = { known: false, invalid: false, closed: false, verified: false, completed: new Set() };
      this.threads.set(id, entry);
    }
    return entry;
  }

  observe(value: unknown): void {
    const thread = record(value);
    if (!codexThreadId(thread?.id)) return;
    const entry = this.entry(thread.id);
    if (!entry) return;
    const source = record(record(record(thread.source)?.subAgent)?.thread_spawn);
    const current = thread.parentThreadId;
    const legacy = source?.parent_thread_id;
    const parent = current ?? legacy;
    if (!codexThreadId(parent) || parent === thread.id
      || (current != null && legacy != null && current !== legacy)
      || (entry.parent !== undefined && entry.parent !== parent)) {
      entry.invalid = true;
    } else {
      entry.parent = parent;
      const nickname = thread.agentNickname ?? source?.agent_nickname;
      if (typeof nickname === 'string') entry.nickname = nickname;
    }
    entry.known = true;
    this.changed?.();
  }

  started(id: string, turn: unknown): void {
    const entry = this.entry(id);
    if (!entry || !codexThreadId(turn) || entry.closed || entry.completed.has(turn)) return;
    if (entry.turn && entry.turn !== turn) this.completed(id, entry.turn);
    if (!entry.invalid) entry.turn = turn;
    this.changed?.();
  }

  completed(id: string, turn: unknown): void {
    const entry = this.entry(id);
    if (!entry || !codexThreadId(turn)) return;
    if (entry.completed.size >= MAX_CLOSED_TURNS) entry.invalid = true;
    else entry.completed.add(turn);
    if (entry.turn === turn) entry.turn = undefined;
    this.changed?.();
  }

  closed(id: string): void {
    const entry = this.entry(id);
    if (entry) { entry.closed = true; entry.turn = undefined; this.changed?.(); }
  }

  belongs(id: string): boolean {
    const seen = new Set<string>();
    while (id !== this.root) {
      if (seen.has(id) || seen.size >= MAX_DEPTH) return false;
      seen.add(id);
      const entry = this.threads.get(id);
      if (!entry?.known || entry.invalid || entry.closed || !entry.parent) return false;
      id = entry.parent;
    }
    // Remember proven membership for teardown even if later metadata revokes approval eligibility.
    for (const id of seen) this.threads.get(id)!.verified = true;
    return true;
  }

  active(id: string, turn: unknown): boolean {
    return this.liveTurn(id, turn) && this.belongs(id);
  }

  /** Lifecycle is observed immediately, even while its metadata lookup is pending. */
  liveTurn(id: string, turn: unknown): boolean {
    const entry = this.threads.get(id);
    return codexThreadId(turn) && !!entry && !entry.invalid && !entry.closed && entry.turn === turn;
  }

  ended(id: string, turn: string): boolean {
    const entry = this.threads.get(id);
    return !!entry && (entry.closed || entry.completed.has(turn) || (entry.turn !== undefined && entry.turn !== turn));
  }

  label(id: string): string {
    return this.threads.get(id)?.nickname || id.slice(0, 12);
  }

  activeTurns(): { threadId: string; turnId: string }[] {
    // Revoked ancestry closes cards; previously verified live work must still be interrupted.
    return [...this.threads].flatMap(([threadId, entry]) => entry.turn && entry.verified
      ? [{ threadId, turnId: entry.turn }] : []);
  }

  /** One bounded metadata lookup per discovered thread, including its parent chain. */
  async verify(id: string, seen = new Set<string>()): Promise<boolean> {
    if (id === this.root) return true;
    if (seen.has(id) || seen.size >= MAX_DEPTH) return false;
    seen.add(id);
    const entry = this.entry(id);
    if (!entry || entry.invalid || entry.closed) return false;
    if (!entry.known) {
      entry.metadata ??= this.read(id).then((value) => {
        const thread = record(record(value)?.thread);
        if (thread?.id !== id) { entry.invalid = true; this.changed?.(); }
        else this.observe(thread);
      }).catch(() => { entry.invalid = true; this.changed?.(); });
      await entry.metadata;
    }
    if (entry.invalid || entry.closed || !entry.parent) return false;
    await this.verify(entry.parent, seen);
    return this.belongs(id);
  }
}
