import { worktreeCreationConflictSchema } from '@/shared/worktreeCreation';
import type { ArenaMachineSnapshot } from '@/shared/types';

/** Use the executor's catalog, including when it differs from the selected home machine. */
export function worktreeCreationError(data: { error?: string; worktreeConflict?: unknown }, machines: ArenaMachineSnapshot[]): string {
  const parsed = worktreeCreationConflictSchema.safeParse(data.worktreeConflict);
  if (!parsed.success) return data.error || 'Could not create a session.';
  const details = parsed.data;
  const machine = machines.find((entry) => entry.machine.id === details.machineId);
  const label = machine?.machine.label || 'the executing machine';
  const states = { preparing: 'preparing a turn', queued: 'queued', running: 'running', 'needs-you': 'waiting for you' };
  const turns = details.blockingTurns?.map((turn) => {
    const title = machine?.sessions.find((session) => session.id === turn.sessionId)?.title;
    return `${title ? `“${title.replaceAll(/\s+/g, ' ').trim()}”` : 'another session'} (${states[turn.state]})`;
  });
  const reasons = {
    maintenance: 'maintenance is in progress', creation: 'another worktree is being created or recovered',
    recovery: 'Undo is using this repository', 'git-read': 'a Git read is using this repository',
    turn: turns?.length ? `this repository or shared Git metadata is in use by ${turns.join(', ')}${details.additionalTurns ? `, and ${details.additionalTurns} more sessions` : ''}`
      : 'a turn is using this repository or shared Git metadata',
  };
  return `Worktree creation on ${label} is blocked: ${reasons[details.kind]}. Wait for it to finish and retry.`;
}
