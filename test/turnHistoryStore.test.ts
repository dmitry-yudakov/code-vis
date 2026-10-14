import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { SessionStore, publicSession, arenaSessionSummary } from '@/server/storage/sessionStore';
import { ACTIVITY_LIMITS, createTurn, updateActivity, finishTurn, serializedBytes, type TurnRecord } from '@/shared/turnActivity';
import { canonicalTranscript } from '@/server/conversation/transcript';
import { RunRegistry } from '@/server/runs/runRegistry';
import type { AssistantMessage, DurableSession, UserMessage } from '@/shared/types';

function userMessage(session: DurableSession, turn: TurnRecord): UserMessage {
  return { id: turn.userMessageId, role: 'user', authorId: session.participants.find(p => p.kind === 'human')!.id,
    addressedParticipantId: session.primaryAgentId, text: 'Instruction', createdAt: turn.acceptedAt, status: 'sending', diagramAttachments: [], turn };
}
function assistantMessage(session: DurableSession): AssistantMessage {
  return { id: crypto.randomUUID(), role: 'assistant', authorId: session.primaryAgentId, createdAt: new Date().toISOString(),
    status: 'complete', rawMarkdown: 'Answer', blocks: [{ kind: 'markdown', markdown: 'Answer' }] };
}
function sizedTurn(session: DurableSession, bytes: number): TurnRecord {
  const turn = createTurn(crypto.randomUUID(), crypto.randomUUID(), session.primaryAgentId, new Date().toISOString());
  turn.lifecycle = 'completed'; turn.sequence = 9;
  turn.entries = Array.from({ length: 4 }, (_, i) => ({ kind: 'assistant', id: `1:${i}`, firstSequence: i + 1, sequence: 9, attempt: 1, text: '', complete: true }));
  let remaining = bytes - serializedBytes(turn);
  for (const entry of turn.entries) {
    if (entry.kind !== 'assistant') continue;
    const length = Math.min(remaining, 256 * 1024);
    entry.text = 'x'.repeat(length); remaining -= length;
  }
  expect(serializedBytes(turn)).toBe(bytes);
  return turn;
}

