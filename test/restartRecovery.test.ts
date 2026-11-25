import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentErrorCode, AgentProcessRun, AgentProcessResult, DurableSession, SteerTurn } from '@/shared/types';

const provider = vi.hoisted(() => ({
  jobs: [] as Array<{ input: AgentProcessRun; finish(): void }>,
  finish: false, aborted: 0, cleanup: Promise.resolve(),
  abortCode: 'cancelled' as AgentErrorCode,
  steer: undefined as SteerTurn | undefined,
}));
vi.mock('@/server/agents/providerRegistry', async () => {
  const { AgentRunError } = await import('@/server/agents/agentRunError');
  const adapter = {
    checkHealth: async () => ({ available: true, authenticated: true, supportedModes: ['ask', 'plan', 'agent'] }),
    createRunner: () => ({ async run(input: AgentProcessRun): Promise<AgentProcessResult> {
      const sessionId = input.session.id ?? crypto.randomUUID();
      input.emit({ type: 'session-started', sessionId });
      input.emit({ type: 'turn-started' });
      input.emit({ type: 'phase', phase: 'thinking' });
      if (provider.steer) input.onSteer?.(provider.steer);
      return new Promise((resolve, reject) => {
        const finish = () => resolve({ finalText: 'Completed remaining work.', sessionId, durationMs: 1, outputBytes: 25 });
        provider.jobs.push({ input, finish });
        input.signal.addEventListener('abort', () => {
          provider.aborted++;
          void provider.cleanup.then(() => reject(new AgentRunError(provider.abortCode, 'Provider stopped for maintenance.')));
        }, { once: true });
        if (provider.finish) finish();
      });
    } }),
  };
  return { getProviderAdapters: () => ({ claude: adapter, codex: adapter }) };
});
vi.mock('@/server/conversation/conversationTitle', () => ({ generateConversationTitle: vi.fn() }));
vi.mock('@/server/conversation/agentSessionArchive', () => ({ checkSessionCompletion: vi.fn() }));

import { submitMessage } from '@/server/conversation/submitMessage';
import { getConfig } from '@/server/config';
import { getCheckoutRegistry } from '@/server/repository/checkoutRegistry';
import { getSessionStore } from '@/server/storage/sessionStore';
import { runRegistry } from '@/server/runs/runRegistry';
import { CodeAiLifecycle } from '@/server/lifecycle/codeAiLifecycle';
import { SuspendedTurns } from '@/server/lifecycle/suspendedTurns';
import { resumeSuspendedTurns } from '@/server/lifecycle/resumeSuspendedTurns';
import { getTurnCheckpoints } from '@/server/repository/turnCheckpoints';
import { POST as archiveSession } from '@/app/api/sessions/[sessionId]/archive/route';
import { POST as steerMessage } from '@/app/api/agent/steer/route';
import type { ManagedBridge } from '@/server/lifecycle/managedBridge';
import type { ServerLifecycleMessage } from '@/shared/codeAiLifecycle';

const PNG = Buffer.from('89504e470d0a1a0a0000000049454e44ae426082', 'hex');
const image = { dataUrl: `data:image/png;base64,${PNG.toString('base64')}` };

