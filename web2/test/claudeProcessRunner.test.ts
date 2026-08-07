import { chmod, mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ClaudeProcessRunner } from '@/lib/server/claudeProcessRunner';
import { checkClaude } from '@/lib/server/claudePreflight';
import { PermissionBroker } from '@/lib/server/permissionBroker';
import { resolveAgentPolicy } from '@/lib/server/agentPolicy';
import { getConfig } from '@/lib/server/config';
import type { AgentMode, AgentProcessEvent } from '@/lib/shared/types';

const binary = path.resolve('test/fixtures/fake-claude.mjs');

interface RunOptions {
  action?: 'start' | 'resume';
  timeoutMs?: number;
  signal?: AbortSignal;
  debug?: boolean;
  mode?: AgentMode;
  sessionId?: string;
  prompt?: string;
  permissions?: PermissionBroker;
  onEvent?(event: AgentProcessEvent): void;
}

describe.sequential('ClaudeProcessRunner', () => {
  beforeAll(async () => chmod(binary, 0o755));
  afterEach(() => {
    delete process.env.CODEAI_FAKE_MODE;
    delete process.env.CODEAI_FAKE_HELP;
    delete process.env.CODEAI_FAKE_ENV_MARKER;
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
  });

  async function run(options: RunOptions = {}) {
    const { action = 'start', timeoutMs = 2_000, signal = new AbortController().signal, debug = false, mode = 'ask' } = options;
    const directory = await mkdtemp(path.join(os.tmpdir(), 'web2-fake-'));
    const id = options.sessionId || crypto.randomUUID();
    const runner = new ClaudeProcessRunner({ binary, maxOutputBytes: 100_000, killGraceMs: 50, debug });
    const events: AgentProcessEvent[] = [];
    const result = await runner.run({
      runId: crypto.randomUUID(),
      project: { id: 'p', name: 'fixture', relativePath: '.', realPath: process.cwd() },
      session: { id, action },
      prompt: options.prompt ?? (action === 'start' ? 'unique first question' : 'short follow-up only'),
      attachmentDirectory: directory,
      policy: { ...resolveAgentPolicy(getConfig(), mode), timeoutMs },
      permissions: options.permissions,
      signal,
      emit(event) { events.push(event); options.onEvent?.(event); },
    });
    return { result, events, sessionId: id, invocation: JSON.parse(await readFile(path.join(directory, 'fake-invocation.json'), 'utf8')) };
  }

  it('uses a session id first and resume later without transcript replay', async () => {
    const first = await run({ action: 'start' });
    expect(first.invocation.args).toContain('--session-id');
    const second = await run({ action: 'resume' });
    expect(second.invocation.args).toContain('--resume');
    expect(second.invocation.prompt).toBe('short follow-up only');
    expect(second.result.finalText).toContain('prior turn');
    expect(second.invocation.args).toContain('Read,Glob,Grep,Bash');
    expect(second.invocation.args).not.toContain('--dangerously-skip-permissions');
  });

  it('passes the fixed git allowlist and no interactive flags in read-only modes', async () => {
    for (const mode of ['ask', 'plan'] as const) {
      const { invocation } = await run({ mode });
      const allowed = invocation.args[invocation.args.indexOf('--allowedTools') + 1] as string;
      expect(allowed.split(',')).toContain('Bash(git log:*)');
      expect(allowed).not.toContain('git push');
      expect(invocation.args).toContain('plan');
      expect(invocation.args).not.toContain('--input-format');
      expect(invocation.args).not.toContain('--permission-prompt-tool');
    }
  });

  it('passes the parent environment through untouched so the user’s own auth applies', async () => {
    // Whatever the user's terminal Claude Code uses — subscription login, a custom endpoint, a key —
    // must reach the child unchanged, and web2 must add nothing of its own.
    process.env.CODEAI_FAKE_ENV_MARKER = 'inherited';
    process.env.ANTHROPIC_BASE_URL = 'https://example.invalid/anthropic';
    process.env.ANTHROPIC_AUTH_TOKEN = 'user-supplied-token';
    const { invocation } = await run();
    expect(invocation.inheritedEnv).toEqual({
      marker: 'inherited',
      baseUrl: 'https://example.invalid/anthropic',
      authToken: 'user-supplied-token',
    });
    expect(invocation.args.join(' ')).not.toContain('ANTHROPIC');
  });

  it('surfaces an auto-denied command as visible activity and still completes the turn', async () => {
    process.env.CODEAI_FAKE_MODE = 'denied';
    const { events, result } = await run({ mode: 'ask' });
    expect(events).toContainEqual({ type: 'activity', tool: 'Bash', detail: 'rm -rf build', denied: true });
    expect(result.finalText).toContain('outside the allowed read-only set');
  });

  it('emits sanitized per-tool activity without absolute paths', async () => {
    const { events } = await run({ action: 'start' });
    const activity = events.filter((event) => event.type === 'activity');
    expect(activity).toEqual([
      { type: 'activity', tool: 'Read', detail: 'README.md' },
      { type: 'activity', tool: 'Grep', detail: 'architecture in src' },
      { type: 'activity', tool: 'Read', detail: 'attached context: git-status.txt' },
      { type: 'activity', tool: 'Read' },
    ]);
    expect(JSON.stringify(activity)).not.toContain(process.cwd());
    expect(events.filter((event) => event.type === 'phase').map((event) => event.phase)).toEqual(['thinking', 'responding']);
  });

  it('prints compact debug lines only when enabled', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await run({ action: 'start' });
      expect(spy).not.toHaveBeenCalled();
      await run({ action: 'start', debug: true });
      const lines = spy.mock.calls.map((call) => String(call[0]));
      expect(lines[0]).toMatch(/^\[agent [0-9a-f]{8}\] \+\d+\.\ds spawn fake-claude\.mjs .*--session-id/);
      expect(lines.some((line) => line.includes('recv system/init'))).toBe(true);
      expect(lines.some((line) => line.includes('recv tool_use Read (README.md)'))).toBe(true);
      expect(lines.some((line) => line.includes('recv first text delta'))).toBe(true);
      expect(lines.some((line) => line.includes('recv result/success'))).toBe(true);
      expect(lines.some((line) => /exit code=0 \(stdout \d+B, 1 text deltas \d+B\)/.test(line))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('classifies malformed, non-zero, missing-session, timeout, and cancellation', async () => {
    process.env.CODEAI_FAKE_MODE = 'malformed';
    await expect(run()).rejects.toMatchObject({ code: 'malformed-stream' });
    process.env.CODEAI_FAKE_MODE = 'nonzero';
    await expect(run()).rejects.toMatchObject({ code: 'process-failed' });
    process.env.CODEAI_FAKE_MODE = 'missing-session';
    await expect(run({ action: 'resume' })).rejects.toMatchObject({ code: 'missing-session' });
    process.env.CODEAI_FAKE_MODE = 'timeout';
    await expect(run({ action: 'start', timeoutMs: 40 })).rejects.toMatchObject({ code: 'timeout' });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);
    await expect(run({ action: 'start', signal: controller.signal })).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('explains an exhausted turn budget instead of reporting a generic failure', async () => {
    process.env.CODEAI_FAKE_MODE = 'max-turns';
    // Naming the setting and the fact that the session survives is the whole point of the message.
    await expect(run({ mode: 'ask' })).rejects.toMatchObject({
      code: 'max-turns',
      message: expect.stringContaining('CODEAI_WEB2_AGENT_MAX_TURNS'),
      delivery: 'possibly-sent',
    });
    await expect(run({ mode: 'agent' })).rejects.toMatchObject({
      code: 'max-turns',
      message: expect.stringContaining('CODEAI_WEB2_BUILD_MAX_TURNS'),
    });
    const failure = await run({ mode: 'agent' }).catch((error: Error) => error);
    expect(failure).toMatchObject({ message: expect.stringContaining('send "continue"') });
  });

  it('reports per-mode flag support with an actionable message', async () => {
    await expect(checkClaude(binary)).resolves.toEqual({ binaryReady: true, flagsReady: true, unsupportedModes: [] });

    process.env.CODEAI_FAKE_HELP = 'no-input-format';
    const partial = await checkClaude(binary);
    expect(partial).toMatchObject({ binaryReady: true, flagsReady: false, unsupportedModes: ['agent'] });
    expect(partial.message).toContain('agent needs --input-format');
    expect(partial.message).toContain('claude update');

    process.env.CODEAI_FAKE_HELP = 'legacy';
    const outdated = await checkClaude(binary);
    expect(outdated.unsupportedModes).toEqual(['ask', 'plan', 'agent']);
    expect(outdated.message).toContain('--allowedTools');

    const missing = await checkClaude(path.resolve('test/fixtures/not-a-real-binary'));
    expect(missing).toMatchObject({ binaryReady: false, flagsReady: false });
  });

  describe.sequential('agent mode', () => {
    /** Answers each permission request as it arrives, after an optional delay. */
    function autoDecide(broker: PermissionBroker, decision: 'allow' | 'deny', delayMs = 0) {
      return (event: AgentProcessEvent) => {
        if (event.type !== 'permission-request' || !event.requestId) return;
        const requestId = event.requestId;
        setTimeout(() => broker.decide(requestId, decision), delayMs);
      };
    }

    it('spawns with the default toolset, default permissions, and streaming input', async () => {
      const permissions = new PermissionBroker(5_000);
      const { invocation } = await run({ mode: 'agent', permissions, onEvent: autoDecide(permissions, 'allow') });
      expect(invocation.args).not.toContain('--tools');
      expect(invocation.args[invocation.args.indexOf('--permission-mode') + 1]).toBe('default');
      expect(invocation.args).toContain('--input-format');
      expect(invocation.args[invocation.args.indexOf('--input-format') + 1]).toBe('stream-json');
      expect(invocation.args[invocation.args.indexOf('--permission-prompt-tool') + 1]).toBe('stdio');
      expect(invocation.args).toContain('--safe-mode');
      // The prompt travels as a stream-json user message and arrives intact.
      expect(invocation.prompt).toBe('unique first question');
    });

    it('lets an allowed edit proceed and a denied edit continue the turn', async () => {
      const allowBroker = new PermissionBroker(5_000);
      const allowed = await run({ mode: 'agent', permissions: allowBroker, onEvent: autoDecide(allowBroker, 'allow') });
      expect(allowed.events.filter((event) => event.type === 'permission-request')).toEqual([
        { type: 'permission-request', requestId: expect.any(String), tool: 'Edit', detail: 'README.md' },
      ]);
      expect(allowed.events.filter((event) => event.type === 'permission-resolved').map((event) => event.decision)).toEqual(['allow']);
      expect(allowed.invocation.decision.behavior).toBe('allow');
      expect(allowed.result.finalText).toContain('Edit approved');

      const denyBroker = new PermissionBroker(5_000);
      const denied = await run({ mode: 'agent', permissions: denyBroker, onEvent: autoDecide(denyBroker, 'deny') });
      expect(denied.events.filter((event) => event.type === 'permission-resolved').map((event) => event.decision)).toEqual(['deny']);
      expect(denied.invocation.decision.behavior).toBe('deny');
      expect(denied.invocation.decision.message).toContain('denied this action');
      expect(denied.result.finalText).toContain('Edit denied');
    });

    it('auto-denies an unanswered request once the approval timeout expires', async () => {
      const permissions = new PermissionBroker(80);
      const { events, invocation, result } = await run({ mode: 'agent', permissions });
      expect(events.filter((event) => event.type === 'permission-resolved').map((event) => event.decision)).toEqual(['timeout']);
      expect(invocation.decision.behavior).toBe('deny');
      expect(invocation.decision.message).toContain('expired');
      expect(result.finalText).toContain('Edit denied');
    });

    it('pauses the run-timeout clock while a request is pending', async () => {
      const permissions = new PermissionBroker(5_000);
      // The decision alone outlasts the run budget; only a paused clock lets the turn finish.
      const { result } = await run({
        mode: 'agent',
        timeoutMs: 900,
        permissions,
        onEvent: autoDecide(permissions, 'allow', 1_400),
      });
      expect(result.finalText).toContain('Edit approved');
    });

    it('resolves pending requests as cancelled before terminating the child', async () => {
      const permissions = new PermissionBroker(5_000);
      const controller = new AbortController();
      const events: AgentProcessEvent[] = [];
      await expect(run({
        mode: 'agent',
        permissions,
        signal: controller.signal,
        onEvent: (event) => {
          events.push(event);
          if (event.type === 'permission-request') controller.abort();
        },
      })).rejects.toMatchObject({ code: 'cancelled' });
      expect(events.filter((event) => event.type === 'permission-resolved').map((event) => event.decision)).toEqual(['cancelled']);
      expect(permissions.pendingCount).toBe(0);
    });

    it('resumes the same session when a plan hands off to agent mode', async () => {
      const sessionId = crypto.randomUUID();
      const planned = await run({ mode: 'plan', sessionId, prompt: 'Mode: PLAN\n\n[User message]\nplan a refactor' });
      expect(planned.invocation.args).toContain('--session-id');
      expect(planned.invocation.args).toContain(sessionId);
      expect(planned.result.finalText).toContain('cartograph:plan:start');

      const permissions = new PermissionBroker(5_000);
      const executed = await run({
        mode: 'agent',
        action: 'resume',
        sessionId,
        permissions,
        onEvent: autoDecide(permissions, 'allow'),
      });
      expect(executed.invocation.args).toContain('--resume');
      expect(executed.invocation.args[executed.invocation.args.indexOf('--resume') + 1]).toBe(sessionId);
      expect(executed.invocation.args[executed.invocation.args.indexOf('--permission-mode') + 1]).toBe('default');
      expect(executed.invocation.args).not.toContain('--tools');
    });
  });
});
