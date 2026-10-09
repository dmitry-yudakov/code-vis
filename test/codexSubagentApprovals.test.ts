import { spawn } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { resolveAgentPolicy } from '@/server/agents/agentPolicy';
import { CodexProcessRunner } from '@/server/agents/codexProcessRunner';
import { getConfig } from '@/server/config';
import { PermissionBroker } from '@/server/runs/permissionBroker';
import type { AgentMode, AgentProcessEvent } from '@/shared/types';

const binary = path.resolve('test/fixtures/fake-codex.mjs');
const directories: string[] = [];
beforeAll(async () => chmod(binary, 0o755));
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

interface RpcMessage {
  id?: string | number;
  method?: string;
  params?: Record<string, unknown>;
  result?: { decision?: string };
  error?: { code: number };
}

interface Options {
  decision?: 'allow' | 'deny' | 'hold';
  mode?: AgentMode;
  level?: 'guarded' | 'native';
  execution?: 'local' | 'docker';
  resumed?: boolean;
  abort?: boolean;
  timeoutMs?: number;
  decisionDelayMs?: number;
  approvalTimeoutMs?: number;
}

async function runDelegation(fixture: string, options: Options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'codeai-codex-subagent-'));
  directories.push(directory);
  const recordPath = path.join(directory, 'protocol.json');
  vi.stubEnv('CODEAI_FAKE_CODEX_MODE', fixture);
  vi.stubEnv('CODEAI_FAKE_CODEX_RECORD', recordPath);
  const permissions = new PermissionBroker(options.approvalTimeoutMs ?? 0);
  const controller = new AbortController();
  const events: AgentProcessEvent[] = [];
  const lateDecisions: boolean[] = [];
  const timers: ReturnType<typeof setTimeout>[] = [];
  const runner = new CodexProcessRunner({
    binary, maxOutputBytes: 100_000, killGraceMs: 50,
    ...(options.execution === 'docker' ? { transport: {
      spawn: (executable: string, args: string[]) => spawn(executable, args, { stdio: ['pipe', 'pipe', 'pipe'] }),
    } } : {}),
  });
  // Also interrupt an unimplemented fixture that never opens a card, so the red test stays bounded.
  if (options.abort) timers.push(setTimeout(() => controller.abort(), 200));
  let failure: unknown;
  const result = await runner.run({
    runId: crypto.randomUUID(),
    checkout: { id: 'checkout', name: 'fixture', relativePath: '.', realPath: process.cwd() },
    session: { action: options.resumed ? 'resume' : 'start', ...(options.resumed ? { id: 'saved-parent-thread' } : {}) },
    prompt: 'Run a subagent to review the implementation.', attachmentDirectory: directory,
    policy: { ...resolveAgentPolicy({ ...getConfig(), securityLevel: options.level ?? 'native' },
      options.mode ?? 'auto', options.execution ?? 'local'), timeoutMs: options.timeoutMs ?? 2_000 },
    permissions, signal: controller.signal,
    emit(event) {
      events.push(event);
      if (event.type === 'permission-request' && event.requestId && (options.decision ?? 'allow') !== 'hold') {
        const requestId = event.requestId;
        timers.push(setTimeout(() => permissions.decide(requestId, options.decision === 'deny' ? 'deny' : 'allow'), options.decisionDelayMs ?? 0));
      }
      if (event.type === 'permission-resolved' && event.requestId) {
        lateDecisions.push(permissions.decide(event.requestId, 'allow'));
      }
    },
  }).catch((error: unknown) => { failure = error; return undefined; });
  for (const timer of timers) clearTimeout(timer);
  const protocol = JSON.parse(await readFile(recordPath, 'utf8')) as { requests: RpcMessage[]; responses: RpcMessage[] };
  return { result, failure, permissions, events, lateDecisions, protocol,
    cards: events.filter((event) => event.type === 'permission-request'),
    resolutions: events.filter((event) => event.type === 'permission-resolved'),
    callbackResponses: protocol.responses.filter((message) => String(message.id).startsWith('child-') || String(message.id) === '0') };
}

