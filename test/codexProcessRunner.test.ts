import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CodexProcessRunner } from '@/server/agents/codexProcessRunner';
import { checkCodex } from '@/server/agents/codexPreflight';
import {
  buildCodexAppServerArgs, codexAmbientInstructionNote, codexModelChoices, codexThreadPolicyIssue, codexTurnSecurity,
} from '@/server/agents/codexInvocation';
import { PermissionBroker } from '@/server/runs/permissionBroker';
import { resolveAgentPolicy } from '@/server/agents/agentPolicy';
import { getConfig } from '@/server/config';
import type { AgentMode, AgentProcessEvent } from '@/shared/types';

const binary = path.resolve('test/fixtures/fake-codex.mjs');

interface RunOptions {
  action?: 'start' | 'resume';
  sessionId?: string;
  mode?: AgentMode;
  timeoutMs?: number;
  signal?: AbortSignal;
  permissions?: PermissionBroker;
  onEvent?(event: AgentProcessEvent): void;
  /** The installation default (`CODEAI_CODEX_MODEL`). */
  runnerModel?: string;
  model?: string;
  effort?: string;
}

type RecordedRequest = { method: string; params: Record<string, unknown> };

describe.sequential('CodexProcessRunner', () => {
  beforeAll(async () => chmod(binary, 0o755));
  afterEach(() => {
    delete process.env.CODEAI_FAKE_CODEX_MODE;
    delete process.env.CODEAI_FAKE_CODEX_RECORD;
  });

  async function run(options: RunOptions = {}) {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'codeai-codex-'));
    const recordPath = path.join(directory, 'codex-invocation.json');
    await writeFile(path.join(directory, 'canvas.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
    process.env.CODEAI_FAKE_CODEX_RECORD = recordPath;
    const events: AgentProcessEvent[] = [];
    const mode = options.mode || 'ask';
    const runner = new CodexProcessRunner({ binary, model: options.runnerModel, maxOutputBytes: 100_000, killGraceMs: 50 });
    const result = await runner.run({
      runId: crypto.randomUUID(),
      checkout: { id: 'p', name: 'fixture', relativePath: '.', realPath: process.cwd() },
      session: { id: options.sessionId, action: options.action || 'start' },
      prompt: mode === 'plan' ? 'Mode: PLAN\n\n[User message]\nMake a plan' : 'Mode: ASK\n\n[User message]\nExplain this',
      attachmentDirectory: directory,
      policy: { ...resolveAgentPolicy(getConfig(), mode), timeoutMs: options.timeoutMs || 5_000 },
      permissions: options.permissions,
      signal: options.signal || new AbortController().signal,
      emit(event) { events.push(event); options.onEvent?.(event); },
      model: options.model,
      effort: options.effort,
    });
    const invocation = JSON.parse(await readFile(recordPath, 'utf8'));
    return { result, events, invocation, recordPath };
  }

  it('isolates App Server on stdio and maps read-only start, images, streaming, and activity', async () => {
    const { result, events, invocation } = await run();
    expect(buildCodexAppServerArgs().slice(0, 2)).toEqual(['app-server', '--stdio']);
    expect(buildCodexAppServerArgs()).not.toContain('exec');
    expect(buildCodexAppServerArgs()).toContain('mcp_servers={}');
    expect(codexTurnSecurity('ask')).toMatchObject({
      approvalPolicy: 'never', sandboxPolicy: { type: 'readOnly', networkAccess: false },
    });
    expect(result).toMatchObject({ finalText: 'Codex answer.', sessionId: 'codex-thread-new' });
    expect(events).toContainEqual({ type: 'session-started', sessionId: 'codex-thread-new' });
    expect(events.filter((event) => event.type === 'text-delta').map((event) => event.text).join('')).toBe('Codex answer.');
    const activity = events.filter((event) => event.type === 'activity');
    expect(activity).toContainEqual({ type: 'activity', tool: 'Shell', detail: 'sed -n 1,20p ./README.md' });
    expect(JSON.stringify(activity)).not.toContain(process.cwd());
    const turn = invocation.requests.find((request: { method: string }) => request.method === 'turn/start');
    expect(turn.params.sandboxPolicy).toEqual({ type: 'readOnly', networkAccess: false });
    expect(turn.params.input).toContainEqual(expect.objectContaining({ type: 'localImage' }));
    const thread = invocation.requests.find((request: { method: string }) => request.method === 'thread/start');
    expect(thread.params.config).toMatchObject({ mcp_servers: {}, features: { multi_agent: false } });
  });

  it('keeps Default params unchanged and sends a chosen model on every request but effort only on the turn', async () => {
    const params = (invocation: { requests: RecordedRequest[] }, method: string) => (
      invocation.requests.find((request) => request.method === method)!.params
    );
    const threadKeys = ['approvalPolicy', 'config', 'cwd', 'developerInstructions', 'sandbox', 'serviceName'];
    const turnKeys = ['approvalPolicy', 'cwd', 'input', 'sandboxPolicy', 'threadId'];

    const plain = (await run()).invocation;
    expect(Object.keys(params(plain, 'thread/start')).sort()).toEqual(threadKeys);
    expect(Object.keys(params(plain, 'turn/start')).sort()).toEqual(turnKeys);

    const configured = (await run({ runnerModel: 'configured-model' })).invocation;
    expect(Object.keys(params(configured, 'thread/start')).sort()).toEqual([...threadKeys, 'model'].sort());
    expect(params(configured, 'thread/start').model).toBe('configured-model');
    expect(Object.keys(params(configured, 'turn/start')).sort()).toEqual([...turnKeys, 'model'].sort());
    expect(params(configured, 'turn/start').model).toBe('configured-model');

    const chosen = (await run({ runnerModel: 'configured-model', model: 'gpt-5.5', effort: 'high' })).invocation;
    expect(params(chosen, 'thread/start')).toMatchObject({ model: 'gpt-5.5' });
    expect(params(chosen, 'thread/start')).not.toHaveProperty('effort');
    expect(params(chosen, 'turn/start')).toMatchObject({ model: 'gpt-5.5', effort: 'high' });

    const resumed = (await run({ action: 'resume', sessionId: 'codex-thread-resume', model: 'gpt-5.5', effort: 'low' })).invocation;
    expect(params(resumed, 'thread/resume')).toMatchObject({ threadId: 'codex-thread-resume', model: 'gpt-5.5' });
    expect(params(resumed, 'thread/resume')).not.toHaveProperty('effort');
    expect(params(resumed, 'turn/start')).toMatchObject({ model: 'gpt-5.5', effort: 'low' });

    const effortOnly = (await run({ effort: 'medium' })).invocation;
    expect(params(effortOnly, 'thread/start')).not.toHaveProperty('model');
    expect(Object.keys(params(effortOnly, 'turn/start')).sort()).toEqual([...turnKeys, 'effort'].sort());
  });

  it('resumes only the stored Codex thread and preserves plan markers', async () => {
    const resumed = await run({ action: 'resume', sessionId: 'codex-thread-resume' });
    expect(resumed.result.finalText).toBe('Resumed Codex thread.');
    const request = resumed.invocation.requests.find((item: { method: string }) => item.method === 'thread/resume');
    expect(request.params.threadId).toBe('codex-thread-resume');

    const planned = await run({ mode: 'plan' });
    expect(planned.result.finalText).toContain('cartograph:plan:start');
  });

  it.each([
    ['approval-command', 'Shell'],
    ['approval-file', 'Edit'],
  ] as const)('routes %s through one-shot permission decisions', async (fakeMode, tool) => {
    process.env.CODEAI_FAKE_CODEX_MODE = fakeMode;
    const permissions = new PermissionBroker(5_000);
    const { result, events, invocation } = await run({
      mode: 'agent',
      permissions,
      onEvent(event) {
        if (event.type === 'permission-request' && event.requestId) {
          setTimeout(() => permissions.decide(event.requestId!, 'allow'), 0);
        }
      },
    });
    expect(events).toContainEqual(expect.objectContaining({ type: 'permission-request', tool }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'permission-resolved', decision: 'allow' }));
    expect(invocation.responses).toContainEqual(expect.objectContaining({ result: { decision: 'accept' } }));
    expect(result.finalText).toBe('Approved once.');
    expect(codexTurnSecurity('agent')).toMatchObject({
      approvalPolicy: 'on-request', sandboxPolicy: { type: 'readOnly', networkAccess: false },
    });
  });

  it('makes denial model-visible and continues the turn', async () => {
    process.env.CODEAI_FAKE_CODEX_MODE = 'approval-file';
    const permissions = new PermissionBroker(5_000);
    const { result, invocation } = await run({
      mode: 'agent',
      permissions,
      onEvent(event) {
        if (event.type === 'permission-request' && event.requestId) {
          setTimeout(() => permissions.decide(event.requestId!, 'deny'), 0);
        }
      },
    });
    expect(invocation.responses).toContainEqual(expect.objectContaining({ result: { decision: 'decline' } }));
    expect(result.finalText).toBe('Declined and continued.');
  });

  it('interrupts on cancellation and timeout before closing the child', async () => {
    process.env.CODEAI_FAKE_CODEX_MODE = 'wait';
    const controller = new AbortController();
    const cancelledDirectory = await mkdtemp(path.join(os.tmpdir(), 'codeai-codex-cancel-'));
    const cancelledRecord = path.join(cancelledDirectory, 'record.json');
    process.env.CODEAI_FAKE_CODEX_RECORD = cancelledRecord;
    const runner = new CodexProcessRunner({ binary, maxOutputBytes: 100_000, killGraceMs: 100 });
    const base = {
      runId: crypto.randomUUID(),
      checkout: { id: 'p', name: 'fixture', relativePath: '.', realPath: process.cwd() },
      session: { action: 'start' as const },
      prompt: 'wait', attachmentDirectory: cancelledDirectory,
      policy: { ...resolveAgentPolicy(getConfig(), 'ask'), timeoutMs: 1_000 },
      signal: controller.signal, emit() {},
    };
    const cancelled = runner.run(base);
    const cancellation = expect(cancelled).rejects.toMatchObject({ code: 'cancelled' });
    await vi.waitFor(async () => {
      const current = JSON.parse(await readFile(cancelledRecord, 'utf8'));
      expect(current.requests).toContainEqual(expect.objectContaining({ method: 'turn/start' }));
    }, { timeout: 5_000, interval: 20 });
    controller.abort();
    await cancellation;
    let record = JSON.parse(await readFile(cancelledRecord, 'utf8'));
    expect(record.requests).toContainEqual(expect.objectContaining({ method: 'turn/interrupt' }));

    const timeoutRecord = path.join(cancelledDirectory, 'timeout.json');
    process.env.CODEAI_FAKE_CODEX_RECORD = timeoutRecord;
    await expect(runner.run({
      ...base,
      runId: crypto.randomUUID(),
      signal: new AbortController().signal,
      policy: { ...base.policy, timeoutMs: 1_000 },
    })).rejects.toMatchObject({ code: 'timeout' });
    record = JSON.parse(await readFile(timeoutRecord, 'utf8'));
    expect(record.requests).toContainEqual(expect.objectContaining({ method: 'turn/interrupt' }));
  });

  it('classifies missing sessions, malformed JSONL, crashes, and ambient integrations', async () => {
    process.env.CODEAI_FAKE_CODEX_MODE = 'missing-session';
    await expect(run({ action: 'resume', sessionId: 'gone' })).rejects.toMatchObject({ code: 'missing-session' });
    process.env.CODEAI_FAKE_CODEX_MODE = 'malformed';
    await expect(run()).rejects.toMatchObject({ code: 'malformed-stream' });
    process.env.CODEAI_FAKE_CODEX_MODE = 'crash';
    await expect(run()).rejects.toMatchObject({ code: 'process-failed' });
    process.env.CODEAI_FAKE_CODEX_MODE = 'ambient-skill';
    await expect(run()).rejects.toMatchObject({ code: 'unsupported-flags', delivery: 'not-sent' });
  });

  it('disables inherited MCP servers per thread and fails closed if App Server ignores it', async () => {
    process.env.CODEAI_FAKE_CODEX_MODE = 'ambient-mcp';
    const isolated = await run();
    const thread = isolated.invocation.requests.find((item: { method: string }) => item.method === 'thread/start');
    expect(thread.params.config.mcp_servers).toEqual({ ambient: { enabled: false } });
    expect(isolated.result.finalText).toBe('Codex answer.');

    process.env.CODEAI_FAKE_CODEX_MODE = 'ambient-mcp-unisolated';
    await expect(run()).rejects.toMatchObject({ code: 'unsupported-flags', delivery: 'not-sent' });
  });

  it('notes ambient instruction files without blocking the turn', async () => {
    process.env.CODEAI_FAKE_CODEX_MODE = 'ambient-instructions';
    const { result } = await run();
    expect(result.finalText).toBe('Codex answer.');

    const thread = { cwd: '/repo', approvalPolicy: 'never', sandbox: { type: 'readOnly', networkAccess: false } };
    expect(codexThreadPolicyIssue({ ...thread, instructionSources: ['/home/user/.codex/AGENTS.md'] }, '/repo', 'never')).toBeUndefined();
    expect(codexThreadPolicyIssue({ ...thread, instructionSources: ['relative/AGENTS.md'] }, '/repo', 'never')).toMatch(/invalid instruction source/);
    expect(codexAmbientInstructionNote({ instructionSources: ['/repo/AGENTS.md'] }, '/repo')).toBeUndefined();
    expect(codexAmbientInstructionNote({ instructionSources: ['/home/user/.codex/AGENTS.md', '/repo/AGENTS.md'] }, '/repo'))
      .toMatch(/^Codex also loads 1 instruction file from outside the repository/);
  });

  it('preflights authentication, isolation, protocol support, and mode gates without a model turn', async () => {
    const recordPath = path.join(await mkdtemp(path.join(os.tmpdir(), 'codeai-codex-preflight-')), 'preflight.json');
    process.env.CODEAI_FAKE_CODEX_RECORD = recordPath;
    await expect(checkCodex(binary, process.cwd(), false)).resolves.toEqual({
      available: true, authenticated: true, supportedModes: ['ask', 'plan'],
      message: expect.any(String),
      // The hidden entry is left out, and Default offers only the efforts both models accept.
      models: [
        { id: 'fake-large', label: 'Fake Large', efforts: ['low', 'medium', 'high', 'ultra'] },
        { id: 'fake-small', label: 'Fake Small', efforts: ['minimal', 'low', 'medium', 'high', 'xhigh'] },
      ],
      efforts: ['low', 'medium', 'high'],
    });
    const requests = (JSON.parse(await readFile(recordPath, 'utf8')) as { requests: RecordedRequest[] }).requests;
    const methods = requests.map((request) => request.method);
    expect(requests.find((request) => request.method === 'model/list')?.params).toEqual({ includeHidden: false, limit: 50 });
    // It is sent with the first batch, so the whole handshake has time to answer it.
    expect(methods.indexOf('model/list')).toBeLessThan(methods.indexOf('thread/start'));
    delete process.env.CODEAI_FAKE_CODEX_RECORD;

    process.env.CODEAI_FAKE_CODEX_MODE = 'no-model-list';
    const withoutList = await checkCodex(binary, process.cwd(), false);
    expect(withoutList).toMatchObject({ available: true, authenticated: true, supportedModes: ['ask', 'plan'] });
    expect(withoutList).not.toHaveProperty('models');
    expect(withoutList).not.toHaveProperty('efforts');

    process.env.CODEAI_FAKE_CODEX_MODE = 'silent-model-list';
    const startedAt = Date.now();
    const silentList = await checkCodex(binary, process.cwd(), false);
    expect(silentList).toMatchObject({ available: true, authenticated: true, supportedModes: ['ask', 'plan'] });
    expect(silentList).not.toHaveProperty('models');
    expect(Date.now() - startedAt).toBeLessThan(2_000);

    process.env.CODEAI_FAKE_CODEX_MODE = 'unauthenticated';
    await expect(checkCodex(binary, process.cwd(), false)).resolves.toMatchObject({
      available: false, authenticated: false, supportedModes: [],
    });
    process.env.CODEAI_FAKE_CODEX_MODE = 'ambient-mcp';
    await expect(checkCodex(binary, process.cwd(), true)).resolves.toMatchObject({
      available: true, authenticated: true, supportedModes: ['ask', 'plan', 'agent'],
    });
    process.env.CODEAI_FAKE_CODEX_MODE = 'ambient-instructions';
    await expect(checkCodex(binary, process.cwd(), true)).resolves.toMatchObject({
      available: true, authenticated: true, supportedModes: ['ask', 'plan', 'agent'],
      message: expect.stringContaining('instruction file from outside the repository'),
    });
    process.env.CODEAI_FAKE_CODEX_MODE = 'ambient-mcp-unisolated';
    await expect(checkCodex(binary, process.cwd(), true)).resolves.toMatchObject({
      available: false, authenticated: true, supportedModes: [],
    });
    await expect(checkCodex(path.resolve('test/fixtures/missing-codex'), process.cwd(), false)).resolves.toMatchObject({
      available: false, authenticated: 'unknown', supportedModes: [],
    });
  });

  it('keeps only visible, bounded model/list entries', () => {
    const entry = (model: unknown, efforts: unknown[] = ['low', 'high'], extra: Record<string, unknown> = {}) => ({
      id: model, model, displayName: typeof model === 'string' ? model.toUpperCase() : 'Bad', hidden: false, isDefault: false,
      supportedReasoningEfforts: efforts.map((reasoningEffort) => ({ reasoningEffort, description: '' })),
      defaultReasoningEffort: 'low', ...extra,
    });
    expect(codexModelChoices({ data: [
      entry('gpt-a', ['low', 'medium', 'high']),
      entry('gpt-hidden', ['low'], { hidden: true }),
      entry('-flag'),
      entry('bad id'),
      entry('m'.repeat(101)),
      entry(42),
      entry('gpt-long-label', ['low'], { displayName: 'L'.repeat(81) }),
      entry('gpt-no-label', ['low'], { displayName: '' }),
      entry('gpt-bad-effort', ['low', 'High']),
      entry('gpt-too-many', ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']),
      entry('gpt-a', ['low']),
      entry('gpt-b', ['high', 'low']),
      null,
    ], nextCursor: 'next-page' })).toEqual({
      models: [
        { id: 'gpt-a', label: 'GPT-A', efforts: ['low', 'medium', 'high'] },
        { id: 'gpt-b', label: 'GPT-B', efforts: ['high', 'low'] },
      ],
      efforts: ['low', 'high'],
    });
    expect(codexModelChoices({ data: Array.from({ length: 60 }, (_, index) => entry(`gpt-${index}`)) }).models).toHaveLength(50);
    expect(codexModelChoices({ data: [entry('gpt-a', []), entry('gpt-b')] })).toEqual({
      models: [{ id: 'gpt-a', label: 'GPT-A', efforts: [] }, { id: 'gpt-b', label: 'GPT-B', efforts: ['low', 'high'] }],
    });
    for (const malformed of [undefined, null, 'list', { data: 'x' }, { data: [] }, { data: [entry('-x')] }]) {
      expect(codexModelChoices(malformed)).toEqual({});
    }
  });
});
