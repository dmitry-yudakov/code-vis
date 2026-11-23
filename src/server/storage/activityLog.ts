import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, rename } from 'node:fs/promises';
import path from 'node:path';
import {
  activityEntrySchema, type ActivityEntry, type ActivityInput, type ActivityPage, type ActivityActor,
} from '@/shared/activityLog';
import { syncDirectory } from './atomicWrite';

const SEGMENT_BYTES = 1024 * 1024;
const PAGE_SIZE = 50;
const MAX_PENDING_WRITES = 128;
const SAFE_OPEN = (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
const isMissing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';

type State = { pending: Promise<unknown>; writes: number; missed: boolean };
const scope = globalThis as typeof globalThis & { __codeaiActivityLogs?: Map<string, State> };

// Route bundles share one queue per data directory. The live CodeAI process owns these files.
function stateFor(dataDir: string): State {
  const states = scope.__codeaiActivityLogs ??= new Map();
  const key = path.resolve(dataDir);
  let state = states.get(key);
  if (!state) states.set(key, state = { pending: Promise.resolve(), writes: 0, missed: false });
  return state;
}

function enqueue<T>(state: State, work: () => Promise<T>): Promise<T> {
  const result = state.pending.then(work);
  state.pending = result.catch(() => undefined);
  return result;
}

function markIncomplete(state: State): void {
  if (!state.missed) console.warn('CodeAI could not record activity. Some entries may be missing.');
  state.missed = true;
}

function segments(dataDir: string) {
  return { current: path.join(dataDir, 'activity.ndjson'), older: path.join(dataDir, 'activity.previous.ndjson') };
}

async function append(file: string, line: Buffer): Promise<boolean> {
  const handle = await open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | SAFE_OPEN, 0o600);
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error('Invalid activity segment');
    if (info.size + line.length > SEGMENT_BYTES) return false;
    await handle.writeFile(line);
    await handle.sync();
    if (info.size === 0) await syncDirectory(path.dirname(file));
    return true;
  } finally {
    await handle.close();
  }
}

export async function recordActivity(dataDir: string, input: ActivityInput): Promise<void> {
  const state = stateFor(dataDir);
  if (state.writes >= MAX_PENDING_WRITES) {
    markIncomplete(state);
    return;
  }
  state.writes++;
  return enqueue(state, async () => {
    try {
      const entry = activityEntrySchema.parse({ ...input, id: randomUUID(), at: new Date().toISOString() });
      // A crash midway through a write leaves one incomplete line. Prefix the next entry with a
      // newline so it stays readable even when the preceding write was interrupted.
      const line = Buffer.from(`\n${JSON.stringify(entry)}`);
      const { current, older } = segments(dataDir);
      await mkdir(dataDir, { recursive: true, mode: 0o700 });
      if (!await append(current, line)) {
        await rename(current, older);
        await append(current, line);
      }
    } catch {
      markIncomplete(state);
    } finally {
      state.writes--;
    }
  });
}

async function readSegment(file: string): Promise<Buffer> {
  const handle = await open(file, constants.O_RDONLY | SAFE_OPEN).catch(error => {
    if (isMissing(error)) return undefined;
    throw error;
  });
  if (!handle) return Buffer.alloc(0);
  try {
    const info = await handle.stat();
    if (info.size > SEGMENT_BYTES || !info.isFile()) throw new Error('Invalid activity segment');
    const bytes = Buffer.alloc(info.size);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await handle.read(bytes, length, bytes.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    return bytes.subarray(0, length);
  } finally {
    await handle.close();
  }
}

/** The cursor identifies a retained entry. Appends never shift a page boundary. */
export async function readActivity(
  dataDir: string, source?: ActivityActor['source'], before?: string,
): Promise<ActivityPage | undefined> {
  const state = stateFor(dataDir);
  const { files, missed } = await enqueue(state, async () => {
    const { current, older } = segments(dataDir);
    return { files: await Promise.all([readSegment(current), readSegment(older)]), missed: state.missed };
  });
  const entries: ActivityEntry[] = [];
  let incomplete = missed;
  let pastCursor = !before;
  for (const file of files) {
    for (const line of file.toString('utf8').split('\n').reverse()) {
      if (!line) continue;
      let parsed;
      try { parsed = activityEntrySchema.safeParse(JSON.parse(line)); } catch { /* Interrupted write. */ }
      if (!parsed?.success) { incomplete = true; continue; }
      const entry = parsed.data;
      if (!pastCursor) { pastCursor = entry.id === before; continue; }
      if (source && entry.actor.source !== source) continue;
      if (entries.length === PAGE_SIZE) return { entries, nextCursor: entries.at(-1)!.id, incomplete };
      entries.push(entry);
    }
  }
  return pastCursor ? { entries, nextCursor: null, incomplete } : undefined;
}
