import type { ChildProcessWithoutNullStreams } from 'node:child_process';

/** Server-only stdio transport. Protocol parsers remain owned by the provider runners. */
export interface ProcessTransport {
  spawn(binary: string, args: string[]): ChildProcessWithoutNullStreams;
}
