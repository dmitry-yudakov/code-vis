import type { AgentExecution, AgentMode, ModelChoices, ProviderModel, ResolvedAgentPolicy, SecurityLevel } from '@/shared/types';
import { changesCheckout } from '@/shared/agentModes';

export function buildClaudeArgs(input: {
  session: { id: string; action: 'start' | 'resume' };
  attachmentDirectory: string;
  policy: ResolvedAgentPolicy;
  model?: string;
  effort?: string;
  /** The user's framed text for Guarded turns; Native loads its own file. */
  appendSystemPrompt?: string;
}): string[] {
  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    ...(input.policy.level === 'native' ? [] : ['--safe-mode']),
    '--permission-mode', input.policy.permissionMode,
  ];
  // No `--tools` at all means the CLI default toolset, which is exactly what agent mode wants.
  if (input.policy.tools) args.push('--tools', input.policy.tools.join(','));
  if (input.policy.allowedTools.length) args.push('--allowedTools', input.policy.allowedTools.join(','));
  if (input.policy.level !== 'native') args.push('--strict-mcp-config', '--disable-slash-commands');
  if (input.policy.execution !== 'docker' && !changesCheckout(input.policy.mode)) args.push('--setting-sources', 'user');
  args.push(
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
  if (input.policy.level !== 'native' && input.appendSystemPrompt) args.push('--append-system-prompt', input.appendSystemPrompt);
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
  '--append-system-prompt',
] as const;

/**
 * The modes Claude runs at Guarded. Auto is absent: Claude's sandbox did not pass Story 79's probes on the
 * machine they ran on, so Claude never advertises it and is never checked or run for it.
 */
export const CLAUDE_MODES = ['ask', 'plan', 'agent'] as const satisfies readonly AgentMode[];
export function claudeSupportedModes(level: SecurityLevel = 'guarded'): readonly AgentMode[] {
  return level === 'native' ? ['ask', 'plan', 'agent', 'edits', 'auto', 'full'] : CLAUDE_MODES;
}

export function requiredFlagsForMode(mode: AgentMode, level: SecurityLevel = 'guarded', execution: AgentExecution = 'local'): readonly string[] {
  const native = level === 'native' && execution === 'local' && changesCheckout(mode);
  const base = native ? BASE_CLAUDE_FLAGS.filter((flag) => !['--safe-mode', '--strict-mcp-config', '--disable-slash-commands', '--append-system-prompt'].includes(flag)) : BASE_CLAUDE_FLAGS;
  return [...base, ...(changesCheckout(mode) ? ['--input-format'] : ['--tools', ...(execution === 'local' ? ['--setting-sources'] : [])])];
}

export const REQUIRED_CLAUDE_FLAGS: readonly string[] = [
  ...new Set(CLAUDE_MODES.flatMap((mode) => requiredFlagsForMode(mode))),
];
