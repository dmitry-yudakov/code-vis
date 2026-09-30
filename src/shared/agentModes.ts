import type { AgentExecution, AgentMode } from './types';

/** Every mode, in the order a picker offers them. */
export const AGENT_MODES = ['ask', 'plan', 'agent', 'auto'] as const satisfies readonly AgentMode[];

/**
 * The modes a new session or a role default may use. Auto is chosen inside a session, where the
 * checkout it may change is in view, and is never carried into another one.
 */
export const LAUNCH_MODES = ['ask', 'plan', 'agent'] as const satisfies readonly AgentMode[];
export type LaunchMode = (typeof LAUNCH_MODES)[number];

export function isAgentMode(value: unknown): value is AgentMode {
  return (AGENT_MODES as readonly unknown[]).includes(value);
}

/**
 * Whether a Local turn in this mode may change the checkout. Such a turn takes the checkout
 * exclusively in the scheduler and runs on the build budget.
 */
export function changesCheckout(mode: AgentMode): boolean {
  return mode === 'agent' || mode === 'auto';
}

/**
 * The modes a turn cannot use here. Before readiness is known (`supported` absent) nothing is
 * marked except Auto, which is offered only where it is advertised. Auto is never offered in
 * Docker, whatever readiness the session is shown with.
 */
export function unsupportedModes(supported: readonly AgentMode[] | undefined, execution: AgentExecution = 'local'): AgentMode[] {
  return AGENT_MODES.filter((mode) => (supported ? !supported.includes(mode) : mode === 'auto')
    || (mode === 'auto' && execution === 'docker'));
}
