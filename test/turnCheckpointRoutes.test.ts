import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const fixture = vi.hoisted(() => ({ outcome: 'complete', invoked: 0, beforeProvider: '' }));
vi.mock('@/server/agents/providerRegistry', () => ({
  getProviderAdapters: () => ({ claude: {
    checkHealth: async () => ({ available: true, authenticated: true, supportedModes: ['ask', 'plan', 'agent'] }),
    createRunner: () => ({ run: async (input: { checkout: { realPath: string }; signal: AbortSignal }) => {
      fixture.invoked++;
      const { getConfig } = await import('@/server/config');
      const { readdir, readFile, writeFile } = await import('node:fs/promises');
      const checkpointFiles = await readdir(path.join(getConfig().dataDir, 'turn-checkpoints')).catch(() => []);
      fixture.beforeProvider = checkpointFiles.filter((name) => name.endsWith('.json')).length ? 'captured' : 'no checkpoint';
      await writeFile(path.join(input.checkout.realPath, 'a.txt'), 'provider edit');
      if (fixture.outcome === 'hold') await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }));
      if (fixture.outcome !== 'complete') {
        const { AgentRunError } = await import('@/server/agents/agentRunError');
        throw new AgentRunError(fixture.outcome === 'failed' ? 'internal' : 'cancelled', 'Fixture stopped after editing');
      }
      return { finalText: 'Changed a.txt', durationMs: 1, outputBytes: 13 };
    } }),
  } }),
}));
vi.mock('@/server/execution/dockerRecovery', () => ({ recoverDockerExecution: async () => undefined, DOCKER_RECOVERY_MESSAGE: 'Recovery unavailable' }));

import { POST as MESSAGE } from '@/app/api/agent/message/route';
import { POST as UNDO } from '@/app/api/agent/undo/route';
import { GET as STATUS } from '@/app/api/agent/checkpoint/route';
import { POST as CANCEL } from '@/app/api/agent/cancel/route';
import { getSessionStore } from '@/server/storage/sessionStore';
import { getCheckoutRegistry } from '@/server/repository/checkoutRegistry';
import { getConfig } from '@/server/config';
import { runRegistry } from '@/server/runs/runRegistry';
import { TurnCheckpoint } from '@/features/conversation/TurnCheckpoint';
import { CHECKPOINT_SCOPE, type CheckpointSummary } from '@/shared/turnCheckpoint';
import { machineOperationAllowed } from '@/server/machines/machineRoutePolicy';
import type { DurableSession } from '@/shared/types';

let directory: string;
let checkout: string;
let session: DurableSession;
const request = (operation: string, body: unknown) => new Request(`http://localhost/api/agent/${operation}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const status = async (sessionId = session.id) => STATUS(new Request(`http://localhost/api/agent/checkpoint?sessionId=${sessionId}`));
async function checkpoint(): Promise<CheckpointSummary> { return (await (await status()).json()).checkpoint; }
const send = (mode = 'agent') => MESSAGE(request('message', { sessionId: session.id, participantId: session.primaryAgentId,
  messageId: crypto.randomUUID(), text: 'Change a.txt', mode, diagramAttachments: [],
}));
const undo = async (summary: CheckpointSummary, sessionId = session.id) => UNDO(request('undo', { sessionId, checkpointId: summary.id }));

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'codeai-checkpoint-route-'));
  checkout = path.join(directory, 'checkout'); await mkdir(checkout);
  await writeFile(path.join(checkout, 'package.json'), '{}'); await writeFile(path.join(checkout, 'a.txt'), 'human work');
  vi.stubEnv('CODEAI_DATA_DIR', path.join(directory, 'data'));
  vi.stubEnv('CODEAI_REPOSITORIES_ROOT', checkout);
  vi.stubEnv('CODEAI_REMOTE_ACCESS', 'local');
  fixture.outcome = 'complete'; fixture.invoked = 0; fixture.beforeProvider = '';
  const config = getConfig();
  const [binding] = await getCheckoutRegistry(checkout).list();
  const store = getSessionStore(config.dataDir);
  const project = await store.createProject('Recovery fixture', [binding.id]);
  session = await store.createSession({ projectId: project.id, provider: 'claude' });
});
afterEach(async () => {
  for (const run of runRegistry.currentRuns) await runRegistry.cancel(run.runId);
  await Promise.all(runRegistry.currentRuns.map((run) => runRegistry.wait(run.runId)));
  await getSessionStore(getConfig().dataDir).close();
  vi.unstubAllEnvs(); vi.restoreAllMocks(); await rm(directory, { recursive: true, force: true });
});

