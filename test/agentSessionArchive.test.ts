import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkSessionCompletion, completionContext } from '@/server/conversation/agentSessionArchive';
import { getConfig } from '@/server/config';
import { publicSession, arenaSessionSummary, completedArchiveReply, SessionStore } from '@/server/storage/sessionStore';
import { RunRegistry } from '@/server/runs/runRegistry';
import { durableSessionSchema } from '@/shared/sessionSchema';
import { createTurn, finishTurn, updateActivity } from '@/shared/turnActivity';
import { hydrateSession, reconcileSessionTitles } from '@/features/conversation/sessionStore';
import type { AgentProcessRun, AgentProvider, ArenaMachineSnapshot, AssistantMessage } from '@/shared/types';

const mocks = vi.hoisted(() => ({ run: vi.fn(), adapters: vi.fn() }));
vi.mock('@/server/agents/providerRegistry', () => ({ getProviderAdapters: mocks.adapters }));
const roots: string[] = [];
const stores: SessionStore[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(stores.splice(0).map(store => store.close()));
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
  vi.resetAllMocks();
});

function reserve(registry: RunRegistry, sessionId: string, blockedBySessions: string[] = []) {
  const runId = crypto.randomUUID();
  const reservation = registry.reserve({ runId, sessionId, participantId: 'agent', providerKey: sessionId,
    checkoutId: 'checkout', checkoutPath: '/fixture', access: 'write', blockedBySessions, cancel() {} });
  expect(reservation.accepted).toBe(true);
  return runId;
}

async function fixture(provider: AgentProvider = 'claude', allowed = true) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codeai-agent-archive-'));
  roots.push(root);
  const store = new SessionStore(path.join(root, 'data'));
  stores.push(store);
  let session = await store.createSession({ provider, allowAgentArchive: allowed });
  const user = { id: crypto.randomUUID(), role: 'user' as const,
    authorId: session.participants.find(p => p.kind === 'human')!.id,
    addressedParticipantId: session.primaryAgentId, text: 'Fix the label and verify it.',
    createdAt: new Date().toISOString(), status: 'sending' as const, diagramAttachments: [] };
  await store.appendUserMessage(session.id, user);
  const reply: AssistantMessage = { id: crypto.randomUUID(), role: 'assistant', authorId: session.primaryAgentId,
    createdAt: new Date().toISOString(), status: 'complete', rawMarkdown: 'Fixed the label. Focused checks pass.',
    blocks: [{ kind: 'markdown', markdown: 'Fixed the label. Focused checks pass.' }] };
  session = await store.completeAssistantMessage(session.id, session.primaryAgentId, user.id, reply);
  mocks.run.mockResolvedValue({ finalText: 'ARCHIVE', sessionId: 'private-check', durationMs: 1, outputBytes: 7 });
  mocks.adapters.mockReturnValue({ [provider]: { createRunner: () => ({ run: mocks.run }) } });
  const registry = new RunRegistry();
  const input = { sessionId: session.id, messageId: reply.id, sessionStore: store, registry,
    config: { ...getConfig(), dataDir: store.dataDirectory }, model: 'chosen-model', effort: 'low' };
  return { root, store, session, user, reply, registry, input };
}

