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

  return <div className="participant-controls">
    <DesktopPopover className="agent-menu" label="Session agents" summary={`@${selected?.displayName || 'Agent'} ▾`} disabled={disabled || busy}>
      {(close) => <div className="participant-menu">
        <div className="participant-row" aria-label="Session agents">
          {agents.map(agent => <Button key={agent.id} aria-pressed={agent.id === selected?.id}
            onClick={() => { onSelect(agent.id); close(); }}>
            @{agent.displayName} · {AGENT_ROLE_LABELS[agent.role]}{agent.id === primaryAgentId ? ' · Main' : ''}
          </Button>)}
        </div>
        {selected && selected.id !== primaryAgentId && <Button onClick={() => { onMakePrimary(selected.id); close(); }}>Make @{selected.displayName} the main agent</Button>}
        {quickAgents.map(agent => <Button key={agent.id} title="Prefill only — edit before sending" onClick={() => { onHandoff(agent.id, HANDOFF_PROMPTS[agent.role], agent.defaultMode); close(); }}>
          @{agent.displayName} · {agent.role === 'reviewer' ? 'Review this' : agent.role === 'tester' ? 'Verify this' : 'What next?'}
        </Button>)}
        <div className="participant-add-form" aria-label="Add agent">
          <label>Provider<NativeSelect value={safeProvider} disabled={!providers.length} onChange={event => setProvider(event.target.value as AgentProvider)}>
            {providers.map(item => <option key={item} value={item}>{PROVIDER_LABELS[item]}</option>)}
          </NativeSelect></label>
          <label>Role<NativeSelect value={role} onChange={event => setRole(event.target.value as AgentRole)}>
            {AGENT_ROLES.map(item => <option key={item} value={item}>{AGENT_ROLE_LABELS[item]}</option>)}
          </NativeSelect></label>
          <Button disabled={!safeProvider} onClick={() => { addParticipant(); close(); }}>Add agent</Button>
        </div>
      </div>}
    </DesktopPopover>
  </div>;
}
