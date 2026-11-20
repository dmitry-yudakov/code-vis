import { z } from 'zod';
import { MAX_MESSAGE_TEXT_CHARS } from './limits';
import { agentEffortSchema, agentModeSchema, agentModelIdSchema, agentProviderSchema, agentRoleSchema } from './protocol';

export const MCP_REQUEST_BYTES = 16 * 1024;
export const MCP_RESPONSE_BYTES = 64 * 1024;
export const MCP_WORKSPACE_URI = 'codeai://local/workspace';
export const MCP_SCOPES = ['projects:read', 'sessions:read', 'sessions:create', 'sessions:archive', 'participants:add', 'messages:send'] as const;
export const mcpScopeSchema = z.enum(MCP_SCOPES);
export type McpScope = z.infer<typeof mcpScopeSchema>;
const uuid = z.string().uuid();
const page = { cursor: z.string().max(200).optional(), limit: z.number().int().min(1).max(50).default(50) };
const message = { messageId: uuid, text: z.string().trim().min(1).max(MAX_MESSAGE_TEXT_CHARS), mode: agentModeSchema,
  model: agentModelIdSchema.optional(), effort: agentEffortSchema.optional() };
export const mcpToolSchemas = {
  get_workspace: z.object({}).strict(),
  list_projects: z.object(page).strict(),
  list_sessions: z.object({ ...page, projectId: uuid.optional(), archived: z.boolean().default(false) }).strict(),
  read_session: z.object({ sessionId: uuid, archived: z.boolean().default(false) }).strict(),
  create_session: z.object({ creationRequestId: uuid, projectId: uuid.optional(), checkoutId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/).optional(),
    expectedProjectBindings: z.string().regex(/^[0-9a-f]{64}$/).optional(), provider: agentProviderSchema,
    execution: z.enum(['local', 'docker']), role: agentRoleSchema.default('coder'), checkoutMode: z.enum(['current', 'worktree']),
    launch: z.enum(['empty', 'run', 'queue']), firstMessage: z.object(message).strict().optional(),
  }).strict().refine(v => Boolean(v.projectId) !== Boolean(v.checkoutId), 'Choose a project or a direct checkout.')
    .refine(v => !v.projectId || Boolean(v.expectedProjectBindings), 'A project binding token is required.')
    .refine(v => v.projectId || !v.expectedProjectBindings, 'Binding tokens require a project.')
    .refine(v => (v.launch === 'empty') === !v.firstMessage, 'Run/queue requires a first message; empty cannot send.'),
  archive_session: z.object({ sessionId: uuid, expectedRevision: z.number().int().nonnegative() }).strict(),
  add_participant: z.object({ sessionId: uuid, requestId: uuid, provider: agentProviderSchema, role: agentRoleSchema }).strict(),
  send_message: z.object({ sessionId: uuid, participantId: uuid, ...message }).strict(),
};
export type McpTool = keyof typeof mcpToolSchemas;
export const mcpToolScopes: Record<McpTool, McpScope> = {
  get_workspace: 'sessions:read', list_projects: 'projects:read', list_sessions: 'sessions:read', read_session: 'sessions:read',
  create_session: 'sessions:create', archive_session: 'sessions:archive', add_participant: 'participants:add', send_message: 'messages:send',
};
export const mcpBridgeRequestSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('get_workspace'), input: mcpToolSchemas.get_workspace }).strict(),
  z.object({ operation: z.literal('list_projects'), input: mcpToolSchemas.list_projects }).strict(),
  z.object({ operation: z.literal('list_sessions'), input: mcpToolSchemas.list_sessions }).strict(),
  z.object({ operation: z.literal('read_session'), input: mcpToolSchemas.read_session }).strict(),
  z.object({ operation: z.literal('create_session'), input: mcpToolSchemas.create_session }).strict(),
  z.object({ operation: z.literal('archive_session'), input: mcpToolSchemas.archive_session }).strict(),
  z.object({ operation: z.literal('add_participant'), input: mcpToolSchemas.add_participant }).strict(),
  z.object({ operation: z.literal('send_message'), input: mcpToolSchemas.send_message }).strict(),
  z.object({ operation: z.literal('release_listing'), input: z.object({ cursor: z.string().max(200).optional() }).strict() }).strict(),
]);
export type McpBridgeRequest = z.infer<typeof mcpBridgeRequestSchema>;
export const mcpConnectionSchema = z.object({ version: z.literal(1), grantId: uuid, machineId: uuid,
  origin: z.string().url(), credential: z.string().regex(/^[a-zA-Z0-9_-]{43}$/) }).strict();
export type McpConnection = z.infer<typeof mcpConnectionSchema>;
