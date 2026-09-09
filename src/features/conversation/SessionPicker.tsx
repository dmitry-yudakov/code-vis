'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { AgentExecution, AgentProvider, CheckoutSummary, DurableProject, ExecutionHealth, ProviderHealth, SessionSnapshot } from '@/shared/types';
import { findAgentParticipant, PROVIDER_LABELS } from '@/shared/participants';

interface SessionCreationProps {
  initialExecution?: AgentExecution;
  executionHealth?: ExecutionHealth;
  providerHealth?: Record<AgentProvider, ProviderHealth>;
  project?: DurableProject;
  checkouts: CheckoutSummary[];
  hostId?: string;
  newProvider: AgentProvider;
  creating: boolean;
  submitLabel?: string;
  error?: string;
  onNewProvider(value: AgentProvider): void;
  onNew(provider: AgentProvider, options: { execution: AgentExecution; checkoutId?: string }): Promise<boolean>;
}

export function SessionCreationForm({ initialExecution = 'local', executionHealth, providerHealth, project, checkouts, hostId,
  newProvider, creating, submitLabel = 'Start session', error, onNewProvider, onNew }: SessionCreationProps) {
  const dockerEnabled = Boolean(executionHealth?.docker.enabled);
  const [execution, setExecution] = useState<AgentExecution>(initialExecution === 'docker' && dockerEnabled ? 'docker' : 'local');
  const [checkoutId, setCheckoutId] = useState(checkouts[0]?.id || '');
  const [failed, setFailed] = useState(false);
  const selectedHealth = execution === 'docker' ? executionHealth?.docker.providers : executionHealth?.local.providers || providerHealth;
  const providers = (['claude', 'codex'] as AgentProvider[]).filter((provider) => selectedHealth?.[provider].available && selectedHealth[provider].supportedModes.length);
  const provider = providers.includes(newProvider) ? newProvider : providers[0];
  const bindings = project?.repositories || [];
  const invalidBinding = execution === 'docker' && (project
    ? bindings.length !== 1 || bindings[0].role !== 'primary' || bindings[0].hostId !== hostId
      || !checkouts.some((checkout) => checkout.id === bindings[0].checkoutId)
    : !checkouts.some((checkout) => checkout.id === checkoutId));

  useEffect(() => { if (!dockerEnabled) setExecution('local'); }, [dockerEnabled]);

  return (
    <form className="session-creation-form" aria-label="Create project session" onSubmit={(event) => {
      event.preventDefault();
      if (creating || !provider || invalidBinding) return;
      setFailed(false);
      void onNew(provider, { execution, ...(execution === 'docker' && !project ? { checkoutId } : {}) })
        .then((created) => setFailed(!created));
    }}>
      <label>
        <span>Execution</span>
        <select value={execution} disabled={creating} onChange={(event) => setExecution(event.target.value as AgentExecution)}>
          <option value="local">Local</option>
          <option value="docker" disabled={!dockerEnabled}>Docker{dockerEnabled ? '' : ' · enable in Arena'}</option>
        </select>
      </label>
      {!dockerEnabled && <Link href="/arena">Enable Docker in Arena</Link>}
      {execution === 'docker' && <p>Ask and Plan use a read-only repository. Agent edits it directly without individual approvals.</p>}
      {execution === 'docker' && !project && (
        <label>
          <span>Repository</span>
          <select value={checkoutId} disabled={creating} onChange={(event) => setCheckoutId(event.target.value)}>
            <option value="">Choose one repository</option>
            {checkouts.map((checkout) => <option key={checkout.id} value={checkout.id}>{checkout.name}</option>)}
          </select>
        </label>
      )}
      {invalidBinding && <p role="status">Docker requires exactly one primary repository on this machine. {project ? 'Update this project’s repositories to continue.' : 'Choose a repository to continue.'}</p>}
      <label>
        <span>New session with</span>
        <select aria-label="New session provider" value={provider || ''} disabled={creating || !providers.length}
          onChange={(event) => onNewProvider(event.target.value as AgentProvider)}>
          {!providers.length && <option value="">No provider available</option>}
          {providers.map((value) => <option value={value} key={value}>{PROVIDER_LABELS[value]}</option>)}
        </select>
      </label>
      {!providers.length && <p role="status">{execution === 'docker'
        ? <>{selectedHealth?.claude.message || 'Docker needs setup.'} <Link href="/arena">Open Docker setup</Link></>
        : 'Install and authenticate Claude Code or Codex for Local, or select Docker.'}</p>}
      {failed && <p role="alert">{error || 'Could not create the session. Try again.'}</p>}
      <button type="submit" disabled={creating || !provider || invalidBinding}>{creating ? 'Creating…' : submitLabel}</button>
    </form>
  );
}

export function SessionPicker({ sessions, value, onChange, ...creation }: SessionCreationProps & {
  sessions: SessionSnapshot[];
  value?: string;
  onChange(value: string): void;
}) {
  const newSessionMenu = useRef<HTMLDetailsElement>(null);
  return (
    <div className="session-picker">
      <label className="breadcrumb-select">
        <span className="sr-only">Session</span>
        <select aria-label="Session" value={value || ''} disabled={!sessions.length} onChange={(event) => onChange(event.target.value)}>
          {!sessions.length && <option value="">No sessions yet</option>}
          {sessions.map((session) => (
            <option value={session.id} key={session.id}>
              {findAgentParticipant(session.participants, session.primaryAgentId)?.displayName || 'Agent'} · {session.title} · {session.execution === 'docker' ? 'Docker' : 'Local'}
            </option>
          ))}
        </select>
      </label>
      <details className="new-session-menu" ref={newSessionMenu}>
        <summary role="button" aria-label="New session">＋</summary>
        <div>
          <SessionCreationForm {...creation} key={`${creation.project?.id || 'loose'}:${value || 'empty'}`}
            onNew={async (provider, options) => {
              const created = await creation.onNew(provider, options);
              if (created && newSessionMenu.current) newSessionMenu.current.open = false;
              return created;
            }} />
        </div>
      </details>
    </div>
  );
}
