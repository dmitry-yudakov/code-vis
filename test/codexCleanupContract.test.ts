import { spawn } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, it, vi } from 'vitest';
import { resolveAgentPolicy } from '@/server/agents/agentPolicy';
import { CodexProcessRunner } from '@/server/agents/codexProcessRunner';
import { getConfig } from '@/server/config';
import { RunRegistry } from '@/server/runs/runRegistry';
import type { AgentProcessEvent } from '@/shared/types';

interface Protocol {
  workerPid?: number;
  requests: Array<{ method: string }>;
}

it('does not send user input after synchronous cancellation from session-started', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'codeai-cancel-before-input-'));
  const recordPath = path.join(directory, 'protocol.json');
  const binary = path.resolve('test/fixtures/fake-codex-cleanup.mjs');
  await chmod(binary, 0o755);
  vi.stubEnv('CODEAI_CLEANUP_RECORD', recordPath);
  vi.stubEnv('CODEAI_CLEANUP_RELEASE', path.join(directory, 'allow-termination'));
  const controller = new AbortController();
  let launcherPid: number | undefined;
  let workerPid: number | undefined;
  let sessionStarted = false;
  const runner = new CodexProcessRunner({ binary, imagePaths: [], maxOutputBytes: 10_000, killGraceMs: 50,
    transport: { spawn(executable, args) {
      const child = spawn(executable, args, { stdio: ['pipe', 'pipe', 'pipe'] });
      launcherPid = child.pid;
      return child;
    } },
  });
  const outcome = runner.run({ runId: crypto.randomUUID(),
    checkout: { id: 'fixture', name: 'fixture', relativePath: '.', realPath: directory },
    session: { action: 'start' }, prompt: 'Use a subagent.', attachmentDirectory: directory,
    policy: { ...resolveAgentPolicy({ ...getConfig(), securityLevel: 'guarded' }, 'ask'), timeoutMs: 0 },
    signal: controller.signal, emit(event) {
      if (event.type === 'session-started') { sessionStarted = true; controller.abort(); }
    },
  }).then(result => ({ result, error: undefined }), error => ({ result: undefined, error }));
  try {
    await vi.waitFor(() => expect(sessionStarted).toBe(true));
    await delay(150);
    const protocol = JSON.parse(await readFile(recordPath, 'utf8')) as Protocol;
    workerPid = protocol.workerPid;
    expect(protocol.requests.some(request => request.method === 'turn/start')).toBe(false);
    expect(workerPid).toBeUndefined();
    expect(await outcome).toMatchObject({ error: { code: 'cancelled' } });
  } finally {
    for (const pid of [workerPid, launcherPid]) if (pid) {
      try { process.kill(pid, 'SIGKILL'); } catch { /* Already stopped. */ }
    }
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  }
});

