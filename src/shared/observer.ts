import { z } from 'zod';
import { MAX_DRAFT_LENGTH } from './voice';

export const observerTargetSchema = z.object({ machineId: z.string().uuid(), sessionId: z.string().uuid() }).strict();
export const observerProposalSchema = observerTargetSchema.extend({ text: z.string().trim().min(1).max(MAX_DRAFT_LENGTH) });
const runTargetSchema = observerTargetSchema.extend({ runId: z.string().uuid() });
export const observerActionSchema = z.discriminatedUnion('kind', [
  runTargetSchema.extend({ kind: z.literal('permission'), requestId: z.string().uuid(), decision: z.enum(['allow', 'deny']) }),
  runTargetSchema.extend({ kind: z.literal('cancel-turn') }),
  runTargetSchema.extend({ kind: z.literal('edit-queued'), text: z.string().trim().min(1).max(MAX_DRAFT_LENGTH) }),
  z.object({ kind: z.literal('build-and-restart') }).strict(),
]);
export const observerAnswerSchema = z.object({
  answer: z.string().trim().min(1).max(4000),
  inspect: observerTargetSchema.optional(),
  proposal: observerProposalSchema.optional(),
  action: observerActionSchema.optional(),
  mentions: z.array(observerTargetSchema).max(8).default([]),
}).strict().refine(value => [value.inspect, value.proposal, value.action].filter(Boolean).length <= 1);
export const observerRequestSchema = z.object({
  text: z.string().trim().min(1).max(MAX_DRAFT_LENGTH),
  provider: z.enum(['claude', 'codex']),
  model: z.string().min(1).max(200).optional(),
  effort: z.string().min(1).max(40).optional(),
  offset: z.number().int().min(0).max(9000).default(0),
  focus: z.string().max(8000).optional(),
  pending: observerProposalSchema.optional(),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(4000) }).strict()).max(6).default([]),
}).strict();
export type ObserverTarget = z.infer<typeof observerTargetSchema>;
export type ObserverProposal = z.infer<typeof observerProposalSchema>;
export type ObserverAction = z.infer<typeof observerActionSchema>;
export type ObserverAnswer = z.infer<typeof observerAnswerSchema>;
export type ObserverRequest = z.infer<typeof observerRequestSchema>;
export interface ObserverResult extends Omit<ObserverAnswer, 'inspect'> {
  observedAt: string;
  total: number;
  included: number;
  nextOffset?: number;
}

/** Model output can name only sessions supplied by this inference's authoritative context. */
export function parseObserverAnswer(text: string, context: { rows: Array<ObserverTarget & {
  runId?: string; state?: string; pending?: Array<{ requestId: string }>;
}> }): ObserverAnswer | undefined {
  try {
    if (new TextEncoder().encode(text).length > 8192) return undefined;
    const parsed = observerAnswerSchema.safeParse(JSON.parse(text));
    if (!parsed.success) return undefined;
    const value = parsed.data;
    const known = (target: ObserverTarget) => context.rows.some(row => row.machineId === target.machineId && row.sessionId === target.sessionId);
    if ([value.inspect, value.proposal, ...value.mentions].some(target => target && !known(target))) return undefined;
    if (value.action && value.action.kind !== 'build-and-restart') {
      const action = value.action;
      const row = context.rows.find(row => row.machineId === action.machineId && row.sessionId === action.sessionId);
      if (!row || row.state === 'offline' || row.runId !== action.runId) return undefined;
      if (action.kind === 'permission' && !row.pending?.some(p => p.requestId === action.requestId)) return undefined;
      if (action.kind === 'edit-queued' && row.state !== 'queued') return undefined;
    }
    return value;
  } catch { return undefined; }
}
