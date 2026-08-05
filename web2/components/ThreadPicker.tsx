'use client';

import type { ChatThread } from '@/lib/shared/types';

export function ThreadPicker({ threads, value, disabled, onChange, onNew }: {
  threads: ChatThread[];
  value?: string;
  disabled?: boolean;
  onChange(value: string): void;
  onNew(): void;
}) {
  return (
    <div className="thread-picker">
      <label className="compact-select">
        <span>Conversation</span>
        <select value={value || ''} disabled={disabled || !threads.length} onChange={(event) => onChange(event.target.value)}>
          {!threads.length && <option value="">None yet</option>}
          {threads.map((thread) => <option value={thread.id} key={thread.id}>{thread.title}</option>)}
        </select>
      </label>
      <button type="button" className="new-thread-button" disabled={disabled} onClick={onNew}>＋ New</button>
    </div>
  );
}
