import { spawn } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, it, vi } from 'vitest';
import { resolveAgentPolicy } from '@/server/agents/agentPolicy';
import { CodexProcessRunner } from '@/server/agents/codexProcessRunner';
import { CodexSubagentThreads } from '@/server/agents/codexSubagentThreads';
import { getConfig } from '@/server/config';

interface Protocol {
  workerPid?: number;
  requests: { method: string; params?: { threadId?: string; turnId?: string } }[];
}

it.each(['delayed-turn', 'failed-child-interrupt'])('retains non-Linux cleanup through %s', async mode => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'codeai-cleanup-race-'));
  const recordPath = path.join(directory, 'protocol.json');
  const releasePath = path.join(directory, 'release');
  const binary = path.resolve('test/fixtures/fake-codex-cleanup-races.mjs');
  await chmod(binary, 0o755);
  vi.stubEnv('CODEAI_CLEANUP_RACE_MODE', mode);
  vi.stubEnv('CODEAI_CLEANUP_RACE_RECORD', recordPath);
  vi.stubEnv('CODEAI_CLEANUP_RACE_RELEASE', releasePath);
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  const abort = new AbortController();
  let launcherPid: number | undefined;
  let workerPid: number | undefined;
  let settled = false;
  const runner = new CodexProcessRunner({ binary, imagePaths: [], maxOutputBytes: 10_000, killGraceMs: 50,
    transport: { spawn(executable, args) {
      const child = spawn(executable, args, { stdio: ['pipe', 'pipe', 'pipe'] });
      launcherPid = child.pid;
      Object.defineProperty(process, 'platform', { ...platform, value: 'darwin' });
      return child;
    } },
  });
  const outcome = runner.run({ runId: crypto.randomUUID(),
    checkout: { id: 'p', name: 'fixture', relativePath: '.', realPath: directory },
    session: { action: 'start' }, prompt: 'Review with a child.', attachmentDirectory: directory,
    policy: { ...resolveAgentPolicy({ ...getConfig(), securityLevel: 'guarded' }, 'ask'), timeoutMs: 0 },
    signal: abort.signal,
    emit(event) { if (mode === 'delayed-turn' && event.type === 'phase' && event.phase === 'thinking') abort.abort(); },
  }).then(result => { settled = true; return { result, error: undefined }; },
    error => { settled = true; return { result: undefined, error }; });
  const protocol = async () => JSON.parse(await readFile(recordPath, 'utf8')) as Protocol;
  try {
    await vi.waitFor(async () => {
      workerPid = (await protocol()).workerPid;
      expect(workerPid).toBeGreaterThan(1);
    });
    if (mode === 'delayed-turn') {
      await delay(100);
      expect((await protocol()).requests.filter(request => request.method === 'thread/backgroundTerminals/list')).toHaveLength(1);
    }
    await vi.waitFor(async () => expect((await protocol()).requests).toContainEqual(expect.objectContaining({
      method: 'turn/interrupt', params: { threadId: mode === 'delayed-turn' ? 'race-parent' : 'race-child',
        turnId: mode === 'delayed-turn' ? 'delayed-parent-turn' : 'active-child-turn' },
    })));
    expect(settled).toBe(false);
    expect(process.kill(workerPid!, 0)).toBe(true);
    await writeFile(releasePath, 'allow');
    await vi.waitFor(() => expect(settled).toBe(true), { timeout: 4_000 });
    const value = await outcome;
    if (mode === 'delayed-turn') expect(value.error).toMatchObject({ code: 'cancelled' });
    else expect(value.result).toMatchObject({ finalText: 'Parent review.' });
    expect((await protocol()).requests.filter(request => request.method === 'turn/interrupt').length).toBeGreaterThan(1);
  } finally {
    Object.defineProperty(process, 'platform', platform);
    vi.unstubAllEnvs();
    for (const pid of [workerPid, launcherPid]) if (pid) try { process.kill(pid, 'SIGKILL'); } catch { /* Already stopped. */ }
    await rm(directory, { recursive: true, force: true });
  }
});

it('retains unconfirmed cleanup when valid discovered threads exceed the metadata bound', () => {
  const read = vi.fn();
  const threads = new CodexSubagentThreads('parent', read);
  for (let index = 0; index < 64; index += 1) threads.observe({ id: `child-${index}`, parentThreadId: 'parent' });
  expect(threads.cleanupUnverified).toBe(false);
  expect(threads.discover('child-65')).toBe(false);
  expect(threads.verifiedThreads()).toHaveLength(64);
  expect(threads.cleanupUnverified).toBe(true);
  expect(read).not.toHaveBeenCalled();
});
