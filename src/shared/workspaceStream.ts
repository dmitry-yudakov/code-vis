/** Liveness only: heartbeats never rebuild workspace snapshots. */
export const WORKSPACE_HEARTBEAT_MS = 5_000;
export const WORKSPACE_STALE_MS = 20_000;
export const EXECUTOR_SNAPSHOT_BYTES = 8_000_000;
/** One local machine and at most eight attached executors, plus framing. */
export const ARENA_SNAPSHOT_BYTES = 9 * EXECUTOR_SNAPSHOT_BYTES + 1_024;
export const WORKSPACE_STREAM_TYPE = 'application/x-ndjson';

export type WorkspaceStreamEvent<T> = { type: 'snapshot'; snapshot: T } | { type: 'heartbeat' };

/** A byte bound per frame, never a lifetime bound on a valid long-lived subscription. */
export async function readWorkspaceStream<T>(response: Response, input: {
  snapshot(value: T): void;
  heartbeat(): void;
}, maximumBytes: number): Promise<void> {
  if (!response.body) throw new Error('Workspace subscription has no body.');
  const reader = response.body.getReader();
  let chunks: Uint8Array[] = [];
  let size = 0;
  const append = (chunk: Uint8Array) => {
    size += chunk.byteLength;
    if (size > maximumBytes) throw new Error('Workspace snapshot exceeds its byte bound.');
    if (chunk.byteLength) chunks.push(chunk);
  };
  const frame = () => {
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    chunks = [];
    size = 0;
    const event = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as WorkspaceStreamEvent<T>;
    if (event?.type === 'heartbeat') input.heartbeat();
    else if (event?.type === 'snapshot' && Object.hasOwn(event, 'snapshot')) input.snapshot(event.snapshot);
    else throw new Error('Invalid workspace subscription event.');
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        if (size) throw new Error('Workspace subscription ended inside a frame.');
        return;
      }
      let start = 0;
      for (let index = 0; index < value.byteLength; index++) if (value[index] === 10) {
        append(value.subarray(start, index));
        frame();
        start = index + 1;
      }
      append(value.subarray(start));
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
