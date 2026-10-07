import { z } from 'zod';
import { agentProviderSchema, agentRoleSchema } from './protocol';
import { globalInstructionsChoiceSchema } from './sessionSchema';

export const CODEAI_SESSION_PATH = '/api/codeai-session';
export const preparedCodeAiContextSchema = z.object({
  projectId: z.string().uuid(), checkoutId: z.string().min(1).max(128),
  bindingsFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();
export type PreparedCodeAiContext = z.infer<typeof preparedCodeAiContextSchema>;
export type CodeAiSessionAvailability = { available: false; reason: 'not-managed' | 'checkout-unavailable'; message?: string }
  | { available: true; machineId: string; phase: 'idle' | 'building' | 'restarting'; checkoutId: string; checkoutName: string };

export const codeAiSessionRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('prepare') }).strict(),
  z.object({
    action: z.literal('create'), preparedContext: preparedCodeAiContextSchema,
    provider: agentProviderSchema, role: agentRoleSchema.optional(), instructions: globalInstructionsChoiceSchema.optional(),
    checkoutMode: z.enum(['current', 'worktree']).optional(), creationRequestId: z.string().uuid(),
  }).strict(),
]);
