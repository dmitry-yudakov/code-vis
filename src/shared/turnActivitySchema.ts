import { z } from 'zod';
import { ACTIVITY_LIMITS, serializedBytes } from './turnActivity';

const identity = z.string().min(1).max(1100);
const sequence = z.number().int().nonnegative();
const display = z.string().refine(value => new TextEncoder().encode(value).length <= ACTIVITY_LIMITS.fieldBytes, 'Display field exceeds byte limit');
export const approvalReviewSchema = z.object({
  completeness: z.enum(['complete', 'unavailable', 'unknown']),
  text: z.string().refine(value => new TextEncoder().encode(value).length <= ACTIVITY_LIMITS.reviewBytes).optional(),
  reason: display.optional(), omittedBytes: sequence.optional(),
}).strict();
const base = {
  id: identity, firstSequence: sequence, sequence, attempt: sequence, omittedBytes: sequence.optional(),
  actor: z.object({ provider: z.enum(['claude', 'codex']).optional(), name: identity.optional(), threadId: identity.optional(), parentToolId: identity.optional() }).strict().optional(),
};
export const turnEntrySchema = z.discriminatedUnion('kind', [
  z.object({ ...base, kind: z.literal('assistant'), text: z.string().refine(value => new TextEncoder().encode(value).length <= 256 * 1024), complete: z.boolean(), sourceBlockId: identity.optional(), phase: z.enum(['commentary', 'final']).optional(), canonicalMessageId: identity.optional() }).strict(),
  z.object({ ...base, kind: z.literal('tool'), tool: z.string().max(300), summary: display.optional(), input: display.optional(), output: display.optional(), diff: display.optional(), error: display.optional(), status: z.enum(['running', 'succeeded', 'failed', 'denied', 'cancelled', 'unknown']), startedAt: z.string().datetime().optional(), finishedAt: z.string().datetime().optional(), durationMs: z.number().finite().nonnegative().optional(), exitCode: z.number().int().optional() }).strict(),
  z.object({ ...base, kind: z.literal('approval'), requestId: identity, tool: z.string().max(300), summary: display, toolId: identity.optional(), state: z.enum(['pending', 'resolved']), decision: z.enum(['allow', 'deny', 'timeout', 'cancelled']).optional(), review: approvalReviewSchema.optional() }).strict(),
  z.object({ ...base, kind: z.literal('gap'), reason: display, count: sequence }).strict(),
]);
export const turnRecordSchema = z.object({
  version: z.literal(1), runId: identity, userMessageId: identity, participantId: identity, acceptedAt: z.string().datetime(),
  lifecycle: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled', 'interrupted']),
  sequence, entries: z.array(turnEntrySchema).max(ACTIVITY_LIMITS.entries), incomplete: z.boolean(), history: z.enum(['saved', 'unsaved']),
  evicted: z.string().length(8192).regex(/^[0-9a-f]+$/).optional(),
}).strict().superRefine((turn, ctx) => {
  if (serializedBytes(turn) > ACTIVITY_LIMITS.turnBytes) ctx.addIssue({ code: 'custom', message: 'Turn activity exceeds byte limit' });
  const ids = new Set<string>();
  let sequence = -1;
  for (const entry of turn.entries) {
    if (ids.has(entry.id) || entry.firstSequence < sequence || entry.sequence < entry.firstSequence || entry.sequence > turn.sequence) {
      ctx.addIssue({ code: 'custom', message: 'Activity identities and server sequences must be ordered and unique' });
      break;
    }
    sequence = entry.firstSequence; ids.add(entry.id);
  }
});
