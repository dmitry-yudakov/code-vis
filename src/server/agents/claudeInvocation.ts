import type { AgentMode, ModelChoices, ProviderModel, ResolvedAgentPolicy } from '@/shared/types';

export function buildClaudeArgs(input: {
  session: { id: string; action: 'start' | 'resume' };
  attachmentDirectory: string;
  policy: ResolvedAgentPolicy;
  model?: string;
  effort?: string;
}): string[] {
  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--safe-mode',
    '--permission-mode', input.policy.permissionMode,
  ];
  // No `--tools` at all means the CLI default toolset, which is exactly what agent mode wants.
  if (input.policy.tools) args.push('--tools', input.policy.tools.join(','));
  if (input.policy.allowedTools.length) args.push('--allowedTools', input.policy.allowedTools.join(','));
  args.push(
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--max-turns', String(input.policy.maxTurns),
    input.session.action === 'start' ? '--session-id' : '--resume', input.session.id,
    '--add-dir', input.attachmentDirectory,
  );
  if (input.policy.interactivePermissions) {
    // Bidirectional control protocol: the CLI asks over stdout, we answer over stdin.
    args.push('--input-format', 'stream-json', '--permission-prompt-tool', 'stdio');
  }
  if (input.model) args.push('--model', input.model);
  if (input.effort) args.push('--effort', input.effort);
  return args;
}

/**
 * Flags sent only for a chosen (or configured) model and a chosen effort. No mode requires them;
 * preflight probes `--effort` only to decide whether efforts are offered.
 */
export const CHOICE_CLAUDE_FLAGS = ['--model', '--effort'] as const;

export const CLAUDE_EFFORTS: readonly string[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/**
 * Family aliases resolve to the newest model in each family, so the list does not go stale. Haiku
 * takes no effort because the API rejects effort on Haiku 4.5.
 */
export const CLAUDE_MODEL_CHOICES: readonly ProviderModel[] = [
  { id: 'fable', label: 'Fable', efforts: [...CLAUDE_EFFORTS] },
  { id: 'opus', label: 'Opus', efforts: [...CLAUDE_EFFORTS] },
  { id: 'sonnet', label: 'Sonnet', efforts: [...CLAUDE_EFFORTS] },
  { id: 'haiku', label: 'Haiku', efforts: [] },
];

export function claudeModelChoices(effortSupported: boolean, defaultModel?: string): Required<ModelChoices> {
  return {
    models: CLAUDE_MODEL_CHOICES.map((model) => ({ ...model, efforts: effortSupported ? [...model.efforts] : [] })),
    // Default runs the installation model when one is set, and Haiku takes no effort.
    efforts: effortSupported && !/haiku/i.test(defaultModel || '') ? [...CLAUDE_EFFORTS] : [],
  };
}

/**
 * Flags the CLI supports but does not document in `claude --help`. Preflight must never probe for
 * these: a healthy install would be reported as outdated and every mode disabled.
 */
export const UNPROBED_CLAUDE_FLAGS = ['--max-turns', '--permission-prompt-tool'] as const;

const BASE_CLAUDE_FLAGS = [
  '--output-format', '--verbose', '--include-partial-messages', '--safe-mode', '--permission-mode',
  '--allowedTools', '--strict-mcp-config', '--disable-slash-commands', '--session-id', '--resume', '--add-dir',
] as const;

/** Per-mode additions, all documented in `claude --help`. */
const MODE_CLAUDE_FLAGS: Record<AgentMode, readonly string[]> = {
  ask: ['--tools'],
  plan: ['--tools'],
  agent: ['--input-format'],
};

export const AGENT_MODES: readonly AgentMode[] = ['ask', 'plan', 'agent'];

export function requiredFlagsForMode(mode: AgentMode): readonly string[] {
  return [...BASE_CLAUDE_FLAGS, ...MODE_CLAUDE_FLAGS[mode]];
}

export const REQUIRED_CLAUDE_FLAGS: readonly string[] = [
  ...new Set(AGENT_MODES.flatMap((mode) => requiredFlagsForMode(mode))),
];
