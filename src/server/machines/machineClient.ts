import { executorSnapshotSchema } from '@/shared/machineSchema';
import type { ExecutorSnapshot } from '@/shared/types';
import { RUN_NOW_CAPABILITY_HEADER } from '@/shared/workspaceStream';
import type { MachineConnection } from './machineRegistry';

const SNAPSHOT_TIMEOUT_MS = 1_500;
const MAX_SNAPSHOT_BYTES = 8_000_000;

export async function boundedResponseText(response: Response, maximumBytes: number, signal?: AbortSignal): Promise<string> {
  const declared = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(declared) && declared > maximumBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error('Remote response is too large.');
  }
  if (signal?.aborted) { await response.body?.cancel().catch(() => undefined); signal.throwIfAborted(); }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener('abort', abort, { once: true });
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error('Remote response is too large.');
      }
      chunks.push(value);
    }
  } finally { signal?.removeEventListener('abort', abort); reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export function machineAuthorization(credential: string): string {
  return `Bearer ${credential}`;
}

export async function fetchExecutorSnapshot(connection: MachineConnection): Promise<ExecutorSnapshot> {
  const response = await fetch(`${connection.origin}/api/machine/snapshot`, {
    cache: 'no-store',
    redirect: 'error',
    headers: { Authorization: machineAuthorization(connection.credential), Accept: 'application/json', [RUN_NOW_CAPABILITY_HEADER]: 'true' },
    signal: AbortSignal.timeout(SNAPSHOT_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Executor snapshot returned ${response.status}.`);
  const raw = await boundedResponseText(response, MAX_SNAPSHOT_BYTES).catch((error) => {
    if (error instanceof Error && error.message === 'Remote response is too large.') {
      throw new Error('Executor snapshot is too large.');
    }
    throw error;
  });
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('Executor snapshot is not valid JSON.'); }
  const parsed = executorSnapshotSchema.safeParse(value);
  if (!parsed.success) throw new Error('Executor snapshot does not match the machine contract.');
  if (parsed.data.machine.id !== connection.machine.id) {
    throw new Error('Executor snapshot returned a different machine identity.');
  }
  return parsed.data as ExecutorSnapshot;
}