describe.sequential('Native Codex descendant approval routing', () => {
  it.each([
    { fixture: 'subagent-direct', decision: 'allow', resumed: false },
    { fixture: 'subagent-direct', decision: 'deny', resumed: false },
    { fixture: 'subagent-direct', decision: 'allow', resumed: true },
    { fixture: 'subagent-nested', decision: 'allow', resumed: false },
    { fixture: 'subagent-lazy', decision: 'allow', resumed: false },
  ] as const)('routes $fixture/$decision through the parent broker (resumed=$resumed)', async (options) => {
    const run = await runDelegation(options.fixture, options);
    expect(run.failure).toBeUndefined();
    expect(run.result).toMatchObject({ finalText: 'Parent continued after review.',
      sessionId: options.resumed ? 'saved-parent-thread' : 'codex-thread-new' });
    expect(run.cards).toHaveLength(1);
    expect(run.cards[0]).toMatchObject({ tool: 'Shell', detail: expect.stringMatching(/subagent/i) });
    expect(run.cards[0].detail).toContain('npm test -- review');
    expect(run.resolutions).toEqual([expect.objectContaining({ requestId: run.cards[0].requestId, decision: options.decision })]);
    expect(run.callbackResponses).toEqual([{ id: 'child-command', result: { decision: options.decision === 'allow' ? 'accept' : 'decline' } }]);
    expect(run.permissions.pendingCount).toBe(0);
    expect(run.lateDecisions).toEqual([false]);
    if (options.fixture === 'subagent-lazy') {
      expect(run.protocol.requests).toContainEqual(expect.objectContaining({ method: 'thread/read', params: expect.objectContaining({ threadId: 'reviewer' }) }));
      expect(run.protocol.requests.map((request) => request.method)).not.toContain('thread/resume');
    }
  });

  it.each(['subagent-file-collision', 'subagent-lazy-file'])('keeps %s file detail scoped when parent and child item IDs collide', async (fixture) => {
    const run = await runDelegation(fixture);
    expect(run.failure).toBeUndefined();
    expect(run.cards).toHaveLength(1);
    expect(run.cards[0]).toMatchObject({ tool: 'Edit', detail: expect.stringMatching(/subagent/i) });
    expect(run.cards[0].detail).toContain('reviewer-only.ts');
    expect(run.cards[0].detail).not.toContain('parent-only.ts');
    expect(run.callbackResponses).toEqual([{ id: 'child-file', result: { decision: 'accept' } }]);
  });

  it.each(['subagent-concurrent', 'subagent-lazy-concurrent'])('keeps valid %s discovery/cards when unrelated child events arrive', async (fixture) => {
    const run = await runDelegation(fixture);
    expect(run.failure).toBeUndefined();
    expect(run.cards).toHaveLength(1);
    expect(run.resolutions).toEqual([expect.objectContaining({ decision: 'allow' })]);
    expect(run.callbackResponses).toHaveLength(2);
    expect(run.callbackResponses).toEqual(expect.arrayContaining([
      { id: 'child-command', result: { decision: 'accept' } },
      expect.objectContaining({ id: 'child-unrelated', error: { code: -32601, message: expect.any(String) } }),
    ]));
    expect(run.result?.finalText).toBe('Parent continued after review.');
  });

  it.each(['subagent-unknown', 'subagent-shared-family', 'subagent-conflicting-parent', 'subagent-malformed-parent',
    'subagent-stale-turn', 'subagent-closed'])('fails closed for %s without opening a permission card', async (fixture) => {
    const run = await runDelegation(fixture);
    expect(run.failure).toBeUndefined();
    expect(run.cards).toEqual([]);
    expect(run.callbackResponses).toEqual([expect.objectContaining({ id: 'child-command', error: { code: -32601, message: expect.any(String) } })]);
    expect(run.result?.finalText).toBe('Parent continued after review.');
  });

  it('opens and answers a duplicate provider callback exactly once', async () => {
    const run = await runDelegation('subagent-duplicate');
    expect(run.failure).toBeUndefined();
    expect(run.cards).toHaveLength(1);
    expect(run.resolutions).toHaveLength(1);
    expect(run.callbackResponses).toEqual([{ id: 'child-command', result: { decision: 'accept' } }]);
  });

  it('correlates numeric and string provider callback IDs independently', async () => {
    const run = await runDelegation('subagent-numeric-ids');
    expect(run.failure).toBeUndefined();
    expect(run.cards).toHaveLength(2);
    expect(new Set(run.cards.map((card) => card.requestId)).size).toBe(2);
    expect(run.callbackResponses).toEqual([{ id: 0, result: { decision: 'accept' } }, { id: '0', result: { decision: 'accept' } }]);
    expect(run.resolutions).toHaveLength(2);
  });

  it.each(['subagent-lazy-child-complete', 'subagent-lazy-parent-complete'])('refuses a %s request while ancestry lookup is unresolved', async (fixture) => {
    const run = await runDelegation(fixture);
    expect(run.failure).toBeUndefined();
    expect(run.cards).toEqual([]);
    expect(run.callbackResponses.some((message) => message.result?.decision === 'accept')).toBe(false);
    expect(run.result?.finalText).toBe('Parent continued after review.');
    expect(run.permissions.pendingCount).toBe(0);
  });

  it('keeps child final text, usage, error and completion distinct from the parent', async () => {
    const run = await runDelegation('subagent-lifecycle', { decision: 'hold' });
    expect(run.failure).toBeUndefined();
    expect(run.result).toMatchObject({ finalText: 'Parent continued after review.', usage: { inputTokens: 11, outputTokens: 7 } });
    expect(run.events.filter((event) => event.type === 'text-delta').map((event) => event.text).join('')).toBe('Parent continued after review.');
    expect(run.cards).toHaveLength(1);
    expect(run.resolutions).toEqual([expect.objectContaining({ decision: 'cancelled' })]);
    expect(run.events).toContainEqual(expect.objectContaining({ type: 'activity', detail: expect.stringMatching(/child review failed|subagent.*failed/i) }));
    expect(run.lateDecisions).toEqual([false]);
  });

  it.each(['subagent-child-complete', 'subagent-child-closed', 'subagent-parent-complete'])('cancels %s pending cards and refuses late answers', async (fixture) => {
    const run = await runDelegation(fixture, { decision: 'hold' });
    expect(run.failure).toBeUndefined();
    expect(run.cards).toHaveLength(1);
    expect(run.resolutions).toEqual([expect.objectContaining({ requestId: run.cards[0].requestId, decision: 'cancelled' })]);
    expect(run.callbackResponses).toEqual([{ id: 'child-command', result: { decision: 'cancel' } }]);
    expect(run.permissions.pendingCount).toBe(0);
    expect(run.lateDecisions).toEqual([false]);
  });

  it('cancels the child card without closing a simultaneous parent card', async () => {
    const run = await runDelegation('subagent-parent-card');
    expect(run.failure).toBeUndefined();
    expect(run.cards).toHaveLength(2);
    expect(run.resolutions.map((event) => event.decision)).toEqual(['cancelled', 'allow']);
    expect(run.protocol.responses).toEqual([{ id: 'child-command', result: { decision: 'cancel' } },
      { id: 'parent-command', result: { decision: 'accept' } }]);
    expect(run.result?.finalText).toBe('Parent continued after review.');
    expect(run.permissions.pendingCount).toBe(0);
  });

  it('cancels a nested child card when its coordinator closes before Allow', async () => {
    const run = await runDelegation('subagent-ancestor-closed');
    expect(run.failure).toBeUndefined();
    expect(run.cards).toHaveLength(1);
    expect(run.resolutions).toEqual([expect.objectContaining({ decision: 'cancelled' })]);
    expect(run.callbackResponses).toEqual([{ id: 'child-command', result: { decision: 'cancel' } }]);
    expect(run.lateDecisions).toEqual([false]);
  });

  it.each(['subagent-malformed-foreign-empty', 'subagent-malformed-foreign-long'])('isolates %s final text, usage and errors', async (fixture) => {
    const run = await runDelegation(fixture);
    expect(run.failure).toBeUndefined();
    expect(run.result).toMatchObject({ finalText: 'Parent continued after review.', usage: { inputTokens: 11, outputTokens: 7 } });
    expect(run.events.filter((event) => event.type === 'text-delta').map((event) => event.text).join('')).toBe('Parent continued after review.');
  });

  it('does not borrow file detail from a completed child turn with a reused item ID', async () => {
    const run = await runDelegation('subagent-file-stale');
    expect(run.failure).toBeUndefined();
    expect(run.cards).toHaveLength(1);
    expect(run.cards[0]).toMatchObject({ tool: 'Edit', detail: expect.stringMatching(/subagent/i) });
    expect(run.cards[0].detail).not.toContain('old.ts');
    expect(run.callbackResponses).toEqual([{ id: 'child-file', result: { decision: 'accept' } }]);
  });

  it('keeps the execution clock paused for a parent card after cancelling unpublished child discovery', async () => {
    const run = await runDelegation('subagent-lazy-clock', { timeoutMs: 500, decisionDelayMs: 1_100 });
    expect(run.failure).toBeUndefined();
    expect(run.cards).toHaveLength(1);
    expect(run.cards[0].detail).not.toMatch(/subagent/i);
    expect(run.protocol.responses).toEqual([{ id: 'child-command', result: { decision: 'cancel' } },
      { id: 'parent-command', result: { decision: 'accept' } }]);
    expect(run.result?.finalText).toBe('Parent continued after review.');
  });

  it('still interrupts a previously verified reviewer after its coordinator closes', async () => {
    const run = await runDelegation('subagent-ancestor-cancel', { decision: 'hold', abort: true });
    expect(run.failure).toMatchObject({ code: 'cancelled' });
    expect(run.protocol.requests.filter((message) => message.method === 'turn/interrupt').map((message) => message.params))
      .toEqual(expect.arrayContaining([{ threadId: 'reviewer', turnId: 'reviewer-turn' }, { threadId: 'codex-thread-new', turnId: 'codex-turn-1' }]));
    expect(run.permissions.pendingCount).toBe(0);
  });

  it('cancels a published child card when an earlier pending metadata lookup fails', async () => {
    // A finite broker timeout bounds the failing implementation, which otherwise waits forever.
    const run = await runDelegation('subagent-lazy-read-race', { decision: 'hold', approvalTimeoutMs: 400 });
    expect(run.failure).toBeUndefined();
    expect(run.cards).toHaveLength(1);
    expect(run.resolutions).toEqual([expect.objectContaining({ decision: 'cancelled' })]);
    expect(run.callbackResponses).toEqual([{ id: 'child-command', result: { decision: 'cancel' } }]);
    expect(run.result?.finalText).toBe('Parent continued after review.');
    expect(run.lateDecisions).toEqual([false]);
  });

  it('closes a provider-resolved callback without sending a second answer', async () => {
    const run = await runDelegation('subagent-request-resolved', { decision: 'hold' });
    expect(run.failure).toBeUndefined();
    expect(run.cards).toHaveLength(1);
    expect(run.resolutions).toEqual([expect.objectContaining({ decision: 'cancelled' })]);
    expect(run.callbackResponses).toEqual([]);
    expect(run.permissions.pendingCount).toBe(0);
    expect(run.lateDecisions).toEqual([false]);
  });

  it('cancels descendant cards on provider exit and refuses a late Allow', async () => {
    const run = await runDelegation('subagent-provider-exit', { decision: 'hold' });
    expect(run.failure).toMatchObject({ code: 'process-failed' });
    expect(run.cards).toHaveLength(1);
    expect(run.resolutions).toEqual([expect.objectContaining({ decision: 'cancelled' })]);
    expect(run.permissions.pendingCount).toBe(0);
    expect(run.lateDecisions).toEqual([false]);
  });

  it('interrupts the verified live descendant and root when the run is cancelled', async () => {
    const run = await runDelegation('subagent-cancel', { decision: 'hold', abort: true });
    expect(run.failure).toMatchObject({ code: 'cancelled' });
    expect(run.cards).toHaveLength(1);
    expect(run.callbackResponses).toEqual([{ id: 'child-command', result: { decision: 'cancel' } }]);
    expect(run.protocol.requests.filter((message) => message.method === 'turn/interrupt').map((message) => message.params))
      .toEqual(expect.arrayContaining([{ threadId: 'reviewer', turnId: 'reviewer-turn' }, { threadId: 'codex-thread-new', turnId: 'codex-turn-1' }]));
    expect(run.permissions.pendingCount).toBe(0);
    expect(run.lateDecisions).toEqual([false]);
  });

  it.each([
    { level: 'guarded', execution: 'local', mode: 'agent' },
    { level: 'native', execution: 'local', mode: 'ask' },
    { level: 'native', execution: 'local', mode: 'plan' },
    { level: 'native', execution: 'docker', mode: 'agent' },
  ] as const)('retains subagent isolation in $execution/$level/$mode', async (policy) => {
    const run = await runDelegation('subagent-direct', policy);
    expect(run.failure).toMatchObject({ code: 'unsupported-flags' });
    expect(run.cards).toEqual([]);
    expect(run.callbackResponses.every((message) => message.result?.decision !== 'accept')).toBe(true);
  });
});
