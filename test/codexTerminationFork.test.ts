import { spawn } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { resolveAgentPolicy } from '@/server/agents/agentPolicy';
import { CodexProcessRunner } from '@/server/agents/codexProcessRunner';
import { getConfig } from '@/server/config';
import { RunRegistry } from '@/server/runs/runRegistry';

it.skipIf(process.platform !== 'linux')('does not release runner admission beside a worker forked by a termination handler', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'codeai-termination-fork-'));
  const binary = path.resolve('test/fixtures/fake-codex-termination-fork.mjs');
  await chmod(binary, 0o755);
  vi.stubEnv('CODEAI_TERMINATION_DIRECTORY', directory);
  const registry = new RunRegistry(1);
  const runId = crypto.randomUUID();
  let launcherPid: number | undefined;
  let workerPid: number | undefined;
  let replacementPid: number | undefined;
  let settled = false;
  let successorFinished = false;
  let admissionReleasedBesideWorker = false;
  const successor = vi.fn(async () => {
    try { replacementPid = Number(await readFile(path.join(directory, 'replacement.pid'), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (replacementPid) {
      try { admissionReleasedBesideWorker = process.kill(replacementPid, 0); } catch { /* Replacement stopped. */ }
    }
    successorFinished = true;
  });
  const runner = new CodexProcessRunner({ binary, imagePaths: [], maxOutputBytes: 10_000, killGraceMs: 50,
    transport: { spawn(executable, args) {
      const child = spawn(executable, args, { stdio: ['pipe', 'pipe', 'pipe'] });
      launcherPid = child.pid;
      return child;
    } },
  });
  try {
    expect(registry.reserve({ runId, sessionId: 'fork-session', participantId: 'codex',
      providerKey: 'codex:fork', checkoutId: 'fixture', checkoutPath: directory,
      access: 'write', execution: 'local', cancel() {} })).toMatchObject({ accepted: true });
    registry.activate(runId, { async execute() {
      await runner.run({ runId,
        checkout: { id: 'fixture', name: 'fixture', relativePath: '.', realPath: directory },
        session: { action: 'start' }, prompt: 'Use a subagent.', attachmentDirectory: directory,
        policy: { ...resolveAgentPolicy({ ...getConfig(), securityLevel: 'native' }, 'agent'), timeoutMs: 2_000 },
        signal: new AbortController().signal, emit() {},
      }).catch(() => undefined);
      settled = true;
    }, cancelQueued: async () => undefined });
    await vi.waitFor(async () => {
      await readFile(path.join(directory, 'worker.ready'), 'utf8');
      workerPid = Number(await readFile(path.join(directory, 'worker.pid'), 'utf8'));
    });
    const nextId = crypto.randomUUID();
    expect(registry.reserve({ runId: nextId, sessionId: 'next-session', participantId: 'next',
      providerKey: 'other-provider', checkoutId: 'other-checkout', checkoutPath: path.join(directory, 'other'),
      access: 'read', execution: 'local', cancel() {} })).toMatchObject({ accepted: true });
    registry.activate(nextId, { execute: successor, cancelQueued: async () => undefined });
    expect(settled).toBe(false);
    expect(successor).not.toHaveBeenCalled();
    expect(registry.acquireCheckoutWrite(directory)).toBeUndefined();
    await writeFile(path.join(directory, 'finish-parent'), 'finish');
    await vi.waitFor(() => expect(settled).toBe(true), { timeout: 4_000 });
    await vi.waitFor(() => expect(successor).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(successorFinished).toBe(true));
    expect(admissionReleasedBesideWorker).toBe(false);
    expect(() => process.kill(workerPid!, 0)).toThrow();
  } finally {
    if (!replacementPid) {
      try { replacementPid = Number(await readFile(path.join(directory, 'replacement.pid'), 'utf8')); } catch { /* No replacement spawned. */ }
    }
    for (const pid of [workerPid, replacementPid, launcherPid]) if (pid) {
      try { process.kill(pid, 'SIGKILL'); } catch { /* Already stopped. */ }
    }
    vi.unstubAllEnvs();
    registry.finish(runId);
    await rm(directory, { recursive: true, force: true });
  }
});
