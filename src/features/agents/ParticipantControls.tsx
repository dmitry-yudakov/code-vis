'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { AgentMode, AgentParticipant, AgentProvider, AgentRole } from '@/shared/types';
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
  const addMenuRef = useRef<HTMLDetailsElement>(null);
  const [provider, setProvider] = useState<AgentProvider>(providers[0] || 'claude');
  const [role, setRole] = useState<AgentRole>('reviewer');
  const selected = agents.find((agent) => agent.id === activeAgentId) || agents[0];
  const quickAgents = useMemo(() => agents.filter((agent) => agent.id !== selected?.id), [agents, selected?.id]);
  const safeProvider = providers.includes(provider) ? provider : providers[0];

  useEffect(() => {
    const close = (event: Event) => {
      const menu = addMenuRef.current;
      if (!menu?.open) return;
      if (event.type === 'keydown' && (event as KeyboardEvent).key === 'Escape') {
        menu.removeAttribute('open');
        (menu.querySelector('summary') as HTMLElement | null)?.focus();
      } else if (event.type === 'pointerdown' && !menu.contains(event.target as Node)) {
        menu.removeAttribute('open');
      }
    };
    document.addEventListener('keydown', close);
    document.addEventListener('pointerdown', close);
    return () => {
      document.removeEventListener('keydown', close);
      document.removeEventListener('pointerdown', close);
    };
  }, []);

  const addParticipant = () => {
    if (!safeProvider) return;
    addMenuRef.current?.removeAttribute('open');
    onAdd(safeProvider, role);
  };

  return (
    <div className="participant-controls">
      <div className="participant-row" aria-label="Session agents">
        {agents.map((agent) => (
          <button
            type="button"
            key={agent.id}
            className={`participant-chip ${agent.id === selected?.id ? 'active' : ''}`}
            aria-pressed={agent.id === selected?.id}
            disabled={disabled}
            title={`${PROVIDER_LABELS[agent.provider]} · ${AGENT_ROLE_LABELS[agent.role]}${agent.id === primaryAgentId ? ' · main agent' : ''}`}
            onClick={() => onSelect(agent.id)}
          >
            <span>@{agent.displayName}</span>
            <small>{AGENT_ROLE_LABELS[agent.role]}{agent.id === primaryAgentId ? ' · Main' : ''}</small>
          </button>
        ))}
        <details ref={addMenuRef} className="add-agent-menu">
          <summary aria-label="Add agent">＋ Agent</summary>
          <div>
            <label>Provider
              <select value={safeProvider} disabled={disabled || busy || !providers.length} onChange={(event) => setProvider(event.target.value as AgentProvider)}>
                {providers.map((item) => <option key={item} value={item}>{PROVIDER_LABELS[item]}</option>)}
              </select>
            </label>
            <label>Role
              <select value={role} disabled={disabled || busy} onChange={(event) => setRole(event.target.value as AgentRole)}>
                {AGENT_ROLES.map((item) => <option key={item} value={item}>{AGENT_ROLE_LABELS[item]}</option>)}
              </select>
            </label>
            <button type="button" disabled={disabled || busy || !safeProvider} onClick={addParticipant}>
              {busy ? 'Adding…' : 'Add participant'}
            </button>
          </div>
        </details>
      </div>
      {selected && selected.id !== primaryAgentId && (
        <button type="button" className="make-main-action" disabled={disabled || busy} onClick={() => onMakePrimary(selected.id)}>
          Make @{selected.displayName} the main agent
        </button>
      )}
      {quickAgents.length > 0 && (
        <div className="handoff-actions" aria-label="Quick handoffs">
          {quickAgents.map((agent) => (
            <button
              type="button"
              key={agent.id}
              disabled={disabled}
              title="Prefill only — you can edit before sending"
              onClick={() => onHandoff(agent.id, HANDOFF_PROMPTS[agent.role], agent.defaultMode)}
            >
              @{agent.displayName} · {agent.role === 'reviewer' ? 'Review this' : agent.role === 'tester' ? 'Verify this' : agent.role === 'coder' ? 'Take next step' : 'What next?'}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
