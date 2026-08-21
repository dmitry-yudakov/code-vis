import type { AgentMode, ResolvedAgentPolicy } from '@/shared/types';
import type { AppConfig } from '@/server/config';

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

export function resolveAgentPolicy(config: AppConfig, mode: AgentMode = 'ask'): ResolvedAgentPolicy {
  const shared = {
    mode,
    allowedTools: GIT_READ_ALLOWLIST,
    safeMode: true as const,
    sessionPersistence: true as const,
  };
  if (mode === 'agent') {
    return Object.freeze({
      ...shared,
      profile: 'agent-full' as const,
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