describe.sequential('planned restart recovery', () => {
  let root: string;
  let dataDir: string;
  let checkoutId: string;
  const scope = globalThis as typeof globalThis & { __codeAiSessionStores?: Map<string, unknown> };

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'codeai-restart-recovery-'));
    dataDir = path.join(root, 'data');
    await mkdir(path.join(root, 'repositories', 'repo'), { recursive: true });
    await writeFile(path.join(root, 'repositories', 'repo', 'package.json'), '{}');
    vi.stubEnv('CODEAI_DATA_DIR', dataDir);
    vi.stubEnv('CODEAI_REPOSITORIES_ROOT', path.join(root, 'repositories'));
    vi.stubEnv('CODEAI_REMOTE_ACCESS', 'local');
    provider.jobs = []; provider.finish = false; provider.aborted = 0; provider.cleanup = Promise.resolve(); provider.abortCode = 'cancelled';
    provider.steer = undefined;
    checkoutId = (await getCheckoutRegistry(getConfig().repositoriesRoot, getConfig().repositoryDiscoveryDepth).list())[0].id;
  });
  afterEach(async () => {
    runRegistry.releaseMaintenance();
    await Promise.all(runRegistry.currentRuns.filter(run => run.startedAt === undefined).map(run => runRegistry.cancel(run.runId)));
    for (const job of provider.jobs) job.finish();
    await Promise.all(runRegistry.currentRuns.map(run => runRegistry.wait(run.runId)));
    await getSessionStore(dataDir).close();
    scope.__codeAiSessionStores?.delete(dataDir);
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  async function send(extra: Record<string, unknown> = {}, existingSession?: DurableSession) {
    const store = getSessionStore(dataDir);
    const session = existingSession ?? await store.createSession({ provider: 'claude', checkoutId });
    const request = { sessionId: session.id, participantId: session.primaryAgentId, messageId: crypto.randomUUID(),
      text: 'Continue implementing the requested work.', diagramAttachments: [], imageAttachments: [image], mode: 'ask', ...extra };
    const response = await submitMessage(new Request('http://localhost/message', { method: 'POST', body: JSON.stringify(request) }));
    expect(response.status, await response.clone().text()).toBe(202);
    return { session, request, runId: response.headers.get('X-CodeAI-Run-Id')! };
  }

  function lifecycle() {
    const sent: ServerLifecycleMessage[] = [];
    let receive!: (message: unknown) => void;
    const bridge: ManagedBridge = {
      init: { type: 'lifecycle-init', installationRoot: root, slot: '.next', releaseId: 'old-release' },
      connected: () => true, send: message => { sent.push(message); }, listen: listener => { receive = listener; },
    };
    return { instance: new CodeAiLifecycle(bridge, runRegistry), sent, deliver: (message: unknown) => receive(message) };
  }

  async function coldStart() {
    await getSessionStore(dataDir).close();
    scope.__codeAiSessionStores?.delete(dataDir);
    runRegistry.releaseMaintenance(); // Simulates the old process's in-memory ownership ending.
    await resumeSuspendedTurns(getConfig());
  }

  async function archive(sessionId: string) {
    const session = await getSessionStore(dataDir).getSession(sessionId);
    const response = await archiveSession(new Request('http://localhost/archive', {
      method: 'POST', body: JSON.stringify({ expectedRevision: session.revision }),
    }), { params: Promise.resolve({ sessionId }) });
    expect(response.status, await response.clone().text()).toBe(200);
  }

  it('remembers Run now across restart while the checkout is locked and leaves other ideas queued', async () => {
    const first = await send();
    await vi.waitFor(() => expect(provider.jobs).toHaveLength(1));
    provider.jobs[0].finish();
    await runRegistry.wait(first.runId);
    const queued = await send({ waitForCheckout: true });
    const later = await send({ waitForCheckout: true });
    const checkoutPath = path.join(root, 'repositories', 'repo');
    const release = runRegistry.acquireCheckoutWrite(checkoutPath)!;
    expect(release).toBeTypeOf('function');
    try {
      expect(await runRegistry.runNow(queued.runId)).toEqual({ ok: true, queued: true });
      expect(await new SuspendedTurns(dataDir).get(queued.runId)).toMatchObject({
        state: 'ready', request: { waitForCheckout: false, messageId: queued.request.messageId },
      });
      expect(provider.jobs).toHaveLength(1);
      runRegistry.finish(queued.runId, false);
      runRegistry.finish(later.runId, false);
    } finally { release(); }
    await coldStart();
    await vi.waitFor(() => expect(provider.jobs.at(-1)?.input.runId).toBe(queued.runId));
    provider.jobs.at(-1)!.finish();
    await runRegistry.wait(queued.runId);
    expect(runRegistry.list(later.session.id).active[0]).toMatchObject({ state: 'queued', canRunNow: true });
    const saved = await getSessionStore(dataDir).getSession(queued.session.id);
    expect(saved.messages).toHaveLength(2);
    expect(saved.messages[0]).toMatchObject({ id: queued.request.messageId, turn: { runId: queued.runId, lifecycle: 'completed' } });
    expect((await getSessionStore(dataDir).getSession(first.session.id)).archivedAt).toBeUndefined();
  });

  it('persists acceptance and restores edited waiting work across two ordinary process restarts', async () => {
    const first = await send();
    await vi.waitFor(() => expect(provider.jobs).toHaveLength(1));
    provider.jobs[0].finish();
    await runRegistry.wait(first.runId);
    const queued = await send({ waitForCheckout: true, fileAttachments: [{ name: 'idea.txt', text: 'Saved evidence' }] });
    const journal = new SuspendedTurns(dataDir);
    expect(await journal.get(queued.runId)).toMatchObject({ state: 'ready', request: { imageAttachments: [image] } });
    await runRegistry.editQueuedMessage(queued.runId, 'Edited before a process restart', queued.request.text);
    expect(await runRegistry.changeMode(queued.runId, 'plan')).toEqual({ ok: true });
    runRegistry.finish(queued.runId); // Discard only volatile scheduler state, as process exit does.
    await getSessionStore(dataDir).close();
    scope.__codeAiSessionStores?.delete(dataDir);
    const child = (extra: Record<string, string>) => promisify(execFile)(process.execPath,
      ['--import', 'tsx', 'test/fixtures/resume-suspended-turns.ts'], {
        cwd: process.cwd(), env: { ...process.env, CODEAI_CLAUDE_BIN: path.resolve('test/fixtures/fake-claude.mjs'),
          CODEAI_CODEX_BIN: path.resolve('test/fixtures/not-a-real-codex'), ...extra }, timeout: 15_000,
      });
    await child({ CODEAI_TEST_LEAVE_QUEUED: '1' });
    expect(await journal.get(queued.runId)).toMatchObject({ state: 'ready' });
    await child({ CODEAI_TEST_ARCHIVE_SESSIONS: first.session.id });
    const saved = await getSessionStore(dataDir).getSession(queued.session.id);
    expect(saved.messages).toHaveLength(2);
    expect(saved.messages[0]).toMatchObject({ id: queued.request.messageId, text: 'Edited before a process restart',
      imageAttachments: [{ mediaType: 'image/png' }], fileAttachments: [{ name: 'idea.txt', text: 'Saved evidence' }],
      turn: { runId: queued.runId, lifecycle: 'completed' } });
    expect(saved.messages[1].mode).toBe('plan');
    expect(await journal.list()).toEqual([]);
  }, 35_000);

  it('restores same-session follow-ups in transcript order even when journal timestamps tie', async () => {
    const first = await send();
    await vi.waitFor(() => expect(provider.jobs).toHaveLength(1));
    const second = await send({ queueIfBusy: true, text: 'Second in this session' }, first.session);
    const third = await send({ queueIfBusy: true, text: 'Third in this session' }, first.session);
    expect(runRegistry.list(first.session.id).followUps?.map(run => run.runId)).toEqual([second.runId, third.runId]);
    const journal = new SuspendedTurns(dataDir);
    const later = (await journal.get(third.runId))!;
    const earlier = (await journal.get(second.runId))!;
    const list = SuspendedTurns.prototype.list;
    vi.spyOn(SuspendedTurns.prototype, 'list').mockResolvedValueOnce([{ ...later, acceptedAt: earlier.acceptedAt }, earlier]);
    // Finish the provider so its saved session ID differs from the pre-start snapshot a follow-up may have used.
    await journal.save({ ...earlier, providerSessionId: undefined });
    await journal.save({ ...later, providerSessionId: undefined });
    expect(await runRegistry.holdStartupRecovery()).toBe('live-runs');
    expect(runRegistry.beginDrain()).toBe('acquired');
    provider.jobs[0].finish();
    await runRegistry.wait(first.runId);
    runRegistry.finish(second.runId);
    runRegistry.finish(third.runId);
    await coldStart();
    vi.spyOn(SuspendedTurns.prototype, 'list').mockImplementation(list);
    await vi.waitFor(() => expect(provider.jobs[1]?.input.runId).toBe(second.runId));
    provider.jobs[1].finish();
    await runRegistry.wait(second.runId);
    await vi.waitFor(() => expect(provider.jobs[2]?.input.runId).toBe(third.runId));
    provider.jobs[2].finish();
    await runRegistry.wait(third.runId);
    const saved = await getSessionStore(dataDir).getSession(first.session.id);
    expect(saved.messages.map(message => message.role === 'user' ? message.text : message.role))
      .toEqual([first.request.text, 'assistant', second.request.text, 'assistant', third.request.text, 'assistant']);
  });

  it('keeps a rejected steer queued and never promotes an uncertain steer after the active turn ends', async () => {
    const store = getSessionStore(dataDir);
    const session = await store.createSession({ provider: 'codex', checkoutId });
    let finishSteer!: (outcome: 'unknown') => void;
    const steer = vi.fn<SteerTurn>().mockResolvedValueOnce('rejected').mockImplementationOnce(() => new Promise(resolve => { finishSteer = resolve; }));
    provider.steer = steer;
    const first = await send({}, session);
    await vi.waitFor(() => expect(provider.jobs).toHaveLength(1));
    const second = await send({ queueIfBusy: true, imageAttachments: [], text: 'Change direction' }, session);
    const journal = new SuspendedTurns(dataDir);
    const requestSteer = (expectedText: string) => steerMessage(new Request('http://localhost/api/agent/steer', {
      method: 'POST', body: JSON.stringify({ runId: second.runId, activeRunId: first.runId, expectedText }),
    }));
    expect((await requestSteer('Stale text')).status).toBe(409);
    expect(steer).not.toHaveBeenCalled();
    expect((await requestSteer(second.request.text)).status).toBe(409);
    expect(await journal.get(second.runId)).toMatchObject({ state: 'ready' });
    const uncertain = requestSteer(second.request.text);
    await vi.waitFor(() => expect(steer).toHaveBeenCalledTimes(2));
    expect(await journal.get(second.runId)).toMatchObject({ state: 'resuming' });
    provider.jobs[0].finish();
    const beforeOutcome = await store.getSession(session.id);
    finishSteer('unknown');
    expect(beforeOutcome.messages.some(message => message.role === 'assistant')).toBe(false);
    expect((await uncertain).status).toBe(409);
    await runRegistry.wait(first.runId);
    expect(provider.jobs).toHaveLength(1);
    expect(runRegistry.list(session.id).active).toEqual([]);
    expect(await journal.get(second.runId)).toBeUndefined();
    const saved = await store.getSession(session.id);
    expect(saved.messages.find(message => message.id === second.request.messageId)).toMatchObject({ status: 'failed', delivery: 'possibly-sent' });
  });

  it('rejects admission when the full waiting request cannot be saved', async () => {
    vi.spyOn(SuspendedTurns.prototype, 'save').mockRejectedValueOnce(new Error('Disk unavailable'));
    const session = await getSessionStore(dataDir).createSession({ provider: 'claude', checkoutId });
    const response = await submitMessage(new Request('http://localhost/message', { method: 'POST', body: JSON.stringify({
      sessionId: session.id, participantId: session.primaryAgentId, messageId: crypto.randomUUID(),
      text: 'Persist this first', diagramAttachments: [], waitForCheckout: true,
    }) }));
    expect(response.status).toBe(503);
    expect(provider.jobs).toHaveLength(0);
    expect(runRegistry.currentRuns).toEqual([]);
    expect((await getSessionStore(dataDir).getSession(session.id)).messages).toEqual([]);
  });

  it('builds with only waiting sessions and retains them through a failed build', async () => {
    const first = await send();
    await vi.waitFor(() => expect(provider.jobs).toHaveLength(1));
    provider.jobs[0].finish();
    await runRegistry.wait(first.runId);
    const queued = await send({ waitForCheckout: true });
    const managed = lifecycle();
    expect(managed.instance.start()).toMatchObject({ accepted: true });
    await vi.waitFor(() => expect(managed.sent).toHaveLength(1));
    expect(provider.jobs).toHaveLength(1);
    const request = managed.sent[0];
    if (request.type !== 'lifecycle-request') throw new Error('Expected a build request');
    managed.deliver({ type: 'lifecycle-state', snapshot: { available: true, phase: 'idle', releaseId: 'old-release',
      lastOperation: { operationId: request.operationId, outcome: 'build-failed', finishedAt: new Date().toISOString() } } });
    managed.deliver({ type: 'lifecycle-lease', request: 'release' });
    expect(managed.instance.snapshot().phase).toBe('paused');
    expect(await new SuspendedTurns(dataDir).get(queued.runId)).toMatchObject({ state: 'ready' });
    await coldStart();
    expect(provider.jobs).toHaveLength(1);
    await archive(first.session.id);
    await vi.waitFor(() => expect(provider.jobs).toHaveLength(2));
    provider.jobs[1].finish();
    await runRegistry.wait(queued.runId);
  });

  it('claims execution before starting a provider and never replays an uncertain attempt', async () => {
    const sent = await send();
    await vi.waitFor(() => expect(provider.jobs).toHaveLength(1));
    const journal = new SuspendedTurns(dataDir);
    expect(await journal.get(sent.runId)).toMatchObject({ state: 'resuming' });
    runRegistry.finish(sent.runId);
    // Discard the old provider owner without completing its canonical message.
    provider.jobs = [];
    await coldStart();
    expect(provider.jobs).toHaveLength(0);
    expect((await getSessionStore(dataDir).getSession(sent.session.id)).messages[0]).toMatchObject({
      status: 'failed', delivery: 'possibly-sent', turn: { lifecycle: 'interrupted' },
    });
    expect(await journal.get(sent.runId)).toMatchObject({ state: 'resuming' });
  });

  it('keeps never-started requests replayable if maintenance stops before saving the suspended lifecycle', async () => {
    const first = await send();
    await vi.waitFor(() => expect(provider.jobs).toHaveLength(1));
    provider.jobs[0].finish();
    await runRegistry.wait(first.runId);
    const queued = await send({ waitForCheckout: true });
    const stopped = vi.spyOn(getSessionStore(dataDir), 'suspendUserMessage').mockRejectedValueOnce(new Error('Process stopped'));
    const managed = lifecycle();
    managed.instance.start();
    await vi.waitFor(() => expect(managed.instance.snapshot().phase).toBe('paused'));
    expect(managed.sent).toEqual([]);
    expect(await new SuspendedTurns(dataDir).get(queued.runId)).toMatchObject({ state: 'ready' });
    stopped.mockRestore();
    runRegistry.finish(queued.runId);
    await coldStart();
    await archive(first.session.id);
    await vi.waitFor(() => expect(provider.jobs).toHaveLength(2));
    expect(provider.jobs[1].input.runId).toBe(queued.runId);
    provider.jobs[1].finish();
    await runRegistry.wait(queued.runId);
  });

  it('does not resurrect cancelled queued work after an ordinary restart', async () => {
    const first = await send();
    await vi.waitFor(() => expect(provider.jobs).toHaveLength(1));
    provider.jobs[0].finish();
    await runRegistry.wait(first.runId);
    const queued = await send({ waitForCheckout: true });
    expect(await runRegistry.cancel(queued.runId)).toBe('accepted');
    expect(await new SuspendedTurns(dataDir).get(queued.runId)).toBeUndefined();
    await coldStart();
    await archive(first.session.id);
    expect(provider.jobs).toHaveLength(1);
    expect((await getSessionStore(dataDir).getSession(queued.session.id)).messages[0].status).toBe('cancelled');
  });

  it.each([false, true])('settles a queued mode save before promotion or cancellation (cancel: %s)', async cancel => {
    const first = await send();
    await vi.waitFor(() => expect(provider.jobs).toHaveLength(1));
    provider.jobs[0].finish();
    await runRegistry.wait(first.runId);
    const queued = await send({ waitForCheckout: true });
    const save = SuspendedTurns.prototype.save;
    let release!: () => void;
    let writing = false;
    const gate = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(SuspendedTurns.prototype, 'save').mockImplementation(async function (this: SuspendedTurns, turn) {
      if (turn.runId === queued.runId && turn.state === 'ready' && turn.request.mode === 'plan') {
        writing = true;
        await gate;
      }
      return save.call(this, turn);
    });
    const changing = runRegistry.changeMode(queued.runId, 'plan');
    await vi.waitFor(() => expect(writing).toBe(true));
    await archive(first.session.id);
    expect(provider.jobs).toHaveLength(1);
    const cancelling = cancel ? runRegistry.cancel(queued.runId) : undefined;
    release();
    await changing;
    if (cancelling) {
      expect(await cancelling).toBe('accepted');
      expect(provider.jobs).toHaveLength(1);
    } else {
      await vi.waitFor(() => expect(provider.jobs).toHaveLength(2));
      expect(provider.jobs[1].input.policy.mode).toBe('plan');
      provider.jobs[1].finish();
      await runRegistry.wait(queued.runId);
    }
    expect(await new SuspendedTurns(dataDir).get(queued.runId)).toBeUndefined();
  });

  it('restores execution slots and a full waiting queue before releasing dispatch on an unmanaged startup', async () => {
    await send();
    await send();
    await vi.waitFor(() => expect(provider.jobs).toHaveLength(2));
    const queued = [];
    for (let i = 0; i < 32; i++) queued.push(await send({ waitForCheckout: true }));
    const managed = lifecycle();
    managed.instance.start();
    await vi.waitFor(async () => expect((await new SuspendedTurns(dataDir).list()).filter(turn => turn.state === 'preparing')).toHaveLength(2));
    for (const job of provider.jobs) job.input.emit({ type: 'response-boundary', responseFinal: false });
    await vi.waitFor(() => expect(managed.sent).toHaveLength(1));
    await coldStart();
    expect(runRegistry.currentRuns).toHaveLength(34);
    expect(queued.every(turn => runRegistry.currentRuns.some(run => run.runId === turn.runId && run.state === 'queued'))).toBe(true);
  }, 20_000);

  it.each([false, true])('releases restored ideas in order after archive (predecessor archived offline: %s)', async archivedOffline => {
    const first = await send();
    await vi.waitFor(() => expect(provider.jobs).toHaveLength(1));
    const queued = await send({ waitForCheckout: true });
    const later = await send({ waitForCheckout: true });
    await runRegistry.editQueuedMessage(queued.runId, 'Edited queued work', queued.request.text);
    const managed = lifecycle();
    managed.instance.start();
    await vi.waitFor(async () => expect((await new SuspendedTurns(dataDir).list()).filter(turn => turn.state === 'ready')).toHaveLength(2));
    if (archivedOffline) provider.jobs[0].finish();
    else provider.jobs[0].input.emit({ type: 'response-boundary', responseFinal: false });
    await vi.waitFor(() => expect(managed.sent).toHaveLength(1));
    if (archivedOffline) {
      const store = getSessionStore(dataDir);
      const session = await store.getSession(first.session.id);
      await store.archiveSession(session.id, session.revision);
    }
    await coldStart();
    await vi.waitFor(() => expect(provider.jobs).toHaveLength(2));
    if (!archivedOffline) {
      expect(provider.jobs[1].input.runId).toBe(first.runId);
      provider.jobs[1].finish();
      await runRegistry.wait(first.runId);
      expect(runRegistry.currentRuns.find(run => run.runId === queued.runId)?.state).toBe('queued');
      await archive(first.session.id);
      await vi.waitFor(() => expect(provider.jobs).toHaveLength(3));
    }
    const job = provider.jobs.at(-1)!;
    expect(job.input.runId).toBe(queued.runId);
    expect(job.input.prompt).toContain('Edited queued work');
    expect(runRegistry.currentRuns.find(run => run.runId === later.runId)?.state).toBe('queued');
    job.finish();
    await runRegistry.wait(queued.runId);
    const saved = await getSessionStore(dataDir).getSession(queued.session.id);
    expect(saved.messages).toHaveLength(2);
    expect(saved.messages[0]).toMatchObject({ id: queued.request.messageId, text: 'Edited queued work',
      imageAttachments: [{ mediaType: 'image/png' }], turn: { runId: queued.runId, lifecycle: 'completed' } });
    expect(runRegistry.currentRuns.find(run => run.runId === later.runId)?.state).toBe('queued');
    await archive(queued.session.id);
    await vi.waitFor(() => expect(provider.jobs.at(-1)?.input.runId).toBe(later.runId));
    provider.jobs.at(-1)!.finish();
    await runRegistry.wait(later.runId);
    expect((await getSessionStore(dataDir).getSession(later.session.id)).messages).toHaveLength(2);
    expect(await new SuspendedTurns(dataDir).list()).toEqual([]);
  });

  it('retains earlier idle/follow-up blockers without letting an unresumable later idea block them', async () => {
    const first = await send();
    await vi.waitFor(() => expect(provider.jobs).toHaveLength(1));
    provider.jobs[0].finish();
    await runRegistry.wait(first.runId);
    const queued = await send({ waitForCheckout: true });
    const later = await send({ waitForCheckout: true });
    const response = await submitMessage(new Request('http://localhost/message', { method: 'POST',
      body: JSON.stringify({ ...first.request, messageId: crypto.randomUUID(), text: 'A normal follow-up.' }) }));
    expect(response.status).toBe(202);
    const followupRunId = response.headers.get('X-CodeAI-Run-Id')!;
    await vi.waitFor(() => expect(provider.jobs).toHaveLength(2));
    const managed = lifecycle();
    managed.instance.start();
    await vi.waitFor(async () => expect((await new SuspendedTurns(dataDir).list()).filter(turn => turn.state === 'ready')).toHaveLength(2));
    provider.jobs[1].input.emit({ type: 'response-boundary', responseFinal: false });
    await vi.waitFor(() => expect(managed.sent).toHaveLength(1));
    const journal = new SuspendedTurns(dataDir);
    // Current host validation rejects the later idea and preserves it for recovery.
    await journal.save({ ...(await journal.get(later.runId))!, hostId: crypto.randomUUID() });
    await getSessionStore(dataDir).close();
    scope.__codeAiSessionStores?.delete(dataDir);
    runRegistry.releaseMaintenance();
    expect(runRegistry.holdStartupRecovery()).toBe('acquired');
    await resumeSuspendedTurns(getConfig());
    expect(provider.jobs).toHaveLength(2);
    runRegistry.releaseMaintenance();
    await vi.waitFor(() => expect(provider.jobs).toHaveLength(3));
    expect(provider.jobs[2].input.runId).toBe(followupRunId);
    provider.jobs[2].finish();
    await runRegistry.wait(followupRunId);
    expect(runRegistry.currentRuns.find(run => run.runId === queued.runId)?.state).toBe('queued');
    await archive(first.session.id);
    await vi.waitFor(() => expect(provider.jobs).toHaveLength(4));
    expect(provider.jobs[3].input.runId).toBe(queued.runId);
    provider.jobs[3].finish();
    await runRegistry.wait(queued.runId);
    expect((await journal.list()).map(turn => turn.runId)).toEqual([later.runId]);
    expect((await getSessionStore(dataDir).getSession(later.session.id)).messages[0]).toMatchObject({
      status: 'sending', turn: { lifecycle: 'suspended' },
    });
  });

  it.each([false, true])('does not add a later idle conversation as a restored idea\'s predecessor (shell created earlier: %s)', async earlierShell => {
    const first = await send();
    await vi.waitFor(() => expect(provider.jobs).toHaveLength(1));
    const shell = earlierShell ? await getSessionStore(dataDir).createSession({ provider: 'claude', checkoutId }) : undefined;
    const queued = await send({ waitForCheckout: true });
    const later = await send({}, shell);
    await vi.waitFor(() => expect(provider.jobs).toHaveLength(2));
    provider.jobs[1].finish();
    await runRegistry.wait(later.runId);
    const managed = lifecycle();
    managed.instance.start();
    await vi.waitFor(async () => expect((await new SuspendedTurns(dataDir).list()).some(turn => turn.runId === queued.runId && turn.state === 'ready')).toBe(true));
    provider.jobs[0].input.emit({ type: 'response-boundary', responseFinal: false });
    await vi.waitFor(() => expect(managed.sent).toHaveLength(1));
    await coldStart();
    await vi.waitFor(() => expect(provider.jobs).toHaveLength(3));
    provider.jobs[2].finish();
    await runRegistry.wait(first.runId);
    await archive(first.session.id);
    await vi.waitFor(() => expect(provider.jobs).toHaveLength(4));
    expect(provider.jobs[3].input.runId).toBe(queued.runId);
    provider.jobs[3].finish();
    await runRegistry.wait(queued.runId);
    expect((await getSessionStore(dataDir).getSession(later.session.id)).archivedAt).toBeUndefined();
  });

  it('waits for response and cleanup, retains failed-build suspensions, then resumes on a manual cold start', async () => {
    const sent = await send();
    await vi.waitFor(() => expect(provider.jobs).toHaveLength(1));
    let cleaned!: () => void;
    provider.cleanup = new Promise(resolve => { cleaned = resolve; });
    const managed = lifecycle();
    expect(managed.instance.start()).toMatchObject({ accepted: true, snapshot: { phase: 'suspending' } });
    await vi.waitFor(async () => expect((await new SuspendedTurns(dataDir).list())[0].state).toBe('preparing'));
    expect(provider.aborted).toBe(0);
    provider.jobs[0].input.emit({ type: 'history', activity: { kind: 'tool', key: 'read-result', tool: 'Read',
      status: 'succeeded', output: 'saved-before-restart' } });
    provider.jobs[0].input.emit({ type: 'response-boundary', responseFinal: false });
    expect(provider.aborted).toBe(1);
    expect(managed.sent).toEqual([]);
    cleaned();
    await vi.waitFor(() => expect(managed.sent).toHaveLength(1));
    const journal = new SuspendedTurns(dataDir);
    const [saved] = await journal.list();
    expect(saved).toMatchObject({ state: 'ready', request: { imageAttachments: [image] }, progress: { attempt: 1, continuation: true } });
    const originalProviderId = saved.providerSessionId;
    const message = (await getSessionStore(dataDir).getSession(sent.session.id)).messages[0];
    expect(message).toMatchObject({ status: 'sending', turn: { lifecycle: 'suspended' } });
    const operationId = managed.sent[0].type === 'lifecycle-request' ? managed.sent[0].operationId : '';
    managed.deliver({ type: 'lifecycle-state', snapshot: { available: true, phase: 'idle', releaseId: 'old-release',
      lastOperation: { operationId, outcome: 'build-failed', finishedAt: new Date().toISOString() } } });
    managed.deliver({ type: 'lifecycle-lease', request: 'release' });
    expect(managed.instance.snapshot().phase).toBe('paused');
    const blockedSession = await getSessionStore(dataDir).createSession({ provider: 'claude', checkoutId });
    const blocked = await submitMessage(new Request('http://localhost/message', { method: 'POST', body: JSON.stringify({
      ...sent.request, sessionId: blockedSession.id, participantId: blockedSession.primaryAgentId, messageId: crypto.randomUUID(),
    }) }));
    expect(blocked.status).toBe(503);
    provider.finish = true;
    await coldStart();
    await vi.waitFor(() => expect(provider.jobs).toHaveLength(2));
    await runRegistry.wait(sent.runId);
    const resumed = provider.jobs[1].input;
    expect(resumed.session).toEqual({ id: originalProviderId, action: 'resume' });
    expect(resumed.prompt).toContain('CodeAI suspended this unfinished task for maintenance');
    expect(resumed.prompt).toContain('saved-before-restart');
    const finished = await getSessionStore(dataDir).getSession(sent.session.id);
    expect(finished.messages).toHaveLength(2);
    expect(finished.messages[0]).toMatchObject({ id: sent.request.messageId, status: 'sent', turn: { lifecycle: 'completed' } });
    expect(await journal.list()).toEqual([]);
    // Calling startup recovery again must not dispatch the same continuation twice.
    await resumeSuspendedTurns(getConfig());
    expect(provider.jobs).toHaveLength(2);
  });

  it('preserves queued edits and evidence and never starts queued turns during preparation', async () => {
    const first = await send();
    await vi.waitFor(() => expect(provider.jobs).toHaveLength(1));
    const queued = await send({ waitForCheckout: true });
    await runRegistry.editQueuedMessage(queued.runId, 'Edited queued work', queued.request.text);
    const managed = lifecycle();
    managed.instance.start();
    await vi.waitFor(async () => expect((await new SuspendedTurns(dataDir).list()).some(turn => turn.runId === queued.runId && turn.state === 'ready')).toBe(true));
    expect(provider.jobs).toHaveLength(1);
    provider.jobs[0].input.emit({ type: 'response-boundary', responseFinal: false });
    await vi.waitFor(() => expect(managed.sent).toHaveLength(1));
    const records = await new SuspendedTurns(dataDir).list();
    expect(records.find(turn => turn.runId === queued.runId)).toMatchObject({ request: { text: 'Edited queued work', imageAttachments: [image] }, progress: { continuation: false } });
    expect(records.map(turn => turn.runId)).toEqual([first.runId, queued.runId]);
  });

  it.each(['process-failed', 'session-save'] as const)('does not turn a %s failure into a resumable checkpoint', async failure => {
    const sent = await send();
    if (failure === 'session-save') vi.spyOn(getSessionStore(dataDir), 'markProviderSessionStarted').mockRejectedValue(new Error('Disk unavailable'));
    else provider.abortCode = 'process-failed';
    await vi.waitFor(() => expect(provider.jobs).toHaveLength(1));
    const managed = lifecycle();
    managed.instance.start();
    await vi.waitFor(async () => expect((await new SuspendedTurns(dataDir).list())[0].state).toBe('preparing'));
    provider.jobs[0].input.emit({ type: 'response-boundary', responseFinal: false });
    await vi.waitFor(() => expect(managed.instance.snapshot().phase).toBe('paused'));
    expect(managed.sent).toEqual([]);
    expect((await new SuspendedTurns(dataDir).list())[0].state).toBe('preparing');
    expect(managed.instance.start()).toEqual({ accepted: false, reason: 'busy' });
    await coldStart();
    expect(provider.jobs).toHaveLength(1);
    expect((await getSessionStore(dataDir).getSession(sent.session.id)).messages).toHaveLength(1);
  });

  it('lets a naturally completed task stay complete without scheduling continuation', async () => {
    const sent = await send();
    await vi.waitFor(() => expect(provider.jobs).toHaveLength(1));
    const managed = lifecycle();
    managed.instance.start();
    await vi.waitFor(async () => expect((await new SuspendedTurns(dataDir).list())[0].state).toBe('preparing'));
    provider.jobs[0].finish();
    await vi.waitFor(() => expect(managed.sent).toHaveLength(1));
    expect(await new SuspendedTurns(dataDir).list()).toEqual([]);
    await coldStart();
    expect(provider.jobs).toHaveLength(1);
    expect((await getSessionStore(dataDir).getSession(sent.session.id)).messages).toHaveLength(2);
  });

  it('waits for provisional admission and suspends it without launching a provider', async () => {
    const store = getSessionStore(dataDir);
    const original = store.appendUserMessage.bind(store);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const appending = vi.spyOn(store, 'appendUserMessage').mockImplementation(async (...args) => { await gate; return original(...args); });
    const pending = send();
    await vi.waitFor(() => expect(appending).toHaveBeenCalledOnce());
    const managed = lifecycle();
    expect(managed.instance.start()).toMatchObject({ accepted: true, snapshot: { phase: 'suspending' } });
    expect(managed.sent).toEqual([]);
    release();
    const sent = await pending;
    await vi.waitFor(() => expect(managed.sent).toHaveLength(1));
    expect(provider.jobs).toHaveLength(0);
    expect((await new SuspendedTurns(dataDir).list())[0]).toMatchObject({ runId: sent.runId, state: 'ready', progress: { continuation: false } });
  });

  it('waits for queued cancellation racing with preparation and never resurrects cancelled work', async () => {
    await send();
    await vi.waitFor(() => expect(provider.jobs).toHaveLength(1));
    const queued = await send({ waitForCheckout: true });
    const store = getSessionStore(dataDir);
    const original = store.failUserMessage.bind(store);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(store, 'failUserMessage').mockImplementation(async (...args) => { await gate; return original(...args); });
    const cancellation = runRegistry.cancel(queued.runId);
    const managed = lifecycle();
    managed.instance.start();
    release();
    expect(await cancellation).toBe('accepted');
    await vi.waitFor(async () => expect((await new SuspendedTurns(dataDir).list()).length).toBe(1));
    provider.jobs[0].input.emit({ type: 'response-boundary', responseFinal: false });
    await vi.waitFor(() => expect(managed.sent).toHaveLength(1));
    expect((await new SuspendedTurns(dataDir).list()).some(turn => turn.runId === queued.runId)).toBe(false);
    expect((await store.getSession(queued.session.id)).messages[0].status).toBe('cancelled');
  });

  it('continues a saved task in a separate server process after the original writer closes', async () => {
    const sent = await send();
    await vi.waitFor(() => expect(provider.jobs).toHaveLength(1));
    const managed = lifecycle();
    managed.instance.start();
    await vi.waitFor(async () => expect((await new SuspendedTurns(dataDir).list())[0].state).toBe('preparing'));
    provider.jobs[0].input.emit({ type: 'response-boundary', responseFinal: false });
    await vi.waitFor(() => expect(managed.sent).toHaveLength(1));
    await getSessionStore(dataDir).close();
    scope.__codeAiSessionStores?.delete(dataDir);
    const child = await promisify(execFile)(process.execPath, ['--import', 'tsx', 'test/fixtures/resume-suspended-turns.ts'], {
      cwd: process.cwd(), env: { ...process.env, CODEAI_CLAUDE_BIN: path.resolve('test/fixtures/fake-claude.mjs'),
        CODEAI_CODEX_BIN: path.resolve('test/fixtures/not-a-real-codex') }, timeout: 15_000,
    });
    const saved = await getSessionStore(dataDir).getSession(sent.session.id);
    expect(saved.messages, child.stderr || child.stdout).toHaveLength(2);
    expect(saved.messages[0]).toMatchObject({ id: sent.request.messageId, status: 'sent' });
    expect(await new SuspendedTurns(dataDir).list()).toEqual([]);
  }, 20_000);

  it('lets cancellation win after queued suspension has already read its sending state', async () => {
    await send();
    await vi.waitFor(() => expect(provider.jobs).toHaveLength(1));
    const queued = await send({ waitForCheckout: true });
    const save = SuspendedTurns.prototype.save;
    let release!: () => void;
    let writing = false;
    const gate = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(SuspendedTurns.prototype, 'save').mockImplementation(async function (this: SuspendedTurns, turn) {
      if (turn.runId === queued.runId && turn.state === 'ready') { writing = true; await gate; }
      return save.call(this, turn);
    });
    const managed = lifecycle();
    managed.instance.start();
    await vi.waitFor(() => expect(writing).toBe(true));
    expect(await runRegistry.cancel(queued.runId)).toBe('accepted');
    release();
    provider.jobs[0].input.emit({ type: 'response-boundary', responseFinal: false });
    await vi.waitFor(() => expect(managed.sent).toHaveLength(1));
    expect((await new SuspendedTurns(dataDir).list()).some(turn => turn.runId === queued.runId)).toBe(false);
  });

  it('gives resumed writing work a fresh Undo baseline that preserves manual build repairs', async () => {
    const repo = path.join(root, 'repositories', 'repo');
    const git = (...args: string[]) => promisify(execFile)('git', ['-C', repo, ...args], {
      env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
    });
    await git('init');
    await writeFile(path.join(repo, 'work.txt'), 'original');
    await git('add', '.');
    await git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'Fixture');
    const sent = await send({ mode: 'agent' });
    await vi.waitFor(() => expect(provider.jobs).toHaveLength(1));
    await writeFile(path.join(repo, 'work.txt'), 'before maintenance');
    const managed = lifecycle();
    managed.instance.start();
    await vi.waitFor(async () => expect((await new SuspendedTurns(dataDir).list())[0].state).toBe('preparing'));
    provider.jobs[0].input.emit({ type: 'response-boundary', responseFinal: false });
    await vi.waitFor(() => expect(managed.sent).toHaveLength(1));
    const checkpoints = getTurnCheckpoints(dataDir);
    const old = (await checkpoints.latest(sent.session.id))!;
    expect(old.state).toBe('ready');
    await writeFile(path.join(repo, 'work.txt'), 'manual build repair');
    await coldStart();
    await vi.waitFor(() => expect(provider.jobs).toHaveLength(2));
    await writeFile(path.join(repo, 'work.txt'), 'continued task');
    provider.jobs[1].finish();
    await runRegistry.wait(sent.runId);
    const resumed = (await checkpoints.latest(sent.session.id))!;
    expect(resumed.id).not.toBe(old.id);
    await checkpoints.undo(resumed.id);
    expect(await readFile(path.join(repo, 'work.txt'), 'utf8')).toBe('manual build repair');
    await expect(checkpoints.undo(old.id)).rejects.toThrow();
  });
});
