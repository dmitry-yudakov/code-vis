import { useRef } from 'react';
import { createUuid } from '@/shared/uuid';
import { WORKTREE_BASELINE, worktreeChoice } from './worktreeChoice';

/** Keep the identity on retries; changed choices or a deliberate new creation get a new one. */
export function useCreationRequestId() {
  const pending = useRef<{ key: string; id: string } | undefined>(undefined);
  return {
    forRequest(key: string) {
      if (pending.current?.key !== key) pending.current = { key, id: createUuid() };
      return pending.current.id;
    },
    reset() { pending.current = undefined; },
  };
}

export function CheckoutChoice({ value, choice, disabled, onChange }: {
  value: 'current' | 'worktree'; choice: ReturnType<typeof worktreeChoice>; disabled?: boolean;
  onChange(value: 'current' | 'worktree'): void;
}) {
  return <>
    <label>
      <span>Checkout</span>
      <select aria-label="Session checkout" value={value} disabled={disabled}
        onChange={(event) => onChange(event.target.value as 'current' | 'worktree')}>
        <option value="current">Use current checkout</option>
        <option value="worktree" disabled={!choice.available}>Create a worktree</option>
      </select>
    </label>
    {choice.source && <p>Source: {choice.source.name}{choice.source.worktreeCreation?.branch ? ` · ${choice.source.worktreeCreation.branch}` : ''}</p>}
    {value === 'worktree' && <p>{WORKTREE_BASELINE}</p>}
    {choice.reason && <p role="status">{choice.reason}</p>}
    {choice.source?.worktree && value === 'current' && <p>This conversation will share the selected worktree. Use an ordinary source and Create a worktree for independent work.</p>}
  </>;
}
