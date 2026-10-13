'use client';

import Button from '@mui/material/Button';
import NativeSelect from '@mui/material/NativeSelect';

import { useMemo, useState } from 'react';
import type { AgentMode, AgentParticipant, AgentProvider, AgentRole } from '@/shared/types';
import { DesktopPopover } from '@/features/shell/DesktopPopover';
import { AGENT_ROLES, AGENT_ROLE_LABELS, PROVIDER_LABELS } from '@/shared/participants';

const HANDOFF_PROMPTS: Record<AgentRole, string> = {
  orchestrator: 'Synthesize the conversation above into a concrete next-step plan. Call out unresolved decisions, dependencies, and risks.',
  coder: 'Address the latest findings or agreed plan above. In this mode, make only the changes you are allowed to make and explain how to verify them.',
  reviewer: 'Review the latest proposal or changes above. Lead with prioritized, evidence-backed issues, regressions, and missing tests.',
  tester: 'Verify the latest claims or changes above. Report what is proven, what fails, and what remains untested.',
  custom: 'Give an independent assessment of the latest work above and recommend the next concrete action.',
};

export function ParticipantControls({
  agents, activeAgentId, primaryAgentId, providers, disabled, busy,
  onSelect, onMakePrimary, onAdd, onHandoff,
}: {
  agents: AgentParticipant[];
  activeAgentId?: string;
  primaryAgentId?: string;
  providers: AgentProvider[];
  disabled?: boolean;
  busy?: boolean;
  onSelect(participantId: string): void;
  onMakePrimary(participantId: string): void;
  onAdd(provider: AgentProvider, role: AgentRole): void;
  onHandoff(participantId: string, text: string, mode: AgentMode): void;
}) {
  const [provider, setProvider] = useState<AgentProvider>(providers[0] || 'claude');
  const [role, setRole] = useState<AgentRole>('reviewer');
  const selected = agents.find((agent) => agent.id === activeAgentId) || agents[0];
  const quickAgents = useMemo(() => agents.filter((agent) => agent.id !== selected?.id), [agents, selected?.id]);
  const safeProvider = providers.includes(provider) ? provider : providers[0];


  const addParticipant = () => {
    if (!safeProvider) return;
    onAdd(safeProvider, role);
  };

  return (
    <div className="participant-controls">
      <div className="participant-row" aria-label="Session agents">
        {agents.map((agent) => (
          <Button
            type="button"
            key={agent.id}
            className={`participant-chip ${agent.id === selected?.id ? 'active' : ''}`}
            aria-pressed={agent.id === selected?.id}
            variant={agent.id === selected?.id ? 'contained' : 'outlined'}
            disabled={disabled}
            title={`${PROVIDER_LABELS[agent.provider]} · ${AGENT_ROLE_LABELS[agent.role]}${agent.id === primaryAgentId ? ' · main agent' : ''}`}
            onClick={() => onSelect(agent.id)}
          >
            <span>@{agent.displayName}</span>
            <small>{AGENT_ROLE_LABELS[agent.role]}{agent.id === primaryAgentId ? ' · Main' : ''}</small>
          </Button>
        ))}
        <DesktopPopover className="add-agent-menu" anchorSelector=".participant-controls" label="Add agent" summary="＋ Agent" disabled={disabled}>
          {(close) => <div className="participant-add-form">
            <label>Provider
              <NativeSelect value={safeProvider} disabled={disabled || busy || !providers.length} onChange={(event) => setProvider(event.target.value as AgentProvider)}>
                {providers.map((item) => <option key={item} value={item}>{PROVIDER_LABELS[item]}</option>)}
              </NativeSelect>
            </label>
            <label>Role
              <NativeSelect value={role} disabled={disabled || busy} onChange={(event) => setRole(event.target.value as AgentRole)}>
                {AGENT_ROLES.map((item) => <option key={item} value={item}>{AGENT_ROLE_LABELS[item]}</option>)}
              </NativeSelect>
            </label>
            <Button type="button" disabled={disabled || busy || !safeProvider} onClick={() => { close(); addParticipant(); }}>
              {busy ? 'Adding…' : 'Add participant'}
            </Button>
          </div>}
        </DesktopPopover>
      </div>
      {selected && selected.id !== primaryAgentId && (
        <Button type="button" className="make-main-action" disabled={disabled || busy} onClick={() => onMakePrimary(selected.id)}>
          Make @{selected.displayName} the main agent
        </Button>
      )}
      {quickAgents.length > 0 && (
        <div className="handoff-actions" aria-label="Quick handoffs">
          {quickAgents.map((agent) => (
            <Button
              type="button"
              key={agent.id}
              disabled={disabled}
              title="Prefill only — you can edit before sending"
              onClick={() => onHandoff(agent.id, HANDOFF_PROMPTS[agent.role], agent.defaultMode)}
            >
              @{agent.displayName} · {agent.role === 'reviewer' ? 'Review this' : agent.role === 'tester' ? 'Verify this' : agent.role === 'coder' ? 'Take next step' : 'What next?'}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
