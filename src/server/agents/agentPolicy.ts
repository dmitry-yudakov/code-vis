import { realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AgentExecution, AgentMode, ResolvedAgentPolicy } from '@/shared/types';
import type { AppConfig } from '@/server/config';
import { changesCheckout } from '@/shared/agentModes';

/**
 * Fixed, server-owned permission rules added to every mode. Command-level allowlisting is not
 * argument-level sandboxing — see the README caveat about flags such as `git log --output=<file>`.
 * Deliberately excludes `git fetch`/`git pull`/`gh api`, which are arbitrary code execution.
 */
export const GIT_READ_ALLOWLIST: readonly string[] = Object.freeze([
  'Bash(git log:*)',
  'Bash(git show:*)',
  'Bash(git diff:*)',
  'Bash(git status:*)',
  'Bash(git branch:*)',
  'Bash(git blame:*)',
  'Bash(git shortlog:*)',
  'Bash(gh pr view:*)',
  'Bash(gh pr diff:*)',
  'Bash(gh pr list:*)',
]);

const READONLY_TOOLS: readonly string[] = Object.freeze(['Read', 'Glob', 'Grep', 'Bash']);

export function resolveAgentPolicy(config: AppConfig, mode: AgentMode = 'ask', execution: AgentExecution = 'local'): ResolvedAgentPolicy {
  if (execution === 'docker') {
    // These stay `=== 'agent'`: Docker never offers Auto, and any other mode mounts the checkout read-only.
    return Object.freeze({
      execution, mode, profile: mode === 'agent' ? 'agent-full' : mode === 'plan' ? 'plan-readonly' : 'ask-readonly',
      tools: ['Read', 'Glob', 'Grep', 'Bash', ...(mode === 'agent' ? ['Edit', 'Write', 'NotebookEdit'] : [])],
      allowedTools: [], permissionMode: 'bypassPermissions', interactivePermissions: false,
      safeMode: true, sessionPersistence: true,
      maxTurns: mode === 'agent' ? config.buildMaxTurns : config.agentMaxTurns,
      timeoutMs: mode === 'agent' ? config.buildTimeoutMs : config.agentTimeoutMs,
    });
  }
  const shared = {
    mode,
    allowedTools: GIT_READ_ALLOWLIST,
    safeMode: true as const,
    sessionPersistence: true as const,
  };
  if (changesCheckout(mode)) {
    return Object.freeze({
      ...shared,
      // Auto differs from Agent only in what runs without a card, and that is each provider's own
      // sandbox arguments (`codexTurnSecurity`). Its escalations use Agent's cards and timeout.
      profile: mode === 'auto' ? 'auto-sandboxed' as const : 'agent-full' as const,
      tools: undefined,
      permissionMode: 'default' as const,
      interactivePermissions: true,
      // Building spends turns on research long before the first edit, so it gets its own budget
      // rather than the read-only conversation's.
      maxTurns: config.buildMaxTurns,
      timeoutMs: config.buildTimeoutMs,
      approvalTimeoutMs: config.approvalTimeoutMs,
    });
  }
  return Object.freeze({
    ...shared,
    profile: mode === 'plan' ? 'plan-readonly' as const : 'ask-readonly' as const,
    tools: READONLY_TOOLS,
    permissionMode: 'plan' as const,
    interactivePermissions: false,
    maxTurns: config.agentMaxTurns,
    timeoutMs: config.agentTimeoutMs,
  });
}

/**
 * An Auto sandbox leaves the checkout and the temp directories writable. CodeAI's records and each
 * run's attachments live in the data directory, so Auto is refused while that lies inside one of
 * them. The default data directory, under the home directory, never does.
 */
export async function autoDataDirectoryIssue(dataDir: string, checkoutPath: string): Promise<string | undefined> {
  const real = (target: string) => realpath(target).catch(() => path.resolve(target));
  const data = await real(dataDir);
  const writable = await Promise.all([checkoutPath, os.tmpdir(), '/tmp'].map(real));
  if (!writable.some((root) => data === root || data.startsWith(`${root}${path.sep}`))) return undefined;
  return 'Auto is unavailable while CodeAI\'s data directory is inside the checkout or a temporary directory, '
    + 'where an Auto turn could change CodeAI\'s own records without asking. Set CODEAI_DATA_DIR to a directory outside them.';
}
