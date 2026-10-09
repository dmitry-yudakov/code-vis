// Runs in a private process because unproved worker ownership intentionally retains admission.
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { writeSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { CodexProcessRunner as CurrentRunner } from '@/server/agents/codexProcessRunner';
import { resolveAgentPolicy } from '@/server/agents/agentPolicy';
import { getConfig } from '@/server/config';
import type { AgentProcessEvent } from '@/shared/types';

async function main() {
  const directory = process.env.CODEAI_CLEANUP_DIRECTORY!;
  const recordPath = process.env.CODEAI_CLEANUP_RECORD!;
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  const events: AgentProcessEvent[] = [];
  let workerPid: number | undefined;
  let launcherPid: number | undefined;
  let settled = false;
  const Runner = process.env.CODEAI_CLEANUP_RUNNER_SOURCE
    ? (await import(process.env.CODEAI_CLEANUP_RUNNER_SOURCE)).CodexProcessRunner as typeof CurrentRunner : CurrentRunner;
  try {
    const runner = new Runner({ binary: path.resolve('test/fixtures/fake-codex-cleanup.mjs'), imagePaths: [],
      maxOutputBytes: 10_000, killGraceMs: 50,
      transport: { spawn(executable, args) {
        const child = spawn(executable, args, { stdio: ['pipe', 'pipe', 'pipe'] });
        launcherPid = child.pid;
        Object.defineProperty(process, 'platform', { ...platform, value: 'darwin' });
        return child;
      } },
    });
    void runner.run({ runId: crypto.randomUUID(),
      checkout: { id: 'fixture', name: 'fixture', relativePath: '.', realPath: directory },
      session: { action: 'start' }, prompt: 'Use a subagent for a read-only review.', attachmentDirectory: directory,
      policy: { ...resolveAgentPolicy({ ...getConfig(), securityLevel: 'guarded' }, 'ask'), timeoutMs: 0 },
      signal: new AbortController().signal, emit: event => events.push(event),
    }).then(() => { settled = true; }, () => { settled = true; });

    let protocol: { workerPid?: number; requests: Array<{ method: string }> } | undefined;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try { protocol = JSON.parse(await readFile(recordPath, 'utf8')); } catch { /* SDK not started. */ }
      workerPid = protocol?.workerPid;
      if (workerPid && protocol?.requests.some(request => request.method === 'thread/read')) break;
      await delay(20);
    }
    await delay(300);
    writeSync(1, `${JSON.stringify({ settled, workerAlive: workerPid && process.kill(workerPid, 0),
      metadataRequested: protocol?.requests.some(request => request.method === 'thread/read'),
      cleanupReported: events.some(event => event.type === 'activity' && /remain.*locked/i.test(event.detail ?? '')),
    })}\n`);
  } finally {
    Object.defineProperty(process, 'platform', platform);
    if (!workerPid) {
      try { workerPid = JSON.parse(await readFile(recordPath, 'utf8')).workerPid; } catch { /* SDK failed before launch. */ }
    }
    for (const pid of [workerPid, launcherPid]) if (pid) {
      try { process.kill(pid, 'SIGKILL'); } catch { /* Already stopped. */ }
    }
  }
  process.exit(0);
}

void main();
