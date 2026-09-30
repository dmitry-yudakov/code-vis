import { constants } from 'node:fs';
import { open, readlink } from 'node:fs/promises';

export type BoundedTextIssue = 'missing' | 'not-file' | 'too-large' | 'not-text' | 'unreadable' | 'changed';
export type BoundedText = { text: string } | { issue: BoundedTextIssue };

/** Whether this system can name the file behind an open handle, which is what `exactly` relies on. */
export function namesOpenFiles(): boolean {
  return process.platform === 'linux';
}

/**
 * Reads one of the user's own files whole or not at all: a regular file of at most `maxBytes` of
 * UTF-8 without NUL bytes. Anything else is an issue, never a truncated text. One handle is opened
 * and everything is asked of it, and no more than `maxBytes + 1` bytes are ever read, so a file that
 * grows, a FIFO, or a `/proc` file of unknown size cannot stall or fill the process.
 *
 * With `exactly`, `file` must be a canonical path, and the handle must be the file at that very
 * path: the kernel's own name for the open file must equal it. That closes the gap between
 * resolving a path and opening it, in which the file or a folder on the way could have been swapped
 * for a link. Where the system cannot name an open file (`namesOpenFiles`), nothing is proven.
 */
export async function readBoundedTextFile(file: string, maxBytes: number, options: { exactly?: boolean } = {}): Promise<BoundedText> {
  // Non-blocking, so that opening a FIFO does not wait for a writer.
  const handle = await open(file, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0)).catch((error: NodeJS.ErrnoException) => error);
  if (handle instanceof Error) return { issue: handle.code === 'ENOENT' ? 'missing' : 'unreadable' };
  try {
    const info = await handle.stat();
    if (!info.isFile()) return { issue: 'not-file' };
    if (options.exactly && namesOpenFiles() && await readlink(`/proc/self/fd/${handle.fd}`) !== file) return { issue: 'changed' };
    const bytes = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await handle.read(bytes, length, bytes.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > maxBytes) return { issue: 'too-large' };
    const text = bytes.subarray(0, length);
    if (text.includes(0)) return { issue: 'not-text' };
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(text) };
  } catch (error) {
    // A fatal decoder reports invalid UTF-8 with a TypeError.
    return { issue: error instanceof TypeError ? 'not-text' : 'unreadable' };
  } finally {
    await handle.close().catch(() => undefined);
  }
}
