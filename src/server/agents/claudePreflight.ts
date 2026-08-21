import { spawn } from 'node:child_process';
import type { AgentMode } from '@/shared/types';
import { AGENT_MODES, requiredFlagsForMode } from './claudeInvocation';

export interface ClaudePreflightResult {
  binaryReady: boolean;
  flagsReady: boolean;
  unsupportedModes: AgentMode[];
  message?: string;
}

function inspectFlags(help: string): { unsupportedModes: AgentMode[]; message?: string } {
  const missingByMode = AGENT_MODES.map((mode) => ({
    mode,
    missing: requiredFlagsForMode(mode).filter((flag) => !help.includes(flag)),
  })).filter((entry) => entry.missing.length > 0);
  if (!missingByMode.length) return { unsupportedModes: [] };
  const detail = missingByMode.map((entry) => `${entry.mode} needs ${entry.missing.join(', ')}`).join('; ');
  return {
    unsupportedModes: missingByMode.map((entry) => entry.mode),
    message: `The installed Claude Code version is missing flags this app requires (${detail}). Update it with \`claude update\`.`,
  };
}

export async function checkClaude(binary: string): Promise<ClaudePreflightResult> {
  return new Promise((resolve) => {
    const child = spawn(binary, ['--help'], { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({ binaryReady: true, flagsReady: false, unsupportedModes: [...AGENT_MODES], message: 'Claude Code help check timed out.' });
    }, 5_000);
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString('utf8').slice(0, 1_000_000); });
    child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString('utf8').slice(0, 1_000_000); });
    child.once('error', () => {
      clearTimeout(timer);
      resolve({ binaryReady: false, flagsReady: false, unsupportedModes: [...AGENT_MODES], message: 'Claude Code executable was not found.' });
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        resolve({ binaryReady: false, flagsReady: false, unsupportedModes: [...AGENT_MODES], message: 'Claude Code help check failed.' });
        return;
      }
      const flags = inspectFlags(output);
      resolve({
        binaryReady: true,
        flagsReady: flags.unsupportedModes.length === 0,
        unsupportedModes: flags.unsupportedModes,
        message: flags.message,
      });
    });
  });
}
