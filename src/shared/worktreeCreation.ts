import { z } from 'zod';

/** Public admission details: no checkout paths, provider keys or command/status text. */
export const worktreeCreationConflictSchema = z.object({
  machineId: z.string().uuid(),
  sourceCheckoutId: z.string().min(1).max(128).optional(),
  kind: z.enum(['maintenance', 'creation', 'turn', 'recovery', 'git-read']),
  blockingTurns: z.array(z.object({
    sessionId: z.string().uuid(), runId: z.string().uuid().optional(),
    state: z.enum(['preparing', 'queued', 'running', 'needs-you']),
  }).strict()).max(8).optional(),
  additionalTurns: z.number().int().min(1).max(40).optional(),
}).strict();

export type WorktreeCreationConflict = z.infer<typeof worktreeCreationConflictSchema>;
