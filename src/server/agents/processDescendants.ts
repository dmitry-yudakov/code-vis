import { readFile, readdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

export interface ProcessIdentity { pid: number; started: string }

/** A failed inventory still owns the identities proved before it failed. */
export class ProcessCaptureError extends Error {
  constructor(readonly observed: ProcessIdentity[], cause: unknown) {
    super(cause instanceof Error ? cause.message : 'Provider process inventory is incomplete', { cause });
  }
}

export async function readProcessIdentity(pid: number | undefined): Promise<ProcessIdentity | undefined> {
  if (process.platform !== 'linux' || !pid) return undefined;
  const current = await identity(pid);
  return current && { pid, started: current.started };
}

async function identity(pid: number) {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return { pid, state: fields[0], parent: Number(fields[1]), started: fields[19] };
  } catch (error) {
    if (['ENOENT', 'ESRCH'].includes((error as NodeJS.ErrnoException).code || '')) return undefined;
    throw error;
  }
}

/** Host PIDs, captured before wrappers exit and children are reparented. Never read command/env text. */
export async function captureDescendantProcesses(root: ProcessIdentity | undefined, retained: readonly ProcessIdentity[] = []): Promise<ProcessIdentity[]> {
  if (process.platform !== 'linux' || !root) return [];
  const pending = [root];
  const seen = new Set([root.pid]);
  const owned: ProcessIdentity[] = [];
  let retainedIndex = 0;
  try {
    // A sandbox wrapper can exit during a turn, reparenting a still-owned worker. Keep its
    // verified identity and track its descendants, while pruning dead or reused processes.
    for (; retainedIndex < retained.length; retainedIndex += 1) {
      const original = retained[retainedIndex];
      if (seen.has(original.pid)) continue;
      const current = await identity(original.pid);
      if (current?.started !== original.started || ['Z', 'X'].includes(current.state)) continue;
      if (seen.size >= 1024) throw new Error('Provider process tree exceeds the cleanup bound');
      seen.add(original.pid);
      pending.push(original);
      owned.push(original);
    }
    for (const original of pending) {
      const { pid } = original;
      if ((await identity(pid))?.started !== original.started) continue;
      const found = new Map<number, ProcessIdentity>();
      const tasks = await readdir(`/proc/${pid}/task`).catch((error: NodeJS.ErrnoException) => {
        if (['ENOENT', 'ESRCH'].includes(error.code || '')) return [];
        throw error;
      });
      try {
        for (const task of tasks) {
          const children = await readFile(`/proc/${pid}/task/${task}/children`, 'utf8').catch((error: NodeJS.ErrnoException) => {
            if (['ENOENT', 'ESRCH'].includes(error.code || '')) return '';
            throw error;
          });
          for (const childPid of children.trim().split(/\s+/).map(Number)) {
            if (childPid <= 1 || seen.has(childPid) || found.has(childPid)) continue;
            if (seen.size + found.size >= 1024) throw new Error('Provider process tree exceeds the cleanup bound');
            const child = await identity(childPid);
            if (!child || child.parent !== pid) continue;
            found.set(childPid, { pid: childPid, started: child.started });
          }
        }
      } finally {
        if ((await identity(pid))?.started === original.started) for (const child of found.values()) {
          seen.add(child.pid);
          pending.push(child);
          owned.push(child);
        }
      }
    }
    return owned;
  } catch (error) {
    // Unprocessed retained identities were already proved by an earlier inventory.
    const observed = new Map([...owned, ...retained.slice(retainedIndex)].map(process => [`${process.pid}:${process.started}`, process]));
    throw new ProcessCaptureError([...observed.values()], error);
  }
}

/** SDK cleanup already requested graceful stopping. Force the host fallback so a TERM handler
 * cannot spawn a replacement after its last captured ancestry. Recheck identities before killing. */
export async function stopDescendantProcesses(owned: readonly ProcessIdentity[]): Promise<void> {
  const alive = async () => {
    const live: ProcessIdentity[] = [];
    for (const original of owned) {
      const current = await identity(original.pid);
      if (current?.started === original.started && !['Z', 'X'].includes(current.state)) live.push(original);
    }
    return live;
  };
  let signalError: unknown;
  for (const original of (await alive()).reverse()) {
    if ((await identity(original.pid))?.started !== original.started) continue;
    try { process.kill(original.pid, 'SIGKILL'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') signalError = error; }
  }
  const until = Date.now() + 300;
  do {
    if (!(await alive()).length) return;
    await delay(20);
  } while (Date.now() < until);
  if ((await alive()).length) throw signalError || new Error('Provider descendants did not stop');
}

/** Retains child identities before a launcher exits/reparents them. Used by Claude's stdio runner;
 * Codex also has its SDK-specific cleanup barrier. An unproved inventory never releases ownership. */
export class ProviderProcessTree {
  private readonly root: Promise<ProcessIdentity | undefined>;
  private owned: ProcessIdentity[] = [];
  private pending = Promise.resolve();
  private incomplete = false;
  private timer?: ReturnType<typeof setInterval>;
  private stopped = false;
  constructor(pid: number | undefined, private readonly report: () => void) { this.root = readProcessIdentity(pid); }

  async start(): Promise<void> {
    await this.capture();
    if (this.stopped) return;
    this.timer = setInterval(() => { void this.capture().catch(() => this.report()); }, 100);
    this.timer.unref();
  }

  capture(): Promise<void> {
    const capture = this.pending.then(async () => {
      try {
        const root = await this.root;
        this.owned = await captureDescendantProcesses(root, this.owned);
        if (root && (await readProcessIdentity(root.pid))?.started === root.started) this.incomplete = false;
      } catch (error) {
        this.incomplete = true;
        if (error instanceof ProcessCaptureError) this.owned = error.observed;
        throw error;
      }
    });
    this.pending = capture.catch(() => undefined);
    return capture;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    for (;;) {
      await this.capture().catch(() => undefined);
      try {
        await stopDescendantProcesses(this.owned);
        if (!this.incomplete) return;
      } catch { /* Keep ownership until every captured worker is confirmed stopped. */ }
      this.report();
      await delay(1_000);
    }
  }
}
