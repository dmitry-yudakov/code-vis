import { randomUUID } from 'node:crypto';
import { chmod, open, rename, unlink, type FileHandle } from 'node:fs/promises';
import path from 'node:path';

export async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, 'r').catch(() => undefined);
  if (!handle) return;
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function atomicWrite(
  targetPath: string,
  value: unknown,
  beforeRename?: (targetPath: string, temporaryPath: string) => void | Promise<void>,
  compact = false,
): Promise<void> {
  const directory = path.dirname(targetPath);
  const temporaryPath = path.join(directory, `.${path.basename(targetPath)}-${randomUUID()}.tmp`);
  let handle: FileHandle | undefined;
  try {
    handle = await open(temporaryPath, 'wx', 0o600);
    await handle.writeFile(compact ? `${JSON.stringify(value)}\n` : `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await beforeRename?.(targetPath, temporaryPath);
    await rename(temporaryPath, targetPath);
    await chmod(targetPath, 0o600);
    await syncDirectory(directory);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}
