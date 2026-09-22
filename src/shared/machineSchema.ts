import { z } from 'zod';
import { MAX_MODEL_EFFORTS, MAX_MODEL_LABEL_CHARS, MAX_PROVIDER_MODELS } from './limits';
import { agentEffortSchema, agentModelIdSchema } from './protocol';
import { durableProjectSchema } from './sessionSchema';

const dateTime = z.string().datetime();
const machineIdentitySchema = z.object({
  id: z.string().uuid(),
  label: z.string().trim().min(1).max(200),
}).strict();

/** One server-owned model choice, as a machine lists it for its provider. */
export const providerModelSchema = z.object({
  id: agentModelIdSchema,
  label: z.string().trim().min(1).max(MAX_MODEL_LABEL_CHARS),
  efforts: z.array(agentEffortSchema).max(MAX_MODEL_EFFORTS),
}).strict();

const providerHealthSchema = z.object({
  available: z.boolean(),
  authenticated: z.union([z.boolean(), z.literal('unknown')]),
  supportedModes: z.array(z.enum(['ask', 'plan', 'agent'])).max(3),
  message: z.string().max(500).optional(),
  models: z.array(providerModelSchema).max(MAX_PROVIDER_MODELS).optional(),
  efforts: z.array(agentEffortSchema).max(MAX_MODEL_EFFORTS).optional(),
}).strict();

const checkoutSummarySchema = z.object({
  id: z.string().trim().min(1).max(128),
  name: z.string().trim().min(1).max(500),
  relativePath: z.string().min(1).max(4_096),
}).strict();

const arenaSessionSummarySchema = z.object({
  execution: z.enum(['local', 'docker']).optional(),
  id: z.string().uuid(),
  revision: z.number().int().nonnegative(),
  title: z.string().trim().min(1).max(200),
  archivedAt: dateTime.optional(),
  projectId: z.string().uuid().optional(),
  repositoryCheckoutIds: z.array(z.string().trim().min(1).max(128)).max(32),
  agents: z.array(z.object({
    id: z.string().trim().min(1).max(160),
    displayName: z.string().trim().min(1).max(160),
    provider: z.enum(['claude', 'codex']),
    role: z.enum(['orchestrator', 'coder', 'reviewer', 'tester', 'custom']),
  }).strict()).max(8),
  updatedAt: dateTime,
  lastActivity: z.object({
    messageId: z.string().uuid(),
    createdAt: dateTime,
    status: z.enum(['sending', 'sent', 'cancelled', 'failed', 'complete']),
  }).strict().optional(),
}).strict();

const runPermissionSchema = z.object({
  requestId: z.string().uuid(),
  participantId: z.string().trim().min(1).max(160),
  tool: z.string().max(500),
  detail: z.string().max(4_096),
}).strict();

const runDescriptorSchema = z.object({
  runId: z.string().uuid(),
  sessionId: z.string().uuid(),
  participantId: z.string().trim().min(1).max(160),
  state: z.enum(['queued', 'running', 'needs-you', 'finished']),
  enqueuedAt: z.number().finite().nonnegative(),
  startedAt: z.number().finite().nonnegative().optional(),
  finishedAt: z.number().finite().nonnegative().optional(),
  queuePosition: z.number().int().positive().optional(),
  pendingPermissionCount: z.number().int().nonnegative(),
  pendingPermissions: z.array(runPermissionSchema).max(32),
  status: z.string().max(1_000).optional(),
  outcome: z.enum(['completed', 'failed', 'cancelled']).optional(),
}).strict();

export const executorSnapshotSchema = z.object({
  machine: machineIdentitySchema,
  projects: z.array(durableProjectSchema).max(1_000),
  checkouts: z.array(checkoutSummarySchema).max(5_000),
  recentCheckoutIds: z.array(z.string().trim().min(1).max(128)).max(5),
  providers: z.object({ claude: providerHealthSchema, codex: providerHealthSchema }).strict(),
  sessions: z.array(arenaSessionSummarySchema).max(1_000),
  archivedSessions: z.array(arenaSessionSummarySchema).max(1_000),
  runs: z.object({
    active: z.array(runDescriptorSchema).max(40),
    recent: z.array(runDescriptorSchema).max(200),
  }).strict(),
}).strict();

export const machinePairRequestSchema = z.object({
  code: z.string().trim().min(16).max(32),
  machine: machineIdentitySchema,
}).strict();

export const machinePairResponseSchema = z.object({
  machine: machineIdentitySchema,
  credential: z.string().min(60).max(180),
  expiresAt: dateTime,
}).strict();

export const attachedMachineSummarySchema = machineIdentitySchema.extend({
  pairedAt: dateTime,
  expiresAt: dateTime,
}).strict();

export { machineIdentitySchema };