describe('agent session archive permission', () => {
  it('checks a completed canonical reply even when activity history was shortened', async () => {
    const { store, session, user, reply, input } = await fixture();
    const followup = { ...user, id: crypto.randomUUID(), text: 'Commit the verified changes.' };
    const turn = updateActivity(createTurn(crypto.randomUUID(), followup.id, session.primaryAgentId,
      new Date().toISOString()), 1, { kind: 'gap', key: 'retained-history', reason: 'Older activity was omitted.' });
    expect(turn.incomplete).toBe(true);
    await store.appendUserMessage(session.id, { ...followup, turn });
    const final = { ...reply, id: crypto.randomUUID(), rawMarkdown: 'Committed. Working tree is clean.' };
    const saved = await store.completeAssistantMessage(session.id, session.primaryAgentId, followup.id, final,
      finishTurn(turn, 'completed'));
    await checkSessionCompletion({ ...input, messageId: final.id });
    expect(mocks.run).toHaveBeenCalledOnce();
    expect((await store.getArchivedSession(session.id)).messages).toEqual(saved.messages);
  });

  it('requires a completed, delivered current reply independently of activity retention', async () => {
    const { session, user, reply } = await fixture();
    const turn = createTurn(crypto.randomUUID(), user.id, session.primaryAgentId, user.createdAt);
    const sent = { ...user, status: 'sent' as const, turn: finishTurn(turn, 'completed') };
    const current = { ...session, messages: [sent, reply] };
    expect(completedArchiveReply(current, reply.id)).toEqual(reply);
    for (const lifecycle of ['queued', 'running', 'suspended', 'interrupted', 'failed', 'cancelled'] as const) {
      expect(completedArchiveReply({ ...current, messages: [{ ...sent, turn: { ...sent.turn, lifecycle } }, reply] }, reply.id)).toBeUndefined();
    }
    for (const status of ['sending', 'failed', 'cancelled'] as const) {
      expect(completedArchiveReply({ ...current, messages: [{ ...sent, status }, reply] }, reply.id)).toBeUndefined();
    }
    expect(completedArchiveReply({ ...current, messages: [sent, { ...reply, planProposed: true }] }, reply.id)).toBeUndefined();
    expect(completedArchiveReply(current, crypto.randomUUID())).toBeUndefined();
  });

  it('defaults off, upgrades only opted-in records and projects permission publicly', async () => {
    const { store, session } = await fixture('claude', false);
    expect(session.allowAgentArchive).not.toBe(true);
    expect(session.version).toBe(4);
    const enabled = await store.setAgentArchiveAllowed(session.id, true, false);
    expect(enabled.version).toBe(15);
    expect(publicSession(enabled).allowAgentArchive).toBe(true);
    expect(arenaSessionSummary(enabled).allowAgentArchive).toBe(true);
    expect(durableSessionSchema.safeParse({ ...enabled, version: 14 }).success).toBe(false);
    const child = await store.createSession({ provider: 'claude', sourceSessionId: session.id, execution: 'local' });
    expect(child.allowAgentArchive).not.toBe(true);
    await expect(store.setAgentArchiveAllowed(session.id, false, false)).rejects.toThrow(/changed/i);
    expect((await store.setAgentArchiveAllowed(session.id, false, true)).allowAgentArchive).toBe(false);
  });

  it('invalidates a check across permission off/on and keeps the transcript intact', async () => {
    const { store, session, input } = await fixture();
    mocks.run.mockImplementationOnce(async () => {
      await store.setAgentArchiveAllowed(session.id, false, true);
      await store.setAgentArchiveAllowed(session.id, true, false);
      return { finalText: 'ARCHIVE' };
    });
    await checkSessionCompletion(input);
    const saved = await store.getSession(session.id);
    expect(saved.messages).toEqual(session.messages);
    expect(saved.agentArchiveCheck).toBeUndefined();
  });

  it('retains cross-device permission/check metadata ahead of an older full snapshot', async () => {
    const { session } = await fixture();
    const snapshot = publicSession(session);
    const newer = { ...arenaSessionSummary(session), revision: session.revision + 2, allowAgentArchive: false };
    const machine = { machine: { id: 'machine', state: 'online' }, sessions: [newer] } as unknown as ArenaMachineSnapshot;
    const reconciled = reconcileSessionTitles([hydrateSession(snapshot)], [machine], 'machine')[0];
    expect(reconciled.allowAgentArchive).toBe(false);
    expect(reconciled.revision).toBe(snapshot.revision);
    expect(reconciled.titleRevision).toBe(newer.revision);
    expect(hydrateSession(snapshot, reconciled).allowAgentArchive).toBe(false);
  });
});

