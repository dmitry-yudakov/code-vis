import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { runConversation } from '@/server/conversation/conversationService';
import { SessionStore } from '@/server/storage/sessionStore';
import { getConfig } from '@/server/config';
import { TurnMode } from '@/server/runs/turnMode';
import { AgentRunError } from '@/server/agents/agentRunError';
import type { PermissionBroker } from '@/server/runs/permissionBroker';
import { createTurn } from '@/shared/turnActivity';
import { RunRegistry } from '@/server/runs/runRegistry';
import { agentEventStream } from '@/app/api/agent/eventStream';
import { readNdjson } from '@/features/conversation/ndjson';
import type { AgentEvent, AgentProcessRunner } from '@/shared/types';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codeai-history-conversation-'));
  const checkoutPath = path.join(root, 'repo');
  await mkdir(checkoutPath);
  const store = new SessionStore(path.join(root, 'data'));
  let session = await store.createSession({ provider: 'claude' });
  const runId = crypto.randomUUID();
  const messageId = crypto.randomUUID();
  await store.appendUserMessage(session.id, { id: messageId, role: 'user', authorId: session.participants.find(p => p.kind === 'human')!.id,
    addressedParticipantId: session.primaryAgentId, text: 'Do work', createdAt: new Date().toISOString(), status: 'sending', diagramAttachments: [],
    turn: createTurn(runId, messageId, session.primaryAgentId, new Date().toISOString()) });
  session = await store.getSession(session.id);
  const events: AgentEvent[] = [];
  const input = { runId, session, request: { sessionId: session.id, participantId: session.primaryAgentId, messageId, text: 'Do work', diagramAttachments: [], mode: 'agent' as const },
    checkout: { id: 'checkout', name: 'Repo', relativePath: 'repo', realPath: checkoutPath }, config: { ...getConfig(), dataDir: store.dataDirectory },
    sessionStore: store, transcriptDelta: '', signal: new AbortController().signal, emit: (event: AgentEvent) => events.push(event) };
  return { input, store, events, close: async () => { await store.close(); await rm(root, { recursive: true, force: true }); } };
}

