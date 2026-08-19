import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildTranscriptDelta } from '@/lib/conversation/transcript';
import { buildConversationPrompt } from '@/lib/conversation/prompt';
import { roleContract } from '@/lib/server/agentRoles';
import {
  publicParticipants, serverAgent, ThreadRegistry,
} from '@/lib/server/threadRegistry';
import { AGENT_ROLE_DEFAULT_MODES, humanParticipantId, legacyAgentParticipantId } from '@/lib/shared/participants';
import { agentMessageRequestSchema } from '@/lib/shared/protocol';
import type { ServerAgentParticipant, ServerThread, TranscriptContextMessage } from '@/lib/shared/types';

describe('multi-agent thread registry', () => {
  it('creates a human and main coder, then keeps added agent sessions and cursors independent', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'web2-multi-agent-'));
    const registry = new ThreadRegistry(directory);
    const created = await registry.create('project-a', 'claude');
    const claude = serverAgent(created, created.primaryAgentId)!;
    expect(created.participants.find((participant) => participant.kind === 'human')).toMatchObject({ displayName: 'You' });
    expect(claude).toMatchObject({ provider: 'claude', role: 'coder', defaultMode: 'plan', session: { started: false } });

    const codex = await registry.addAgent(created.id, 'project-a', 'codex', 'reviewer');
    expect(codex).toMatchObject({ displayName: 'Codex', role: 'reviewer', defaultMode: 'ask' });
    await registry.markSessionStarted(created.id, claude.id, 'claude', 'claude-session');
    await registry.markSessionStarted(created.id, codex.id, 'codex', 'codex-session');
    await registry.markObserved(created.id, codex.id, crypto.randomUUID());
    await registry.setPrimaryAgent(created.id, 'project-a', codex.id);

    const persisted = await registry.get(created.id);
    expect(persisted.primaryAgentId).toBe(codex.id);
    expect(serverAgent(persisted, claude.id)?.session.sessionId).toBe('claude-session');
    expect(serverAgent(persisted, claude.id)?.lastObservedMessageId).toBeUndefined();
    expect(serverAgent(persisted, codex.id)?.session.sessionId).toBe('codex-session');
    expect(serverAgent(persisted, codex.id)?.lastObservedMessageId).toBeTruthy();
    expect(publicParticipants(persisted).some((participant) => 'session' in participant)).toBe(false);
  });

  it('migrates the shipped v2 single-provider session to deterministic roster identities', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'web2-v2-roster-'));
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await writeFile(path.join(directory, 'threads.json'), JSON.stringify({
      version: 2,
      threads: [{
        id, projectId: 'project-a', createdAt: now, updatedAt: now,
        agent: { provider: 'codex', sessionId: 'kept-session', started: true },
      }],
    }));
    const migrated = await new ThreadRegistry(directory).get(id);
    expect(migrated.primaryAgentId).toBe(legacyAgentParticipantId(id));
    expect(migrated.participants).toMatchObject([
      { id: humanParticipantId(id), kind: 'human', displayName: 'You' },
      {
        id: legacyAgentParticipantId(id), kind: 'agent', provider: 'codex', role: 'coder', defaultMode: 'ask',
        session: { provider: 'codex', sessionId: 'kept-session', started: true },
      },
    ]);
  });
});

