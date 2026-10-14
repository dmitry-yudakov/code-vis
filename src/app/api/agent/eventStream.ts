import type { AgentEvent } from '@/shared/types';

const NDJSON_HEADERS = {
  'Content-Type': 'application/x-ndjson; charset=utf-8',
  'Cache-Control': 'no-store, no-transform',
  'X-Content-Type-Options': 'nosniff',
};

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

  const detach = () => {
    if (!attached) return;
    attached = false;
    input.onDetach();
  };

  const write = (event: AgentEvent) => {
    if (!attached) return;
    try {
      const chunk = encoder.encode(`${JSON.stringify(event)}\n`);
      // A slow/disconnected reader can recover from the registry's coalesced snapshot. Never
      // accumulate an unbounded queue of full history snapshots behind its network socket.
      if (controller && (controller.desiredSize ?? 0) < chunk.byteLength) {
        controller.error(new Error('The event reader fell behind. Reconnect to recover current activity.'));
        detach();
        return;
      }
      controller?.enqueue(chunk);
    } catch {
      detach();
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController;
      for (const event of input.replay || []) write(event);
      void input.start(write).finally(() => {
        detach();
        try { streamController.close(); } catch { /* client already gone */ }
      });
    },
    cancel() {
      detach();
    },
  }, { highWaterMark: 8 * 1024 * 1024, size: chunk => chunk.byteLength });

  const headers = new Headers(NDJSON_HEADERS);
  if (input.headers) new Headers(input.headers).forEach((value, key) => headers.set(key, value));
  return new Response(stream, { headers });
}
