import { chmod, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ClaudeProcessRunner } from '@/server/agents/claudeProcessRunner';
import { CodexProcessRunner } from '@/server/agents/codexProcessRunner';
import { checkCodex } from '@/server/agents/codexPreflight';
import { getProviderAdapters } from '@/server/agents/providerRegistry';
import { resolveAgentPolicy } from '@/server/agents/agentPolicy';
import { getConfig } from '@/server/config';
import type { AgentMode, AgentProcessEvent } from '@/shared/types';

const claude = path.resolve('test/fixtures/fake-claude.mjs');
const codex = path.resolve('test/fixtures/fake-codex.mjs');
const dirs: string[] = [];
beforeAll(async () => { await Promise.all([chmod(claude, 0o755), chmod(codex, 0o755)]); });
afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
async function run(provider: 'claude' | 'codex', mode: AgentMode, native = true) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'codeai-native-run-')); dirs.push(directory);
  const recordPath = path.join(directory, 'codex.json'); vi.stubEnv('CODEAI_FAKE_CODEX_RECORD', recordPath);
  const events: AgentProcessEvent[] = [];
  const runner = provider === 'claude' ? new ClaudeProcessRunner({ binary: claude, maxOutputBytes: 100_000 })
    : new CodexProcessRunner({ binary: codex, maxOutputBytes: 100_000 });
  const result = await runner.run({
    runId: crypto.randomUUID(), checkout: { id: 'checkout', name: 'fixture', relativePath: '.', realPath: process.cwd() },
    session: { id: provider === 'claude' ? crypto.randomUUID() : undefined, action: 'start' },
    prompt: 'Hello', attachmentDirectory: directory,
    policy: { ...resolveAgentPolicy({ ...getConfig(), securityLevel: native ? 'native' : 'guarded' }, mode), timeoutMs: 3_000 },
    globalInstructions: { displayPath: '~/.claude/CLAUDE.md', text: 'GLOBAL_MARKER' }, signal: new AbortController().signal, emit(event) { events.push(event); },
  });
  const invocation = JSON.parse(await readFile(provider === 'claude' ? path.join(directory, 'fake-invocation.json') : recordPath, 'utf8'));
  return { events, result, invocation };
}

