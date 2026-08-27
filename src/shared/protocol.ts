import { z } from 'zod';
import { MAX_MESSAGE_TEXT_CHARS } from './limits';
import {
  diagramAnnotationSchema, drawingMarkSchema, projectAttachmentSchema, sketchCanvasSchema,
} from './conversationSchema';

export {
  assistantMessageSchema, chatMessageSchema, diagramAnnotationSchema, drawingMarkSchema,
  durableConversationSchema, participantSchema, projectAttachmentSchema, providerSessionRefSchema,
  publicConversationSchema, serverParticipantSchema, sketchCanvasSchema, userMessageSchema,
} from './conversationSchema';

const finite = z.number().finite().min(-1_000_000).max(1_000_000);
/**
 * One attached canvas. A diagram carries immutable Mermaid source; a sketch has none, so its
 * marks and composite PNG are the whole payload. `kind` defaults to `diagram` so a browser tab
 * loaded before sketches existed keeps working.
 */
export const diagramAttachmentSchema = z.object({
  diagramId: z.string().uuid(),
  kind: z.enum(['diagram', 'sketch']).default('diagram'),
  source: z.string().max(200_000),
  marks: z.array(drawingMarkSchema).max(500),
  viewport: z.object({ viewBox: z.tuple([finite, finite, finite.positive(), finite.positive()]) }),
  compositePngDataUrl: z.string().startsWith('data:image/png;base64,').optional(),
}).superRefine((value, ctx) => {
  if (value.kind === 'diagram' && !value.source.trim()) {
    ctx.addIssue({ code: 'custom', message: 'A diagram attachment needs Mermaid source.', path: ['source'] });
  }
  if (value.kind === 'sketch' && value.source.trim()) {
    ctx.addIssue({ code: 'custom', message: 'A sketch attachment cannot carry Mermaid source.', path: ['source'] });
  }
});

export const agentModeSchema = z.enum(['ask', 'plan', 'agent']);
export const agentProviderSchema = z.enum(['claude', 'codex']);
export const agentRoleSchema = z.enum(['orchestrator', 'coder', 'reviewer', 'tester', 'custom']);

const participantIdSchema = z.string().trim().min(1).max(160);
export const agentMessageRequestSchema = z.object({
  threadId: z.string().uuid(),
  messageId: z.string().uuid(),
  participantId: participantIdSchema,
  text: z.string().trim().min(1).max(MAX_MESSAGE_TEXT_CHARS),
  diagramAttachments: z.array(diagramAttachmentSchema),
  mode: agentModeSchema.optional(),
}).strict();

export const permissionDecisionRequestSchema = z.object({
  runId: z.string().uuid(),
  requestId: z.string().uuid(),
  decision: z.enum(['allow', 'deny']),
}).strict();

export const cancelRunRequestSchema = z.object({ runId: z.string().uuid() }).strict();

export const createThreadRequestSchema = z.object({
  checkoutId: z.string().trim().min(1).max(128).optional(),
  provider: agentProviderSchema,
  role: agentRoleSchema.optional(),
}).strict();

export const addParticipantRequestSchema = z.object({
  provider: agentProviderSchema,
  role: agentRoleSchema,
  requestId: z.string().uuid(),
}).strict();

export const setPrimaryAgentRequestSchema = z.object({
  primaryAgentId: participantIdSchema,
  expectedRevision: z.number().int().nonnegative(),
}).strict();

export const putAnnotationRequestSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  annotation: diagramAnnotationSchema,
}).strict();

export const createSketchRequestSchema = z.object({
  sketch: sketchCanvasSchema,
}).strict();

export const setPinsRequestSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  pinnedDiagramIds: z.array(z.string().uuid()).max(100),
}).strict();

export const projectAttachmentRequestSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  attachment: projectAttachmentSchema,
}).strict();

export function safeJsonResponse(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, {
    ...init,
    headers: { 'Cache-Control': 'no-store', ...init?.headers },
  });
}

export function publicError(error: unknown): string {
  return error instanceof Error ? error.message.replaceAll(/\s+/g, ' ').slice(0, 500) : 'Unexpected error';
}
