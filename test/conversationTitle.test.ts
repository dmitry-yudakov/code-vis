import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateConversationTitle, parseConversationTitle, titleModelSelection } from '@/server/conversation/conversationTitle';
import { getConfig } from '@/server/config';
import { publicSession, SessionStore } from '@/server/storage/sessionStore';
import { hydrateSession, reconcileSessionTitles, serializeSessionExport } from '@/features/conversation/sessionStore';
import type { AgentProcessRun, AgentProvider, ArenaMachineSnapshot, AssistantMessage, ModelChoices } from '@/shared/types';

const mocks = vi.hoisted(() => ({ run: vi.fn(), adapters: vi.fn() }));
vi.mock('@/server/agents/providerRegistry', () => ({ getProviderAdapters: mocks.adapters }));
const roots: string[] = [];
const stores: SessionStore[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(stores.splice(0).map(store => store.close()));
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
  vi.clearAllMocks();
});

async function fixture(provider: AgentProvider = 'claude') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codeai-title-'));
  roots.push(root);
  const store = new SessionStore(path.join(root, 'data'));
  stores.push(store);
  let session = await store.createSession({ provider });
  const user = { id: crypto.randomUUID(), role: 'user' as const, authorId: session.participants.find(p => p.kind === 'human')!.id,
    addressedParticipantId: session.primaryAgentId, text: 'Could you help me improve our conversation titles?',
    createdAt: new Date().toISOString(), status: 'sending' as const, diagramAttachments: [] };
  await store.appendUserMessage(session.id, user);
  session = await store.getSession(session.id);
  const reply: AssistantMessage = { id: crypto.randomUUID(), role: 'assistant', authorId: session.primaryAgentId,
    createdAt: new Date().toISOString(), status: 'complete', rawMarkdown: 'Generate titles after the first reply.',
    blocks: [{ kind: 'markdown', markdown: 'Generate titles after the first reply.' }] };
  await store.completeAssistantMessage(session.id, session.primaryAgentId, user.id, reply);
  mocks.run.mockResolvedValue({ finalText: 'Improve conversation titles', sessionId: 'private-title', durationMs: 1, outputBytes: 27 });
  mocks.adapters.mockReturnValue({ [provider]: { createRunner: () => ({ run: mocks.run }) } });
  const input = { session, participantId: session.primaryAgentId, messageId: user.id, sessionStore: store,
    config: { ...getConfig(), dataDir: store.dataDirectory },
    choices: { models: [{ id: provider === 'claude' ? 'haiku' : 'codex-mini', label: 'Small', efforts: [] }] } };
  return { store, session, user, reply, input };
}

