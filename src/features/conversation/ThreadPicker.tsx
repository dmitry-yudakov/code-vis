'use client';

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
  return (
    <div className="thread-picker">
      <label className="compact-select">
        <span>Conversation</span>
        <select value={value || ''} disabled={disabled || !threads.length} onChange={(event) => onChange(event.target.value)}>
          {!threads.length && <option value="">None yet</option>}
          {threads.map((thread) => (
            <option value={thread.id} key={thread.id}>
              {findAgentParticipant(thread.participants, thread.primaryAgentId)?.displayName || 'Agent'} · {thread.title}
            </option>
          ))}
        </select>
      </label>
      <label className="compact-select provider-select">
        <span>New with</span>
        <select
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
        className="new-thread-button"
        disabled={disabled || !providers.length}
        onClick={() => onNew(newProvider)}
      >
        ＋ New
      </button>
    </div>
  );
}
