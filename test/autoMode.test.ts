import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const routeState = vi.hoisted(() => ({
  checkout: '',
  runs: [] as Array<{ mode: string; profile: string; directory: string; files: string[]; permissions: number; siblings: string[] }>,
  /** While set, every run waits here after recording itself. */
  hold: undefined as Promise<void> | undefined,
}));

vi.mock('@/server/repository/checkoutRegistry', () => ({
  getCheckoutRegistry: () => ({
    list: async () => [],
    resolve: async (id: string) => ({ id, name: 'Repository', relativePath: 'repository', realPath: routeState.checkout }),
  }),
}));

vi.mock('@/server/agents/providerRegistry', async () => {
  const { readdir: list, stat: inspect } = await import('node:fs/promises');
  const { dirname } = await import('node:path');
  const createRunner = () => ({
    // Records the per-run directory while it exists, then completes the turn.
    run: async (input: { attachmentDirectory: string; policy: { mode: string; profile: string } }) => {
      routeState.runs.push({
        mode: input.policy.mode,
        profile: input.policy.profile,
        directory: input.attachmentDirectory,
        files: (await list(input.attachmentDirectory)).sort(),
        permissions: (await inspect(input.attachmentDirectory)).mode & 0o777,
        siblings: (await list(dirname(input.attachmentDirectory))).sort(),
      });
      if (routeState.hold) await routeState.hold;
      return { finalText: 'Done.', sessionId: 'provider-session', durationMs: 1, outputBytes: 5 };
    },
  });
  return {
    getProviderAdapters: (_config: unknown, execution = 'local') => ({
      claude: {
        checkHealth: async () => ({ available: true, authenticated: true, supportedModes: ['ask', 'plan', 'agent'] }),
        createRunner,
      },
      codex: {
        // As the real registry: Codex advertises Auto locally, and nothing advertises it in Docker.
        checkHealth: async () => ({
          available: true, authenticated: true,
          supportedModes: execution === 'docker' ? ['ask', 'plan', 'agent'] : ['ask', 'plan', 'agent', 'auto'],
        }),
        createRunner,
      },
    }),
  };
});

import { POST as POST_MESSAGE } from '@/app/api/agent/message/route';
import { runRegistry } from '@/server/runs/runRegistry';
import { getSessionStore, type SessionStore } from '@/server/storage/sessionStore';
import { AUTO_MODE_SESSION_VERSION, MAX_READABLE_SESSION_VERSION, durableSessionSchema } from '@/shared/sessionSchema';
import type { AgentProvider, DurableSession, UserMessage } from '@/shared/types';

const DATA_ROOT = path.resolve('test-results', 'auto-mode-unit');
let dataDir: string;
let store: SessionStore;

async function sessionFor(provider: AgentProvider, execution: 'local' | 'docker' = 'local'): Promise<DurableSession> {
  const project = await store.createProject(`Project ${crypto.randomUUID()}`, ['checkout-a']);
  return store.createSession({ provider, projectId: project.id, execution });
}

function post(session: DurableSession, mode: unknown, text = 'Make the change.'): Promise<Response> {
  return POST_MESSAGE(new Request('http://localhost/api/agent/message', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: session.id, messageId: crypto.randomUUID(), participantId: session.primaryAgentId, text, diagramAttachments: [], mode,
    }),
  }));
}

async function send(session: DurableSession, mode: unknown, text?: string) {
  const response = await post(session, mode, text);
  const body = await response.text();
  await vi.waitFor(() => expect(runRegistry.currentRuns).toEqual([]));
  return { status: response.status, body };
}

const sessionFile = (id: string) => path.join(dataDir, 'session-store-v2', 'sessions', `${id}.json`);

