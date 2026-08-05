import { spawn } from 'node:child_process';
import { REQUIRED_CLAUDE_FLAGS } from './claudeInvocation';

export interface ClaudePreflightResult {
  binaryReady: boolean;
  flagsReady: boolean;
  message?: string;
}

export async function checkClaude(binary: string): Promise<ClaudePreflightResult> {
  return new Promise((resolve) => {
    const child = spawn(binary, ['--help'], { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({ binaryReady: true, flagsReady: false, message: 'Claude Code help check timed out.' });
    }, 5_000);
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString('utf8').slice(0, 1_000_000); });
    child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString('utf8').slice(0, 1_000_000); });
    child.once('error', () => {
      clearTimeout(timer);
      resolve({ binaryReady: false, flagsReady: false, message: 'Claude Code executable was not found.' });
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      const missing = REQUIRED_CLAUDE_FLAGS.filter((flag) => !output.includes(flag));
      resolve({
        binaryReady: code === 0,
        flagsReady: code === 0 && missing.length === 0,
        message: code !== 0 ? 'Claude Code help check failed.' : missing.length ? `Unsupported Claude flags: ${missing.join(', ')}` : undefined,
      });
    });
  });
}
