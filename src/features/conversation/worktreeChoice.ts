import type { AgentExecution, CheckoutSummary, DurableProject, WorktreeCapability } from '@/shared/types';

export const WORKTREE_BASELINE = 'Start from the latest commit; uncommitted changes and local setup stay in the current checkout.';
export const WORKTREE_FIXED_BINDING = 'This session uses a managed worktree. Repository bindings are fixed; use New session to start an independent worktree.';

export function worktreeChoice({ execution = 'local', project, checkoutId, checkouts, hostId, capability }: {
  execution?: AgentExecution; project?: DurableProject; checkoutId?: string; checkouts: CheckoutSummary[];
  hostId?: string; capability?: WorktreeCapability;
}): { source?: CheckoutSummary; available: boolean; reason?: string } {
  const bindings = project?.repositories;
  const source = checkouts.find((checkout) => checkout.id === (project ? bindings?.[0]?.checkoutId : checkoutId));
  const reason = execution !== 'local' ? 'Worktree creation requires Local execution.'
    : !capability?.available ? capability?.message || 'This executing machine does not offer managed worktrees.'
    : project && (bindings?.length !== 1 || bindings[0].role !== 'primary' || bindings[0].hostId !== hostId)
      ? 'Worktree creation needs exactly one primary repository on this machine.'
    : !source ? 'Choose a source repository to create a worktree.'
    : source.worktree ? 'Choose an ordinary source checkout for a new worktree.'
    : !source.worktreeCreation?.available ? source.worktreeCreation?.message || 'This source does not support managed creation.' : undefined;
  return { source, available: !reason, reason };
}