describe.sequential('Auto mode on the message route and in session records', () => {
  beforeEach(async () => {
    // Not under the system temp directory: Auto is refused for a data directory its sandbox can write.
    await mkdir(DATA_ROOT, { recursive: true });
    dataDir = await mkdtemp(path.join(DATA_ROOT, 'data-'));
    routeState.checkout = await realpath(await mkdtemp(path.join(os.tmpdir(), 'codeai-auto-checkout-')));
    routeState.runs = [];
    routeState.hold = undefined;
    vi.stubEnv('CODEAI_DATA_DIR', dataDir);
    vi.stubEnv('CODEAI_HOST_LABEL', 'Home');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    store = getSessionStore(dataDir, 'Home');
  });
  afterEach(async () => {
    vi.unstubAllEnvs(); vi.restoreAllMocks();
    await rm(DATA_ROOT, { recursive: true, force: true });
  });

  it('answers 409 where Auto is not advertised and 400 for a mode that does not exist', async () => {
    const claude = await sessionFor('claude');
    const refused = await send(claude, 'auto');
    expect([refused.status, JSON.parse(refused.body).error]).toEqual([409, 'Claude is not healthy for auto mode in this CodeAI configuration.']);
    // Docker execution never advertises Auto, whichever provider runs there.
    expect((await send(await sessionFor('codex', 'docker'), 'auto')).status).toBe(409);
    for (const mode of ['turbo', 'Auto', 'bypass']) expect((await send(claude, mode)).status).toBe(400);
    expect(routeState.runs).toEqual([]);
    expect((await store.getSession(claude.id)).messages).toEqual([]);
  });

  it('refuses Auto while the data directory is somewhere its sandbox can write', async () => {
    const refusal = async (directory: string) => {
      vi.stubEnv('CODEAI_DATA_DIR', directory);
      const local = getSessionStore(directory, 'Home');
      const project = await local.createProject('Project', ['checkout-a']);
      const session = await local.createSession({ provider: 'codex', projectId: project.id });
      const auto = await send(session, 'auto');
      // Every other mode still runs: they ask before each write, or cannot write at all.
      expect((await send(session, 'agent')).status).toBe(200);
      await local.close();
      return [auto.status, JSON.parse(auto.body).error];
    };
    const message = 'Auto is unavailable while CodeAI\'s data directory is inside the checkout or a temporary directory, '
      + 'where an Auto turn could change CodeAI\'s own records without asking. Set CODEAI_DATA_DIR to a directory outside them.';
    // The sandbox leaves the temp directories and the checkout writable.
    expect(await refusal(await mkdtemp(path.join(os.tmpdir(), 'codeai-auto-data-')))).toEqual([409, message]);
    // A checkout outside the temp directories, holding the data directory itself.
    routeState.checkout = await realpath(await mkdtemp(path.join(DATA_ROOT, 'checkout-')));
    expect(await refusal(path.join(routeState.checkout, '.codeai-data'))).toEqual([409, message]);
    expect(routeState.runs.map((run) => run.mode)).toEqual(['agent', 'agent']);
  });

  it('upgrades a session to version 6 with its first Auto message, and only that session', async () => {
    const session = await sessionFor('codex');
    const neighbour = await sessionFor('codex');
    const neighbourBytes = await readFile(sessionFile(neighbour.id), 'utf8');
    expect((await send(session, 'ask', 'A plain first question.')).status).toBe(200);
    expect((await send(session, 'agent')).status).toBe(200);
    expect((await store.getSession(session.id)).version).toBe(4);

    const sent = await send(session, 'auto');
    expect(sent.status).toBe(200);
    expect(sent.body).toContain('"type":"assistant-message"');
    const after = await store.getSession(session.id);
    expect(after.version).toBe(AUTO_MODE_SESSION_VERSION);
    expect(after.messages.slice(-2).map((message) => [message.role, message.mode])).toEqual([['user', 'auto'], ['assistant', 'auto']]);
    expect(routeState.runs.map((run) => [run.mode, run.profile])).toEqual([
      ['ask', 'ask-readonly'], ['agent', 'agent-full'], ['auto', 'auto-sandboxed'],
    ]);
    expect(await readFile(sessionFile(neighbour.id), 'utf8')).toBe(neighbourBytes);
    // The directory that holds every run's attachments is CodeAI's own, and private.
    expect((await stat(path.join(dataDir, 'run-attachments'))).mode & 0o777).toBe(0o700);
    expect(await readdir(path.join(dataDir, 'run-attachments'))).toEqual([]);

    // A later message in another mode keeps the session readable by this version only.
    expect((await send(session, 'ask', 'And a follow-up.')).status).toBe(200);
    expect((await store.getSession(session.id)).version).toBe(6);
  });

  it('never lowers a version: a report on a version 6 session keeps 6, and older sessions upgrade in one step', async () => {
    const human = (session: DurableSession) => session.participants.find((participant) => participant.kind === 'human')!.id;
    const message = (session: DurableSession, extra: Partial<UserMessage>): UserMessage => ({
      id: crypto.randomUUID(), role: 'user', authorId: human(session), addressedParticipantId: session.primaryAgentId,
      text: 'Look at this.', createdAt: new Date().toISOString(), status: 'sending', diagramAttachments: [], ...extra,
    });
    const report = { reportId: '2026-09-30T10-00-00.000Z-capture', receivedAt: '2026-09-30T10:00:00.000Z', kind: 'capture' as const, screenshotIncluded: false, errorCount: 0 };

    const six = await sessionFor('codex');
    expect((await store.appendUserMessage(six.id, message(six, { mode: 'auto' }))).session.version).toBe(6);
    expect((await store.appendUserMessage(six.id, message(six, { mode: 'ask', reportAttachments: [report] }))).session.version).toBe(6);
    expect(durableSessionSchema.safeParse(await store.getSession(six.id)).success).toBe(true);

    // Version 5 (a report) then Auto, and version 3 straight to 6 with its implicit Local named.
    const five = await sessionFor('codex');
    expect((await store.appendUserMessage(five.id, message(five, { reportAttachments: [report] }))).session.version).toBe(5);
    expect((await store.appendUserMessage(five.id, message(five, { mode: 'ask' }))).session.version).toBe(5);
    expect((await store.appendUserMessage(five.id, message(five, { mode: 'auto' }))).session.version).toBe(6);
    const three = await sessionFor('codex');
    const { execution: _execution, ...legacy } = three;
    await writeFile(sessionFile(three.id), `${JSON.stringify({ ...legacy, version: 3 }, null, 2)}\n`);
    expect((await store.appendUserMessage(three.id, message(three, { mode: 'auto' }))).session).toMatchObject({ version: 6, execution: 'local' });
  });

  it('accepts Auto messages only at version 6, report evidence from version 5, and no Auto role default', async () => {
    const session = await sessionFor('codex');
    await send(session, 'auto');
    const six = await store.getSession(session.id);
    expect(AUTO_MODE_SESSION_VERSION).toBe(6);
    expect(MAX_READABLE_SESSION_VERSION).toBeGreaterThanOrEqual(AUTO_MODE_SESSION_VERSION);
    expect(durableSessionSchema.safeParse(six).success).toBe(true);
    for (const version of [4, 5]) expect(durableSessionSchema.safeParse({ ...six, version }).success, `version ${version}`).toBe(false);
    // The assistant's own Auto message needs version 6 as much as the user's.
    const assistantOnly = { ...six, version: 5, messages: six.messages.map((item) => (item.role === 'user' ? { ...item, mode: 'agent' } : item)) };
    expect(durableSessionSchema.safeParse(assistantOnly).success).toBe(false);
    const withoutAuto = { ...six, messages: six.messages.map((item) => ({ ...item, mode: 'agent' })) };
    for (const version of [4, 5, 6]) expect(durableSessionSchema.safeParse({ ...withoutAuto, version }).success, `version ${version}`).toBe(true);
    const autoDefault = { ...six, participants: six.participants.map((item) => (item.kind === 'agent' ? { ...item, defaultMode: 'auto' } : item)) };
    expect(durableSessionSchema.safeParse(autoDefault).success).toBe(false);
  });

  it('gives an Auto turn the checkout exclusively, as Agent has it', async () => {
    let release = () => undefined as void;
    routeState.hold = new Promise<void>((resolve) => { release = resolve; });
    const writer = await sessionFor('codex');
    const reader = await sessionFor('claude');
    const first = await post(writer, 'auto');
    await vi.waitFor(() => expect(routeState.runs).toHaveLength(1));
    const second = await post(reader, 'ask');
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(runRegistry.list().active.map((run) => [run.sessionId, run.state])).toEqual([[writer.id, 'running'], [reader.id, 'queued']]);
    release();
    await Promise.all([first.text(), second.text()]);
    await vi.waitFor(() => expect(runRegistry.currentRuns).toEqual([]));
    expect(routeState.runs.map((run) => run.mode)).toEqual(['auto', 'ask']);
  });

  it('keeps each run directory under the data directory, private, and gone after its turn', async () => {
    const root = path.join(dataDir, 'run-attachments');
    // What a crashed server left behind, beside something that is not a run directory.
    await mkdir(path.join(root, 'code-ai-run-crashed'), { recursive: true });
    await writeFile(path.join(root, 'code-ai-run-crashed', 'diagram-1.mmd'), 'flowchart LR\n  A --> B\n');
    await mkdir(path.join(root, 'kept'));

    let release = () => undefined as void;
    routeState.hold = new Promise<void>((resolve) => { release = resolve; });
    const [first, second] = await Promise.all([post(await sessionFor('claude'), 'ask'), post(await sessionFor('codex'), 'plan')]);
    await vi.waitFor(() => expect(routeState.runs).toHaveLength(2));
    release();
    await Promise.all([first.text(), second.text()]);
    await vi.waitFor(() => expect(runRegistry.currentRuns).toEqual([]));

    for (const run of routeState.runs) {
      expect(path.dirname(run.directory)).toBe(root);
      expect(path.basename(run.directory)).toMatch(/^code-ai-run-/);
      expect(run.permissions).toBe(0o700);
      expect(run.files).toContain('context-manifest.json');
      // The sweep ran once, before the first directory existed: the crash leftover is gone and a live sibling is not.
      expect(run.siblings).not.toContain('code-ai-run-crashed');
    }
    expect(routeState.runs[1].siblings).toContain(path.basename(routeState.runs[0].directory));
    expect(await readdir(root)).toEqual(['kept']);
    expect(routeState.runs.map((run) => run.directory.startsWith(path.join(os.tmpdir(), 'code-ai-run-')))).toEqual([false, false]);
  });
});
