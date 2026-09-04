import { executorSnapshotSchema } from '@/shared/machineSchema';
import type { ExecutorSnapshot } from '@/shared/types';
import type { MachineConnection } from './machineRegistry';

const SNAPSHOT_TIMEOUT_MS = 1_500;
const MAX_SNAPSHOT_BYTES = 8_000_000;

export async function boundedResponseText(response: Response, maximumBytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(declared) && declared > maximumBytes) throw new Error('Remote response is too large.');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error('Remote response is too large.');
    }
    chunks.push(value);
  }
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
    headers: { Authorization: machineAuthorization(connection.credential), Accept: 'application/json' },
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
