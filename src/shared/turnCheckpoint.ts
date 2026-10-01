import { z } from 'zod';

export const CHECKPOINT_SCOPE = 'Restore eligible checkout files to before this turn. Ignored and private files, Git history and index, external actions, and writes elsewhere in Full access are excluded. The conversation stays. Do not edit files during Undo.';

export const checkpointSummarySchema = z.object({
  id: z.string().uuid(),
  messageId: z.string().uuid(),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  state: z.enum(['ready', 'unavailable', 'undone']),
  reason: z.string().max(500).optional(),
  changedFiles: z.number().int().nonnegative(),
}).strict();
export type CheckpointSummary = z.infer<typeof checkpointSummarySchema>;

export const undoTurnRequestSchema = z.object({
  sessionId: z.string().uuid(), checkpointId: z.string().uuid(),
}).strict();