describe('authored transcript handoff', () => {
  const now = new Date().toISOString();
  const humanId = 'human-1';
  const editorId = 'agent-editor';
  const reviewerId = 'agent-reviewer';
  const editor: ServerAgentParticipant = {
    id: editorId, kind: 'agent', displayName: 'Claude', provider: 'claude', role: 'coder', defaultMode: 'plan',
    session: { provider: 'claude', started: true, sessionId: 'claude-session' },
  };
  const reviewer: ServerAgentParticipant = {
    id: reviewerId, kind: 'agent', displayName: 'Codex', provider: 'codex', role: 'reviewer', defaultMode: 'ask',
    session: { provider: 'codex', started: false },
  };
  const thread: ServerThread = {
    id: crypto.randomUUID(), projectId: 'project-a', createdAt: now, updatedAt: now,
    participants: [{ id: humanId, kind: 'human', displayName: 'You' }, editor, reviewer],
    primaryAgentId: editorId,
  };
  const message = (authorId: string, text: string): TranscriptContextMessage => ({
    id: crypto.randomUUID(), authorId, createdAt: now, text,
  });

  it('labels authors, starts after the participant cursor, and applies server bounds from the newest end', () => {
    const transcript = [message(humanId, 'draft it'), message(editorId, 'draft'), message(reviewerId, 'finding'), message(humanId, 'please revise')];
    const addressed = { ...editor, lastObservedMessageId: transcript[1].id };
    const delta = buildTranscriptDelta(thread, addressed, transcript, { maxMessages: 2, maxBytes: 1_000 });
    expect(delta.messages.map((item) => item.text)).toEqual(['finding', 'please revise']);
    expect(delta.text).toContain('[Codex · codex/reviewer]');
    expect(delta.text).toContain('[You]');
    expect(delta.text).not.toContain('draft it');

    const bounded = buildTranscriptDelta(thread, reviewer, transcript, { maxMessages: 2, maxBytes: 1_000 });
    expect(bounded.truncated).toBe(true);
    expect(bounded.messages.map((item) => item.text)).toEqual(['finding', 'please revise']);
  });

  it('rejects forged authors and duplicate ids before an agent run starts', () => {
    expect(() => buildTranscriptDelta(thread, reviewer, [message('outsider', 'forged')])).toThrow('outside this conversation');
    const duplicate = message(humanId, 'same');
    expect(() => buildTranscriptDelta(thread, reviewer, [duplicate, duplicate])).toThrow('duplicate');
  });

  it('recovers conservatively when a preserved cursor falls outside the local transcript window', () => {
    const transcript = [message(humanId, 'visible recap'), message(reviewerId, 'visible finding')];
    const addressed = { ...editor, lastObservedMessageId: crypto.randomUUID() };
    const delta = buildTranscriptDelta(thread, addressed, transcript);
    expect(delta.cursorFound).toBe(false);
    expect(delta.messages).toEqual(transcript);
    expect(delta.text).toContain('prior cursor was outside');
  });

  it('requires an explicit participant and transcript while forbidding provider overrides', () => {
    const request = {
      projectId: 'project-a', threadId: thread.id, messageId: crypto.randomUUID(), participantId: reviewerId,
      text: 'Review this.', transcript: [], diagramAttachments: [], mode: 'ask',
    };
    expect(agentMessageRequestSchema.parse(request).participantId).toBe(reviewerId);
    expect(agentMessageRequestSchema.safeParse({ ...request, participantId: undefined }).success).toBe(false);
    expect(agentMessageRequestSchema.safeParse({ ...request, provider: 'claude' }).success).toBe(false);
  });
});

describe('role presets', () => {
  it('keeps all role behavior server-owned and subordinate to the active mode', () => {
    expect(AGENT_ROLE_DEFAULT_MODES).toEqual({
      orchestrator: 'plan', coder: 'plan', reviewer: 'ask', tester: 'ask', custom: 'ask',
    });
    expect(roleContract('orchestrator')).toContain('cannot invoke other participants');
    expect(roleContract('reviewer')).toContain('prioritized');
    expect(roleContract('coder')).toContain('in Ask or Plan, do not edit');

    const prompt = buildConversationPrompt({
      userText: 'What do you think?', attachmentDirectory: '/tmp/run', attachedCanvasNames: [], mode: 'ask',
      participantIdentity: 'You are Codex Reviewer.', roleContract: roleContract('reviewer'),
      transcriptDelta: '[Claude · claude/coder]\nHere is the proposal.',
    });
    expect(prompt).toContain('You are Codex Reviewer.');
    expect(prompt).toContain('Role: REVIEWER');
    expect(prompt).toContain('Mode: ASK');
    expect(prompt).toContain('[Missed shared transcript]');
  });
});
