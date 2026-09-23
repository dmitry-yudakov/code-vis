import type { ManagedLifecycleInit, ServerLifecycleMessage } from '@/shared/codeAiLifecycle';

/**
 * The private channel to the `start:managed` parent. `scripts/start-remote.mjs` installs it only
 * when the parent spawned it with an IPC channel and a marker and initialized it, before Next
 * prepares. Its absence means this server is unmanaged, whatever the environment says.
 */
export interface ManagedBridge {
  init: ManagedLifecycleInit;
  connected(): boolean;
  send(message: ServerLifecycleMessage): void;
  listen(listener: (message: unknown) => void): void;
}

const globalScope = globalThis as typeof globalThis & { __codeaiManagedLifecycle?: ManagedBridge };

export function managedBridge(): ManagedBridge | undefined {
  return globalScope.__codeaiManagedLifecycle;
}
