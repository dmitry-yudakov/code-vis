import { describe, expect, it, vi } from 'vitest';
import { GIT_READ_ALLOWLIST, resolveAgentPolicy } from '@/server/agents/agentPolicy';
import {
  AGENT_MODES, buildClaudeArgs, REQUIRED_CLAUDE_FLAGS, requiredFlagsForMode, UNPROBED_CLAUDE_FLAGS,
} from '@/server/agents/claudeInvocation';
import { getConfig } from '@/server/config';
import { PermissionBroker } from '@/server/runs/permissionBroker';
import { RunRegistry } from '@/server/runs/runRegistry';
import { agentMessageRequestSchema, permissionDecisionRequestSchema } from '@/shared/protocol';
import { hasProposedPlan, PLAN_END_MARKER, PLAN_START_MARKER, stripPlanMarkers } from '@/shared/plan';
import { buildConversationPrompt } from '@/server/conversation/prompt';
import type { AgentEvent, AgentMode } from '@/shared/types';

const config = getConfig();

function args(mode: AgentMode): string[] {
  return buildClaudeArgs({
    session: { id: '11111111-2222-3333-4444-555555555555', action: 'start' },
    attachmentDirectory: '/tmp/codeai-run',
    policy: resolveAgentPolicy(config, mode),
  });
}

function valueAfter(list: string[], flag: string): string | undefined {
  const index = list.indexOf(flag);
  return index >= 0 ? list[index + 1] : undefined;
}