describe('separate session completion inference', () => {
  it.each(['claude', 'codex'] as const)('archives a completed %s session with a fresh isolated request and restores the final answer', async provider => {
    const { store, session, reply, registry, input } = await fixture(provider);
    const notify = vi.spyOn(registry, 'sessionArchived');
    await checkSessionCompletion(input);
    const saved = await store.getArchivedSession(session.id);
    expect(saved.messages).toEqual(session.messages);
    expect(saved.agentArchiveCheck).toMatchObject({ messageId: reply.id, status: 'archived' });
    expect(notify).toHaveBeenCalledExactlyOnceWith(session.id);
    const request = mocks.run.mock.lastCall![0] as AgentProcessRun;
    expect(request).toMatchObject({ backgroundTask: 'archive-check', session: { action: 'start' }, model: 'chosen-model', effort: 'low',
      policy: { level: 'guarded', mode: 'ask', tools: [], allowedTools: [], interactivePermissions: false, maxTurns: 1, timeoutMs: 30_000 } });
    expect(request.session.id).not.toBe(session.participants.find(p => p.kind === 'agent')?.id);
    expect(request.checkout.realPath).toBe(request.attachmentDirectory);
    expect(request.globalInstructions).toBeUndefined();
    expect(request.userCustomizations).toBeUndefined();
    expect(request.prompt).toContain('Fix the label and verify it.');
    expect(request.prompt).toContain('Fixed the label. Focused checks pass.');
    expect(request.prompt).toContain('data');
    expect(mocks.adapters.mock.calls[0][0].maxAssistantBytes).toBe(1024);
    const restored = await store.restoreSession(session.id, saved.revision);
    expect(restored.messages).toEqual(session.messages);
    expect(restored.agentArchiveCheck).toBeUndefined();
  });

  it.each(['KEEP_OPEN', 'ARCHIVE because done', '```\nARCHIVE\n```', '', 'roger_that'])('keeps the session open for %j', async finalText => {
    const { store, session, input } = await fixture();
    mocks.run.mockResolvedValueOnce({ finalText });
    await checkSessionCompletion(input);
    const saved = await store.getSession(session.id);
    expect(saved.agentArchiveCheck?.status).toBe(finalText === 'KEEP_OPEN' ? 'kept-open' : 'failed');
    expect(saved.messages).toEqual(session.messages);
    expect(saved.updatedAt).toBe(session.updatedAt);
  });

  it('does not invoke a checker without permission, regardless of user text', async () => {
    const { store, session, user, registry, input } = await fixture('claude', false);
    const acquire = vi.spyOn(registry, 'acquireSessionArchive');
    expect(user.text).toBeTruthy();
    await checkSessionCompletion(input);
    expect(mocks.run).not.toHaveBeenCalled();
    expect(acquire).not.toHaveBeenCalled();
    expect((await store.getSession(session.id)).agentArchiveCheck).toBeUndefined();
  });

  it('invalidates a pending decision when a new user message arrives', async () => {
    const { store, session, user, input } = await fixture();
    mocks.run.mockImplementationOnce(async () => {
      await store.appendUserMessage(session.id, { ...user, id: crypto.randomUUID(), text: 'One more thing.' });
      return { finalText: 'ARCHIVE' };
    });
    await checkSessionCompletion(input);
    const saved = await store.getSession(session.id);
    expect(saved.messages).toHaveLength(3);
    expect(saved.agentArchiveCheck).toBeUndefined();
  });

  it('checks a completed follow-up after its older pending check returns', async () => {
    const { store, session, user, reply, input } = await fixture();
    let unblock!: () => void;
    const held = new Promise<void>(resolve => { unblock = resolve; });
    mocks.run.mockImplementationOnce(async () => { await held; return { finalText: 'ARCHIVE' }; });
    const first = checkSessionCompletion(input);
    await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(1));
    const followup = { ...user, id: crypto.randomUUID(), text: 'Also fix the tooltip.' };
    await store.appendUserMessage(session.id, followup);
    const final = { ...reply, id: crypto.randomUUID(), rawMarkdown: 'Both labels fixed and verified.' };
    await store.completeAssistantMessage(session.id, session.primaryAgentId, followup.id, final);
    await checkSessionCompletion({ ...input, messageId: final.id });
    unblock(); await first;
    await vi.waitFor(async () => expect((await store.getArchivedSession(session.id)).agentArchiveCheck?.messageId).toBe(final.id));
    expect(mocks.run).toHaveBeenCalledTimes(2);
    expect((await store.getArchivedSession(session.id)).messages).toHaveLength(4);
  });

  it.each(['permission', 'restore'])('retains an explicit same-reply retry after %s invalidates an in-flight check', async change => {
    const { store, session, input } = await fixture();
    let unblock!: () => void;
    const held = new Promise<void>(resolve => { unblock = resolve; });
    mocks.run.mockImplementationOnce(async () => { await held; return { finalText: 'ARCHIVE' }; });
    const first = checkSessionCompletion(input);
    await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(1));
    if (change === 'permission') {
      await store.setAgentArchiveAllowed(session.id, false, true);
      await store.setAgentArchiveAllowed(session.id, true, false);
    } else {
      const current = await store.getSession(session.id);
      const archived = await store.archiveSession(session.id, current.revision);
      await store.restoreSession(session.id, archived.revision);
    }
    await checkSessionCompletion(input);
    unblock(); await first;
    await vi.waitFor(async () => expect((await store.getArchivedSession(session.id)).agentArchiveCheck?.status).toBe('archived'));
    expect(mocks.run).toHaveBeenCalledTimes(2);
  });

  it('leaves failed inference retryable and a later explicit check can archive', async () => {
    const { store, session, input } = await fixture();
    mocks.run.mockRejectedValueOnce(new Error('provider unavailable'));
    await checkSessionCompletion(input);
    expect((await store.getSession(session.id)).agentArchiveCheck?.status).toBe('failed');
    await checkSessionCompletion({ ...input, model: undefined, effort: undefined });
    expect(mocks.run.mock.lastCall![0]).toMatchObject({ model: 'chosen-model', effort: 'low' });
    expect((await store.getArchivedSession(session.id)).messages).toEqual(session.messages);
  });

  it('leaves an archive write failure recoverable and releases its lease for retry', async () => {
    const { store, session, registry, input } = await fixture();
    const notify = vi.spyOn(registry, 'sessionArchived');
    vi.spyOn(store, 'archiveSession').mockRejectedValueOnce(new Error('disk unavailable'));
    await checkSessionCompletion(input);
    const kept = await store.getSession(session.id);
    expect(kept.agentArchiveCheck?.status).toBe('failed');
    expect(kept.messages).toEqual(session.messages);
    expect(notify).not.toHaveBeenCalled();
    await checkSessionCompletion(input);
    expect((await store.getArchivedSession(session.id)).agentArchiveCheck?.status).toBe('archived');
  });

  it('a manual archive and restore invalidate the old inference', async () => {
    const { store, session, input } = await fixture();
    mocks.run.mockImplementationOnce(async () => {
      const current = await store.getSession(session.id);
      const archived = await store.archiveSession(session.id, current.revision);
      await store.restoreSession(session.id, archived.revision);
      return { finalText: 'ARCHIVE' };
    });
    await checkSessionCompletion(input);
    expect((await store.getSession(session.id)).agentArchiveCheck).toBeUndefined();
  });

  it('respects a follow-up reservation even before its user message is appended', async () => {
    const { store, session, registry, input } = await fixture();
    let following!: string;
    mocks.run.mockImplementationOnce(async () => {
      following = reserve(registry, session.id);
      return { finalText: 'ARCHIVE' };
    });
    try {
      await checkSessionCompletion(input);
      expect((await store.getSession(session.id)).messages).toEqual(session.messages);
    } finally { registry.release(following); }
  });

  it('waits for the coding run to release ownership before inference and advances its archive-gated successor', async () => {
    const { store, session, registry, input } = await fixture();
    const working = reserve(registry, session.id);
    const next = reserve(registry, crypto.randomUUID(), [session.id]);
    const execute = vi.fn().mockResolvedValue(undefined);
    registry.activate(next, { execute, cancelQueued: async () => undefined });
    const checking = checkSessionCompletion({ ...input, afterRunId: working });
    await Promise.resolve();
    expect(mocks.run).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    registry.finish(working);
    await checking;
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    await registry.wait(next);
    expect((await store.getArchivedSession(session.id)).agentArchiveCheck?.status).toBe('archived');
  });

  it('does not start during an unrelated device\'s live turn on the same session', async () => {
    const { store, session, registry, input } = await fixture();
    const working = reserve(registry, session.id);
    try {
      await checkSessionCompletion(input);
      expect(mocks.run).not.toHaveBeenCalled();
      expect((await store.getSession(session.id)).agentArchiveCheck).toBeUndefined();
    } finally { registry.release(working); }
  });

  it('rejects tool attempts even when the provider then returns ARCHIVE', async () => {
    const { store, session, input } = await fixture();
    mocks.run.mockImplementationOnce(async (request: AgentProcessRun) => {
      request.emit({ type: 'activity', tool: 'Bash', detail: 'true' });
      return { finalText: 'ARCHIVE' };
    });
    await checkSessionCompletion(input);
    expect((await store.getSession(session.id)).agentArchiveCheck?.status).toBe('failed');
  });

  it('refuses oversized complete context instead of classifying a truncated task', async () => {
    const { store, session, user, reply, input } = await fixture();
    expect(completionContext({ ...session, messages: [{ ...user, text: 'x'.repeat(70_000) }, reply] })).toBeUndefined();
    const next = { ...user, id: crypto.randomUUID(), text: 'Second task' };
    await store.appendUserMessage(session.id, next);
    const large = { ...reply, id: crypto.randomUUID(), rawMarkdown: 'x'.repeat(70_000) };
    await store.completeAssistantMessage(session.id, session.primaryAgentId, next.id, large);
    await checkSessionCompletion({ ...input, messageId: large.id });
    expect(mocks.run).not.toHaveBeenCalled();
    const saved = await store.getSession(session.id);
    expect(saved.messages).toHaveLength(4);
    expect(saved.agentArchiveCheck?.status).toBe('failed');
  });

  it('deduplicates concurrent checks and does not hold session admission during inference', async () => {
    const { store, session, registry, input } = await fixture();
    let unblock!: () => void;
    const held = new Promise<void>(resolve => { unblock = resolve; });
    mocks.run.mockImplementationOnce(async () => { await held; return { finalText: 'KEEP_OPEN' }; });
    const first = checkSessionCompletion(input);
    await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(1));
    const release = registry.acquireSessionArchive(session.id);
    expect(release).toBeTypeOf('function');
    release?.();
    await checkSessionCompletion(input);
    expect(mocks.run).toHaveBeenCalledTimes(1);
    unblock();
    await first;
    expect((await store.getSession(session.id)).agentArchiveCheck?.status).toBe('kept-open');
  });

  it('bounds simultaneous inferences and exposes retry feedback for overflow', async () => {
    const one = await fixture();
    const two = await fixture();
    const three = await fixture();
    let unblock!: () => void;
    const held = new Promise<void>(resolve => { unblock = resolve; });
    mocks.run.mockImplementation(async () => { await held; return { finalText: 'KEEP_OPEN' }; });
    const checks = [checkSessionCompletion(one.input), checkSessionCompletion(two.input)];
    try {
      await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(2));
      await checkSessionCompletion(three.input);
      expect(mocks.run).toHaveBeenCalledTimes(2);
      expect((await three.store.getSession(three.session.id)).agentArchiveCheck?.status).toBe('failed');
    } finally { unblock(); await Promise.all(checks); }
  });

  it('aborts a timed-out inference and refuses its late ARCHIVE result', async () => {
    const { store, session, input } = await fixture();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    mocks.run.mockImplementationOnce((request: AgentProcessRun) => new Promise(resolve => {
      request.signal.addEventListener('abort', () => resolve({ finalText: 'ARCHIVE' }), { once: true });
    }));
    const checking = checkSessionCompletion(input);
    await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(30_000);
    await checking;
    expect((await store.getSession(session.id)).agentArchiveCheck?.status).toBe('failed');
  });
});
