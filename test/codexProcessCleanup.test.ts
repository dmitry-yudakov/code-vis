import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CodexProcessRunner } from '@/server/agents/codexProcessRunner';
import { resolveAgentPolicy } from '@/server/agents/agentPolicy';
import { getConfig } from '@/server/config';
import type { AgentProcessEvent } from '@/shared/types';

const tree = vi.hoisted(() => ({ failures: 0, root: 'original', afterFailure: 'original', startupFailure: false, captures: 0, lateCapture: false, lateInherited: false, stopped: [] as number[] }));
vi.mock('@/server/agents/processDescendants', async importOriginal => {
  const actual = await importOriginal<typeof import('@/server/agents/processDescendants')>();
  return { ...actual,
    readProcessIdentity: vi.fn(async (pid: number) => {
      if (tree.startupFailure) throw new Error('process metadata is unreadable');
      return tree.root === 'absent' ? undefined : { pid, started: tree.root };
    }),
    captureDescendantProcesses: vi.fn(async (_root, retained = []) => {
      tree.captures += 1;
      if (tree.lateCapture && tree.captures === 3) {
        await new Promise(resolve => setTimeout(resolve, 200));
        if (tree.lateInherited) {
          const { readFile } = await import('node:fs/promises');
          const { workerPid } = JSON.parse(await readFile(process.env.CODEAI_FAKE_CODEX_RECORD!, 'utf8'));
          return [await actual.readProcessIdentity(workerPid)];
        }
        return [{ pid: 900999, started: 'late-worker' }];
      }
      if (tree.failures-- > 0) {
        tree.root = tree.afterFailure;
        throw new actual.ProcessCaptureError([], new Error('incomplete process inventory'));
      }
      return retained;
    }),
    stopDescendantProcesses: vi.fn(async (owned: { pid: number; started: string }[]) => {
      tree.stopped.push(...owned.map(process => process.pid));
      if (tree.lateInherited) await actual.stopDescendantProcesses(owned);
    }),
  };
});

