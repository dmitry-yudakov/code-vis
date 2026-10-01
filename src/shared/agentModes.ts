import type { AgentExecution, AgentMode, SecurityLevel } from './types';

/** Every mode, in the order a picker offers them. */
export const AGENT_MODES = ['ask', 'plan', 'agent', 'edits', 'auto', 'full'] as const satisfies readonly AgentMode[];

/**
 * The modes a new session or a role default may use. Extra writing modes are chosen inside a
 * session, where the checkout is in view, and are never carried into another one.
 */
export const LAUNCH_MODES = ['ask', 'plan', 'agent'] as const satisfies readonly AgentMode[];
export type LaunchMode = (typeof LAUNCH_MODES)[number];
export function isLaunchMode(mode: AgentMode): mode is LaunchMode {
  return (LAUNCH_MODES as readonly AgentMode[]).includes(mode);
}

export function isAgentMode(value: unknown): value is AgentMode {
  return (AGENT_MODES as readonly unknown[]).includes(value);
}

/**
 * Whether a Local turn in this mode may change the checkout. Such a turn takes the checkout
 * exclusively in the scheduler and runs on the build budget.
 */
export function changesCheckout(mode: AgentMode): boolean {
  return mode === 'agent' || mode === 'edits' || mode === 'auto' || mode === 'full';
}

/** An unavailable choice may fall back only to read-only modes, even if only Full is ready. */
export function composerMode(stored: AgentMode, unsupported: readonly AgentMode[]): AgentMode {
  if (!unsupported.includes(stored)) return stored;
  return (['ask', 'plan'] as const).find((mode) => !unsupported.includes(mode)) || 'ask';
}

/** Agent and Auto need a level on their record; the other Native modes name themselves. */
export function nativeMessageLevel(mode: AgentMode, level: SecurityLevel): 'native' | undefined {
  return level === 'native' && (mode === 'agent' || mode === 'auto') ? 'native' : undefined;
}

export function isNativeMessage(message: { mode?: unknown; level?: unknown }): boolean {
  return message.level === 'native' || message.mode === 'edits' || message.mode === 'full';
}

/**
 * The modes a turn cannot use here. Before readiness is known (`supported` absent) nothing is
 * marked except Auto, which is offered only where it is advertised. Auto is never offered in
 * Docker, whatever readiness the session is shown with.
 */
export function unsupportedModes(supported: readonly AgentMode[] | undefined, execution: AgentExecution = 'local'): AgentMode[] {
  return AGENT_MODES.filter((mode) => (supported ? !supported.includes(mode) : !isLaunchMode(mode))
    || (!isLaunchMode(mode) && execution === 'docker'));
}
