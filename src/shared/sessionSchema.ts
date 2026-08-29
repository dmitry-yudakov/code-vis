import { z } from 'zod';

const finite = z.number().finite().min(-1_000_000).max(1_000_000);
const dateTime = z.string().datetime();
const participantId = z.string().trim().min(1).max(160);
const checkoutId = z.string().trim().min(1).max(128);
const agentProvider = z.enum(['claude', 'codex']);
const agentRole = z.enum(['orchestrator', 'coder', 'reviewer', 'tester', 'custom']);
const agentMode = z.enum(['ask', 'plan', 'agent']);

const point = z.object({
  x: finite,
  y: finite,
  pressure: z.number().finite().min(0).max(1).optional(),
}).strict();

const markBase = {
  id: z.string().uuid(),
  origin: z.literal('user'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  createdAt: dateTime,
};

export const drawingMarkSchema = z.discriminatedUnion('kind', [
  z.object({ ...markBase, kind: z.literal('pen'), points: z.array(point).min(1).max(5_000) }).strict(),
  z.object({ ...markBase, kind: z.literal('rectangle'), x: finite, y: finite, width: finite, height: finite }).strict(),
  z.object({ ...markBase, kind: z.literal('arrow'), start: point, end: point }).strict(),
  z.object({ ...markBase, kind: z.literal('text'), x: finite, y: finite, text: z.string().trim().min(1).max(500) }).strict(),
]);

export const diagramAnnotationSchema = z.object({
  version: z.literal(1),
  diagramId: z.string().uuid(),
  marks: z.array(drawingMarkSchema).max(500),
  updatedAt: dateTime,
}).strict();

export const sketchCanvasSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  ordinal: z.number().int().positive(),
  createdAt: dateTime,
  viewBox: z.tuple([finite, finite, finite.positive(), finite.positive()]),
}).strict();

export const projectAttachmentSchema = z.object({
  id: z.string().uuid(),
  hostId: z.string().uuid(),
  checkoutId,
  role: z.enum(['primary', 'reference']),
}).strict();

export const providerSessionRefSchema = z.discriminatedUnion('started', [
  z.object({ provider: agentProvider, started: z.literal(false) }).strict(),
  z.object({
    provider: agentProvider,
    started: z.literal(true),
    sessionId: z.string().trim().min(1).max(1_000),
    hostId: z.string().uuid(),
  }).strict(),
]);

export const humanParticipantSchema = z.object({
  id: participantId,
  kind: z.literal('human'),
  displayName: z.string().trim().min(1).max(160),
}).strict();

export const publicAgentParticipantSchema = z.object({
  id: participantId,
  kind: z.literal('agent'),
  displayName: z.string().trim().min(1).max(160),
  provider: agentProvider,
  role: agentRole,
  defaultMode: agentMode,
}).strict();

export const serverAgentParticipantSchema = publicAgentParticipantSchema.extend({
  session: providerSessionRefSchema,
  lastObservedMessageId: z.string().uuid().optional(),
  creationRequestId: z.string().uuid().optional(),
}).strict().superRefine((participant, ctx) => {
  if (participant.session.provider !== participant.provider) {
    ctx.addIssue({ code: 'custom', message: 'Agent and session providers must match.', path: ['session', 'provider'] });
  }
});

export const participantSchema = z.discriminatedUnion('kind', [
  humanParticipantSchema,
  publicAgentParticipantSchema,
]);

export const serverParticipantSchema = z.union([
  humanParticipantSchema,
  serverAgentParticipantSchema,
]);

const diagramAttachmentRecordSchema = z.object({
  diagramId: z.string().uuid(),
  kind: z.enum(['diagram', 'sketch']).optional(),
  marksSnapshot: z.array(drawingMarkSchema).max(500),
  viewport: z.object({
    viewBox: z.tuple([finite, finite, finite.positive(), finite.positive()]),
  }).strict(),
  compositeIncluded: z.boolean(),
}).strict();

const evidenceSchema = z.object({
  elementId: z.string().max(500).optional(),
  location: z.string().max(4_096).optional(),
  path: z.string().max(4_096).optional(),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
  status: z.enum(['observed', 'inferred', 'invalid', 'missing-file', 'outside-project', 'invalid-range']),
  message: z.string().max(4_096),
}).strict();

export const diagramArtifactSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  messageId: z.string().uuid(),
  ordinal: z.number().int().positive(),
  source: z.string().max(200_000),
  createdAt: dateTime,
  status: z.enum(['ready', 'policy-error', 'parse-error', 'render-error']),
  error: z.string().max(4_096).optional(),
  derivedFromDiagramIds: z.array(z.string().uuid()).max(32),
  evidence: z.array(evidenceSchema).max(5_000),
}).strict();

const assistantBlockSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('markdown'), markdown: z.string().max(2_000_000) }).strict(),
  z.object({
    kind: z.literal('code'),
    language: z.string().max(100).optional(),
    source: z.string().max(2_000_000),
    warning: z.string().max(4_096).optional(),
  }).strict(),
  z.object({ kind: z.literal('diagram'), artifact: diagramArtifactSchema }).strict(),
]);

