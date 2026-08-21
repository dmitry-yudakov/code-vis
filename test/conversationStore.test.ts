import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatThread } from '@/shared/types';
import {
  commitProjectThreads, loadProjectSnapshot, loadProjectThreads, loadSelectedProjectId, mergeProjectThreads,
  projectConversationLockName, projectConversationStorageKey, saveProjectThreads, saveSelectedProjectId,
  serializeThreadExport,
} from '@/features/conversation/conversationStore';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

function threadFixture(projectId = 'p1', title = 'Test'): ChatThread {
  const now = new Date().toISOString();
  const humanId = crypto.randomUUID();
  const agentId = crypto.randomUUID();
  return {
    version: 2, id: crypto.randomUUID(), projectId, title, createdAt: now, updatedAt: now,
    participants: [
      { id: humanId, kind: 'human', displayName: 'You' },
      { id: agentId, kind: 'agent', displayName: 'Codex', provider: 'codex', role: 'coder', defaultMode: 'plan' },
    ],
    primaryAgentId: agentId, addressedAgentId: agentId, messages: [], pinnedDiagramIds: [], annotations: {},
  };
}

describe('conversationStore', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('persists the selected project separately from project-scoped conversations', () => {
    const storage = new MemoryStorage();
    expect(loadSelectedProjectId(storage)).toBeUndefined();
    saveSelectedProjectId('p2', storage);
    expect(loadSelectedProjectId(storage)).toBe('p2');
  });

  it('round trips versioned project-scoped threads and rejects cross-project data', () => {
    const storage = new MemoryStorage();
    const now = new Date().toISOString();
    const humanId = 'human-1';
    const agentId = 'agent-1';
    const thread: ChatThread = {
      version: 2, id: crypto.randomUUID(), projectId: 'p1', title: 'Test', createdAt: now, updatedAt: now,
      participants: [
        { id: humanId, kind: 'human', displayName: 'You' },
        { id: agentId, kind: 'agent', displayName: 'Codex', provider: 'codex', role: 'reviewer', defaultMode: 'ask' },
      ],
      primaryAgentId: agentId, addressedAgentId: agentId,
      messages: [], pinnedDiagramIds: [], annotations: {},
    };
    saveProjectThreads('p1', [thread], storage);
    expect(loadProjectThreads('p1', storage)).toEqual([thread]);
    storage.setItem('code-ai:web2:v1:p2', JSON.stringify({ version: 1, threads: [thread] }));
    expect(() => loadProjectThreads('p2', storage)).toThrow('corrupt');
  });

  it('migrates local conversations saved before provider selection to Claude', () => {
    const storage = new MemoryStorage();
    const now = new Date().toISOString();
    const legacy = {
      version: 1, id: crypto.randomUUID(), projectId: 'p1', title: 'Legacy', createdAt: now, updatedAt: now,
      messages: [], pinnedDiagramIds: [], annotations: {},
    };
    storage.setItem('code-ai:web2:v1:p1', JSON.stringify({ version: 1, threads: [legacy] }));
    const migrated = loadProjectThreads('p1', storage)[0];
    expect(migrated).toMatchObject({ id: legacy.id, version: 2 });
    expect(migrated.participants).toMatchObject([
      { kind: 'human', displayName: 'You' },
      { kind: 'agent', provider: 'claude', role: 'coder' },
    ]);
  });

  it('attributes every legacy message to deterministic migrated participants', () => {
    const storage = new MemoryStorage();
    const now = new Date().toISOString();
    const threadId = crypto.randomUUID();
    const legacy = {
      version: 1, id: threadId, projectId: 'p1', title: 'Legacy messages', createdAt: now, updatedAt: now,
      provider: 'codex', pinnedDiagramIds: [], annotations: {},
      messages: [
        { id: crypto.randomUUID(), role: 'user', text: 'Review this.', createdAt: now, status: 'sent', diagramAttachments: [] },
        { id: crypto.randomUUID(), role: 'assistant', createdAt: now, status: 'complete', rawMarkdown: 'Looks good.', blocks: [] },
      ],
    };
    storage.setItem('code-ai:web2:v1:p1', JSON.stringify({ version: 1, threads: [legacy] }));
    const migrated = loadProjectThreads('p1', storage)[0];
    const human = migrated.participants.find((participant) => participant.kind === 'human')!;
    const agent = migrated.participants.find((participant) => participant.kind === 'agent')!;
    expect(migrated.messages[0]).toMatchObject({ authorId: human.id, addressedParticipantId: agent.id });
    expect(migrated.messages[1]).toMatchObject({ authorId: agent.id });
  });

  it('revives persisted diagrams that pass the current policy without reviving unsafe HTML', () => {
    const storage = new MemoryStorage();
    const now = new Date().toISOString();
    const projectId = 'p1';
    const threadId = crypto.randomUUID();
    const messageId = crypto.randomUUID();
    const artifact = (source: string, status: 'policy-error' | 'parse-error' = 'policy-error') => ({
      id: crypto.randomUUID(), threadId, messageId, ordinal: 1, source, createdAt: now,
      status, error: status === 'policy-error' ? 'Raw HTML is not allowed in diagrams' : 'Lexical error',
      derivedFromDiagramIds: [], evidence: [],
    });
    const recoverable = artifact('graph LR\nA["`path`<br/>two"] --> B', 'parse-error');
    const unsafe = artifact('graph LR\nA["<img src=x>"] --> B');
    const humanId = 'human-1';
    const agentId = 'agent-1';
    const thread: ChatThread = {
      version: 2, id: threadId, projectId, title: 'Migration', createdAt: now, updatedAt: now,
      participants: [
        { id: humanId, kind: 'human', displayName: 'You' },
        { id: agentId, kind: 'agent', displayName: 'Claude', provider: 'claude', role: 'coder', defaultMode: 'ask' },
      ],
      primaryAgentId: agentId,
      activeDiagramId: recoverable.id, pinnedDiagramIds: [], annotations: {},
      messages: [{
        id: messageId, role: 'assistant', authorId: agentId, createdAt: now, status: 'complete', rawMarkdown: '',
        blocks: [{ kind: 'diagram', artifact: recoverable }, { kind: 'diagram', artifact: unsafe }],
      }],
    };
    storage.setItem('code-ai:web2:v1:p1', JSON.stringify({ version: 1, threads: [thread] }));
    const diagrams = loadProjectThreads(projectId, storage)[0].messages.flatMap((message) => message.role === 'assistant'
      ? message.blocks.flatMap((block) => block.kind === 'diagram' ? [block.artifact] : [])
      : []);
    expect(diagrams.map((item) => item.status)).toEqual(['ready', 'policy-error']);
    expect(diagrams[0].source).toContain('A["path<br/>two"]');
  });

  it('exports expanded author identity without private provider sessions', () => {
    const now = new Date().toISOString();
    const agentId = 'agent-1';
    const thread: ChatThread = {
      version: 2, id: crypto.randomUUID(), projectId: 'p1', title: 'Export', createdAt: now, updatedAt: now,
      participants: [
        { id: 'human-1', kind: 'human', displayName: 'You' },
        { id: agentId, kind: 'agent', displayName: 'Codex Reviewer', provider: 'codex', role: 'reviewer', defaultMode: 'ask' },
      ],
      primaryAgentId: agentId, pinnedDiagramIds: [], annotations: {},
      messages: [{ id: crypto.randomUUID(), role: 'assistant', authorId: agentId, createdAt: now, status: 'complete', rawMarkdown: 'Finding.', blocks: [] }],
    };
    const exported = serializeThreadExport(thread, now);
    expect(exported.entries[0].author).toEqual({
      id: agentId, displayName: 'Codex Reviewer', kind: 'agent', provider: 'codex', role: 'reviewer',
    });
    expect(JSON.stringify(exported)).not.toContain('sessionId');
  });

  it('recovers a same-revision interleaving by merging content instead of gating on the counter', () => {
    const storage = new MemoryStorage();
    const base = threadFixture();
    saveProjectThreads('p1', [base], storage);
    const sharedRead = storage.getItem(projectConversationStorageKey('p1'))!;
    const tabA = loadProjectThreads('p1', storage)[0];
    const tabB = structuredClone(tabA);
    const humanId = base.participants.find((participant) => participant.kind === 'human')!.id;
    const agentA = { id: crypto.randomUUID(), kind: 'agent' as const, displayName: 'Claude', provider: 'claude' as const, role: 'reviewer' as const, defaultMode: 'ask' as const };
    const agentB = { id: crypto.randomUUID(), kind: 'agent' as const, displayName: 'Codex Tester', provider: 'codex' as const, role: 'tester' as const, defaultMode: 'ask' as const };
    tabA.participants.push(agentA);
    tabA.messages.push({
      id: crypto.randomUUID(), role: 'user', authorId: humanId, addressedParticipantId: agentA.id,
      text: 'review', createdAt: new Date().toISOString(), status: 'sent', diagramAttachments: [],
    });
    tabA.updatedAt = '2026-01-01T00:00:01.000Z';
    const savedA = saveProjectThreads('p1', [tabA], storage);

    tabB.participants.push(agentB);
    tabB.messages.push({
      id: crypto.randomUUID(), role: 'user', authorId: humanId, addressedParticipantId: agentB.id,
      text: 'test', createdAt: new Date().toISOString(), status: 'sent', diagramAttachments: [],
    });
    tabB.updatedAt = '2026-01-01T00:00:02.000Z';
    // Reproduce both tabs reading revision 1 before either writes. The second write
    // overwrites the first with the same revision, proving revision is not a conflict token.
    storage.setItem(projectConversationStorageKey('p1'), sharedRead);
    const savedB = saveProjectThreads('p1', [tabB], storage);
    expect(savedA.revision).toBe(savedB.revision);
    expect(loadProjectThreads('p1', storage)[0].messages.some((message) => message.role === 'user' && message.text === 'review')).toBe(false);

    // A live storage-event recipient merges by content even at the same revision,
    // then its next save restores the durable union.
    const recoveredA = mergeProjectThreads([tabA], savedB.threads);
    const recovered = saveProjectThreads('p1', recoveredA, storage);
    const converged = recovered.threads[0];
    expect(converged.participants.map((participant) => participant.id)).toEqual(expect.arrayContaining([agentA.id, agentB.id]));
    expect(converged.messages.map((message) => message.role === 'user' ? message.text : '')).toEqual(expect.arrayContaining(['review', 'test']));
    expect(loadProjectThreads('p1', storage)[0].messages).toHaveLength(2);
  });

  it('serializes commits through a project-scoped Web Lock', async () => {
    const storage = new MemoryStorage();
    let queue = Promise.resolve();
    const request = vi.fn(<T>(_name: string, callback: () => Promise<T> | T): Promise<T> => {
      const result = queue.then(callback);
      queue = result.then(() => undefined, () => undefined);
      return result;
    });
    vi.stubGlobal('navigator', { locks: { request } });

    const first = threadFixture('p1', 'First');
    const second = threadFixture('p1', 'Second');
    const [savedFirst, savedSecond] = await Promise.all([
      commitProjectThreads('p1', [first], storage),
      commitProjectThreads('p1', [second], storage),
    ]);

    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls.map(([name]) => name)).toEqual([
      'code-ai:web2:v1:p1:commit',
      'code-ai:web2:v1:p1:commit',
    ]);
    expect(projectConversationLockName('p1')).not.toBe(projectConversationLockName('p2'));
    expect([savedFirst.revision, savedSecond.revision]).toEqual([1, 2]);
    expect(loadProjectThreads('p1', storage)).toHaveLength(2);
  });

  it('commits without Web Locks when the platform does not expose them', async () => {
    const storage = new MemoryStorage();
    vi.stubGlobal('navigator', {});
    const thread = threadFixture();
    const result = await commitProjectThreads('p1', [thread], storage);
    expect(result.revision).toBe(1);
    expect(loadProjectThreads('p1', storage)).toEqual([thread]);
  });

  it('isolates an invalid thread, preserves its last valid copy, and saves unaffected threads', () => {
    const storage = new MemoryStorage();
    const affected = threadFixture('p1', 'Affected');
    const healthy = threadFixture('p1', 'Healthy');
    saveProjectThreads('p1', [affected, healthy], storage);
    const malformed = structuredClone(affected);
    malformed.messages.push({
      id: crypto.randomUUID(), role: 'assistant', authorId: 'dangling-agent', createdAt: new Date().toISOString(),
      status: 'complete', rawMarkdown: 'bad', blocks: [],
    });
    const updatedHealthy = { ...healthy, title: 'Healthy updated', updatedAt: '2099-01-01T00:00:00.000Z' };
    const result = saveProjectThreads('p1', [malformed, updatedHealthy], storage);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({ threadId: affected.id, lastValid: { title: 'Affected' } });
    expect(result.failures[0].message).toContain(affected.id);
    const stored = loadProjectThreads('p1', storage);
    expect(stored.find((thread) => thread.id === affected.id)?.messages).toHaveLength(0);
    expect(stored.find((thread) => thread.id === healthy.id)?.title).toBe('Healthy updated');
  });

  it('stores conversations beyond the old 200-message wall and names the raised boundary', () => {
    const storage = new MemoryStorage();
    const thread = threadFixture();
    const humanId = thread.participants.find((participant) => participant.kind === 'human')!.id;
    thread.messages = Array.from({ length: 201 }, (_, index) => ({
      id: crypto.randomUUID(), role: 'user' as const, authorId: humanId,
      addressedParticipantId: thread.primaryAgentId, text: `message ${index}`,
      createdAt: new Date().toISOString(), status: 'sent' as const, diagramAttachments: [],
    }));
    expect(saveProjectThreads('p1', [thread], storage).failures).toEqual([]);
    expect(loadProjectThreads('p1', storage)[0].messages).toHaveLength(201);

    const lastValid = structuredClone(thread);
    saveProjectThreads('p1', [lastValid], storage);
    thread.messages = Array.from({ length: 2_001 }, (_, index) => ({
      id: crypto.randomUUID(), role: 'user' as const, authorId: humanId,
      addressedParticipantId: thread.primaryAgentId, text: `message ${index}`,
      createdAt: new Date().toISOString(), status: 'sent' as const, diagramAttachments: [],
    }));
    const result = saveProjectThreads('p1', [thread], storage);
    expect(result.failures[0].message).toContain('2000-message');
    expect(result.failures[0].lastValid?.messages).toHaveLength(201);
  });
});