describe('background conversation titles', () => {
  it.each(['claude', 'codex'] as const)('uses a fresh bounded %s request and persists only the title', async provider => {
    const { input, store, session } = await fixture(provider);
    const before = await store.getSession(session.id);
    await generateConversationTitle(input);
    const saved = await store.getSession(session.id);
    expect(saved).toEqual({ ...before, title: 'Improve conversation titles', revision: before.revision + 1 });
    const request = mocks.run.mock.lastCall![0] as AgentProcessRun;
    expect(request).toMatchObject({ titleOnly: true, session: { action: 'start' }, model: provider === 'claude' ? 'haiku' : 'codex-mini',
      policy: { level: 'guarded', mode: 'ask', tools: [], allowedTools: [], interactivePermissions: false, maxTurns: 1, timeoutMs: 30_000 } });
    expect(request.checkout.realPath).toBe(request.attachmentDirectory);
    expect(request.prompt).toContain('Could you help me improve our conversation titles?');
    expect(request.prompt).toContain('Generate titles after the first reply.');
    expect(request.prompt).not.toContain('private-title');
    expect(request.globalInstructions).toBeUndefined();
    expect(mocks.adapters.mock.calls[0][0].maxAssistantBytes).toBe(1024);
  });

  it('preserves concurrent messages and the latest activity timestamp while a title is pending', async () => {
    const { input, store, session, user } = await fixture();
    let finish!: (result: unknown) => void;
    mocks.run.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = generateConversationTitle(input);
    await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledOnce());
    await store.appendUserMessage(session.id, { ...user, id: crypto.randomUUID(), text: 'Please implement this.' });
    const concurrent = await store.getSession(session.id);
    finish({ finalText: 'Improve conversation titles' });
    await pending;
    expect(await store.getSession(session.id)).toEqual({ ...concurrent, title: 'Improve conversation titles', revision: concurrent.revision + 1 });
  });

  it.each(['', 'First line\nSecond line', 'x'.repeat(73)])('keeps the placeholder for invalid output %j', async finalText => {
    const { input, store, session } = await fixture();
    mocks.run.mockResolvedValueOnce({ finalText });
    const before = await store.getSession(session.id);
    await generateConversationTitle(input);
    expect(await store.getSession(session.id)).toEqual(before);
  });

  it('contains provider failures and never attempts generation for an already answered session', async () => {
    const { input, store, session } = await fixture();
    mocks.run.mockRejectedValueOnce(new Error('Unavailable model'));
    await expect(generateConversationTitle(input)).resolves.toBeUndefined();
    expect((await store.getSession(session.id)).title).toBe(session.title);
    await generateConversationTitle({ ...input, session: await store.getSession(session.id) });
    expect(mocks.run).toHaveBeenCalledOnce();
  });

  it('skips failed replies and duplicate scheduling while a request is pending', async () => {
    const { input, store, reply, session } = await fixture();
    const unanswered = { ...input, messageId: crypto.randomUUID() };
    await generateConversationTitle(unanswered);
    expect(mocks.run).not.toHaveBeenCalled();
    let finish!: (result: unknown) => void;
    mocks.run.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = generateConversationTitle(input);
    await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledOnce());
    await generateConversationTitle(input);
    finish({ finalText: 'Improve conversation titles' });
    await pending;
    expect((await store.getSession(session.id)).messages.at(-1)?.id).toBe(reply.id);
    expect(mocks.run).toHaveBeenCalledOnce();
  });

  it('does not overwrite a changed title or a different first response', async () => {
    const { store, session, reply } = await fixture();
    const before = await store.getSession(session.id);
    expect(await store.saveGeneratedTitle(session.id, 'Different placeholder', reply.id, 'Wrong title')).toBe(false);
    expect(await store.saveGeneratedTitle(session.id, session.title, crypto.randomUUID(), 'Wrong title')).toBe(false);
    expect(await store.getSession(session.id)).toEqual(before);
  });

  it('does not resurrect an archived session when a title finishes', async () => {
    const { input, store, session } = await fixture();
    mocks.run.mockImplementationOnce(async () => {
      const current = await store.getSession(session.id);
      await store.archiveSession(session.id, current.revision);
      return { finalText: 'Improve conversation titles' };
    });
    await expect(generateConversationTitle(input)).resolves.toBeUndefined();
    expect((await store.getArchivedSession(session.id)).title).toBe(session.title);
  });

  it('bounds input excerpts instead of sending the full transcript or evidence', async () => {
    const { input, store, session } = await fixture();
    const saved = await store.getSession(session.id);
    const get = vi.spyOn(store, 'getSession');
    get.mockResolvedValueOnce({ ...saved, messages: saved.messages.map(message => message.role === 'user'
      ? { ...message, text: 'a'.repeat(100_000) } : { ...message, rawMarkdown: 'b'.repeat(100_000) }) });
    await generateConversationTitle(input);
    expect((mocks.run.mock.lastCall![0] as AgentProcessRun).prompt.length).toBeLessThan(13_000);
  });

  it('caps background jobs without queuing another session', async () => {
    const first = await fixture();
    const second = await fixture();
    const third = await fixture();
    const finish: Array<(result: unknown) => void> = [];
    mocks.run.mockImplementation(() => new Promise(resolve => { finish.push(resolve); }));
    const pending = [generateConversationTitle(first.input), generateConversationTitle(second.input)];
    try {
      await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(2));
      await generateConversationTitle(third.input);
      expect(mocks.run).toHaveBeenCalledTimes(2);
      expect((await third.store.getSession(third.session.id)).title).toBe(third.session.title);
    } finally {
      finish.forEach(resolve => resolve({ finalText: 'Improve conversation titles' }));
      await Promise.all(pending);
    }
  });

  it('discards a title that arrives after the independent deadline', async () => {
    const { input, store, session } = await fixture();
    mocks.run.mockImplementationOnce((request: AgentProcessRun) => new Promise(resolve => {
      request.signal.addEventListener('abort', () => resolve({ finalText: 'Late title' }), { once: true });
    }));
    vi.useFakeTimers();
    const pending = generateConversationTitle(input);
    await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(30_000);
    await pending;
    expect((await store.getSession(session.id)).title).toBe(session.title);
  });

  it('aborts unexpected tool activity without promoting its result into a title', async () => {
    const { input, store, session } = await fixture();
    mocks.run.mockImplementationOnce(async (request: AgentProcessRun) => {
      request.emit({ type: 'history', activity: { kind: 'tool', key: 'unexpected', tool: 'Read', status: 'running' } });
      expect(request.signal.aborted).toBe(true);
      return { finalText: 'Unexpected title' };
    });
    await generateConversationTitle(input);
    expect((await store.getSession(session.id)).title).toBe(session.title);
  });
});

