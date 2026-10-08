import { spawn } from 'node:child_process';
import { constants } from 'node:os';
import { loadEnvConfig } from '@next/env';
import { RotatingServerLog, serverLogConfig } from './serverLogging';

/** Capture the whole server process tree once, including Next dev workers and managed rebuilds. */
async function main(): Promise<void> {
  const [mode, ...args] = process.argv.slice(2);
  if ((mode !== 'development' && mode !== 'production') || args.length === 0) {
    throw new Error('Expected development or production followed by Node server arguments');
  }
  process.env.NODE_ENV ||= mode;
  // Only the launcher needs these loaded values. Let Next load its own files so development
  // reloads can still replace .env values rather than treating them as inherited shell settings.
  const environment = { ...process.env };
  loadEnvConfig(process.cwd(), mode === 'development');
  const config = serverLogConfig(process.env, process.cwd());
  const log = config && new RotatingServerLog(config, (message) => process.stderr.write(`${message}\n`));
  const child = spawn(process.execPath, args, {
    env: environment,
    stdio: config ? ['inherit', 'pipe', 'pipe'] : 'inherit',
  });
  let consoleFailed = false;
  const stopChild = () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  };
  // An unexpected catchable launcher exit must also stop its server. SIGKILL cannot run this hook.
  process.once('exit', stopChild);
  // Pipe preserves the console's bytes and backpressure. Logging has its own decoded line buffers.
  for (const stream of ['stdout', 'stderr'] as const) {
    process[stream].on('error', (error: Error) => {
      // Unpipe pauses the source. Keep draining every failed destination so a shutdown flush
      // larger than the pipe buffer can complete, even if both console streams have failed.
      child[stream]?.unpipe(process[stream]);
      child[stream]?.resume();
      if (consoleFailed) return;
      consoleFailed = true;
      const message = `CodeAI console output failed (${stream}): ${error.message}\n`;
      log?.write('stderr', Buffer.from(message));
      process[stream === 'stdout' ? 'stderr' : 'stdout'].write(message);
      stopChild();
    });
    child[stream]?.on('data', (chunk: Buffer) => log?.write(stream, chunk));
    child[stream]?.pipe(process[stream], { end: false });
  }
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGUSR2'] as const) {
    process.on(signal, () => { if (child.exitCode === null && child.signalCode === null) child.kill(signal); });
  }
  child.once('error', (error) => {
    const message = `Could not start CodeAI server: ${error.message}\n`;
    process.stderr.write(message);
    log?.write('stderr', Buffer.from(message));
    process.exitCode = 1;
  });
  child.once('close', (code, signal) => {
    log?.close();
    process.exitCode = consoleFailed ? 1 : code ?? (signal ? 128 + constants.signals[signal] : 1);
  });
}

main().catch((error: unknown) => {
  process.stderr.write(`Could not start CodeAI server: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
