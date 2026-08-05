import type { ResolvedAgentPolicy } from '@/lib/shared/types';
import type { Web2Config } from './config';

export function resolveAgentPolicy(config: Web2Config): ResolvedAgentPolicy {
  return Object.freeze({
    profile: 'conversation-readonly' as const,
    tools: ['Read', 'Glob', 'Grep'] as const,
    permissionMode: 'plan' as const,
    safeMode: true as const,
    sessionPersistence: true as const,
    maxTurns: config.agentMaxTurns,
    timeoutMs: config.agentTimeoutMs,
  });
}