describe('title models and output', () => {
  const choices: ModelChoices = { models: [
    { id: 'big-model', label: 'Big', efforts: ['high', 'medium', 'low'] },
    { id: 'codex-mini', label: 'Mini', efforts: ['medium', 'minimal'] },
  ], efforts: ['low'] };
  it('prefers an advertised small model and its lowest supported effort', () => {
    expect(titleModelSelection('codex', choices, 'big-model')).toEqual({ model: 'codex-mini', effort: 'minimal' });
    expect(titleModelSelection('codex', { models: choices.models!.slice(0, 1) }, 'big-model')).toEqual({ model: 'big-model', effort: 'low' });
    expect(titleModelSelection('codex', {})).toEqual({});
    expect(titleModelSelection('claude', { models: [{ id: 'haiku', label: 'Haiku', efforts: [] }] })).toEqual({ model: 'haiku' });
  });
  it('accepts short plain titles, including quoted and non-English titles', () => {
    expect(parseConversationTitle(' "Improve conversation titles" ')).toBe('Improve conversation titles');
    expect(parseConversationTitle('改善会话标题')).toBe('改善会话标题');
    expect(parseConversationTitle('Fix C# nullable warnings')).toBe('Fix C# nullable warnings');
    for (const invalid of ['## A heading', '```title```', 'Title\u0000injected', 'a\nb']) expect(parseConversationTitle(invalid)).toBeUndefined();
  });
});

describe('late title reconciliation', () => {
  it('updates only the title of a matching fresh machine summary and rejects stale snapshots', async () => {
    const { store, session } = await fixture();
    const snapshot = publicSession(await store.getSession(session.id));
    const local = { ...hydrateSession(snapshot), machineId: 'executor' };
    const machines = [{ machine: { id: 'executor', state: 'online' }, snapshotFresh: true,
      sessions: [{ id: local.id, revision: local.revision + 2, title: 'Improve conversation titles' }] }] as ArenaMachineSnapshot[];
    const changed = reconcileSessionTitles([local], machines, 'home');
    expect(changed[0]).toMatchObject({ title: 'Improve conversation titles', revision: local.revision, titleRevision: local.revision + 2 });
    expect(changed[0].messages).toBe(local.messages);
    expect(serializeSessionExport(changed[0]).session).not.toHaveProperty('titleRevision');
    expect(hydrateSession(snapshot, changed[0]).title).toBe('Improve conversation titles');
    const stale = structuredClone(machines);
    stale[0].sessions[0] = { ...stale[0].sessions[0], revision: local.revision + 1, title: 'Old title' };
    expect(reconcileSessionTitles(changed, stale, 'home')).toBe(changed);
    stale[0].machine.state = 'online';
    stale[0].snapshotFresh = false;
    expect(reconcileSessionTitles(changed, stale, 'home')).toBe(changed);
    stale[0].sessions[0].revision += 4;
    stale[0].machine.state = 'offline';
    expect(reconcileSessionTitles(changed, stale, 'home')).toBe(changed);
    expect(reconcileSessionTitles([local], machines, 'executor')[0].title).toBe('Improve conversation titles');
    const foreign = structuredClone(machines);
    foreign[0].machine.id = 'another-executor';
    const unchanged = [local];
    expect(reconcileSessionTitles(unchanged, foreign, 'home')).toBe(unchanged);
  });
});
