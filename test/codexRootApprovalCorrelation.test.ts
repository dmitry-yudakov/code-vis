import { chmod, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { resolveAgentPolicy } from '@/server/agents/agentPolicy';
import { CodexProcessRunner } from '@/server/agents/codexProcessRunner';
import { getConfig } from '@/server/config';
import { PermissionBroker } from '@/server/runs/permissionBroker';
import type { AgentProcessEvent } from '@/shared/types';

const binary = path.resolve('test/fixtures/fake-codex-root-approval.mjs');
const directories: string[] = [];
beforeAll(async () => chmod(binary, 0o755));
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

async function run(mode: string) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'codeai-root-approval-'));
  directories.push(directory);
  const record = path.join(directory, 'protocol.json');
  vi.stubEnv('CODEAI_ROOT_APPROVAL_MODE', mode);
  vi.stubEnv('CODEAI_ROOT_APPROVAL_RECORD', record);
  const permissions = new PermissionBroker(1_000);
  const events: AgentProcessEvent[] = [];
  const timers: ReturnType<typeof setTimeout>[] = [];
  const runner = new CodexProcessRunner({ binary, imagePaths: [], maxOutputBytes: 10_000, killGraceMs: 50 });
  try {
    const result = await runner.run({ runId: crypto.randomUUID(),
      checkout: { id: 'checkout', name: 'fixture', relativePath: '.', realPath: directory },
      session: { action: 'resume', id: 'saved-parent-thread' }, prompt: 'Continue the parent task.',
      attachmentDirectory: directory,
      policy: { ...resolveAgentPolicy({ ...getConfig(), securityLevel: 'native' }, 'agent'), timeoutMs: 2_000 },
      permissions, signal: new AbortController().signal,
      emit(event) {
        events.push(event);
        // Make Allow arrive after the turn/start response established the actual current turn.
        if (event.type === 'permission-request') timers.push(setTimeout(() => permissions.decide(event.requestId!, 'allow'), 20));
      },
    });
    const protocol = JSON.parse(await readFile(record, 'utf8')) as {
      responses: Array<{ id: string; result?: { decision: string } }>;
    };
    return { result, events, protocol, permissions };
  } finally {
    timers.forEach(clearTimeout);
  }
}

describe.sequential('Codex parent approval turn correlation', () => {
  it('refuses a stale parent callback received before the turn/start response', async () => {
    const outcome = await run('stale');
    expect(outcome.result.finalText).toBe('Parent completed.');
    expect(outcome.events.filter(event => event.type === 'permission-request')).toEqual([]);
    expect(outcome.protocol.responses).toEqual([{ id: 'early-parent-command', result: { decision: 'cancel' } }]);
    expect(outcome.permissions.pendingCount).toBe(0);
  });

  it.each(['result-only', 'notification-first'])('allows a matching early parent callback after %s establishes its turn', async mode => {
    const outcome = await run(mode);
    expect(outcome.result.finalText).toBe('Parent completed.');
    expect(outcome.events.filter(event => event.type === 'permission-request')).toHaveLength(1);
    expect(outcome.protocol.responses).toEqual([{ id: 'early-parent-command', result: { decision: 'accept' } }]);
    expect(outcome.permissions.pendingCount).toBe(0);
  });
});
