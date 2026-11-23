import { getConfig, type AppConfig } from '@/server/config';
import { getSessionStore } from '@/server/storage/sessionStore';
import { submitMessage } from '@/server/conversation/submitMessage';
import { runRegistry } from '@/server/runs/runRegistry';
import { SuspendedTurns, type SuspendedTurn } from './suspendedTurns';

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
  const admission = runRegistry.holdStartupRecovery();
  if (admission === 'live-runs') throw new Error('Restart recovery requires an idle scheduler.');
  try {
    await restore(records, journal, config);
  } finally {
    if (admission === 'acquired') runRegistry.releaseMaintenance();
  }
}

async function restore(records: SuspendedTurn[], journal: SuspendedTurns, config: AppConfig): Promise<void> {
  const store = getSessionStore(config.dataDir, config.hostLabel);
  await store.host(); // Acquire the canonical store's process-wide writer lock before claiming work.
  const sessionSlots = new Map<string, number[]>();
  records.forEach((turn, index) => {
    const slots = sessionSlots.get(turn.request.sessionId) ?? [];
    slots.push(index);
    sessionSlots.set(turn.request.sessionId, slots);
  });
  for (const [sessionId, slots] of sessionSlots) {
    if (slots.length < 2) continue;
    const session = await store.getSession(sessionId).catch(() => undefined);
    if (!session) continue; // The normal recovery loop handles unavailable sessions.
    // The saved transcript breaks timestamp ties without moving another session's queue entries.
    const order = new Map(session.messages.map((message, index) => [message.id, index]));
    const ordered = slots.map(slot => records[slot]).sort((a, b) =>
      (order.get(a.request.messageId) ?? Infinity) - (order.get(b.request.messageId) ?? Infinity));
    slots.forEach((slot, index) => { records[slot] = ordered[index]; });
  }
  // Later ideas already have saved messages now, but were not predecessors at original admission.
  // Include unresumable records too: their preflight failure must not prevent earlier work.
  const laterQueuedSessions = new Set(records.filter(turn => turn.request.waitForCheckout).map(turn => turn.request.sessionId));
  for (const turn of records) {
    if (turn.request.waitForCheckout) laterQueuedSessions.delete(turn.request.sessionId);
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
      }), turn, laterQueuedSessions);
      if (response.status !== 202) console.error(`CodeAI restart recovery: ${turn.runId} remains suspended (${response.status}).`);
    } catch {
      console.error(`CodeAI restart recovery: ${turn.runId} could not resume. Its saved request was retained.`);
    }
  }
}
