'use client';

import { useRef } from 'react';
import type { AgentProvider, SessionSnapshot } from '@/shared/types';
import { findAgentParticipant, PROVIDER_LABELS } from '@/shared/participants';

export function SessionPicker({ sessions, value, disabled, providers, newProvider, onChange, onNewProvider, onNew }: {
  sessions: SessionSnapshot[];
  value?: string;
  disabled?: boolean;
  providers: AgentProvider[];
  newProvider: AgentProvider;
  onChange(value: string): void;
  onNewProvider(value: AgentProvider): void;
  onNew(provider: AgentProvider): void;
}) {
  const newSessionMenu = useRef<HTMLDetailsElement>(null);
  const newSessionDisabled = Boolean(disabled || !providers.length);

  return (
    <div className="session-picker">
      <label className="breadcrumb-select">
        <span className="sr-only">Session</span>
        <select
          aria-label="Session"
          value={value || ''}
          disabled={disabled || !sessions.length}
          onChange={(event) => onChange(event.target.value)}
        >
          {!sessions.length && <option value="">No sessions yet</option>}
          {sessions.map((session) => (
            <option value={session.id} key={session.id}>
              {findAgentParticipant(session.participants, session.primaryAgentId)?.displayName || 'Agent'} · {session.title}
            </option>
          ))}
        </select>
      </label>
      <details className="new-session-menu" ref={newSessionMenu}>
        <summary
          role="button"
          aria-label="New session"
          aria-disabled={newSessionDisabled}
          onClick={(event) => { if (newSessionDisabled) event.preventDefault(); }}
        >
          ＋
        </summary>
        <div>
          <label>
            <span>New session with</span>
            <select
              aria-label="New session provider"
              value={providers.includes(newProvider) ? newProvider : ''}
              disabled={disabled || !providers.length}
              onChange={(event) => onNewProvider(event.target.value as AgentProvider)}
            >
              {!providers.length && <option value="">No provider</option>}
              {providers.map((provider) => <option value={provider} key={provider}>{PROVIDER_LABELS[provider]}</option>)}
            </select>
          </label>
          <button
            type="button"
            disabled={disabled || !providers.length}
            onClick={() => {
              onNew(newProvider);
              if (newSessionMenu.current) newSessionMenu.current.open = false;
            }}
          >
            Start session
          </button>
        </div>
      </details>
    </div>
  );
}
