import { ARENA_SNAPSHOT_BYTES, WORKSPACE_HEARTBEAT_MS, WORKSPACE_STREAM_TYPE, type WorkspaceStreamEvent } from '@/shared/workspaceStream';
import { reserveBrowserWorkspace } from './browserStreamBudget';
import { safeJsonResponse } from '@/shared/protocol';

/** At most one pending snapshot per reader. Slow readers recover current state, without a queue. */
export function snapshotStream<T>(request: Request, input: {
  subscribe(receive: (value: T) => void, fail: (cause: unknown) => void): () => void;
  authorize(): Promise<Response | undefined>;
  maximumBytes?: number;
}): Response {
  const budget = reserveBrowserWorkspace(request);
  if (budget === false) return safeJsonResponse({ error: 'Workspace updates are paused while agent connections are busy.' },
    { status: 429, headers: { 'Retry-After': '1' } });
  let controller: ReadableStreamDefaultController<Uint8Array>;
  let pending: WorkspaceStreamEvent<T> | undefined;
  let release: (() => void) | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  let reading = false;
  let checking = false;
  const encoder = new TextEncoder();
  const cleanup = () => {
    if (timer) clearInterval(timer);
    request.signal.removeEventListener('abort', abort);
    release?.();
    release = undefined;
    pending = undefined;
    budget?.release();
  };
  const fail = (cause: unknown) => {
    if (closed) return;
    closed = true;
    cleanup();
    controller.error(cause);
  };
  const finish = () => {
    if (closed) return;
    closed = true;
    cleanup();
    controller.close();
  };
  const abort = () => fail(new Error('Workspace subscription was cancelled.'));
  const flush = () => {
    if (closed || !reading || !pending || checking) return;
    try {
      const chunk = encoder.encode(`${JSON.stringify(pending)}\n`);
      if (chunk.byteLength > (input.maximumBytes ?? ARENA_SNAPSHOT_BYTES)) {
        fail(new Error('Workspace snapshot exceeds its byte bound.'));
        return;
      }
      pending = undefined;
      reading = false;
      controller.enqueue(chunk);
    } catch (cause) {
      fail(cause);
    }
  };
  const authorize = () => {
    if (closed || checking) return;
    checking = true;
    void input.authorize().then(denied => {
      if (closed) return;
      if (denied) { fail(new Error('Workspace subscription is no longer authorized.')); return; }
      checking = false;
      flush();
    }).catch(fail);
  };
  const stream = new ReadableStream<Uint8Array>({
    start(current) {
      controller = current;
      budget?.onEvict(finish);
      if (closed) return;
      request.signal.addEventListener('abort', abort, { once: true });
      if (request.signal.aborted) { abort(); return; }
      try {
        release = input.subscribe(snapshot => {
          pending = { type: 'snapshot', snapshot };
          authorize();
        }, fail);
        if (closed) { cleanup(); return; }
        timer = setInterval(() => {
          pending ??= { type: 'heartbeat' };
          authorize();
        }, WORKSPACE_HEARTBEAT_MS);
        timer.unref?.();
      } catch (cause) { fail(cause); }
    },
    pull() { reading = true; flush(); },
    cancel() { closed = true; cleanup(); },
  }, { highWaterMark: 0 });
  return new Response(stream, { headers: {
    'Content-Type': `${WORKSPACE_STREAM_TYPE}; charset=utf-8`, 'Cache-Control': 'no-store, no-transform',
    'X-Content-Type-Options': 'nosniff', 'X-Accel-Buffering': 'no',
  } });
}
