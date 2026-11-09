import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SessionStore } from '@/server/storage/sessionStore';
import { sessionQueueBlockers } from '@/server/runs/sessionQueue';
import { createTurn } from '@/shared/turnActivity';
import { textFileRecords } from '@/server/storage/textFiles';
import { MAX_MESSAGE_TEXT_CHARS } from '@/shared/limits';
import type { DurableSession, UserMessage } from '@/shared/types';

function message(session: DurableSession): UserMessage {
  const id = crypto.randomUUID();
  return { id, role: 'user', authorId: session.participants.find(participant => participant.kind === 'human')!.id,
    addressedParticipantId: session.primaryAgentId, text: 'Original idea', createdAt: new Date().toISOString(), status: 'sending',
    diagramAttachments: [], mode: 'plan', turn: createTurn(crypto.randomUUID(), id, session.primaryAgentId, new Date().toISOString()) };
}

describe('queued session storage and scope', () => {
  it('keeps canonical identity and evidence while rejecting stale, invalid, or cancelled edits', async () => {
    const store = new SessionStore(await mkdtemp(path.join(os.tmpdir(), 'codeai-queue-edit-')));
    try {
      const session = await store.createSession({ provider: 'claude' });
      const original = message(session);
      original.fileAttachments = textFileRecords([{ name: 'idea.txt', text: 'Evidence' }]);
      await store.appendUserMessage(session.id, original);
      const saved = await store.editQueuedMessage(session.id, original.turn!.runId, original.id, 'Revised idea', original.text);
      expect(saved.messages[0]).toEqual({ ...original, text: 'Revised idea' });
      expect(saved.title).toBe('Revised idea');
      await expect(store.editQueuedMessage(session.id, original.turn!.runId, original.id, 'Stale edit', original.text)).rejects.toThrow('another device');
      for (const text of ['', ' '.repeat(10), 'x'.repeat(MAX_MESSAGE_TEXT_CHARS + 1)]) {
        await expect(store.editQueuedMessage(session.id, original.turn!.runId, original.id, text, 'Revised idea')).rejects.toThrow('text limit');
      }
      await store.failUserMessage(session.id, original.id, 'cancelled', 'not-sent');
      await expect(store.editQueuedMessage(session.id, original.turn!.runId, original.id, 'Too late', 'Revised idea')).rejects.toThrow('no longer queued');
      expect((await store.getSession(session.id)).messages[0]).toMatchObject({ text: 'Revised idea', status: 'cancelled' });
    } finally { await store.close(); }
  });

  it.each([false, true])('reserves against a settled archive snapshot (archive fails: %s)', async fails => {
    let enabled = false;
    let entered!: () => void;
    let resume!: () => void;
    const paused = new Promise<void>(resolve => { entered = resolve; });
    const resumed = new Promise<void>(resolve => { resume = resolve; });
    const store = new SessionStore(await mkdtemp(path.join(os.tmpdir(), 'codeai-queue-snapshot-')), {
      beforeRename: async target => {
        if (!enabled || !target.includes('/sessions/')) return;
        entered(); await resumed;
        if (fails) throw new Error('disk unavailable');
      },
    });
    try {
      const session = await store.createSession({ provider: 'claude' });
      const appended = await store.appendUserMessage(session.id, message(session));
      enabled = true;
      const archiving = store.archiveSession(session.id, appended.session.revision);
      const archiveResult = archiving.catch(error => error);
      await paused;
      let admitted = false;
      const snapshot = store.withActiveSessionSnapshot(async sessions => { admitted = true; return sessions.map(item => item.id); });
      await Promise.resolve();
      expect(admitted).toBe(false);
      resume(); await archiveResult;
      expect(await snapshot).toEqual(fails ? [session.id] : []);
    } finally { resume(); await store.close(); }
  });

  it('finds overlapping primary checkouts across projects, excluding empty and unrelated sessions', async () => {
    const store = new SessionStore(await mkdtemp(path.join(os.tmpdir(), 'codeai-queue-scopes-')));
    try {
      const project = await store.createProject('Main', ['main']);
      const nestedProject = await store.createProject('Nested', ['nested']);
      const otherProject = await store.createProject('Other', ['other']);
      const target = await store.createSession({ projectId: project.id, provider: 'claude' });
      const direct = await store.createSession({ projectId: project.id, provider: 'claude' });
      const nested = await store.createSession({ projectId: nestedProject.id, provider: 'claude' });
      const other = await store.createSession({ projectId: otherProject.id, provider: 'claude' });
      await store.createSession({ projectId: project.id, provider: 'claude' });
      for (const session of [direct, nested, other]) await store.appendUserMessage(session.id, message(session));
      const paths: Record<string, string> = { nested: '/repos/main/nested', other: '/repos/other' };
      const registry = { refresh: async () => Object.entries(paths).map(([id, realPath]) => ({ id, realPath, name: id, relativePath: id })) };
      const blockers = await sessionQueueBlockers(await store.listSessionSummaries(), target,
        { id: 'main', name: 'Main', relativePath: 'main', realPath: '/repos/main' }, registry);
      expect(blockers.sort()).toEqual([direct.id, nested.id].sort());
    } finally { await store.close(); }
  });
});
