import type { AgentMode, AgentParticipant, AgentProvider, AgentRole, HumanParticipant, Participant } from './types';

export const AGENT_ROLES: readonly AgentRole[] = ['orchestrator', 'coder', 'reviewer', 'tester', 'custom'];

export const AGENT_ROLE_LABELS: Record<AgentRole, string> = {
  orchestrator: 'Orchestrator',
  coder: 'Coder',
  reviewer: 'Reviewer',
  tester: 'Tester',
  custom: 'Custom',
};

export const AGENT_ROLE_DEFAULT_MODES: Record<AgentRole, AgentMode> = {
  orchestrator: 'plan',
  coder: 'plan',
  reviewer: 'ask',
  tester: 'ask',
  custom: 'ask',
};

export const PROVIDER_LABELS: Record<AgentProvider, string> = { claude: 'Claude', codex: 'Codex' };

export function humanParticipantId(threadId: string): string {
  return `${threadId}:human`;
}

export function legacyAgentParticipantId(threadId: string): string {
  return `${threadId}:agent:primary`;
}

export function legacyParticipants(threadId: string, provider: AgentProvider): Participant[] {
  const human: HumanParticipant = { id: humanParticipantId(threadId), kind: 'human', displayName: 'You' };
  const agent: AgentParticipant = {
    id: legacyAgentParticipantId(threadId),
    kind: 'agent',
    displayName: PROVIDER_LABELS[provider],
    provider,
    role: 'coder',
    // Existing single-provider conversations were Ask-first; keep that behavior on migration.
    defaultMode: 'ask',
  };
  return [human, agent];
}

export function findAgentParticipant(participants: readonly Participant[], id?: string): AgentParticipant | undefined {
  const participant = participants.find((item) => item.id === id);
  return participant?.kind === 'agent' ? participant : undefined;
}
