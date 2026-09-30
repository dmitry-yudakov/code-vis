import os from 'node:os';
import path from 'node:path';

/**
 * A parent for fixtures that stand for the user's own folders. CodeAI treats the temp directories as
 * places an agent turn can write, so such a fixture cannot live there.
 */
export function userOwnedParent(): string {
  const parent = '/var/tmp';
  for (const temporary of [os.tmpdir(), '/tmp']) {
    const relative = path.relative(path.resolve(temporary), parent);
    if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
      throw new Error(`These tests keep "user-owned" fixtures in ${parent}, which must lie outside the temp directory (${temporary}). Run them with another TMPDIR.`);
    }
  }
  return parent;
}