it('retains non-Linux admission when child metadata fails and the root terminal list is empty', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'codeai-unverified-cleanup-'));
  const fixture = path.resolve('test/fixtures/fake-codex-cleanup.mjs');
  await chmod(fixture, 0o755);
  try {
    const probe = spawn(process.execPath, ['--import', 'tsx', path.resolve('test/fixtures/codex-unverified-cleanup-probe.ts')], {
      stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env,
        CODEAI_CLEANUP_DIRECTORY: directory, CODEAI_CLEANUP_RECORD: path.join(directory, 'protocol.json'),
        CODEAI_CLEANUP_RELEASE: path.join(directory, 'allow-termination'), CODEAI_CLEANUP_UNVERIFIED: '1',
      },
    });
    let stdout = '';
    let stderr = '';
    probe.stdout.on('data', chunk => { stdout += String(chunk); });
    probe.stderr.on('data', chunk => { stderr += String(chunk); });
    const code = await new Promise<number | null>((resolve, reject) => {
      probe.once('error', reject);
      probe.once('close', resolve);
    });
    expect({ code, stderr }).toEqual({ code: 0, stderr: '' });
    expect(JSON.parse(stdout)).toEqual({ settled: false, workerAlive: true, metadataRequested: true, cleanupReported: true });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('retains checkout and machine admission when non-Linux read-only SDK cleanup is unconfirmed', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'codeai-nonlinux-cleanup-'));
  const recordPath = path.join(directory, 'protocol.json');
  const releasePath = path.join(directory, 'allow-termination');
  const binary = path.resolve('test/fixtures/fake-codex-cleanup.mjs');
  await chmod(binary, 0o755);
  vi.stubEnv('CODEAI_CLEANUP_RECORD', recordPath);
  vi.stubEnv('CODEAI_CLEANUP_RELEASE', releasePath);
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  const registry = new RunRegistry(1);
  const runId = crypto.randomUUID();
  const events: AgentProcessEvent[] = [];
  let launcherPid: number | undefined;
  let settled = false;
  let workerPid: number | undefined;
  let failure: unknown;
  const successor = vi.fn(async () => undefined);
  const runner = new CodexProcessRunner({ binary, imagePaths: [], maxOutputBytes: 10_000, killGraceMs: 50,
    transport: { spawn(executable, args) {
      const child = spawn(executable, args, { stdio: ['pipe', 'pipe', 'pipe'] });
      // Spawn on the actual host, then exercise the runner's supported non-Linux cleanup path.
      Object.defineProperty(process, 'platform', { ...platform, value: 'darwin' });
      launcherPid = child.pid;
      return child;
    } },
  });
  let completion: Promise<void> | undefined;
  try {
    expect(registry.reserve({ runId, sessionId: 'read-only-session', participantId: 'codex',
      providerKey: 'codex:cleanup', checkoutId: 'cleanup-checkout', checkoutPath: directory,
      access: 'read', execution: 'local', cancel() {} })).toMatchObject({ accepted: true });
    registry.activate(runId, {
      async execute() {
        completion = runner.run({ runId,
          checkout: { id: 'cleanup-checkout', name: 'fixture', relativePath: '.', realPath: directory },
          session: { action: 'start' }, prompt: 'Use a subagent for a read-only review.', attachmentDirectory: directory,
          policy: { ...resolveAgentPolicy({ ...getConfig(), securityLevel: 'guarded' }, 'ask'), timeoutMs: 0 },
          signal: new AbortController().signal, emit: event => events.push(event),
        }).catch(error => { failure = error; }).then(() => { settled = true; });
        await completion;
      }, cancelQueued: async () => undefined,
    });
    await vi.waitFor(async () => {
      const protocol = JSON.parse(await readFile(recordPath, 'utf8')) as Protocol;
      workerPid = protocol.workerPid;
      expect(protocol.requests.some(request => request.method === 'thread/backgroundTerminals/terminate')).toBe(true);
    });
    const nextId = crypto.randomUUID();
    expect(registry.reserve({ runId: nextId, sessionId: 'next-session', participantId: 'next',
      providerKey: 'other-provider', checkoutId: 'other-checkout', checkoutPath: path.join(directory, 'other'),
      access: 'read', execution: 'local', cancel() {} })).toMatchObject({ accepted: true });
    registry.activate(nextId, { execute: successor, cancelQueued: async () => undefined });
    await delay(300);
    expect(process.kill(workerPid!, 0)).toBe(true);
    expect(settled).toBe(false);
    expect(registry.acquireCheckoutWrite(directory)).toBeUndefined();
    expect(successor).not.toHaveBeenCalled();
    expect(events).toContainEqual(expect.objectContaining({ type: 'activity', detail: expect.stringMatching(/remain.*locked/i) }));

    await writeFile(releasePath, 'allow');
    await vi.waitFor(() => expect(settled).toBe(true), { timeout: 4_000 });
    await completion;
    expect(failure).toBeUndefined();
    expect(() => process.kill(workerPid!, 0)).toThrow();
    await vi.waitFor(() => expect(successor).toHaveBeenCalledOnce());
    const writeLease = registry.acquireCheckoutWrite(directory);
    expect(writeLease).toBeTypeOf('function');
    writeLease?.();
  } finally {
    Object.defineProperty(process, 'platform', platform);
    vi.unstubAllEnvs();
    // The red implementation exits the SDK and leaks its detached worker; remove both on failure.
    for (const pid of [workerPid, launcherPid]) if (pid) {
      try { process.kill(pid, 'SIGKILL'); } catch { /* Already confirmed stopped. */ }
    }
    registry.finish(runId);
    await rm(directory, { recursive: true, force: true });
  }
});
