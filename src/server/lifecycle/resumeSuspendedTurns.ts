import { getConfig, type AppConfig } from '@/server/config';
import { getSessionStore } from '@/server/storage/sessionStore';
import { submitMessage } from '@/server/conversation/submitMessage';
import { SuspendedTurns } from './suspendedTurns';

const scope = globalThis as typeof globalThis & { __codeAiRestartRecovery?: Map<string, Promise<void>> };

/** Startup owns recovery; it needs neither the old parent process nor a browser connection. */
export function resumeSuspendedTurns(config: AppConfig = getConfig()): Promise<void> {
  const recoveries = (scope.__codeAiRestartRecovery ??= new Map());
  let recovery = recoveries.get(config.dataDir);
  if (!recovery) {
    recovery = resume(config);
    recoveries.set(config.dataDir, recovery);
  }
  return recovery;
}

async function resume(config: AppConfig): Promise<void> {
  const journal = new SuspendedTurns(config.dataDir);
  const records = await journal.list();
  if (!records.length) return;
  const store = getSessionStore(config.dataDir, config.hostLabel);
  await store.host(); // Acquire the canonical store's process-wide writer lock before claiming work.
  for (const turn of records) {
    try {
      const session = await store.getSession(turn.request.sessionId);
      const message = session.messages.find(item => item.id === turn.request.messageId);
      if (!message || message.role !== 'user' || message.status === 'sent' || message.status === 'cancelled') {
        await journal.remove(turn.runId);
        continue;
      }
      if (turn.state !== 'ready') {
        console.error(`CodeAI restart recovery: ${turn.runId} did not finish a clean suspension; it was not replayed.`);
        continue;
      }
      const response = await submitMessage(new Request('http://codeai.internal/resume', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(turn.request),
      }), turn);
      if (response.status !== 202) console.error(`CodeAI restart recovery: ${turn.runId} remains suspended (${response.status}).`);
    } catch {
      console.error(`CodeAI restart recovery: ${turn.runId} could not resume. Its saved request was retained.`);
    }
  }
}
