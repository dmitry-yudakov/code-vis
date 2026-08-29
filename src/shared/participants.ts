import type { AgentMode, AgentParticipant, AgentProvider, AgentRole, Participant } from './types';

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

export function humanParticipantId(sessionId: string): string {
  return `${sessionId}:human`;
}

export function findAgentParticipant(participants: readonly Participant[], id?: string): AgentParticipant | undefined {
  const participant = participants.find((item) => item.id === id);
  return participant?.kind === 'agent' ? participant : undefined;
}
