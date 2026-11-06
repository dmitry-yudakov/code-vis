import { createHash } from 'node:crypto';
import { getConfig } from '@/server/config';
import { DEVICE_COOKIE_NAME } from '@/server/devices/deviceAuthorization';

// HTTP/1 browsers commonly have six origin connections. Workspace subscriptions must leave
// the previously available command slot alone when agent responses occupy the other five.
const MAX_STREAMS_WITH_WORKSPACE = 5;
interface Lease { evict(): void }
interface Group { runs: number; workspaces: Set<Lease> }
const state = globalThis as typeof globalThis & { __codeaiBrowserStreamBudgets?: Map<string, Group> };
const groups = state.__codeaiBrowserStreamBudgets ??= new Map<string, Group>();

/** Call only after route authorization. This grouping never grants access or reserves a run. */
function groupFor(request: Request): { group: Group; prune(): void } | undefined {
  const config = getConfig();
  const credential = request.headers.get('cookie')?.split(';').map(part => part.trim())
    .find(part => part.startsWith(`${DEVICE_COOKIE_NAME}=`))?.slice(DEVICE_COOKIE_NAME.length + 1);
  // A paired request without a personal cookie has already passed machine authorization.
  // Node-to-node connections do not share the browser's connection pool.
  const identity = config.remoteAccess === 'paired' ? credential : request.headers.get('user-agent')?.slice(0, 512);
  if (!identity) return undefined;
  const host = request.headers.get('host') ?? new URL(request.url).host;
  const digest = createHash('sha256').update(identity).digest('hex');
  const key = JSON.stringify([config.dataDir, host, digest]);
  let group = groups.get(key);
  if (!group) groups.set(key, group = { runs: 0, workspaces: new Set() });
  return { group, prune() { if (!group.runs && !group.workspaces.size && groups.get(key) === group) groups.delete(key); } };
}

export function reserveBrowserWorkspace(request: Request): false | undefined | {
  onEvict(close: () => void): void; release(): void;
} {
  const owner = groupFor(request);
  if (!owner) return undefined;
  if (owner.group.runs + owner.group.workspaces.size >= MAX_STREAMS_WITH_WORKSPACE) { owner.prune(); return false; }
  let close: (() => void) | undefined;
  let evicted = false;
  let released = false;
  const lease: Lease = { evict() { evicted = true; close?.(); } };
  owner.group.workspaces.add(lease);
  return {
    onEvict(callback) { close = callback; if (evicted) callback(); },
    release() {
      if (released) return;
      released = true;
      owner.group.workspaces.delete(lease);
      owner.prune();
    },
  };
}

/** Account for actual browser run-response lifetimes, including the home-origin remote proxy. */
export function withBrowserRunBudget(request: Request, response: Response): Response {
  if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('application/x-ndjson')) return response;
  const owner = groupFor(request);
  if (!owner) return response;
  owner.group.runs++;
  // Closing the workspace body actually frees its HTTP connection; it never cancels a run.
  for (const lease of [...owner.group.workspaces].reverse()) {
    if (owner.group.runs + owner.group.workspaces.size <= MAX_STREAMS_WITH_WORKSPACE) break;
    lease.evict();
  }
  const reader = response.body.getReader();
  let ended = false;
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const release = () => {
    if (ended) return;
    ended = true;
    request.signal.removeEventListener('abort', abort);
    owner.group.runs--;
    owner.prune();
  };
  const abort = () => {
    if (ended) return;
    release();
    void reader.cancel().catch(() => undefined);
    controller.error(new Error('Agent stream was detached.'));
  };
  const body = new ReadableStream<Uint8Array>({
    start(current) {
      controller = current;
      request.signal.addEventListener('abort', abort, { once: true });
      if (request.signal.aborted) abort();
    },
    async pull() {
      try {
        const result = await reader.read();
        if (ended) return;
        if (result.done) { release(); controller.close(); }
        else controller.enqueue(result.value);
      } catch (cause) { if (!ended) { release(); controller.error(cause); } }
    },
    cancel(reason) { release(); return reader.cancel(reason); },
  }, { highWaterMark: 0 });
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}
