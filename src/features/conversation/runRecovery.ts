import type { RunDescriptor } from '@/shared/types';

export type RunRecoveryAttachment<T> =
  | { kind: 'stream'; stream: T }
  | { kind: 'finished' | 'missing' };

/**
 * Reconciles host run discovery with the canonical conversation snapshot. Discovery and stream
 * attachment are only hints about live work; every completion path finishes on a fresh snapshot.
 */
export async function reconcileThreadRun<T>(input: {
  discover(): Promise<RunDescriptor | undefined>;
  adopt(run: RunDescriptor): void;
  attach(runId: string): Promise<RunRecoveryAttachment<T>>;
  hydrate(): Promise<void>;
  consume(stream: T): Promise<void>;
}): Promise<'idle' | 'missing' | 'finished' | 'streamed'> {
  const active = await input.discover();
  if (!active) {
    await input.hydrate();
    return 'idle';
  }

  input.adopt(active);
  let attachment: RunRecoveryAttachment<T>;
  try {
    attachment = await input.attach(active.runId);
  } catch (error) {
    await input.hydrate();
    throw error;
  }

  // The run may have committed its result between discovery and attachment.
  await input.hydrate();
  if (attachment.kind !== 'stream') return attachment.kind;

  try {
    await input.consume(attachment.stream);
    return 'streamed';
  } finally {
    // Completion is committed before its event, so this snapshot is the final authority even when
    // the stream ended abruptly or its replay overlapped an earlier hydration.
    await input.hydrate();
  }
}
