import { z } from 'zod';

/**
 * The managed build-and-restart of CodeAI's own installation (Story 64). The browser sees only the
 * snapshot and names the fixed action; everything else crosses the private IPC channel between the
 * `start:managed` parent and the server it spawned, and is never accepted from HTTP.
 */
export const CODEAI_LIFECYCLE_PATH = '/api/codeai-lifecycle';

/** A release is named by the content of its build directory's Next `BUILD_ID` file. */
export const RELEASE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
export const MAX_LIFECYCLE_DETAIL_CHARS = 300;

const releaseIdSchema = z.string().regex(RELEASE_ID_PATTERN);
const operationIdSchema = z.string().uuid();

export const codeAiLifecyclePhaseSchema = z.enum(['idle', 'building', 'restarting']);
export type CodeAiLifecyclePhase = z.infer<typeof codeAiLifecyclePhaseSchema>;

export const codeAiLifecycleOperationSchema = z.object({
  operationId: operationIdSchema,
  outcome: z.enum(['succeeded', 'build-failed', 'rolled-back']),
  finishedAt: z.string().datetime(),
  /** Bounded and written by the parent from fixed text: no host path, output, or environment value. */
  detail: z.string().max(MAX_LIFECYCLE_DETAIL_CHARS).optional(),
}).strict();
export type CodeAiLifecycleOperation = z.infer<typeof codeAiLifecycleOperationSchema>;

export const availableLifecycleSnapshotSchema = z.object({
  available: z.literal(true),
  phase: codeAiLifecyclePhaseSchema,
  releaseId: releaseIdSchema,
  /** The operation in progress. */
  operationId: operationIdSchema.optional(),
  startedAt: z.string().datetime().optional(),
  /** Known once the build has produced it. */
  candidateReleaseId: releaseIdSchema.optional(),
  /** Carried to the next server by the parent. */
  lastOperation: codeAiLifecycleOperationSchema.optional(),
}).strict();
export type AvailableLifecycleSnapshot = z.infer<typeof availableLifecycleSnapshotSchema>;

export const codeAiLifecycleSnapshotSchema = z.union([
  availableLifecycleSnapshotSchema,
  z.object({ available: z.literal(false), reason: z.enum(['not-managed', 'not-self-project']) }).strict(),
]);
export type CodeAiLifecycleSnapshot = z.infer<typeof codeAiLifecycleSnapshotSchema>;

export const buildAndRestartRequestSchema = z.object({
  action: z.literal('build-and-restart'),
  projectId: z.string().uuid(),
}).strict();
export type BuildAndRestartRequest = z.infer<typeof buildAndRestartRequestSchema>;

/** The directories a release may be served from; only the two managed slots are ever built or removed. */
export const MANAGED_SLOTS = ['.next-managed-a', '.next-managed-b'] as const;
export const RELEASE_DIRECTORIES = ['.next', ...MANAGED_SLOTS] as const;
export type ManagedSlot = typeof MANAGED_SLOTS[number];
export type ReleaseDirectory = typeof RELEASE_DIRECTORIES[number];

/** Parent to server. */
export const parentLifecycleMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('lifecycle-init'),
    installationRoot: z.string().min(1).max(4_096),
    slot: z.enum(RELEASE_DIRECTORIES),
    releaseId: releaseIdSchema,
    lastOperation: codeAiLifecycleOperationSchema.optional(),
  }).strict(),
  z.object({ type: z.literal('lifecycle-lease'), request: z.enum(['acquire', 'release']) }).strict(),
  z.object({ type: z.literal('lifecycle-state'), snapshot: availableLifecycleSnapshotSchema }).strict(),
]);
export type ParentLifecycleMessage = z.infer<typeof parentLifecycleMessageSchema>;
export type ManagedLifecycleInit = Extract<ParentLifecycleMessage, { type: 'lifecycle-init' }>;

/** Server to parent. */
export const serverLifecycleMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('lifecycle-request'), operationId: operationIdSchema, action: z.literal('build-and-restart') }).strict(),
  z.object({ type: z.literal('lifecycle-lease'), request: z.literal('acquire'), granted: z.boolean() }).strict(),
  z.object({ type: z.literal('lifecycle-ready'), releaseId: releaseIdSchema }).strict(),
]);
export type ServerLifecycleMessage = z.infer<typeof serverLifecycleMessageSchema>;

/** The private parent/server IPC; never accepted from HTTP. */
export type ManagedLifecycleMessage = ParentLifecycleMessage | ServerLifecycleMessage;
