import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentEvent, AgentMode, AgentProcessResult, AgentProcessRun, SecurityLevel } from '@/shared/types';

const fixture = vi.hoisted(() => ({
  checkout: '', attempts: [] as AgentProcessRun[], modes: ['ask', 'plan', 'agent', 'auto', 'full'] as AgentMode[],
  run: undefined as undefined | ((input: AgentProcessRun) => Promise<AgentProcessResult>),
  healthWait: undefined as Promise<void> | undefined,
}));
vi.mock('@/server/repository/checkoutRegistry', () => ({ getCheckoutRegistry: () => ({
  resolve: async () => ({ id: 'checkout', name: 'fixture', relativePath: '.', realPath: fixture.checkout }),
}) }));
vi.mock('@/server/agents/providerRegistry', () => ({ getProviderAdapters: () => {
  const adapter = {
    checkHealth: async () => {
      await fixture.healthWait;
      return { available: true, supportedModes: fixture.modes };
    },
    createRunner: () => ({ run: async (input: AgentProcessRun) => {
      fixture.attempts.push(input);
      return fixture.run!(input);
    } }),
  };
  return { claude: adapter, codex: adapter };
} }));

import { POST as sendMessage } from '@/app/api/agent/message/route';
import { POST as changeMode } from '@/app/api/agent/mode/route';
import { AgentRunError } from '@/server/agents/agentRunError';
import { runRegistry } from '@/server/runs/runRegistry';
import { getSessionStore } from '@/server/storage/sessionStore';
import { getTurnCheckpoints } from '@/server/repository/turnCheckpoints';

let root: string;
let store: ReturnType<typeof getSessionStore>;
let checkpoints: ReturnType<typeof getTurnCheckpoints>;
const cached = globalThis as typeof globalThis & { __codeaiSecurityLevel?: SecurityLevel };

