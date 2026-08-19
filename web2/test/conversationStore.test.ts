import { describe, expect, it } from 'vitest';
import type { ChatThread } from '@/lib/shared/types';
import {
  loadProjectThreads, loadSelectedProjectId, saveProjectThreads, saveSelectedProjectId, serializeThreadExport,
} from '@/lib/client/conversationStore';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe('conversationStore', () => {
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
});
