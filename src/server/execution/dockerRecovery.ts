import type { AppConfig } from '@/server/config';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { atomicWrite, getSessionStore, skipNewerFormat } from '@/server/storage/sessionStore';
import { getDockerRuntime } from './dockerRuntime';

const globals = globalThis as typeof globalThis & { __codeAiDockerRecovery?: Map<string, Promise<void>> };

/** Shown wherever recovery blocks admission, so the turn route and health agree. */
export const DOCKER_RECOVERY_MESSAGE = 'Docker recovery is incomplete. Once provisioned, every turn needs the local Docker daemon: start it and retry. If its engine was replaced, run npm run docker:provision -- --replace-engine on this machine.';

export function recoverDockerExecution(config: AppConfig): Promise<void> {
  const recoveries = globals.__codeAiDockerRecovery ??= new Map();
  let recovery = recoveries.get(config.dataDir);
  if (!recovery) {
    recovery = (async () => {
      const interrupted = await getDockerRuntime(config).reconcile();
      if (!interrupted.length) return;
      const store = getSessionStore(config.dataDir, config.hostLabel);
      const interruptedPath = path.join(config.dataDir, 'docker', 'interrupted.json');
      // A newer CodeAI's session stays recorded so that build can fail its interrupted delivery.
      const newerFormat: string[] = [];
      for (const sessionId of interrupted) {
        const session = await store.getSession(sessionId).catch(skipNewerFormat);
        if (!session) {
          newerFormat.push(sessionId);
          continue;
        }
        for (const message of session.messages) {
          if (message.role === 'user' && message.status === 'sending') {
            await store.failUserMessage(sessionId, message.id, 'failed', 'possibly-sent');
          }
        }
      }
      if (newerFormat.length) {
        await atomicWrite(interruptedPath, newerFormat);
        return;
      }
      await unlink(interruptedPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
    })().catch((error) => { recoveries.delete(config.dataDir); throw error; });
    recoveries.set(config.dataDir, recovery);
  }
  return recovery;
}
