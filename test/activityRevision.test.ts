import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SessionStore } from '@/server/storage/sessionStore';
import { createTurn, updateActivity } from '@/shared/turnActivity';
import type { DiagramAnnotation, UserMessage } from '@/shared/types';

describe('display activity and canonical edit revisions', () => {
  it('preserves the annotation edit revision across activity saves but rejects genuine stale drawing edits', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'codeai-activity-revision-'));
    const store = new SessionStore(directory);
    try {
      let session = await store.createSession({ provider: 'claude' });
      const now = new Date().toISOString();
      const diagramId = crypto.randomUUID();
      session = await store.createSketch(session.id, { id: diagramId, sessionId: session.id, ordinal: 1, createdAt: now, viewBox: [0, 0, 1600, 1000] });
      const user: UserMessage = { id: crypto.randomUUID(), role: 'user', authorId: session.participants.find(item => item.kind === 'human')!.id,
        addressedParticipantId: session.primaryAgentId, createdAt: now, status: 'sending', text: 'Work', diagramAttachments: [] };
      const initial = createTurn(crypto.randomUUID(), user.id, session.primaryAgentId, now);
      session = (await store.appendUserMessage(session.id, { ...user, turn: initial })).session;
      const editRevision = session.revision;
      const activity = updateActivity(initial, 1, { kind: 'tool', key: 'read', tool: 'Read', status: 'running' });
      const saved = await store.saveTurnActivity(session.id, activity);
      expect(saved.revision).toBe(editRevision);
      expect(saved.messages[0]).toMatchObject({ turn: { sequence: activity.sequence, history: 'saved' } });
      const annotation: DiagramAnnotation = { version: 1, diagramId, marks: [], updatedAt: now };
      const annotated = await store.putAnnotation(session.id, annotation, editRevision);
      expect(annotated.revision).toBe(editRevision + 1);
      expect((await store.getSession(session.id)).annotations[annotation.diagramId]).toEqual(annotation);
      await store.saveTurnActivity(session.id, updateActivity(activity, 1, { kind: 'tool', key: 'read', tool: 'Read', status: 'succeeded', output: 'Read complete' }));
      await expect(store.putAnnotation(session.id, { ...annotation, updatedAt: new Date(Date.now() + 1).toISOString() }, editRevision))
        .rejects.toMatchObject({ code: 'conflict' });
      const reread = await store.getSession(session.id);
      expect(reread.revision).toBe(editRevision + 1);
      expect(reread.annotations[annotation.diagramId]).toEqual(annotation);
      expect(reread.messages[0]).toMatchObject({ turn: { entries: [{ kind: 'tool', status: 'succeeded', output: 'Read complete' }] } });
    } finally { await store.close(); await rm(directory, { recursive: true, force: true }); }
  });
});