describe('agent modes', () => {
  it('defaults to ask and keeps ask read-only apart from the git allowlist', () => {
    expect(resolveAgentPolicy(config).mode).toBe('ask');
    const ask = resolveAgentPolicy(config, 'ask');
    expect(ask.profile).toBe('ask-readonly');
    expect(ask.tools).toEqual(['Read', 'Glob', 'Grep', 'Bash']);
    expect(ask.permissionMode).toBe('plan');
    expect(ask.interactivePermissions).toBe(false);
    expect(ask.allowedTools).toEqual(GIT_READ_ALLOWLIST);
  });

  it('gives plan the same capability as ask and differs only by contract', () => {
    const ask = resolveAgentPolicy(config, 'ask');
    const plan = resolveAgentPolicy(config, 'plan');
    expect(plan.profile).toBe('plan-readonly');
    expect({ ...plan, profile: ask.profile, mode: ask.mode }).toEqual({ ...ask });
  });

  it('gives agent the default toolset behind interactive permissions', () => {
    const agent = resolveAgentPolicy(config, 'agent');
    expect(agent.profile).toBe('agent-full');
    expect(agent.tools).toBeUndefined();
    expect(agent.permissionMode).toBe('default');
    expect(agent.interactivePermissions).toBe(true);
    expect(agent.safeMode).toBe(true);
    expect(agent.approvalTimeoutMs).toBe(config.approvalTimeoutMs);
  });

  it('budgets agent runs for building, not for answering', () => {
    // Research alone can exhaust the conversation allowance before the first edit is proposed.
    const ask = resolveAgentPolicy(config, 'ask');
    const agent = resolveAgentPolicy(config, 'agent');
    expect(ask.maxTurns).toBe(config.agentMaxTurns);
    expect(ask.timeoutMs).toBe(config.agentTimeoutMs);
    expect(agent.maxTurns).toBe(config.buildMaxTurns);
    expect(agent.timeoutMs).toBe(config.buildTimeoutMs);
    expect(agent.maxTurns).toBeGreaterThan(ask.maxTurns);
    expect(agent.timeoutMs).toBeGreaterThan(ask.timeoutMs);
  });

  it('never allows a write-capable or network-capable git command', () => {
    for (const rule of GIT_READ_ALLOWLIST) {
      expect(rule).toMatch(/^Bash\((git|gh pr) [a-z]+:\*\)$/);
    }
    const joined = GIT_READ_ALLOWLIST.join(' ');
    for (const forbidden of ['git push', 'git fetch', 'git pull', 'git commit', 'gh api', 'git checkout']) {
      expect(joined).not.toContain(forbidden);
    }
  });

  it('builds mode-specific CLI arguments', () => {
    const ask = args('ask');
    expect(valueAfter(ask, '--tools')).toBe('Read,Glob,Grep,Bash');
    expect(valueAfter(ask, '--permission-mode')).toBe('plan');
    expect(valueAfter(ask, '--allowedTools')).toBe(GIT_READ_ALLOWLIST.join(','));
    expect(ask).not.toContain('--input-format');

    const agent = args('agent');
    expect(agent).not.toContain('--tools');
    expect(valueAfter(agent, '--permission-mode')).toBe('default');
    expect(valueAfter(agent, '--input-format')).toBe('stream-json');
    expect(valueAfter(agent, '--permission-prompt-tool')).toBe('stdio');
    expect(agent).toContain('--safe-mode');

    for (const mode of AGENT_MODES) {
      expect(args(mode)).toContain('--strict-mcp-config');
      expect(args(mode)).toContain('--disable-slash-commands');
      expect(args(mode)).not.toContain('--dangerously-skip-permissions');
    }
  });

  it('requires the union of every shipped mode’s flags at preflight', () => {
    for (const mode of AGENT_MODES) {
      for (const flag of requiredFlagsForMode(mode)) expect(REQUIRED_CLAUDE_FLAGS).toContain(flag);
    }
    expect(REQUIRED_CLAUDE_FLAGS).toContain('--input-format');
  });

  it('probes every flag it passes except the ones the CLI hides from help', () => {
    // Probing an undocumented flag reports a healthy install as outdated and disables every mode,
    // so each flag we actually pass must be deliberately classified one way or the other.
    for (const mode of AGENT_MODES) {
      const passed = args(mode).filter((value) => value.startsWith('--'));
      for (const flag of passed) {
        const probed = requiredFlagsForMode(mode).includes(flag);
        const exempt = (UNPROBED_CLAUDE_FLAGS as readonly string[]).includes(flag);
        expect(probed || exempt, `${flag} (${mode}) is neither probed nor exempt`).toBe(true);
      }
    }
    for (const flag of UNPROBED_CLAUDE_FLAGS) expect(REQUIRED_CLAUDE_FLAGS).not.toContain(flag);
  });

  it('accepts only the three mode names over the wire', () => {
    const base = {
      sessionId: crypto.randomUUID(),
      messageId: crypto.randomUUID(),
      participantId: 'agent-1',
      text: 'hello',
      diagramAttachments: [],
    };
    expect(agentMessageRequestSchema.safeParse(base).success).toBe(true);
    for (const mode of AGENT_MODES) {
      expect(agentMessageRequestSchema.safeParse({ ...base, mode }).success).toBe(true);
    }
    for (const mode of ['bypass', 'AGENT', '', null, { tools: ['Bash'] }]) {
      expect(agentMessageRequestSchema.safeParse({ ...base, mode }).success).toBe(false);
    }
    // The browser can name a mode and nothing else about the policy.
    expect(agentMessageRequestSchema.safeParse({ ...base, tools: ['Bash'] }).success).toBe(false);
    expect(agentMessageRequestSchema.safeParse({ ...base, allowedTools: ['Bash(rm:*)'] }).success).toBe(false);
    expect(agentMessageRequestSchema.safeParse({ ...base, permissionMode: 'bypassPermissions' }).success).toBe(false);
    expect(agentMessageRequestSchema.safeParse({ ...base, projectId: 'p' }).success).toBe(false);
    expect(agentMessageRequestSchema.safeParse({ ...base, transcript: [] }).success).toBe(false);
  });

  it('states the mode contract and git allowlist in the prompt', () => {
    for (const mode of AGENT_MODES) {
      const prompt = buildConversationPrompt({ userText: 'hi', attachmentDirectory: '/tmp/run', attachedCanvasNames: [], mode });
      expect(prompt).toContain(`Mode: ${mode.toUpperCase()}`);
      expect(prompt).toContain('gh pr view/diff/list');
    }
    expect(buildConversationPrompt({ userText: 'hi', attachmentDirectory: '/tmp/run', attachedCanvasNames: [] })).toContain('Mode: ASK');
    expect(buildConversationPrompt({ userText: 'hi', attachmentDirectory: '/tmp/run', attachedCanvasNames: [], mode: 'plan' })).toContain(PLAN_START_MARKER);
  });

  it('detects and strips plan delimiters', () => {
    const answer = `Notes.\n${PLAN_START_MARKER}\n## Implementation plan\n1. Do it.\n${PLAN_END_MARKER}`;
    expect(hasProposedPlan(answer)).toBe(true);
    expect(hasProposedPlan('Notes without a plan.')).toBe(false);
    expect(hasProposedPlan(`${PLAN_END_MARKER}\n${PLAN_START_MARKER}`)).toBe(false);
    const stripped = stripPlanMarkers(answer);
    expect(stripped).not.toContain(PLAN_START_MARKER);
    expect(stripped).toContain('## Implementation plan');
  });
});

