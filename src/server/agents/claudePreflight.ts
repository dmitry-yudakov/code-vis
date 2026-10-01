import { spawn } from 'node:child_process';
import { claudeSupportedModes, requiredFlagsForMode } from './claudeInvocation';
import type { AgentExecution, AgentMode, SecurityLevel } from '@/shared/types';

export interface ClaudePreflightResult {
  binaryReady: boolean;
  flagsReady: boolean;
  unsupportedModes: AgentMode[];
  /** Whether `claude --help` documents `--effort`. It decides only whether efforts are offered. */
  effortSupported: boolean;
  message?: string;
}

/**
 * The rule every Claude check applies to `claude --help`, wherever it ran: the flags each mode needs
 * that the text leaves out, and whether it documents `--effort`.
 */
export function inspectClaudeHelp(help: string, level: SecurityLevel = 'guarded', execution: AgentExecution = 'local'): { missingByMode: Array<{ mode: AgentMode; missing: string[] }>; effortSupported: boolean } {
  if (execution === 'docker') level = 'guarded';
  const permissionSection = help.match(/--permission-mode\b[\s\S]*?(?=\n\s+--|\nCommands:|$)/)?.[0] ?? '';
  const choices: readonly string[] = permissionSection.match(/choices:\s*([^)]*)/)?.[1].match(/[A-Za-z]+/g) ?? [];
  const permission: Partial<Record<AgentMode, string>> = { edits: 'acceptEdits', auto: 'auto', full: 'bypassPermissions' };
  return {
    missingByMode: claudeSupportedModes(level).map((mode) => ({
      mode,
      missing: [...requiredFlagsForMode(mode, level, execution).filter((flag) => !help.includes(flag)),
        ...(level === 'native' && permission[mode] && !choices.includes(permission[mode]!) ? [permission[mode]!] : [])],
    })).filter((entry) => entry.missing.length > 0),
    effortSupported: help.includes('--effort'),
  };
}

function inspectFlags(missingByMode: ReturnType<typeof inspectClaudeHelp>['missingByMode']): { unsupportedModes: AgentMode[]; message?: string } {
  if (!missingByMode.length) return { unsupportedModes: [] };
  const detail = missingByMode.map((entry) => `${entry.mode} needs ${entry.missing.join(', ')}`).join('; ');
  return {
    unsupportedModes: missingByMode.map((entry) => entry.mode),
    message: `The installed Claude Code version is missing flags this app requires (${detail}). Update it with \`claude update\`.`,
  };
}

export async function checkClaude(binary: string, level: SecurityLevel = 'guarded'): Promise<ClaudePreflightResult> {
  const modes = claudeSupportedModes(level);
  return new Promise((resolve) => {
    const child = spawn(binary, ['--help'], { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({ binaryReady: true, flagsReady: false, unsupportedModes: [...modes], effortSupported: false, message: 'Claude Code help check timed out.' });
    }, 5_000);
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString('utf8').slice(0, 1_000_000); });
    child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString('utf8').slice(0, 1_000_000); });
    child.once('error', () => {
      clearTimeout(timer);
      resolve({ binaryReady: false, flagsReady: false, unsupportedModes: [...modes], effortSupported: false, message: 'Claude Code executable was not found.' });
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        resolve({ binaryReady: false, flagsReady: false, unsupportedModes: [...modes], effortSupported: false, message: 'Claude Code help check failed.' });
        return;
      }
      const { missingByMode, effortSupported } = inspectClaudeHelp(output, level);
      const flags = inspectFlags(missingByMode);
      resolve({
        binaryReady: true,
        flagsReady: flags.unsupportedModes.length === 0,
        unsupportedModes: flags.unsupportedModes,
        effortSupported,
        message: flags.message,
      });
    });
  });
}
