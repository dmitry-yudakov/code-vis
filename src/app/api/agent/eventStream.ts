import type { AgentEvent } from '@/shared/types';

const NDJSON_HEADERS = {
  'Content-Type': 'application/x-ndjson; charset=utf-8',
  'Cache-Control': 'no-store, no-transform',
  'X-Content-Type-Options': 'nosniff',
};

const MAX_PENDING_BYTES = 8 * 1024 * 1024;
type SnapshotEvent = Extract<AgentEvent, { type: 'turn-activity' | 'context-usage' }>;

/**
 * Wraps a run's events in an NDJSON response. `start` receives the writer and returns a promise
 * that resolves when the stream should close; a client that goes away only triggers `onDetach`,
 * because the run itself outlives any single browser connection.
 */
export function agentEventStream(input: {
  runId: string;
  onDetach(): void;
  headers?: HeadersInit;
  replay?: AgentEvent[];
  start(write: (event: AgentEvent) => void): Promise<unknown>;
}): Response {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let attached = true;
  let finished = false;
  let closed = false;
  let reading = false;
  // Required events retain order and an 8 MiB pending-byte budget. Keep only the latest live
  // activity and context snapshots, serializing them when the consumer pulls.
  const pending: (Uint8Array | SnapshotEvent)[] = [];
  let pendingBytes = 0;
  const pendingSnapshots = new Map<SnapshotEvent['type'], SnapshotEvent>();

  const detach = () => {
    if (!attached) return;
    attached = false;
    input.onDetach();
  };

  const clear = () => {
    pending.length = 0;
    pendingSnapshots.clear();
    pendingBytes = 0;
  };

  const fail = (error: unknown) => {
    if (closed) return;
    closed = true;
    clear();
    controller?.error(error);
    detach();
  };

  const overflow = () => fail(new Error('The event reader fell behind. Reconnect to recover current activity.'));
  const encode = (event: AgentEvent) => encoder.encode(`${JSON.stringify(event)}\n`);

  const flush = () => {
    if (closed) return;
    try {
      if (reading && pending.length) {
        const next = pending.shift()!;
        const chunk = next instanceof Uint8Array ? next : encode(next);
        if (next instanceof Uint8Array) pendingBytes -= chunk.byteLength;
        else pendingSnapshots.delete(next.type);
        if (chunk.byteLength > MAX_PENDING_BYTES) { overflow(); return; }
        reading = false;
        controller!.enqueue(chunk);
      }
      if (finished && !pending.length) {
        closed = true;
        controller!.close();
      }
    } catch (error) { fail(error); }
  };

  const write = (event: AgentEvent, replay = false) => {
    if (!attached || closed) return;
    try {
      if ((event.type === 'turn-activity' || event.type === 'context-usage') && !replay) {
        // Move newer state after intervening required events. Replay stays verbatim because its
        // advertised prefix length tells the browser which attention events are historical.
        const previous = pendingSnapshots.get(event.type);
        if (previous) pending.splice(pending.indexOf(previous), 1);
        pendingSnapshots.set(event.type, event);
        pending.push(event);
      } else {
        const chunk = encode(event);
        if (pendingBytes + chunk.byteLength > MAX_PENDING_BYTES) { overflow(); return; }
        pendingBytes += chunk.byteLength;
        pending.push(chunk);
      }
      flush();
    } catch (error) { fail(error); }
  };

  const finish = () => {
    finished = true;
    detach();
    // Provider completion ends the subscription, not delivery of already accepted output.
    flush();
  };

  const stream = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController;
      try {
        for (const event of input.replay || []) write(event, true);
        void input.start(write).then(finish, fail);
      } catch (error) { fail(error); }
    },
    pull() {
      reading = true;
      flush();
    },
    cancel() {
      closed = true;
      clear();
      detach();
    },
  }, { highWaterMark: 0 });

  const headers = new Headers(NDJSON_HEADERS);
  if (input.headers) new Headers(input.headers).forEach((value, key) => headers.set(key, value));
  return new Response(stream, { headers });
}
