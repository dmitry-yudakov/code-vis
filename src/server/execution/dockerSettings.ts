import { readFileSync } from 'node:fs';
import path from 'node:path';
import { dockerSettingsSchema } from '@/shared/protocol';

export function dockerSettingsPath(dataDir: string): string {
  return path.join(dataDir, 'docker', 'settings.json');
}

/** Read on each configuration resolution so changes work across requests and server restarts. */
export function savedDockerEnabled(dataDir: string): boolean | undefined {
  try {
    return dockerSettingsSchema.parse(JSON.parse(readFileSync(dockerSettingsPath(dataDir), 'utf8'))).enabled;
  } catch (error) {
    // Only an absent setting inherits the environment. A damaged/unreadable record fails closed.
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? undefined : false;
  }
}