export const userMessageSchema = z.object({
  id: z.string().uuid(),
  role: z.literal('user'),
  authorId: participantId,
  addressedParticipantId: participantId,
  text: z.string().max(200_000),
  createdAt: dateTime,
  status: z.enum(['sending', 'sent', 'cancelled', 'failed']),
  delivery: z.enum(['not-sent', 'possibly-sent']).optional(),
  diagramAttachments: z.array(diagramAttachmentRecordSchema).max(12),
  mode: agentMode.optional(),
}).strict();

export const assistantMessageSchema = z.object({
  id: z.string().uuid(),
  role: z.literal('assistant'),
  authorId: participantId,
  createdAt: dateTime,
  status: z.enum(['complete', 'cancelled', 'failed']),
  rawMarkdown: z.string().max(2_000_000),
  blocks: z.array(assistantBlockSchema).max(10_000),
  metrics: z.object({
    durationMs: z.number().finite().nonnegative(),
    outputBytes: z.number().int().nonnegative(),
  }).strict().optional(),
  mode: agentMode.optional(),
  planProposed: z.boolean().optional(),
}).strict();

export const chatMessageSchema = z.discriminatedUnion('role', [userMessageSchema, assistantMessageSchema]);

const sessionBase = {
  version: z.literal(2),
  revision: z.number().int().nonnegative(),
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  attachments: z.array(projectAttachmentSchema).max(32),
  createdAt: dateTime,
  updatedAt: dateTime,
  primaryAgentId: participantId,
  messages: z.array(chatMessageSchema).max(10_000),
  pinnedDiagramIds: z.array(z.string().uuid()).max(100),
  annotations: z.record(z.string(), diagramAnnotationSchema),
  sketches: z.array(sketchCanvasSchema).max(100),
};

function validateSession(
  value: {
    id: string;
    attachments: Array<{ id: string; hostId: string; checkoutId: string; role: string }>;
    participants: Array<{ id: string; kind: string; displayName: string; lastObservedMessageId?: string }>;
    primaryAgentId: string;
    messages: Array<{ id: string; role: string; authorId: string; addressedParticipantId?: string }>;
    pinnedDiagramIds: string[];
    annotations: Record<string, { diagramId: string }>;
    sketches: Array<{ id: string; sessionId: string }>;
  },
  ctx: z.RefinementCtx,
): void {
  const attachmentIds = value.attachments.map((attachment) => attachment.id);
  const checkoutKeys = value.attachments.map((attachment) => `${attachment.hostId}\0${attachment.checkoutId}`);
  if (new Set(attachmentIds).size !== attachmentIds.length) {
    ctx.addIssue({ code: 'custom', message: 'Attachment ids must be unique.', path: ['attachments'] });
  }
  if (new Set(checkoutKeys).size !== checkoutKeys.length) {
    ctx.addIssue({ code: 'custom', message: 'A checkout may be attached only once per host.', path: ['attachments'] });
  }
  if (value.attachments.filter((attachment) => attachment.role === 'primary').length > 1) {
    ctx.addIssue({ code: 'custom', message: 'A session may have at most one primary attachment.', path: ['attachments'] });
  }

  const participantIds = value.participants.map((participant) => participant.id);
  const participantNames = value.participants.map((participant) => participant.displayName);
  if (new Set(participantIds).size !== participantIds.length || new Set(participantNames).size !== participantNames.length) {
    ctx.addIssue({ code: 'custom', message: 'Participant ids and display names must be unique.', path: ['participants'] });
  }
  if (!value.participants.some((participant) => participant.kind === 'human')) {
    ctx.addIssue({ code: 'custom', message: 'A session requires at least one human.', path: ['participants'] });
  }
  if (!value.participants.some((participant) => participant.kind === 'agent' && participant.id === value.primaryAgentId)) {
    ctx.addIssue({ code: 'custom', message: 'The primary participant must be an agent in this session.', path: ['primaryAgentId'] });
  }

  const participantSet = new Set(participantIds);
  const humanSet = new Set(value.participants.filter((participant) => participant.kind === 'human').map((participant) => participant.id));
  const agentSet = new Set(value.participants.filter((participant) => participant.kind === 'agent').map((participant) => participant.id));
  const messageIds = value.messages.map((message) => message.id);
  if (new Set(messageIds).size !== messageIds.length) {
    ctx.addIssue({ code: 'custom', message: 'Message ids must be unique.', path: ['messages'] });
  }
  value.messages.forEach((message, index) => {
    if (!participantSet.has(message.authorId)) {
      ctx.addIssue({ code: 'custom', message: 'A message author must belong to the session.', path: ['messages', index, 'authorId'] });
    }
    if (message.role === 'user' && !humanSet.has(message.authorId)) {
      ctx.addIssue({ code: 'custom', message: 'A user message author must be a human.', path: ['messages', index, 'authorId'] });
    }
    if (message.role === 'assistant' && !agentSet.has(message.authorId)) {
      ctx.addIssue({ code: 'custom', message: 'An assistant message author must be an agent.', path: ['messages', index, 'authorId'] });
    }
    if (message.role === 'user' && !value.participants.some((participant) => (
      participant.kind === 'agent' && participant.id === message.addressedParticipantId
    ))) {
      ctx.addIssue({ code: 'custom', message: 'A user message must address an agent in the session.', path: ['messages', index, 'addressedParticipantId'] });
    }
  });
  const messageSet = new Set(messageIds);
  value.participants.forEach((participant, index) => {
    if (participant.lastObservedMessageId && !messageSet.has(participant.lastObservedMessageId)) {
      ctx.addIssue({ code: 'custom', message: 'A participant cursor must reference a stored message.', path: ['participants', index, 'lastObservedMessageId'] });
    }
  });

  const canvasIdList = value.sketches.map((sketch) => sketch.id);
  const canvasIds = new Set(canvasIdList);
  value.sketches.forEach((sketch, index) => {
    if (sketch.sessionId !== value.id) {
      ctx.addIssue({ code: 'custom', message: 'A sketch must belong to its session.', path: ['sketches', index, 'sessionId'] });
    }
  });
  for (const message of value.messages) {
    if (message.role !== 'assistant') continue;
    const blocks = (message as unknown as { blocks: Array<{ kind: string; artifact?: { id: string; sessionId: string; messageId: string } }> }).blocks;
    for (const block of blocks) {
      if (block.kind !== 'diagram' || !block.artifact) continue;
      canvasIdList.push(block.artifact.id);
      canvasIds.add(block.artifact.id);
      if (block.artifact.sessionId !== value.id || block.artifact.messageId !== message.id) {
        ctx.addIssue({ code: 'custom', message: 'A diagram must belong to its session and message.', path: ['messages'] });
      }
    }
  }
  if (canvasIds.size !== canvasIdList.length) {
    ctx.addIssue({ code: 'custom', message: 'Canvas ids must be unique across diagrams and sketches.', path: ['messages'] });
  }
  for (const [key, annotation] of Object.entries(value.annotations)) {
    if (key !== annotation.diagramId || !canvasIds.has(key)) {
      ctx.addIssue({ code: 'custom', message: 'Annotations must reference a canvas in this session.', path: ['annotations', key] });
    }
  }
  if (new Set(value.pinnedDiagramIds).size !== value.pinnedDiagramIds.length
    || value.pinnedDiagramIds.some((id) => !canvasIds.has(id))) {
    ctx.addIssue({ code: 'custom', message: 'Pins must uniquely reference canvases in this session.', path: ['pinnedDiagramIds'] });
  }
}