describe('permission broker', () => {
  it('settles each request exactly once and reports unknown ids', () => {
    const broker = new PermissionBroker(5_000);
    const seen: string[] = [];
    broker.request('a', (resolution) => seen.push(resolution));
    expect(broker.pendingCount).toBe(1);
    expect(broker.decide('a', 'allow')).toBe(true);
    expect(broker.decide('a', 'deny')).toBe(false);
    expect(broker.decide('missing', 'allow')).toBe(false);
    expect(seen).toEqual(['allow']);
    expect(broker.pendingCount).toBe(0);
  });

  it('auto-denies on expiry and cancels everything still pending', async () => {
    const expiring = new PermissionBroker(20);
    const timedOut = new Promise<string>((resolve) => expiring.request('a', resolve));
    expect(await timedOut).toBe('timeout');

    const broker = new PermissionBroker(5_000);
    const seen: string[] = [];
    broker.request('a', (resolution) => seen.push(resolution));
    broker.request('b', (resolution) => seen.push(resolution));
    broker.cancelAll();
    expect(seen).toEqual(['cancelled', 'cancelled']);
    // Requests arriving after cancellation are denied rather than left hanging.
    broker.request('c', (resolution) => seen.push(resolution));
    expect(seen).toEqual(['cancelled', 'cancelled', 'cancelled']);
  });

  it('routes decisions only to the run that owns them', () => {
    const registry = new RunRegistry();
    const runId = crypto.randomUUID();
    const broker = new PermissionBroker(5_000);
    expect(registry.decide(runId, 'req', 'allow')).toBe('unknown-run');
    registry.start({ runId, sessionId: 'session', participantId: 'agent-1', cancel: () => undefined });
    registry.attachPermissions(runId, broker);
    broker.request('req', () => undefined);
    expect(registry.decide(crypto.randomUUID(), 'req', 'allow')).toBe('unknown-run');
    expect(registry.decide(runId, 'other', 'allow')).toBe('unknown-request');
    expect(registry.decide(runId, 'req', 'allow')).toBe('accepted');
    registry.finish(runId);
    expect(registry.decide(runId, 'req', 'allow')).toBe('unknown-run');
  });

  it('runs one turn at a time and frees the slot when it finishes', () => {
    const registry = new RunRegistry();
    const first = crypto.randomUUID();
    const second = crypto.randomUUID();
    expect(registry.start({ runId: first, sessionId: 't1', participantId: 'agent-1', cancel: () => undefined })).toBe(true);
    expect(registry.currentRuns).toEqual([expect.objectContaining({
      runId: first, sessionId: 't1', participantId: 'agent-1', startedAt: expect.any(Number),
    })]);
    expect(registry.start({ runId: second, sessionId: 't2', participantId: 'agent-2', cancel: () => undefined })).toBe(false);
    registry.finish(first);
    expect(registry.start({ runId: second, sessionId: 't2', participantId: 'agent-2', cancel: () => undefined })).toBe(true);
    registry.finish(second);
  });

  it('keeps a run alive when its browser detaches, and replays what the next one missed', () => {
    // A reload must not kill work the user already approved, so cancellation is explicit only.
    const registry = new RunRegistry();
    const runId = crypto.randomUUID();
    let cancelled = false;
    registry.start({ runId, sessionId: 'session', participantId: 'agent-1', cancel: () => { cancelled = true; } });

    const firstStream: AgentEvent[] = [];
    registry.subscribe(runId, (event) => firstStream.push(event));
    registry.record(runId, { type: 'status', runId, phase: 'thinking', label: 'Thinking…' });
    registry.record(runId, { type: 'assistant-delta', runId, delta: 'partial ' });
    registry.unsubscribe(runId);

    // Work continues with nobody listening.
    registry.record(runId, { type: 'permission-request', runId, requestId: 'r1', participantId: 'agent-1', tool: 'Edit', detail: 'a.ts' });
    registry.record(runId, { type: 'assistant-delta', runId, delta: 'answer' });
    expect(cancelled).toBe(false);

    const reattached = registry.subscribe(runId, () => undefined);
    expect(reattached?.runId).toBe(runId);
    expect(reattached?.finished).toBe(false);
    expect(reattached?.replay).toEqual([
      { type: 'status', runId, phase: 'thinking', label: 'Thinking…' },
      { type: 'permission-request', runId, requestId: 'r1', participantId: 'agent-1', tool: 'Edit', detail: 'a.ts' },
      // Deltas are coalesced so a reattaching page rebuilds the whole preview in one event.
      { type: 'assistant-delta', runId, delta: 'partial answer' },
    ]);
    expect(registry.cancel(runId)).toBe(true);
    expect(cancelled).toBe(true);
  });

  it('retains finished runs independently by run id and expires them only by time', () => {
    const now = 2_000_000_000_000;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const registry = new RunRegistry();
    const first = crypto.randomUUID();
    const second = crypto.randomUUID();
    registry.start({ runId: first, sessionId: 'session', participantId: 'agent-1', cancel: () => undefined });
    registry.record(first, { type: 'done', runId: first, durationMs: 10, cancelled: false });
    registry.finish(first);
    registry.start({ runId: second, sessionId: 'session', participantId: 'agent-2', cancel: () => undefined });
    registry.record(second, { type: 'done', runId: second, durationMs: 11, cancelled: false });
    registry.finish(second);

    expect(registry.list('session').recent).toEqual([
      expect.objectContaining({ runId: first, participantId: 'agent-1', finishedAt: now }),
      expect.objectContaining({ runId: second, participantId: 'agent-2', finishedAt: now }),
    ]);
    expect(registry.subscribe(first, () => undefined)).toMatchObject({ runId: first, finished: true });
    expect(registry.subscribe(second, () => undefined)?.replay).toHaveLength(1);
    expect(registry.cancel(first)).toBe(false);

    clock.mockReturnValue(now + 300_001);
    expect(registry.list().recent).toEqual([]);
    expect(registry.subscribe(first, () => undefined)).toBeUndefined();
    clock.mockRestore();
  });

  it('shares one registry across separately loaded route bundles', async () => {
    // Next.js bundles each route handler separately; a per-module singleton would give the message
    // route and the permission route different registries, and every approval would 404.
    const first = (await import('@/server/runs/runRegistry')).runRegistry;
    vi.resetModules();
    const second = (await import('@/server/runs/runRegistry')).runRegistry;
    expect(second).toBe(first);
  });

  it('validates decision payloads', () => {
    const valid = { runId: crypto.randomUUID(), requestId: crypto.randomUUID(), decision: 'allow' };
    expect(permissionDecisionRequestSchema.safeParse(valid).success).toBe(true);
    expect(permissionDecisionRequestSchema.safeParse({ ...valid, decision: 'always' }).success).toBe(false);
    expect(permissionDecisionRequestSchema.safeParse({ ...valid, runId: 'not-a-uuid' }).success).toBe(false);
    expect(permissionDecisionRequestSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false);
  });
});