function bodyRequest(endpoint: string, body: unknown) {
  return new Request(`http://localhost/api/agent/${endpoint}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}
function complete(input: AgentProcessRun): AgentProcessResult {
  const finalText = input.policy.mode === 'plan'
    ? '<!-- cartograph:plan:start -->\n## Implementation plan\n1. Continue safely.\n<!-- cartograph:plan:end -->' : 'Done';
  return { finalText, sessionId: 'private-session', durationMs: 1, outputBytes: finalText.length };
}
function interrupted(input: AgentProcessRun): Promise<AgentProcessResult> {
  input.emit({ type: 'session-started', sessionId: 'private-session' });
  return new Promise((_resolve, reject) => {
    const stop = () => reject(new AgentRunError('cancelled', 'Interrupted'));
    input.signal.addEventListener('abort', stop, { once: true });
    if (input.signal.aborted) stop();
  });
}
async function start(mode: AgentMode = 'agent', options: { provider?: 'codex' | 'claude'; instructions?: 'isolated' } = {}) {
  const project = await store.createProject('Project', ['checkout']);
  const session = await store.createSession({ projectId: project.id, provider: options.provider ?? 'codex', instructions: options.instructions });
  const response = await sendMessage(bodyRequest('message', {
    sessionId: session.id, participantId: session.primaryAgentId, messageId: crypto.randomUUID(),
    text: 'Finish the current task', diagramAttachments: [], mode,
  }));
  expect(response.status).toBe(200);
  await vi.waitFor(() => expect(fixture.attempts).toHaveLength(1));
  const runId = fixture.attempts[0].runId;
  return { session, response, runId, select: (mode: unknown, extra = {}) => changeMode(bodyRequest('mode', { runId, mode, ...extra })) };
}
async function events(response: Response) {
  return (await response.text()).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as AgentEvent);
}

beforeEach(async () => {
  delete cached.__codeaiSecurityLevel;
  root = await mkdtemp(path.join(os.tmpdir(), 'codeai-running-mode-'));
  fixture.checkout = path.join(root, 'repo');
  await mkdir(fixture.checkout);
  await writeFile(path.join(fixture.checkout, 'a.txt'), 'original');
  vi.stubEnv('CODEAI_REMOTE_ACCESS', 'local');
  vi.stubEnv('CODEAI_SECURITY_LEVEL', 'native');
  vi.stubEnv('CODEAI_DATA_DIR', path.join(root, 'data'));
  store = getSessionStore(path.join(root, 'data'), 'fixture');
  checkpoints = getTurnCheckpoints(path.join(root, 'data'));
  fixture.attempts = [];
  fixture.healthWait = undefined;
  fixture.modes = ['ask', 'plan', 'agent', 'auto', 'full'];
  fixture.run = async (input) => fixture.attempts.length === 1 ? interrupted(input) : complete(input);
});
afterEach(async () => {
  await Promise.all(runRegistry.currentRuns.map(async (run) => {
    await runRegistry.cancel(run.runId);
    await runRegistry.wait(run.runId);
  }));
  await store.close();
  await rm(root, { recursive: true, force: true });
  delete cached.__codeaiSecurityLevel;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe.sequential('changing the current turn mode', () => {
  it('closes pending cards, resumes the same session/evidence in Plan, and saves one final answer', async () => {
    const capture = vi.spyOn(checkpoints, 'capture');
    const finish = vi.spyOn(checkpoints, 'finish');
    let resolution: string | undefined;
    fixture.run = async (input) => {
      if (fixture.attempts.length !== 1) return complete(input);
      const waiting = interrupted(input);
      input.emit({ type: 'permission-request', requestId: 'pending', tool: 'Edit', detail: 'a.txt' });
      input.permissions!.request('pending', (decision) => {
        resolution = decision;
        input.emit({ type: 'permission-resolved', requestId: 'pending', decision });
      });
      input.signal.addEventListener('abort', () => input.permissions!.cancelAll(), { once: true });
      return waiting;
    };
    const turn = await start();
    expect((await turn.select('plan')).status).toBe(200);
    const streamed = await events(turn.response);
    await runRegistry.wait(turn.runId);
    expect(resolution).toBe('cancelled');
    expect(fixture.attempts.map((attempt) => attempt.policy.mode)).toEqual(['agent', 'plan']);
    expect(fixture.attempts[1].session).toEqual({ action: 'resume', id: 'private-session' });
    expect(fixture.attempts[1].attachmentDirectory).toBe(fixture.attempts[0].attachmentDirectory);
    expect(fixture.attempts[1].prompt).toContain('Mode: PLAN');
    expect(fixture.attempts[1].prompt).toContain('Explicit user denials remain binding');
    expect(fixture.attempts[1].prompt).toContain('Finish the current task');
    expect(streamed.filter((event) => event.type === 'done')).toHaveLength(1);
    expect(streamed.some((event) => event.type === 'error')).toBe(false);
    expect(streamed).toContainEqual({ type: 'mode-changed', runId: turn.runId, mode: 'plan' });
    const saved = await store.getSession(turn.session.id);
    expect(saved.messages.map((message) => [message.role, message.mode, message.status])).toEqual([
      ['user', 'agent', 'sent'], ['assistant', 'plan', 'complete'],
    ]);
    expect(saved.messages[1]).toMatchObject({ planProposed: true });
    expect(capture).toHaveBeenCalledOnce();
    expect(finish).toHaveBeenCalledOnce();
    expect(runRegistry.list().recent.find((run) => run.runId === turn.runId)?.mode).toBe('plan');
  });

  it('captures a checkpoint before a read-only task resumes as Auto', async () => {
    const capture = vi.spyOn(checkpoints, 'capture');
    const turn = await start('ask');
    expect(capture).not.toHaveBeenCalled();
    expect((await turn.select('auto')).status).toBe(200);
    await events(turn.response);
    expect(capture).toHaveBeenCalledOnce();
    expect(fixture.attempts[1].policy).toMatchObject({ mode: 'auto', level: 'native' });
    expect((await store.getSession(turn.session.id)).messages[1]).toMatchObject({ mode: 'auto', level: 'native' });
  });

  it('rejects malformed, unsupported, and Guarded Auto changes without interrupting the current task', async () => {
    delete cached.__codeaiSecurityLevel;
    vi.stubEnv('CODEAI_SECURITY_LEVEL', 'guarded');
    fixture.modes = ['ask', 'plan', 'agent', 'auto'];
    const turn = await start();
    expect((await turn.select('turbo')).status).toBe(400);
    expect((await turn.select('ask', { sandbox: 'danger-full-access' })).status).toBe(400);
    expect((await turn.select('full')).status).toBe(409);
    const invalidAuto = await turn.select('auto');
    expect(invalidAuto.status).toBe(409);
    expect(await invalidAuto.text()).toContain('data directory');
    expect(fixture.attempts[0].signal.aborted).toBe(false);
    expect(fixture.attempts).toHaveLength(1);
    expect((await turn.select('agent')).status).toBe(200);
    expect(fixture.attempts[0].signal.aborted).toBe(false);
  });

  it('rejects isolated Native Claude writing while leaving its Ask attempt running', async () => {
    const turn = await start('ask', { provider: 'claude', instructions: 'isolated' });
    const refused = await turn.select('agent');
    expect(refused.status).toBe(409);
    expect(await refused.text()).toContain('Claude loads them itself');
    expect(fixture.attempts[0].signal.aborted).toBe(false);
  });

  it('lets cancellation win over validation of a mode change', async () => {
    const turn = await start();
    let release!: () => void;
    fixture.healthWait = new Promise<void>((resolve) => { release = resolve; });
    const changing = turn.select('auto');
    await Promise.resolve();
    await runRegistry.cancel(turn.runId);
    await events(turn.response);
    release();
    expect((await changing).status).toBe(409);
    expect(fixture.attempts).toHaveLength(1);
  });

  it('carries the consumed tool-turn allowance across attempts and refuses another attempt when exhausted', async () => {
    vi.stubEnv('CODEAI_AGENT_MAX_TURNS', '2');
    fixture.run = async (input) => {
      input.emit({ type: 'turn-started' });
      return interrupted(input);
    };
    const turn = await start('ask');
    expect(fixture.attempts[0].policy.maxTurns).toBe(2);
    expect((await turn.select('plan')).status).toBe(200);
    await vi.waitFor(() => expect(fixture.attempts).toHaveLength(2));
    expect(fixture.attempts[1].policy.maxTurns).toBe(1);
    expect((await turn.select('ask')).status).toBe(200);
    const streamed = await events(turn.response);
    expect(fixture.attempts).toHaveLength(2);
    expect(streamed).toContainEqual(expect.objectContaining({ type: 'error', code: 'max-turns' }));
  });

  it('rejects a change that finishes validation after final answer publication begins', async () => {
    let finish!: () => void;
    fixture.run = async (input) => {
      await new Promise<void>((resolve) => { finish = resolve; });
      return complete(input);
    };
    const turn = await start('ask');
    let release!: () => void;
    fixture.healthWait = new Promise<void>((resolve) => { release = resolve; });
    const changing = turn.select('plan');
    await Promise.resolve();
    finish();
    await events(turn.response);
    release();
    expect((await changing).status).toBe(409);
    expect((await store.getSession(turn.session.id)).messages[1].mode).toBe('ask');
  });

  it('fails an upgrade without invoking a writing provider when the checkpoint cannot be saved', async () => {
    const turn = await start('ask');
    vi.spyOn(checkpoints, 'capture').mockRejectedValueOnce(new Error('disk full'));
    expect((await turn.select('agent')).status).toBe(200);
    const streamed = await events(turn.response);
    expect(fixture.attempts).toHaveLength(1);
    expect(streamed).toContainEqual(expect.objectContaining({ type: 'error', code: 'internal', delivery: 'possibly-sent' }));
  });
});