describe('conversation history lifecycle', () => {
  it.each(['complete', 'failed', 'cancelled'] as const)('streams and saves the addressed participant’s latest context after a %s attempt', async outcome => {
    const { input, store, events, close } = await fixture();
    const usage = { usedTokens: 40_000, contextWindow: 200_000, model: 'actual-model' };
    const runner: AgentProcessRunner = { async run(provider) {
      provider.emit({ type: 'context-usage', contextUsage: { ...usage, usedTokens: 150_000 } });
      provider.emit({ type: 'context-usage', contextUsage: usage });
      if (outcome !== 'complete') throw new AgentRunError(outcome === 'cancelled' ? 'cancelled' : 'process-failed', 'Provider stopped.');
      return { finalText: 'Done.', sessionId: 'provider', durationMs: 1, outputBytes: 5 };
    } };
    try {
      const run = runConversation({ ...input, runner });
      if (outcome === 'complete') await run;
      else await expect(run).rejects.toThrow('Provider stopped.');
      expect(events.filter(event => event.type === 'context-usage').at(-1)).toEqual({ type: 'context-usage', runId: input.runId, participantId: input.session.primaryAgentId, usage });
      expect((await store.getSession(input.session.id)).participants.find(p => p.id === input.session.primaryAgentId)).toMatchObject({ contextUsage: usage });
      expect((await store.getSession(input.session.id)).version).toBe(14);
    } finally { await close(); }
  });

  it('streams a large provider burst through completion and retains the same final answer after reload', async () => {
    const { input, store, close } = await fixture();
    const registry = new RunRegistry();
    registry.start({ runId: input.runId, sessionId: input.session.id, participantId: input.session.primaryAgentId, cancel() {} });
    let attachmentId = '';
    const response = agentEventStream({ runId: input.runId,
      onDetach: () => registry.unsubscribe(input.runId, attachmentId), start(write) {
        attachmentId = registry.subscribe(input.runId, write)!.attachmentId;
        return registry.wait(input.runId)!;
      } });
    const received: AgentEvent[] = [];
    const reading = (async () => {
      for await (const event of readNdjson<AgentEvent>(response)) received.push(event);
    })();
    void reading.catch(() => undefined);
    const runner: AgentProcessRunner = { async run(provider) {
      for (let block = 0; block < 3; block++) {
        provider.emit({ type: 'history', activity: { kind: 'assistant', key: `block-${block}`, text: 'x'.repeat(240 * 1024) } });
      }
      for (let index = 0; index < 40; index++) {
        provider.emit({ type: 'history', activity: { kind: 'assistant', key: 'block-2', text: '.', append: true } });
        provider.emit({ type: 'text-delta', text: '.' });
      }
      provider.emit({ type: 'history', activity: { kind: 'assistant', key: 'final', text: 'Burst complete.', phase: 'final', complete: true } });
      return { finalText: 'Burst complete.', finalBlockId: 'final', sessionId: 'provider', durationMs: 1, outputBytes: 15 };
    } };
    try {
      await runConversation({ ...input, runner, emit: event => registry.record(input.runId, event) });
      registry.finish(input.runId);
      await reading;
      const saved = await store.getSession(input.session.id);
      expect(saved.messages).toHaveLength(2);
      expect(saved.messages[0]).toMatchObject({ status: 'sent', turn: { lifecycle: 'completed', history: 'saved' } });
      expect(saved.messages[1]).toMatchObject({ status: 'complete', rawMarkdown: 'Burst complete.' });
      expect(received.find(event => event.type === 'assistant-message')).toEqual({
        type: 'assistant-message', runId: input.runId, message: saved.messages[1],
      });
      expect(received.filter(event => event.type === 'turn-activity').at(-1)).toMatchObject({
        turn: { lifecycle: 'completed', history: 'saved', sequence: saved.messages[0].role === 'user' ? saved.messages[0].turn!.sequence : -1 },
      });
      expect(received.at(-1)).toMatchObject({ type: 'done', cancelled: false });
    } finally { registry.finish(input.runId); await reading.catch(() => undefined); await close(); }
  });

  it('settles unfinished display entries before starting a replacement mode attempt', async () => {
    const { input, events, close } = await fixture();
    const turnMode = new TurnMode('agent');
    let attempts = 0;
    const runner: AgentProcessRunner = { async run(provider) {
      attempts++;
      if (attempts === 1) {
        provider.emit({ type: 'history', activity: { kind: 'assistant', key: 'commentary', text: 'Inspecting.' } });
        provider.emit({ type: 'history', activity: { kind: 'tool', key: 'read', tool: 'Read', status: 'running' } });
        turnMode.change('ask');
        throw new AgentRunError('cancelled', 'Mode changed');
      }
      expect(events.filter(event => event.type === 'turn-activity').at(-1)).toMatchObject({ turn: {
        lifecycle: 'running', entries: [{ kind: 'assistant', attempt: 1, complete: true }, { kind: 'tool', attempt: 1, status: 'unknown' }],
      } });
      provider.emit({ type: 'history', activity: { kind: 'assistant', key: 'final', text: 'Done', complete: true } });
      return { finalText: 'Done', finalBlockId: 'final', sessionId: 'provider', durationMs: 1, outputBytes: 4 };
    } };
    try {
      await runConversation({ ...input, runner, turnMode });
      expect(attempts).toBe(2);
      expect(events.at(-1)).toMatchObject({ type: 'done', cancelled: false });
    } finally { await close(); }
  });

  it('publishes a live approval during a stalled history write and commits final identity after storage resumes', async () => {
    const { input, store, events, close } = await fixture();
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const save = store.saveTurnActivity.bind(store);
    const writes = vi.spyOn(store, 'saveTurnActivity').mockImplementation(async (...args) => { await blocked; return save(...args); });
    let ready!: () => void;
    const requested = new Promise<void>(resolve => { ready = resolve; });
    let allow!: () => void;
    let broker: PermissionBroker | undefined;
    const runner: AgentProcessRunner = { async run(provider) {
      provider.emit({ type: 'history', activity: { kind: 'assistant', key: 'commentary', text: 'Inspecting.' } });
      await new Promise<void>(resolve => {
        provider.permissions!.request('request', decision => {
          expect(decision).toBe('allow');
          provider.emit({ type: 'permission-resolved', requestId: 'request', decision });
          resolve();
        });
        allow = () => { expect(broker!.decide('request', 'allow')).toBe(true); };
        provider.emit({ type: 'permission-request', requestId: 'request', tool: 'Run', detail: 'pwd', review: { completeness: 'complete', text: 'pwd' } });
        ready();
      });
      provider.emit({ type: 'history', activity: { kind: 'assistant', key: 'final', text: 'Done', phase: 'final', complete: true } });
      return { finalText: 'Done', finalBlockId: 'final', sessionId: 'provider', durationMs: 1, outputBytes: 4 };
    } };
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const run = runConversation({ ...input, runner, onPermissionBroker: owner => { broker = owner; } });
    try {
      await requested;
      expect(writes).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(999);
      expect(events.some(event => event.type === 'permission-request')).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(events.find(event => event.type === 'permission-request')).toMatchObject({ requestId: 'request', review: { completeness: 'complete' } });
      expect(events.filter(event => event.type === 'turn-activity').at(-1)).toMatchObject({ turn: { history: 'unsaved' } });
      allow();
      expect(events.some(event => event.type === 'permission-resolved')).toBe(true);
      expect(events.some(event => event.type === 'done')).toBe(false);
      release();
      vi.useRealTimers();
      await run;
      const saved = await store.getSession(input.session.id);
      expect(saved.messages).toHaveLength(2);
      expect(saved.messages[0]).toMatchObject({ status: 'sent', turn: { lifecycle: 'completed', entries: [
        { text: 'Inspecting.' }, { state: 'resolved', decision: 'allow' }, { canonicalMessageId: saved.messages[1].id },
      ] } });
      expect(events.at(-1)).toMatchObject({ type: 'done', cancelled: false });
    } finally { release(); vi.useRealTimers(); await run.catch(() => undefined); await close(); }
  });

  it('does not leave a history flush timer behind when provider host validation rejects the run', async () => {
    const { input, store, close } = await fixture();
    const participant = input.session.participants.find(p => p.kind === 'agent')!;
    if (participant.kind !== 'agent') throw new Error('Missing agent');
    participant.session = { provider: 'claude', started: true, hostId: crypto.randomUUID(), sessionId: 'other-host' };
    const save = vi.spyOn(store, 'saveTurnActivity');
    const runner = { run: vi.fn() } as AgentProcessRunner;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await expect(runConversation({ ...input, runner })).rejects.toThrow('belongs to another host');
      await vi.advanceTimersByTimeAsync(2000);
      expect(save).not.toHaveBeenCalled();
      expect(runner.run).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); await close(); }
  });
});
