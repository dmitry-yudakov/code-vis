import { chmod, mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ClaudeProcessRunner } from '@/lib/server/claudeProcessRunner';
import { resolveAgentPolicy } from '@/lib/server/agentPolicy';
import { getConfig } from '@/lib/server/config';
import type { AgentProcessEvent } from '@/lib/shared/types';

const binary = path.resolve('test/fixtures/fake-claude.mjs');

describe.sequential('ClaudeProcessRunner', () => {
  beforeAll(async () => chmod(binary, 0o755));
  afterEach(() => { delete process.env.CODEAI_FAKE_MODE; });

  async function run(action: 'start' | 'resume' = 'start', timeoutMs = 2_000, signal = new AbortController().signal) {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'web2-fake-'));
    const id = crypto.randomUUID();
    const runner = new ClaudeProcessRunner({ binary, maxOutputBytes: 100_000, killGraceMs: 50 });
    const events: AgentProcessEvent[] = [];
    const result = await runner.run({
      runId: crypto.randomUUID(),
      project: { id: 'p', name: 'fixture', relativePath: '.', realPath: process.cwd() },
      session: { id, action },
      prompt: action === 'start' ? 'unique first question' : 'short follow-up only',
      attachmentDirectory: directory,
      policy: { ...resolveAgentPolicy(getConfig()), timeoutMs },
      signal,
      emit(event) { events.push(event); },
    });
    return { result, events, invocation: JSON.parse(await readFile(path.join(directory, 'fake-invocation.json'), 'utf8')) };
  }

  it('uses a session id first and resume later without transcript replay', async () => {
    const first = await run('start');
    expect(first.invocation.args).toContain('--session-id');
    const second = await run('resume');
    expect(second.invocation.args).toContain('--resume');
    expect(second.invocation.prompt).toBe('short follow-up only');
    expect(second.result.finalText).toContain('prior turn');
    expect(second.invocation.args).toContain('Read,Glob,Grep');
    expect(second.invocation.args).not.toContain('--dangerously-skip-permissions');
  });

  it('emits sanitized per-tool activity without absolute paths', async () => {
    const { events } = await run('start');
    const activity = events.filter((event) => event.type === 'activity');
    expect(activity).toEqual([
      { type: 'activity', tool: 'Read', detail: 'README.md' },
      { type: 'activity', tool: 'Grep', detail: 'architecture in src' },
      { type: 'activity', tool: 'Read', detail: 'attached context: git-status.txt' },
      { type: 'activity', tool: 'Read' },
    ]);
    expect(JSON.stringify(activity)).not.toContain(process.cwd());
  });

  it('classifies malformed, non-zero, missing-session, timeout, and cancellation', async () => {
    process.env.CODEAI_FAKE_MODE = 'malformed';
    await expect(run()).rejects.toMatchObject({ code: 'malformed-stream' });
    process.env.CODEAI_FAKE_MODE = 'nonzero';
    await expect(run()).rejects.toMatchObject({ code: 'process-failed' });
    process.env.CODEAI_FAKE_MODE = 'missing-session';
    await expect(run('resume')).rejects.toMatchObject({ code: 'missing-session' });
    process.env.CODEAI_FAKE_MODE = 'timeout';
    await expect(run('start', 40)).rejects.toMatchObject({ code: 'timeout' });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);
    await expect(run('start', 2_000, controller.signal)).rejects.toMatchObject({ code: 'cancelled' });
  });
});
