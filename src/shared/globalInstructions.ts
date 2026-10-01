import type {
  AgentExecution, AgentMode, AgentProvider, GlobalInstructionsChoice, InstructionFileIssue, InstructionsLine, MachineInstructions, SecurityLevel,
} from './types';
import { changesCheckout } from './agentModes';

export const LOCAL_CODEX_ISOLATION_MESSAGE = 'Local Codex always loads your global AGENTS.md. Use Docker for an isolated Codex.';
export const NATIVE_CLAUDE_ISOLATION_MESSAGE = 'This session runs without your global instructions, and Claude loads them itself in Native writing modes.';

export function nativeClaudeIsolationIssue(input: {
  provider: AgentProvider; execution?: AgentExecution; level?: SecurityLevel; mode: AgentMode; choice?: GlobalInstructionsChoice;
}): string | undefined {
  return input.provider === 'claude' && (input.execution ?? 'local') === 'local' && input.level === 'native'
    && changesCheckout(input.mode) && input.choice === 'isolated' ? NATIVE_CLAUDE_ISOLATION_MESSAGE : undefined;
}

/** The largest instruction file CodeAI passes. A larger one is not passed at all, never truncated. */
export const GLOBAL_INSTRUCTIONS_BYTES = 32 * 1024;

/** Completes "<path> …", for the view and the readiness line. */
export const INSTRUCTION_ISSUE_TEXT: Record<InstructionFileIssue, string> = {
  missing: 'does not exist',
  'not-file': 'is not a regular file',
  'too-large': `is larger than ${GLOBAL_INSTRUCTIONS_BYTES / 1024} KiB`,
  'not-text': 'is not UTF-8 text',
  unreadable: 'cannot be read',
  'agent-link': 'is reached through a link under the repositories root or a temp directory, which an agent turn could repoint',
  protected: 'resolves to a private file of a provider folder',
  unverified: 'is under the repositories root or a temp directory, where this system cannot prove which file was opened',
};

function localCodex(provider: AgentProvider, execution: AgentExecution | undefined): boolean {
  return provider === 'codex' && (execution ?? 'local') === 'local';
}

/** Local Codex loads its own global file whatever CodeAI sends, so an isolated session cannot hold one. */
export function isolatesLocalCodex(
  choice: GlobalInstructionsChoice | undefined,
  execution: AgentExecution | undefined,
  provider: AgentProvider,
): boolean {
  return choice === 'isolated' && localCodex(provider, execution);
}

/**
 * Whether an agent's next turn gets the user's global instructions: always for local Codex, else the
 * session's own choice, else the executing machine's switch. Undefined while that switch is unknown.
 */
export function effectiveInstructions(input: {
  provider: AgentProvider;
  execution?: AgentExecution;
  choice?: GlobalInstructionsChoice;
  machine?: Partial<Record<AgentProvider, boolean>>;
}): GlobalInstructionsChoice | undefined {
  if (localCodex(input.provider, input.execution)) return 'global';
  if (input.choice) return input.choice;
  const enabled = input.machine?.[input.provider];
  return enabled === undefined ? undefined : enabled ? 'global' : 'isolated';
}

/**
 * What the line under the composer shows. A choice that is on says so only when this machine has
 * instructions to give the agent. An executor's own switches and files are not known here, so its
 * session shows only a choice of its own.
 */
export function instructionsLine(input: {
  provider: AgentProvider;
  execution?: AgentExecution;
  choice?: GlobalInstructionsChoice;
  machine?: MachineInstructions;
  level?: SecurityLevel;
  mode?: AgentMode;
}): InstructionsLine | undefined {
  if (input.provider === 'claude' && (input.execution ?? 'local') === 'local' && input.level === 'native'
    && input.mode && changesCheckout(input.mode)) return 'global';
  const { machine } = input;
  if (!machine) return localCodex(input.provider, input.execution) ? undefined : input.choice;
  const choice = effectiveInstructions({ ...input, machine: { claude: machine.claude.enabled, codex: machine.codex.enabled } });
  if (choice !== 'global') return choice;
  const file = machine[input.provider];
  return (localCodex(input.provider, input.execution) ? file.present : file.passable) ? 'global' : 'unavailable';
}
