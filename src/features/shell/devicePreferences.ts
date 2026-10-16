import type {
  AgentExecution, AgentMode, AgentParticipant, AgentProvider, GlobalInstructionsChoice, ModelSelection, ProviderHealth,
} from '@/shared/types';
import { SESSION_LAUNCH_MODES, isAgentMode, isLaunchMode, type SessionLaunchMode } from '@/shared/agentModes';
import { isolatesLocalCodex } from '@/shared/globalInstructions';
import { parseModelSelection, type DeviceViewState } from './workspaceViews';

export const DEVICE_PREFERENCES_STORAGE_KEY = 'code-ai:device:v1:preferences';

const AGENT_PROVIDERS: readonly AgentProvider[] = ['claude', 'codex'];
const INSTRUCTION_CHOICES: readonly GlobalInstructionsChoice[] = ['global', 'isolated'];

/**
 * The last choices made on this device. A session, an agent, or a new-session form without its own
 * choice starts from these. Execution is deliberately absent: Docker stays an explicit choice.
 */
export interface DevicePreferences {
  mode?: AgentMode;
  /** Provider for a new session. */
  provider?: AgentProvider;
  /** Model and effort for an agent of each provider. An empty selection is Default. */
  models?: Partial<Record<AgentProvider, ModelSelection>>;
  /** Global instructions for a new session. Absent is Default: follow the machine's switch. */
  instructions?: GlobalInstructionsChoice;
}

export function parseDevicePreferences(value: string | null): DevicePreferences {
  try {
    const parsed = JSON.parse(value || '') as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== 'object' || parsed.version !== 1) return {};
    const rawModels = parsed.models && typeof parsed.models === 'object' ? parsed.models as Record<string, unknown> : {};
    const models: DevicePreferences['models'] = {};
    for (const provider of AGENT_PROVIDERS) {
      const selection = parseModelSelection(rawModels[provider]);
      if (selection) models[provider] = selection;
    }
    return {
      ...(isAgentMode(parsed.mode) ? { mode: parsed.mode } : {}),
      ...(AGENT_PROVIDERS.includes(parsed.provider as AgentProvider) ? { provider: parsed.provider as AgentProvider } : {}),
      ...(Object.keys(models).length ? { models } : {}),
      ...(INSTRUCTION_CHOICES.includes(parsed.instructions as GlobalInstructionsChoice)
        ? { instructions: parsed.instructions as GlobalInstructionsChoice } : {}),
    };
  } catch {
    return {};
  }
}

export function serializeDevicePreferences(preferences: DevicePreferences): string {
  return JSON.stringify({ version: 1, ...preferences });
}

/** The modes a New session form may offer for this provider and execution. */
export function launchModes(supportedModes: readonly AgentMode[] | undefined, execution: AgentExecution = 'local'): SessionLaunchMode[] {
  return SESSION_LAUNCH_MODES.filter((mode) => supportedModes?.includes(mode) && (mode !== 'auto' || execution === 'local'));
}

/**
 * The mode of a session without its own: this device's last mode, or Ask. Docker Agent edits without
 * individual approvals, so a Docker session never inherits Agent; it has to be chosen there.
 * Auto is inherited only for Local execution; readiness still controls whether it can be used.
 */
export function inheritedMode(lastMode: AgentMode | undefined, execution: AgentExecution | undefined): SessionLaunchMode {
  const mode = lastMode && (isLaunchMode(lastMode) || lastMode === 'auto') ? lastMode : 'ask';
  return execution === 'docker' && (mode === 'agent' || mode === 'auto') ? 'ask' : mode;
}

/** The agent's own choice on this device, or else the last choice made here for its provider. */
export function agentModelSelection(
  view: Pick<DeviceViewState, 'modelSelections'> | undefined,
  preferences: DevicePreferences,
  agent: Pick<AgentParticipant, 'id' | 'provider'> | undefined,
): ModelSelection | undefined {
  if (!agent) return undefined;
  return view?.modelSelections?.[agent.id] ?? preferences.models?.[agent.provider];
}

/**
 * The Global instructions choice a New session form shows and sends: what was chosen, except that
 * Isolate gives way to Default for local Codex, which always loads its own global file.
 */
export function launchInstructions(
  choice: GlobalInstructionsChoice | undefined,
  execution: AgentExecution,
  provider: AgentProvider | undefined,
): GlobalInstructionsChoice | undefined {
  return provider && isolatesLocalCodex(choice, execution, provider) ? undefined : choice;
}

/** What a New session form names for its creation: `default` follows the machine's switch. */
export type LaunchInstructions = GlobalInstructionsChoice | 'default';

/**
 * What a form hands its creation. A choice the form had to set aside is not named at all, so the
 * session follows the machine's switch and the device keeps remembering what the user chose.
 */
export function namedLaunchInstructions(
  choice: GlobalInstructionsChoice | undefined,
  execution: AgentExecution,
  provider: AgentProvider | undefined,
): LaunchInstructions | undefined {
  return launchInstructions(choice, execution, provider) === choice ? choice ?? 'default' : undefined;
}

type LaunchChoice = { provider: AgentProvider; mode: SessionLaunchMode };

/**
 * Where a New session form opens: this device's last provider and mode when the machine can run
 * them, else what the form already shows. Accept edits and Full access open the form at Ask.
 */
export function launchChoice(
  preferences: Pick<DevicePreferences, 'provider' | 'mode'>,
  health: Partial<Record<AgentProvider, Pick<ProviderHealth, 'available' | 'supportedModes'>>> | undefined,
  current: LaunchChoice,
): LaunchChoice {
  const preferred = preferences.provider && health?.[preferences.provider];
  const provider = preferred && preferred.available && preferred.supportedModes.length ? preferences.provider! : current.provider;
  const modes = launchModes(health?.[provider]?.supportedModes);
  const lastMode = preferences.mode ? inheritedMode(preferences.mode, 'local') : undefined;
  const mode = [lastMode, current.mode].find((item) => item && modes.includes(item)) || modes[0] || current.mode;
  return { provider, mode };
}
