import type { AppConfig } from '@/server/config';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { getSessionStore } from '@/server/storage/sessionStore';
import { getDockerRuntime } from './dockerRuntime';

const globals = globalThis as typeof globalThis & { __codeAiDockerRecovery?: Map<string, Promise<void>> };

export function recoverDockerExecution(config: AppConfig): Promise<void> {
  const recoveries = globals.__codeAiDockerRecovery ??= new Map();
  let recovery = recoveries.get(config.dataDir);
  if (!recovery) {
    recovery = (async () => {
      const interrupted = await getDockerRuntime(config).reconcile();
      if (!interrupted.length) return;
      const store = getSessionStore(config.dataDir, config.hostLabel);
      for (const sessionId of interrupted) {
        const session = await store.getSession(sessionId);
        for (const message of session.messages) {
          if (message.role === 'user' && message.status === 'sending') {
            await store.failUserMessage(sessionId, message.id, 'failed', 'possibly-sent');
          }
        }
      }
      await unlink(path.join(config.dataDir, 'docker', 'interrupted.json')).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
    })().catch((error) => { recoveries.delete(config.dataDir); throw error; });
    recoveries.set(config.dataDir, recovery);
  }
  return recovery;
}
