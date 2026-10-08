import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const launcher = path.resolve('scripts/run-server.ts');
const fixture = path.resolve('test/fixtures/logging-server.mjs');
const tsx = createRequire(import.meta.url).resolve('tsx');
const roots: string[] = [];
const children: ChildProcess[] = [];
async function root(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'codeai-log-launcher-'));
  roots.push(directory);
  return directory;
}
function run(cwd: string, environment: Record<string, string | undefined> = {}, args = ['hello', 'argument with spaces'], mode = 'production') {
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (/^CODEAI_(?:WEB2_)?LOG_/.test(name) || name === 'NODE_ENV' || name === '__NEXT_PROCESSED_ENV') delete env[name];
  }
  const child = spawn(process.execPath, ['--import', tsx, launcher, mode, fixture, ...args], {
    cwd, env: { ...env, ...environment }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  const output = { stdout: '', stderr: '' };
  child.stdout.on('data', (chunk) => { output.stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output.stderr += chunk.toString(); });
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve(code));
  });
  return { child, output, exited };
}
afterEach(async () => {
  for (const child of children.splice(0)) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  await Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('server output launcher', () => {
  it('preserves arguments, exit code and both console streams, capturing inherited output once', async () => {
    const directory = await root();
    const runResult = run(directory, { CODEAI_LOG_DIR: './logs' });
    expect(await runResult.exited).toBe(7);
    expect(runResult.output.stdout).toBe('server production hello|argument with spaces\ninherited child\ntrailing partial');
    expect(runResult.output.stderr).toBe('server error\ninherited child error\n');
    const log = await readFile(path.join(directory, 'logs', 'server.log'), 'utf8');
    expect(log).toContain('[stdout] server production hello|argument with spaces');
    expect(log.match(/\[stdout\] inherited child\n/g)).toHaveLength(1);
    expect(log).toContain('[stderr] inherited child error\n');
    expect(log).toContain('[stdout] trailing partial\n');
  });
  it('creates no files when disabled and preserves inherited console output', async () => {
    const directory = await root();
    const result = run(directory);
    expect(await result.exited).toBe(7);
    expect(result.output.stdout).toContain('inherited child');
    expect(await readdir(directory)).toEqual([]);
  });
  it.each(['development', 'production'])('loads the correct %s environment file with shell precedence', async (mode) => {
    const directory = await root();
    await writeFile(path.join(directory, '.env'), 'CODEAI_LOG_DIR=base-logs\n');
    await writeFile(path.join(directory, `.env.${mode}.local`), 'CODEAI_LOG_DIR=mode-logs\n');
    const first = run(directory, {}, ['hello'], mode);
    expect(await first.exited).toBe(7);
    expect(await readFile(path.join(directory, 'mode-logs', 'server.log'), 'utf8')).toContain(`server ${mode} hello`);
    const second = run(directory, { CODEAI_LOG_DIR: 'shell-logs' }, ['hello'], mode);
    expect(await second.exited).toBe(7);
    expect(await readFile(path.join(directory, 'shell-logs', 'server.log'), 'utf8')).toContain(`server ${mode} hello`);
  });
  it('keeps console and server operation alive when the log directory is unavailable', async () => {
    const directory = await root();
    await writeFile(path.join(directory, 'logs'), 'keep');
    const result = run(directory, { CODEAI_LOG_DIR: 'logs' });
    expect(await result.exited).toBe(7);
    expect(result.output.stdout).toContain('inherited child');
    expect(result.output.stderr.match(/CodeAI file logging disabled/g)).toHaveLength(1);
    expect(await readFile(path.join(directory, 'logs'), 'utf8')).toBe('keep');
  });
  it('rejects invalid configured limits before launching a server', async () => {
    const directory = await root();
    const result = run(directory, { CODEAI_LOG_DIR: 'logs', CODEAI_LOG_MAX_FILES: '0' });
    expect(await result.exited).toBe(1);
    expect(result.output.stderr).toContain('CODEAI_LOG_MAX_FILES');
    expect(result.output.stdout).toBe('');
    expect(await readdir(directory)).toEqual([]);
  });
  it('forwards managed rollback and shutdown signals, flushing a final partial line', async () => {
    const directory = await root();
    const result = run(directory, { CODEAI_LOG_DIR: 'logs' }, ['signals']);
    await vi.waitFor(() => expect(result.output.stdout).toContain('ready\n'));
    result.child.kill('SIGUSR2');
    await vi.waitFor(() => expect(result.output.stdout).toContain('rollback received\n'));
    result.child.kill('SIGTERM');
    expect(await result.exited).toBe(0);
    expect(await readFile(path.join(directory, 'logs', 'server.log'), 'utf8')).toContain('[stdout] shutdown tail\n');
  });
  it('returns the conventional exit code when the server dies by signal', async () => {
    const directory = await root();
    expect(await run(directory, {}, ['signal-exit']).exited).toBe(143);
  });
  it.each([
    ['stdout', false], ['stderr', false], ['stdout', true], ['stderr', true],
  ] as const)('shuts down after a broken %s console (large tail: %s)', async (stream, largeTail) => {
    const directory = await root();
    const pidFile = path.join(directory, 'server.pid');
    const stoppedFile = path.join(directory, 'server.stopped');
    const result = run(directory, { CODEAI_LOG_DIR: 'logs' }, [
      'broken-console', stream, pidFile, stoppedFile, largeTail ? 'large' : 'small',
    ]);
    await vi.waitFor(() => expect(result.output[stream]).toContain('ready\n'));
    const pid = Number(await readFile(pidFile, 'utf8'));
    try {
      for (const destination of largeTail ? ['stdout', 'stderr'] as const : [stream]) result.child[destination]!.destroy();
      await vi.waitFor(() => expect(result.child.exitCode).not.toBeNull(), { timeout: 3000 });
      expect(await result.exited).toBe(1);
      expect(await readFile(stoppedFile, 'utf8')).toBe('stopped');
      const log = await readFile(path.join(directory, 'logs', 'server.log'), 'utf8');
      expect(log).toContain('CodeAI console output failed');
      if (largeTail) {
        const lines = log.split('\n').filter((line) => line.includes('[stdout]')).map((line) => line.replace(/^\[[^\]]+\] \[stdout\] /, ''));
        expect(lines.join('')).toContain(`shutdown tail ${'x'.repeat(2 * 1024 * 1024)}`);
      } else expect(log).toContain('[stdout] shutdown tail\n');
    } finally {
      // The regression deliberately exposed an orphan before the fix; never leave it running.
      if (result.child.exitCode === null || !await readFile(stoppedFile, 'utf8').catch(() => undefined)) {
        try { process.kill(pid, 'SIGKILL'); } catch { /* The child already exited. */ }
      }
    }
  });
});
