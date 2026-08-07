import { z } from 'zod';

const finite = z.number().finite().min(-1_000_000).max(1_000_000);
const point = z.object({ x: finite, y: finite, pressure: z.number().finite().min(0).max(1).optional() });
const markBase = {
  id: z.string().uuid(),
  origin: z.literal('user'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  createdAt: z.string().datetime(),
};

export const drawingMarkSchema = z.discriminatedUnion('kind', [
  z.object({ ...markBase, kind: z.literal('pen'), points: z.array(point).min(1).max(5_000) }),
  z.object({ ...markBase, kind: z.literal('rectangle'), x: finite, y: finite, width: finite, height: finite }),
  z.object({ ...markBase, kind: z.literal('arrow'), start: point, end: point }),
  z.object({ ...markBase, kind: z.literal('text'), x: finite, y: finite, text: z.string().trim().min(1).max(500) }),
]);

export const diagramAttachmentSchema = z.object({
  diagramId: z.string().uuid(),
  source: z.string().min(1),
  marks: z.array(drawingMarkSchema).max(500),
  viewport: z.object({ viewBox: z.tuple([finite, finite, finite.positive(), finite.positive()]) }),
  compositePngDataUrl: z.string().startsWith('data:image/png;base64,').optional(),
});

export const agentModeSchema = z.enum(['ask', 'plan', 'agent']);

export const agentMessageRequestSchema = z.object({
  projectId: z.string().min(1).max(128),
  threadId: z.string().uuid(),
  messageId: z.string().uuid(),
  text: z.string().trim().min(1).max(8_000),
  diagramAttachments: z.array(diagramAttachmentSchema),
  mode: agentModeSchema.optional(),
}).strict();

export const permissionDecisionRequestSchema = z.object({
  runId: z.string().uuid(),
  requestId: z.string().uuid(),
  decision: z.enum(['allow', 'deny']),
}).strict();

export const cancelRunRequestSchema = z.object({ runId: z.string().uuid() }).strict();

export const createThreadRequestSchema = z.object({ projectId: z.string().min(1).max(128) }).strict();

export function safeJsonResponse(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, {
    ...init,
    headers: { 'Cache-Control': 'no-store', ...init?.headers },
  });
}

export function publicError(error: unknown): string {
  return error instanceof Error ? error.message.replaceAll(/\s+/g, ' ').slice(0, 500) : 'Unexpected error';
}
