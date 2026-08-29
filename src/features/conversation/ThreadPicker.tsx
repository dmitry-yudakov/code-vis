'use client';

import { useRef } from 'react';
import type { AgentProvider, ChatThread } from '@/shared/types';
import { findAgentParticipant, PROVIDER_LABELS } from '@/shared/participants';

export function ThreadPicker({ threads, value, disabled, providers, newProvider, onChange, onNewProvider, onNew }: {
  threads: ChatThread[];
  value?: string;
  disabled?: boolean;
  providers: AgentProvider[];
  newProvider: AgentProvider;
  onChange(value: string): void;
  onNewProvider(value: AgentProvider): void;
  onNew(provider: AgentProvider): void;
}) {
  const newConversationMenu = useRef<HTMLDetailsElement>(null);
  const newConversationDisabled = Boolean(disabled || !providers.length);

  return (
    <div className="thread-picker">
      <label className="breadcrumb-select">
        <span className="sr-only">Conversation</span>
        <select
          aria-label="Conversation"
          value={value || ''}
          disabled={disabled || !threads.length}
          onChange={(event) => onChange(event.target.value)}
        >
          {!threads.length && <option value="">None yet</option>}
          {threads.map((thread) => (
            <option value={thread.id} key={thread.id}>
              {findAgentParticipant(thread.participants, thread.primaryAgentId)?.displayName || 'Agent'} · {thread.title}
            </option>
          ))}
        </select>
      </label>
      <details className="new-thread-menu" ref={newConversationMenu}>
        <summary
          role="button"
          aria-label="New conversation"
          aria-disabled={newConversationDisabled}
          onClick={(event) => { if (newConversationDisabled) event.preventDefault(); }}
        >
          ＋
        </summary>
        <div>
          <label>
            <span>New conversation with</span>
            <select
              aria-label="New conversation provider"
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
              if (newConversationMenu.current) newConversationMenu.current.open = false;
            }}
          >
            Start conversation
          </button>
        </div>
      </details>
    </div>
  );
}