describe('writing turn recovery routes', () => {
  it.each(['complete', 'failed', 'cancelled'])('captures before execution and recovers a %s turn after durable reload', async (outcome) => {
    fixture.outcome = outcome;
    const response = await send(); const events = await response.text();
    expect(fixture.beforeProvider).toBe('captured');
    expect(events).toContain('"type":"done"');
    const summary = await checkpoint(); expect(summary.state).toBe('ready');
    const saved = await getSessionStore(getConfig().dataDir).getSession(session.id);
    expect(saved.messages[0].status).toBe(outcome === 'complete' ? 'sent' : outcome);
    expect(saved.messages[0].id).toBe(summary.messageId);
    const responseUndo = await undo(summary);
    expect(responseUndo.status).toBe(200);
    expect(await readFile(path.join(checkout, 'a.txt'), 'utf8')).toBe('human work');
    expect((await checkpoint()).state).toBe('undone');
    expect((await getSessionStore(getConfig().dataDir).getSession(session.id)).messages).toEqual(saved.messages);
  });

  it('captures Docker writing turns on the executing host without putting recovery in worker context', async () => {
    const store = getSessionStore(getConfig().dataDir);
    session = await store.createSession({ projectId: session.projectId, provider: 'claude', execution: 'docker' });
    await (await send()).text();
    expect(fixture.beforeProvider).toBe('captured');
    expect((await undo(await checkpoint())).status).toBe(200);
    expect(await readFile(path.join(checkout, 'a.txt'), 'utf8')).toBe('human work');
  });

  it('does not capture Ask and Plan, and fails closed before execution when capture is unsafe', async () => {
    for (const mode of ['ask', 'plan']) {
      await (await send(mode)).text(); expect(fixture.beforeProvider).toBe('no checkpoint');
    }
    expect(await checkpoint()).toBeNull();
    fixture.invoked = 0;
    await writeFile(path.join(checkout, 'oversized.bin'), Buffer.alloc(4 * 1024 * 1024 + 1));
    const events = await (await send()).text();
    expect(fixture.invoked).toBe(0); expect(events).toContain('4 MiB limit');
    const saved = await getSessionStore(getConfig().dataDir).getSession(session.id);
    expect(saved.messages.at(-1)).toMatchObject({ status: 'failed', delivery: 'not-sent' });
  });

  it('protects scheduler access, session identity and newer human edits', async () => {
    await (await send()).text(); const summary = await checkpoint();
    const store = getSessionStore(getConfig().dataDir);
    const other = await store.createSession({ projectId: session.projectId, provider: 'claude' });
    expect((await undo(summary, other.id)).status).toBe(409);
    const lease = runRegistry.acquireCheckoutRead(checkout)!;
    expect((await undo(summary)).status).toBe(409); lease();
    const runId = crypto.randomUUID();
    runRegistry.reserve({ runId, sessionId: other.id, participantId: 'agent', providerKey: 'other', checkoutId: 'nested', checkoutPath: path.join(checkout, 'nested'), access: 'read', cancel() {} });
    expect((await undo(summary)).status).toBe(409); runRegistry.release(runId);
    await writeFile(path.join(checkout, 'a.txt'), 'new human edit');
    expect((await undo(summary)).status).toBe(409);
    expect(await readFile(path.join(checkout, 'a.txt'), 'utf8')).toBe('new human edit');
  });

  it('captures cancelled active work but not a queued cancellation', async () => {
    fixture.outcome = 'hold';
    const live = await send();
    await vi.waitFor(() => expect(fixture.invoked).toBe(1));
    const store = getSessionStore(getConfig().dataDir);
    const other = await store.createSession({ projectId: session.projectId, provider: 'claude' });
    const queued = await MESSAGE(request('message', { sessionId: other.id, participantId: other.primaryAgentId,
      messageId: crypto.randomUUID(), text: 'Queued', mode: 'agent', diagramAttachments: [],
    }));
    const queuedRun = runRegistry.currentRuns.find((run) => run.sessionId === other.id)!;
    expect(queuedRun.state).toBe('queued');
    expect((await CANCEL(request('cancel', { runId: queuedRun.runId }))).status).toBe(200);
    await queued.text();
    expect((await (await status(other.id)).json()).checkpoint).toBeNull();
    const activeRun = runRegistry.currentRuns.find((run) => run.sessionId === session.id)!;
    await CANCEL(request('cancel', { runId: activeRun.runId })); await live.text();
    expect((await checkpoint()).state).toBe('ready'); expect(fixture.invoked).toBe(1);
  });

  it('validates bounded identities and refuses arbitrary paths', async () => {
    expect((await status('bad')).status).toBe(400);
    expect((await UNDO(request('undo', { sessionId: session.id, checkpointId: crypto.randomUUID(), path: '/tmp' }))).status).toBe(400);
    expect((await UNDO(request('undo', { sessionId: session.id, checkpointId: crypto.randomUUID() }))).status).toBe(404);
    expect((await UNDO(request('undo', { padding: 'x'.repeat(1025) }))).status).toBe(413);
    expect(machineOperationAllowed('GET', ['agent', 'checkpoint'])).toBe(true);
    expect(machineOperationAllowed('POST', ['agent', 'undo'])).toBe(true);
    expect(machineOperationAllowed('GET', ['agent', 'undo'])).toBe(false);
    expect(machineOperationAllowed('POST', ['agent', 'checkpoint'])).toBe(false);
  });
});

describe('desktop recovery presentation', () => {
  it('shows confirmation scope, expiry, disabled controls and the successful outcome', () => {
    const summary: CheckpointSummary = { id: crypto.randomUUID(), messageId: crypto.randomUUID(), createdAt: new Date().toISOString(),
      expiresAt: '2026-10-08T12:00:00.000Z', state: 'ready', changedFiles: 3 };
    const controls = { checkpoint: summary, busy: false, confirming: false, onAsk: vi.fn(), onDismiss: vi.fn(), onConfirm: vi.fn() };
    expect(renderToStaticMarkup(createElement(TurnCheckpoint, { controls }))).toContain('Undo this turn');
    expect(renderToStaticMarkup(createElement(TurnCheckpoint, { controls: { ...controls, busy: true } }))).toContain('disabled');
    const confirmation = renderToStaticMarkup(createElement(TurnCheckpoint, { controls: { ...controls, confirming: true } }));
    expect(confirmation).toContain(CHECKPOINT_SCOPE); expect(confirmation).toContain('Confirm Undo');
    expect(renderToStaticMarkup(createElement(TurnCheckpoint, { controls: { ...controls, checkpoint: { ...summary, state: 'undone', reason: 'Checkout files restored.' } } })))
      .toContain('Checkout files restored.');
  });
});
