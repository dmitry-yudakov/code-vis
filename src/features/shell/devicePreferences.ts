import type { AgentExecution, AgentMode, AgentParticipant, AgentProvider, ModelSelection, ProviderHealth } from '@/shared/types';
import { LAUNCH_MODES, isAgentMode, type LaunchMode } from '@/shared/agentModes';
import { parseModelSelection, type DeviceViewState } from './workspaceViews';

export const DEVICE_PREFERENCES_STORAGE_KEY = 'code-ai:device:v1:preferences';

const AGENT_PROVIDERS: readonly AgentProvider[] = ['claude', 'codex'];

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
    };
  } catch {
    return {};
  }
}

export function serializeDevicePreferences(preferences: DevicePreferences): string {
  return JSON.stringify({ version: 1, ...preferences });
}

/** The modes a New session form may offer: what the provider supports, never Auto. */
export function launchModes(supportedModes: readonly AgentMode[] | undefined): LaunchMode[] {
  return LAUNCH_MODES.filter((mode) => supportedModes?.includes(mode));
}

/**
 * The mode of a session without its own: this device's last mode, or Ask. Docker Agent edits without
 * individual approvals, so a Docker session never inherits Agent; it has to be chosen there. Auto
 * edits without individual approvals too, so no session inherits it: it is chosen in the session.
 */
export function inheritedMode(lastMode: AgentMode | undefined, execution: AgentExecution | undefined): LaunchMode {
  return !lastMode || lastMode === 'auto' || (lastMode === 'agent' && execution === 'docker') ? 'ask' : lastMode;
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

type LaunchChoice = { provider: AgentProvider; mode: LaunchMode };

/**
 * Where a New session form opens: this device's last provider and mode when the machine can run
 * them, else what the form already shows. A last mode of Auto opens the form at Ask.
 */
export function launchChoice(
  preferences: Pick<DevicePreferences, 'provider' | 'mode'>,
  health: Partial<Record<AgentProvider, Pick<ProviderHealth, 'available' | 'supportedModes'>>> | undefined,
  current: LaunchChoice,
): LaunchChoice {
  const preferred = preferences.provider && health?.[preferences.provider];
  const provider = preferred && preferred.available && preferred.supportedModes.length ? preferences.provider! : current.provider;
  const modes = launchModes(health?.[provider]?.supportedModes);
  const lastMode = preferences.mode === 'auto' ? 'ask' : preferences.mode;
  const mode = [lastMode, current.mode].find((item) => item && modes.includes(item)) || modes[0] || current.mode;
  return { provider, mode };
}