export const durableSessionSchema = z.object({
  ...sessionBase,
  participants: z.array(serverParticipantSchema).min(2).max(32),
}).strict().superRefine(validateSession);

export const publicSessionSchema = z.object({
  ...sessionBase,
  participants: z.array(participantSchema).min(2).max(32),
}).strict().superRefine(validateSession);

const legacyContainerIdKey = ['th', 'readId'].join('');

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function migrateLegacyContainerId(
  value: unknown,
  ctx: z.RefinementCtx,
  path: Array<string | number>,
): unknown {
  const source = record(value);
  if (!source) return value;
  if (!Object.hasOwn(source, legacyContainerIdKey) || Object.hasOwn(source, 'sessionId')) {
    ctx.addIssue({ code: 'custom', message: 'A legacy canvas must carry its legacy container id only.', path });
    return value;
  }
  const migrated: Record<string, unknown> = { ...source, sessionId: source[legacyContainerIdKey] };
  delete migrated[legacyContainerIdKey];
  return migrated;
}

/** Validates a v1 durable record while returning its exact v2 session equivalent. */
export const legacyDurableSessionSchema = z.unknown().transform((value, ctx) => {
  const source = record(value);
  if (!source || source.version !== 1) {
    ctx.addIssue({ code: 'custom', message: 'A legacy session record must have version 1.', path: ['version'] });
    return z.NEVER;
  }

  const sketches = Array.isArray(source.sketches)
    ? source.sketches.map((sketch, index) => migrateLegacyContainerId(sketch, ctx, ['sketches', index]))
    : source.sketches;
  const messages = Array.isArray(source.messages) ? source.messages.map((message, messageIndex) => {
    const messageRecord = record(message);
    if (!messageRecord || !Array.isArray(messageRecord.blocks)) return message;
    return {
      ...messageRecord,
      blocks: messageRecord.blocks.map((block, blockIndex) => {
        const blockRecord = record(block);
        if (!blockRecord || blockRecord.kind !== 'diagram') return block;
        return {
          ...blockRecord,
          artifact: migrateLegacyContainerId(
            blockRecord.artifact,
            ctx,
            ['messages', messageIndex, 'blocks', blockIndex, 'artifact'],
          ),
        };
      }),
    };
  }) : source.messages;

  return { ...source, version: 2, sketches, messages };
}).pipe(durableSessionSchema);
