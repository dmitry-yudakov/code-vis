import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CodexProcessRunner } from '@/server/agents/codexProcessRunner';
import { checkCodex } from '@/server/agents/codexPreflight';
import { buildCodexAppServerArgs, codexTurnSecurity } from '@/server/agents/codexInvocation';
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
}

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
    const runner = new CodexProcessRunner({ binary, maxOutputBytes: 100_000, killGraceMs: 50 });
    const result = await runner.run({
      runId: crypto.randomUUID(),
      project: { id: 'p', name: 'fixture', relativePath: '.', realPath: process.cwd() },
      session: { id: options.sessionId, action: options.action || 'start' },
      prompt: mode === 'plan' ? 'Mode: PLAN\n\n[User message]\nMake a plan' : 'Mode: ASK\n\n[User message]\nExplain this',
      attachmentDirectory: directory,
      policy: { ...resolveAgentPolicy(getConfig(), mode), timeoutMs: options.timeoutMs || 2_000 },
      permissions: options.permissions,
      signal: options.signal || new AbortController().signal,
      emit(event) { events.push(event); options.onEvent?.(event); },
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
    setTimeout(() => controller.abort(), 40);
    const cancelledDirectory = await mkdtemp(path.join(os.tmpdir(), 'codeai-codex-cancel-'));
    const cancelledRecord = path.join(cancelledDirectory, 'record.json');
    process.env.CODEAI_FAKE_CODEX_RECORD = cancelledRecord;
    const runner = new CodexProcessRunner({ binary, maxOutputBytes: 100_000, killGraceMs: 100 });
    const base = {
      runId: crypto.randomUUID(),
      project: { id: 'p', name: 'fixture', relativePath: '.', realPath: process.cwd() },
      session: { action: 'start' as const },
      prompt: 'wait', attachmentDirectory: cancelledDirectory,
      policy: { ...resolveAgentPolicy(getConfig(), 'ask'), timeoutMs: 1_000 },
      signal: controller.signal, emit() {},
    };
    await expect(runner.run(base)).rejects.toMatchObject({ code: 'cancelled' });
    let record = JSON.parse(await readFile(cancelledRecord, 'utf8'));
    expect(record.requests).toContainEqual(expect.objectContaining({ method: 'turn/interrupt' }));

    const timeoutRecord = path.join(cancelledDirectory, 'timeout.json');
    process.env.CODEAI_FAKE_CODEX_RECORD = timeoutRecord;
    await expect(runner.run({
      ...base,
      runId: crypto.randomUUID(),
      signal: new AbortController().signal,
      policy: { ...base.policy, timeoutMs: 40 },
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

  it('preflights authentication, isolation, protocol support, and mode gates without a model turn', async () => {
    await expect(checkCodex(binary, process.cwd(), false)).resolves.toMatchObject({
      available: true, authenticated: true, supportedModes: ['ask', 'plan'],
    });
    process.env.CODEAI_FAKE_CODEX_MODE = 'unauthenticated';
    await expect(checkCodex(binary, process.cwd(), false)).resolves.toMatchObject({
      available: false, authenticated: false, supportedModes: [],
    });
    process.env.CODEAI_FAKE_CODEX_MODE = 'ambient-mcp';
    await expect(checkCodex(binary, process.cwd(), true)).resolves.toMatchObject({
      available: true, authenticated: true, supportedModes: ['ask', 'plan', 'agent'],
    });
    process.env.CODEAI_FAKE_CODEX_MODE = 'ambient-mcp-unisolated';
    await expect(checkCodex(binary, process.cwd(), true)).resolves.toMatchObject({
      available: false, authenticated: true, supportedModes: [],
    });
    await expect(checkCodex(path.resolve('test/fixtures/missing-codex'), process.cwd(), false)).resolves.toMatchObject({
      available: false, authenticated: 'unknown', supportedModes: [],
    });
  });
});
