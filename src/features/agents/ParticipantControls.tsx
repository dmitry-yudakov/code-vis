'use client';

import { useId, useState } from 'react';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import NativeSelect from '@mui/material/NativeSelect';
import Typography from '@mui/material/Typography';

import type { AgentMode, AgentParticipant, AgentProvider, AgentRole } from '@/shared/types';
import { DesktopPopover } from '@/features/shell/DesktopPopover';
import type { DevicePreferences } from '@/features/shell/devicePreferences';
import { AGENT_ROLES, AGENT_ROLE_LABELS } from '@/shared/participants';
import { ContextUsage } from './ContextUsage';
import { ProviderChips } from './ProviderChips';

const HANDOFF_PROMPTS: Record<AgentRole, string> = {
  orchestrator: 'Synthesize the conversation above into a concrete next-step plan. Call out unresolved decisions, dependencies, and risks.',
  coder: 'Address the latest findings or agreed plan above. In this mode, make only the changes you are allowed to make and explain how to verify them.',
  reviewer: 'Review the latest proposal or changes above. Lead with prioritized, evidence-backed issues, regressions, and missing tests.',
  tester: 'Verify the latest claims or changes above. Report what is proven, what fails, and what remains untested.',
  custom: 'Give an independent assessment of the latest work above and recommend the next concrete action.',
};

export function ParticipantControls({
  agents, activeAgentId, primaryAgentId, providers, disabled, busy,
  choice, onChoiceChange, onSelect, onMakePrimary, onAdd, onHandoff,
}: {
  agents: AgentParticipant[];
  activeAgentId?: string;
  primaryAgentId?: string;
  providers: AgentProvider[];
  disabled?: boolean;
  busy?: boolean;
  choice: Pick<DevicePreferences, 'provider' | 'role'>;
  onChoiceChange(change: Pick<DevicePreferences, 'provider' | 'role'>): void;
  onSelect(participantId: string): void;
  onMakePrimary(participantId: string): void;
  onAdd(provider: AgentProvider, role: AgentRole): void;
  onHandoff(participantId: string, text: string, mode: AgentMode): void;
}) {
  const [adding, setAdding] = useState(false);
  const addFormId = useId();
  const role = choice.role ?? 'reviewer';
  const selected = agents.find((agent) => agent.id === activeAgentId) || agents[0];
  const quickAgents = agents.filter((agent) => agent.id !== selected?.id);
  const safeProvider = choice.provider && providers.includes(choice.provider) ? choice.provider : providers[0];

  return <div className="participant-controls">
    <DesktopPopover className="agent-menu" label="Session agents" summary={`@${selected?.displayName || 'Agent'} ▾`} disabled={disabled || busy}
      onOpenChange={open => { if (!open) setAdding(false); }}>
      {(close) => <div className="participant-menu">
        <Box component="section" aria-label="Next message to">
          <Typography variant="caption" color="text.secondary">Next message to</Typography>
          <div className="participant-row">
            {agents.map(agent => <Button key={agent.id} aria-pressed={agent.id === selected?.id}
              variant={agent.id === selected?.id ? 'contained' : 'text'}
              sx={{ justifyContent: 'flex-start', textAlign: 'left', gap: 1 }}
              onClick={() => { onSelect(agent.id); close(); }}>
              <Box component="span" sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
                @{agent.displayName}<Typography component="span" variant="caption" sx={{ display: 'block', opacity: 0.8 }}>{AGENT_ROLE_LABELS[agent.role]}</Typography>
              </Box>
              {agent.id === primaryAgentId && <Chip component="span" label="Main" sx={{ color: 'inherit' }} />}
              {agent.id === selected?.id && <span aria-hidden="true">✓</span>}
            </Button>)}
          </div>
          {selected && selected.id !== primaryAgentId && <Button variant="text" onClick={() => { onMakePrimary(selected.id); close(); }}>Make @{selected.displayName} the main agent</Button>}
        </Box>
        {quickAgents.length > 0 && <>
          <Divider />
          <Box component="section" aria-label="Draft a message">
            <Typography variant="caption" color="text.secondary">Draft a message</Typography>
            {quickAgents.map(agent => <Button key={agent.id} variant="text" sx={{ justifyContent: 'flex-start', textAlign: 'left', width: '100%' }}
              title="Prefill only — edit before sending" onClick={() => { onHandoff(agent.id, HANDOFF_PROMPTS[agent.role], agent.defaultMode); close(); }}>
              {agent.role === 'reviewer' ? 'Review this' : agent.role === 'tester' ? 'Verify this' : 'What next?'} → @{agent.displayName}
            </Button>)}
          </Box>
        </>}
        <Divider />
        <Button variant="text" sx={{ justifySelf: 'start' }} aria-expanded={adding} aria-controls={adding ? addFormId : undefined}
          onClick={() => setAdding(current => !current)}>Add participant</Button>
        {adding && <Box component="section" id={addFormId} className="participant-add-form" aria-label="Add participant">
          <ProviderChips value={safeProvider} available={providers} onChange={provider => onChoiceChange({ provider })} />
          <label>Role<NativeSelect inputProps={{ 'aria-label': 'Role' }} value={role} onChange={event => onChoiceChange({ role: event.target.value as AgentRole })}>
            {AGENT_ROLES.map(item => <option key={item} value={item}>{AGENT_ROLE_LABELS[item]}</option>)}
          </NativeSelect></label>
          <Button variant="contained" disabled={!safeProvider} onClick={() => { if (safeProvider) onAdd(safeProvider, role); close(); }}>Add agent</Button>
        </Box>}
      </div>}
    </DesktopPopover>
    {selected && <ContextUsage name={selected.displayName} usage={selected.contextUsage} />}
  </div>;
}