describe.sequential('Native provider streams and readiness', () => {
  it.each(['agent', 'edits', 'auto', 'full'] as const)('runs Native Claude %s without appending global instructions', async (mode) => {
    const { invocation, result } = await run('claude', mode);
    expect(invocation.args).not.toContain('--append-system-prompt');
    expect(invocation.args).not.toContain('--safe-mode');
    expect(result.finalText).toBeTruthy();
  });
  it('answers unknown Claude control requests immediately and shows the limitation', async () => {
    vi.stubEnv('CODEAI_FAKE_MODE', 'unknown-control');
    const { events, invocation } = await run('claude', 'full');
    expect(invocation.controlResponse.response).toMatchObject({ subtype: 'error', request_id: 'unknown-1' });
    expect(events).toContainEqual(expect.objectContaining({ type: 'activity', detail: expect.stringContaining('cannot answer initialize_probe') }));
  });
  it('keeps unknown Claude control requests unchanged in Guarded and Native read-only turns', async () => {
    vi.stubEnv('CODEAI_FAKE_MODE', 'unknown-control-ignored');
    for (const [mode, native] of [['agent', false], ['ask', true]] as const) {
      const { events, invocation, result } = await run('claude', mode, native);
      expect(result.finalText).toBe('Unknown request ignored.');
      expect(invocation.controlResponse).toBeUndefined();
      expect(events.filter((event) => event.type === 'activity' && event.tool === 'Control request')).toEqual([]);
    }
  });
  it.each(['agent', 'auto', 'full'] as const)('runs Native Codex %s without inventories or overrides', async (mode) => {
    const { invocation } = await run('codex', mode);
    const names = invocation.requests.map((request: { method: string }) => request.method);
    for (const inventory of ['mcpServerStatus/list', 'skills/list', 'hooks/list']) expect(names).not.toContain(inventory);
    const thread = invocation.requests.find((request: { method: string }) => request.method === 'thread/start').params;
    expect(thread).not.toHaveProperty('approvalsReviewer');
    expect(thread.config).toEqual({ features: { request_permissions_tool: false, exec_permission_approvals: false } });
    expect(thread.developerInstructions).toBe('Treat the attachment directory as read-only.');
    const turn = invocation.requests.find((request: { method: string }) => request.method === 'turn/start').params;
    if (mode !== 'agent') expect(turn).not.toHaveProperty('sandboxPolicy');
  });
  it('shows Native Codex integrations, reviewer decisions and unsupported requests as activity', async () => {
    vi.stubEnv('CODEAI_FAKE_CODEX_MODE', 'native-events');
    const { events, invocation } = await run('codex', 'auto');
    for (const tool of ['MCP', 'Dynamic tool', 'Subagent', 'Web search', 'Hook', 'Auto review']) {
      expect(events).toContainEqual(expect.objectContaining({ type: 'activity', tool }));
    }
    expect(events).toContainEqual(expect.objectContaining({ type: 'activity', detail: expect.stringContaining('cannot answer mcpServer/elicitation/request') }));
    expect(invocation.responses).toContainEqual(expect.objectContaining({ id: 'elicitation-1', error: { code: -32601, message: expect.any(String) } }));
    await expect(run('codex', 'ask')).rejects.toMatchObject({ code: 'unsupported-flags' });
  });
  it('keeps Native writing available when Guarded isolation fails, withholding only Ask and Plan', async () => {
    vi.stubEnv('CODEAI_FAKE_CODEX_MODE', 'ambient-mcp-unisolated');
    const health = await checkCodex(codex, process.cwd(), true, 'native');
    expect(health).toMatchObject({ available: true, authenticated: true, supportedModes: ['agent', 'auto', 'full'] });
    expect(health.message).toContain('Ask and Plan');
    await expect(run('codex', 'auto')).resolves.toMatchObject({ result: { finalText: 'Codex answer.' } });
  });
  it('gates Codex Agent/Auto, Full access independently, and Auto on sandbox startup', async () => {
    expect((await checkCodex(codex, process.cwd(), false, 'native')).supportedModes).toEqual(['ask', 'plan', 'full']);
    vi.stubEnv('CODEAI_FAKE_CODEX_MODE', 'sandbox-unavailable');
    expect((await checkCodex(codex, process.cwd(), true, 'native')).supportedModes).toEqual(['ask', 'plan', 'agent', 'full']);
  });
  it('retains Guarded notes at Native and reports signed-out only once', async () => {
    vi.stubEnv('CODEAI_FAKE_CODEX_MODE', 'ambient-skill');
    const health = await checkCodex(codex, process.cwd(), true, 'native');
    expect(health.message).toContain('Ask and Plan:');
    expect(health.message).toContain('1 user or repository skill enabled');
    vi.stubEnv('CODEAI_FAKE_CODEX_MODE', 'unauthenticated');
    expect((await checkCodex(codex, process.cwd(), false, 'native')).message?.match(/not authenticated/g)).toHaveLength(1);
  });
  it('waits for a slow Native model list and retains the Guarded list if Native cannot list models', async () => {
    vi.stubEnv('CODEAI_FAKE_CODEX_MODE', 'slow-model-list');
    expect((await checkCodex(codex, process.cwd(), false, 'native')).models?.map((model) => model.id)).toEqual(['fake-large', 'fake-small']);
    vi.stubEnv('CODEAI_FAKE_CODEX_MODE', 'native-no-model-list');
    expect((await checkCodex(codex, process.cwd(), false, 'native')).models?.map((model) => model.id)).toEqual(['fake-large', 'fake-small']);
  });
  it.each(['ask', 'full'] as const)('starts only the handshake %s needs for a Native turn', async (mode) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'codeai-native-health-')); dirs.push(directory);
    const starts = path.join(directory, 'starts.jsonl'); vi.stubEnv('CODEAI_FAKE_CODEX_STARTS', starts);
    const health = await checkCodex(codex, process.cwd(), true, 'native', mode);
    expect(health.supportedModes).toEqual([mode]);
    expect(health.message || '').not.toContain('sandbox cannot start');
    const args = (await readFile(starts, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    expect(args).toHaveLength(1);
    expect(args[0].includes('mcp_servers={}')).toBe(mode === 'ask');
  });
  it('keeps recently verified Native choices during a selected turn with a missing model response', async () => {
    const listed = await checkCodex(codex, process.cwd(), false, 'native');
    vi.stubEnv('CODEAI_FAKE_CODEX_MODE', 'native-no-model-list');
    const turn = await checkCodex(codex, process.cwd(), false, 'native', 'full');
    expect(turn.models).toEqual(listed.models);
    expect(turn.efforts).toEqual(listed.efforts);
  });
  it('advertises Claude extras only when listed and keeps Docker modes fixed at Native', async () => {
    const config = { ...getConfig(), claudeBin: claude, codexBin: codex, securityLevel: 'native' as const };
    expect((await getProviderAdapters(config).claude.checkHealth()).supportedModes).toEqual(['ask', 'plan', 'agent', 'edits', 'auto', 'full']);
    vi.stubEnv('CODEAI_FAKE_HELP', 'no-native-permissions');
    expect((await getProviderAdapters(config).claude.checkHealth()).supportedModes).toEqual(['ask', 'plan', 'agent']);
    const docker = getProviderAdapters(config, 'docker');
    expect(docker.claude.supportedModes).toEqual(['ask', 'plan', 'agent']);
    expect(docker.codex.supportedModes).toEqual(['ask', 'plan', 'agent']);
  });
});