describe('durable chronological activity', () => {
  it('retains exact completed history through replay expiry, archive/restore and restart', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'codeai-history-retention-'));
    let store = new SessionStore(dir);
    try {
      let session = await store.createSession({ provider: 'claude' });
      let turn = createTurn(crypto.randomUUID(), crypto.randomUUID(), session.primaryAgentId, new Date().toISOString());
      turn = updateActivity(turn, 1, { kind: 'assistant', key: 'before', text: 'Commentary before the tool.' });
      turn = updateActivity(turn, 1, { kind: 'tool', key: 'read', tool: 'Read', status: 'succeeded', output: 'Retained result' });
      turn = updateActivity(turn, 1, { kind: 'assistant', key: 'final', text: 'Answer', phase: 'final' });
      await store.appendUserMessage(session.id, userMessage(session, turn));
      const answer = assistantMessage(session);
      turn = finishTurn(turn, 'completed', { attempt: 1, key: 'final', messageId: answer.id });
      session = await store.completeAssistantMessage(session.id, session.primaryAgentId, turn.userMessageId, answer, turn);
      const expected = publicSession(session).messages;
      const registry = new RunRegistry();
      registry.start({ runId: turn.runId, sessionId: session.id, participantId: session.primaryAgentId, cancel() {} });
      registry.record(turn.runId, { type: 'turn-activity', runId: turn.runId, turn });
      registry.finish(turn.runId);
      const now = Date.now();
      const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 6 * 60_000);
      try { expect(registry.list().recent).toHaveLength(0); } finally { clock.mockRestore(); }
      session = await store.archiveSession(session.id, session.revision);
      session = await store.restoreSession(session.id, session.revision);
      await store.close();
      store = new SessionStore(dir);
      expect(publicSession(await store.getSession(session.id)).messages).toEqual(expected);
    } finally { await store.close(); await rm(dir, { recursive: true, force: true }); }
  });

  it('upgrades only on use, projects history without prompting it and recovers interruption on restart', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'codeai-turn-history-'));
    let store = new SessionStore(dir);
    try {
      const project = await store.createProject('Test', ['test']);
      let session = await store.createSession({ projectId: project.id, provider: 'claude' });
      expect(session.version).toBe(4);
      const messageId = crypto.randomUUID();
      let turn = createTurn(crypto.randomUUID(), messageId, session.primaryAgentId, new Date().toISOString());
      await store.appendUserMessage(session.id, { id: messageId, role: 'user', authorId: session.participants.find(p => p.kind === 'human')!.id,
        addressedParticipantId: session.primaryAgentId, text: 'Instruction', createdAt: turn.acceptedAt, status: 'sending', diagramAttachments: [], turn });
      turn = updateActivity({ ...turn, lifecycle: 'running' }, 1, { kind: 'tool', key: 'one', tool: 'Read', input: 'HISTORY ONLY', status: 'running' });
      session = await store.saveTurnActivity(session.id, turn);
      expect(session.version).toBe(13);
      expect(publicSession(session).messages[0]).toMatchObject({ turn: { history: 'saved', entries: [{ input: 'HISTORY ONLY' }] } });
      expect(JSON.stringify(arenaSessionSummary(session))).not.toContain('HISTORY ONLY');
      expect(JSON.stringify(canonicalTranscript(session.messages))).not.toContain('HISTORY ONLY');
      await store.close();
      store = new SessionStore(dir);
      session = await store.getSession(session.id);
      expect(session.messages[0]).toMatchObject({ status: 'failed', delivery: 'possibly-sent', turn: { lifecycle: 'interrupted', incomplete: true, entries: [{ status: 'unknown' }] } });
    } finally { await store.close(); await rm(dir, { recursive: true, force: true }); }
  });

  it('preserves canonical answers when an activity-only write fails', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'codeai-turn-history-'));
    let fail = false;
    const store = new SessionStore(dir, { beforeRename() { if (fail) throw new Error('disk'); } });
    try {
      const session = await store.createSession({ provider: 'claude' });
      const messageId = crypto.randomUUID();
      const turn = createTurn(crypto.randomUUID(), messageId, session.primaryAgentId, new Date().toISOString());
      await store.appendUserMessage(session.id, { id: messageId, role: 'user', authorId: session.participants.find(p => p.kind === 'human')!.id,
        addressedParticipantId: session.primaryAgentId, text: 'Instruction', createdAt: turn.acceptedAt, status: 'sending', diagramAttachments: [], turn });
      fail = true;
      await expect(store.saveTurnActivity(session.id, finishTurn(turn, 'completed'))).rejects.toThrow('disk');
      fail = false;
      const answer = { id: crypto.randomUUID(), role: 'assistant' as const, authorId: session.primaryAgentId, createdAt: new Date().toISOString(), status: 'complete' as const, rawMarkdown: 'Answer', blocks: [{ kind: 'markdown' as const, markdown: 'Answer' }] };
      const saved = await store.completeAssistantMessage(session.id, session.primaryAgentId, messageId, answer);
      expect(saved.messages[1]).toEqual(answer);
    } finally { await store.close(); await rm(dir, { recursive: true, force: true }); }
  });

  it.each([false, true])('commits final history and its canonical answer in one replacement (failure=%s)', async failure => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'codeai-turn-atomic-'));
    let checkCommit = false;
    let writes = 0;
    const store = new SessionStore(dir, { async beforeRename(target, temporary) {
      if (!checkCommit) return;
      writes++;
      const before = JSON.parse(await readFile(target, 'utf8')) as DurableSession;
      const proposed = JSON.parse(await readFile(temporary, 'utf8')) as DurableSession;
      expect(before.messages).toHaveLength(1);
      expect(before.messages[0]).toMatchObject({ status: 'sending', turn: { lifecycle: 'running' } });
      expect(proposed.messages).toHaveLength(2);
      expect(proposed.messages[0]).toMatchObject({ status: 'sent', turn: { lifecycle: 'completed', entries: [{ canonicalMessageId: proposed.messages[1].id }] } });
      if (failure) throw new Error('simulated crash before rename');
    } });
    try {
      const session = await store.createSession({ provider: 'claude' });
      let turn = createTurn(crypto.randomUUID(), crypto.randomUUID(), session.primaryAgentId, new Date().toISOString());
      turn = updateActivity({ ...turn, lifecycle: 'running' }, 1, { kind: 'assistant', key: 'answer', text: 'Answer', phase: 'final' });
      await store.appendUserMessage(session.id, userMessage(session, turn));
      const answer = assistantMessage(session);
      const finalTurn = finishTurn(turn, 'completed', { attempt: 1, key: 'answer', messageId: answer.id });
      checkCommit = true;
      const commit = store.completeAssistantMessage(session.id, session.primaryAgentId, turn.userMessageId, answer, finalTurn);
      if (failure) await expect(commit).rejects.toThrow('simulated crash'); else await commit;
      expect(writes).toBe(1);
      checkCommit = false;
      await store.close();
      const reopened = new SessionStore(dir);
      try {
        const saved = await reopened.getSession(session.id);
        expect(saved.messages).toHaveLength(failure ? 1 : 2);
        expect(saved.messages[0]).toMatchObject({ status: failure ? 'failed' : 'sent', turn: { lifecycle: failure ? 'interrupted' : 'completed' } });
        if (failure && saved.messages[0].role === 'user') expect(saved.messages[0].turn?.entries[0]).not.toHaveProperty('canonicalMessageId');
      } finally { await reopened.close(); }
    } finally { await store.close(); await rm(dir, { recursive: true, force: true }); }
  });

  it.each(['append', 'cancel'] as const)('retains new lifecycle writes at the exact session activity cap: %s', async action => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'codeai-turn-cap-'));
    const store = new SessionStore(dir);
    try {
      const session = await store.createSession({ provider: 'claude' });
      session.version = 13;
      for (let i = 0; i < 8; i++) {
        const turn = sizedTurn(session, ACTIVITY_LIMITS.turnBytes - 4096);
        session.messages.push({ ...userMessage(session, turn), status: 'sent' });
      }
      const last = sizedTurn(session, 8 * 4096);
      // Change to a shorter running label and refill the freed bytes to retain the exact boundary.
      last.lifecycle = 'running';
      const finalEntry = last.entries[0];
      if (finalEntry.kind === 'assistant') finalEntry.text += 'xx';
      session.messages.push(userMessage(session, last));
      expect(session.messages.reduce((sum, item) => sum + (item.role === 'user' && item.turn ? serializedBytes(item.turn) : 0), 0)).toBe(ACTIVITY_LIMITS.sessionBytes);
      await writeFile(path.join(store.sessionsDirectory, `${session.id}.json`), JSON.stringify(session));
      const saved = action === 'append'
        ? (await store.appendUserMessage(session.id, userMessage(session, createTurn(crypto.randomUUID(), crypto.randomUUID(), session.primaryAgentId, new Date().toISOString())))).session
        : await store.failUserMessage(session.id, last.userMessageId, 'cancelled', 'possibly-sent');
      expect(saved.messages[0]).toMatchObject({ text: 'Instruction', turn: { entries: [{ kind: 'gap' }], incomplete: true } });
      expect(saved.messages.reduce((sum, item) => sum + (item.role === 'user' && item.turn ? serializedBytes(item.turn) : 0), 0)).toBeLessThanOrEqual(ACTIVITY_LIMITS.sessionBytes);
      expect(saved.messages.at(-1)).toMatchObject({ turn: { lifecycle: action === 'append' ? 'queued' : 'cancelled' } });
    } finally { await store.close(); await rm(dir, { recursive: true, force: true }); }
  });
});
