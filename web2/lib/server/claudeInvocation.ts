import type { ResolvedAgentPolicy } from '@/lib/shared/types';

export function buildClaudeArgs(input: {
  session: { id: string; action: 'start' | 'resume' };
  attachmentDirectory: string;
  policy: ResolvedAgentPolicy;
  model?: string;
}): string[] {
  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--safe-mode',
    '--permission-mode', input.policy.permissionMode,
    '--tools', input.policy.tools.join(','),
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--max-turns', String(input.policy.maxTurns),
    input.session.action === 'start' ? '--session-id' : '--resume', input.session.id,
    '--add-dir', input.attachmentDirectory,
  ];
  if (input.model) args.push('--model', input.model);
  return args;
}

export const REQUIRED_CLAUDE_FLAGS = [
  '--output-format', '--include-partial-messages', '--safe-mode', '--permission-mode', '--tools',
  '--strict-mcp-config', '--disable-slash-commands', '--max-turns', '--session-id', '--resume', '--add-dir',
] as const;
