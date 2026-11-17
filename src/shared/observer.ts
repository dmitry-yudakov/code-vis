import { z } from 'zod';
import { MAX_DRAFT_LENGTH } from './voice';

export const observerTargetSchema = z.object({ machineId: z.string().uuid(), sessionId: z.string().uuid() }).strict();
export const observerProposalSchema = observerTargetSchema.extend({ text: z.string().trim().min(1).max(MAX_DRAFT_LENGTH) });
export const observerAnswerSchema = z.object({
  answer: z.string().trim().min(1).max(4000),
  inspect: observerTargetSchema.optional(),
  proposal: observerProposalSchema.optional(),
  mentions: z.array(observerTargetSchema).max(8).default([]),
}).strict().refine(value => !(value.inspect && value.proposal));
export const observerRequestSchema = z.object({
  text: z.string().trim().min(1).max(MAX_DRAFT_LENGTH),
  provider: z.enum(['claude', 'codex']),
  model: z.string().min(1).max(200).optional(),
  effort: z.string().min(1).max(40).optional(),
  offset: z.number().int().min(0).max(9000).default(0),
  focus: z.string().max(8000).optional(),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(4000) }).strict()).max(6).default([]),
}).strict();
export type ObserverTarget = z.infer<typeof observerTargetSchema>;
export type ObserverProposal = z.infer<typeof observerProposalSchema>;
export type ObserverAnswer = z.infer<typeof observerAnswerSchema>;
export type ObserverRequest = z.infer<typeof observerRequestSchema>;
export interface ObserverResult extends Omit<ObserverAnswer, 'inspect'> {
  observedAt: string;
  total: number;
  included: number;
  nextOffset?: number;
}

/** Model output can name only sessions supplied by this inference's authoritative context. */
export function parseObserverAnswer(text: string, context: { rows: ObserverTarget[] }): ObserverAnswer | undefined {
  try {
    if (new TextEncoder().encode(text).length > 8192) return undefined;
    const parsed = observerAnswerSchema.safeParse(JSON.parse(text));
    if (!parsed.success) return undefined;
    const value = parsed.data;
    const known = (target: ObserverTarget) => context.rows.some(row => row.machineId === target.machineId && row.sessionId === target.sessionId);
    if ([value.inspect, value.proposal, ...value.mentions].some(target => target && !known(target))) return undefined;
    return value;
  } catch { return undefined; }
}