describe('Codex cleanup admission', () => {
  const directories: string[] = [];
  beforeEach(() => {
    Object.assign(tree, { failures: 0, root: 'original', afterFailure: 'original', startupFailure: false, captures: 0, lateCapture: false, lateInherited: false, stopped: [] });
    vi.stubEnv('CODEAI_FAKE_CODEX_MODE', 'subagent');
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
  });

  async function run(events: AgentProcessEvent[], onEvent?: (event: AgentProcessEvent, launcher: ChildProcessWithoutNullStreams) => void) {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'codeai-cleanup-'));
    directories.push(directory);
    let launcher: ChildProcessWithoutNullStreams;
    const runner = new CodexProcessRunner({ binary: path.resolve('test/fixtures/fake-codex.mjs'), imagePaths: [], maxOutputBytes: 100000, killGraceMs: 50,
      transport: { spawn(binary, args) { launcher = spawn(binary, args, { cwd: directory, stdio: ['pipe', 'pipe', 'pipe'] }); return launcher; } },
    });
    return runner.run({ runId: crypto.randomUUID(), checkout: { id: 'p', name: 'fixture', relativePath: '.', realPath: directory },
      session: { action: 'start' }, prompt: 'Review', attachmentDirectory: directory,
      policy: { ...resolveAgentPolicy(getConfig(), 'ask'), timeoutMs: 0 }, signal: new AbortController().signal,
      emit(event) { events.push(event); onEvent?.(event, launcher); },
    });
  }

  it.each(['absent', 'reused'])('retains admission after incomplete inventory when the original root is %s', async root => {
    tree.failures = 1;
    tree.afterFailure = root;
    const events: AgentProcessEvent[] = [];
    let settled = false;
    const outcome = run(events).then(result => { settled = true; return { result, error: undefined }; },
      error => { settled = true; return { result: undefined, error }; });
    try {
      await vi.waitFor(() => expect(events).toContainEqual(expect.objectContaining({ type: 'activity', tool: 'Stopping Codex' })), { timeout: 2000 });
      expect(settled).toBe(false);
      const captures = tree.captures;
      await delay(1100);
      expect(tree.captures).toBeGreaterThan(captures);
      expect(settled).toBe(false);
    } finally {
      // Simulate recovered, complete inventory anchored to the original process identity.
      tree.root = 'original';
      expect((await outcome).error).toMatchObject({ code: 'process-failed' });
    }
  });

  it('recovers complete inventory while the original root remains live', async () => {
    tree.failures = 1;
    const events: AgentProcessEvent[] = [];
    await expect(run(events)).rejects.toMatchObject({ code: 'process-failed' });
    expect(tree.captures).toBeGreaterThan(1);
    expect(events.some(event => event.type === 'activity' && event.tool === 'Stopping Codex')).toBe(false);
  });

  it('settles an initial metadata failure before sending input', async () => {
    tree.startupFailure = true;
    const events: AgentProcessEvent[] = [];
    await expect(run(events)).rejects.toMatchObject({ code: 'process-failed', delivery: 'not-sent' });
    expect(events.some(event => event.type === 'turn-started')).toBe(false);
    expect(tree.captures).toBe(0);
  });

  it('stops a worker captured by SDK cleanup after launcher-exit cleanup finishes', async () => {
    tree.lateCapture = true;
    await expect(run([])).rejects.toMatchObject({ code: 'process-failed' });
    expect(tree.stopped).toContain(900999);
  });

  it.skipIf(process.platform !== 'linux')('stops late captured workers before their inherited output can block close', async () => {
    tree.lateCapture = true; tree.lateInherited = true;
    vi.stubEnv('CODEAI_FAKE_CODEX_MODE', 'subagent-late-stdio');
    const directory = await mkdtemp(path.join(os.tmpdir(), 'codeai-late-output-'));
    directories.push(directory);
    const recordPath = path.join(directory, 'provider.json');
    vi.stubEnv('CODEAI_FAKE_CODEX_RECORD', recordPath);
    let workerPid = 0;
    const outcome = run([]).catch(error => error);
    try {
      await vi.waitFor(async () => {
        workerPid = JSON.parse(await readFile(recordPath, 'utf8')).workerPid || 0;
        expect(workerPid).toBeGreaterThan(1);
      });
      await vi.waitFor(() => expect(tree.stopped).toContain(workerPid), { timeout: 1000 });
      expect(await outcome).toMatchObject({ code: 'process-failed' });
    } finally {
      if (workerPid) try { process.kill(workerPid, 'SIGKILL'); } catch {}
      await outcome;
    }
  });

  it('keeps cleanup active through repeated runtime launcher errors', async () => {
    tree.lateCapture = true;
    let launcher: ChildProcessWithoutNullStreams | undefined;
    let settled = false;
    const outcome = run([], (event, child) => {
      if (!launcher && event.type === 'activity' && event.tool === 'Subagent') {
        launcher = child;
        child.emit('error', Object.assign(new Error('kill denied'), { code: 'EPERM' }));
      }
    }).then(result => { settled = true; return result; }, error => { settled = true; return error; });
    try {
      await vi.waitFor(() => expect(launcher).toBeDefined());
      expect(launcher!.listenerCount('error')).toBeGreaterThan(0);
      launcher!.emit('error', Object.assign(new Error('kill denied again'), { code: 'EPERM' }));
      expect(settled).toBe(false);
      expect(await outcome).toMatchObject({ code: 'process-failed', delivery: 'possibly-sent' });
    } finally {
      if (launcher && launcher.exitCode === null && launcher.signalCode === null) {
        const closed = new Promise(resolve => launcher!.once('close', resolve));
        launcher.kill('SIGKILL');
        await closed;
      }
      await outcome;
    }
  });
});
