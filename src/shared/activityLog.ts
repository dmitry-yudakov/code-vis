import { z } from 'zod';
import type { McpTool } from './mcp';
import { AGENT_MODES } from './agentModes';

export const activitySources = ['web', 'mcp', 'automatic'] as const;
export const activitySourceSchema = z.enum(activitySources);
export const activityActorSchema = z.object({
  source: activitySourceSchema,
  id: z.string().uuid().optional(),
  label: z.string().min(1).max(200).optional(),
}).strict();
export type ActivityActor = z.infer<typeof activityActorSchema>;
export const webActivityActor: ActivityActor = { source: 'web' };
export const automaticActivityActor: ActivityActor = { source: 'automatic' };

export const activityLabels = {
  'session.create': 'Session created',
  'session.archive': 'Session archived',
  'session.archive.completed': 'Session auto-archived after completion',
  'session.archive.inactive': 'Session auto-archived after inactivity',
  'session.autoclose.enable': 'Automatic completion archive enabled',
  'session.autoclose.disable': 'Automatic completion archive disabled',
  'session.restore': 'Session restored',
  'session.repositories': 'Session repositories changed',
  'participant.add': 'Agent added',
  'participant.primary': 'Main agent changed',
  'message.accept': 'User message accepted',
  'message.edit': 'Queued message edit accepted',
  'message.steer': 'Steering message accepted',
  'run.cancel': 'Run cancellation requested',
  'run.allow': 'Permission allowed',
  'run.deny': 'Permission denied',
  'run.undo': 'Turn changes undone',
  'run.mode': 'Run mode change accepted',
  'project.create': 'Project created',
  'project.update': 'Project updated',
  'project.delete': 'Project deleted',
  'git.branch': 'Branch switch accepted',
  'git.stage': 'Files staged',
  'git.unstage': 'Files unstaged',
  'git.commit': 'Git commit created',
  'git.push': 'Git push completed',
  'machine.restart': 'Build & restart requested',
} as const;

export const mcpActivityLabels = {
  get_workspace: 'Read workspace',
  list_projects: 'List projects',
  list_sessions: 'List sessions',
  read_session: 'Read session',
  create_session: 'Create session',
  archive_session: 'Archive session',
  add_participant: 'Add agent',
  send_message: 'Send message',
  release_listing: 'Release listing',
  subscribe: 'Subscribe to workspace',
  request: 'MCP request',
} satisfies Record<McpTool | 'release_listing' | 'subscribe' | 'request', string>;

const uuid = z.string().uuid();
const context = {
  actor: activityActorSchema,
  sessionId: uuid.optional(),
  projectId: uuid.optional(),
  messageId: uuid.optional(),
  participantId: uuid.optional(),
  runId: uuid.optional(),
  requestId: uuid.optional(),
  checkoutId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/).optional(),
  commitHash: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/).optional(),
  mode: z.enum(AGENT_MODES).optional(),
};
const entry = { id: uuid, at: z.string().datetime() };
export const activityEntrySchema = z.union([
  z.object({ ...entry, ...context, action: z.enum(Object.keys(activityLabels) as Array<keyof typeof activityLabels>) }).strict(),
  z.object({ ...entry, ...context, action: z.literal('mcp.call'),
    operation: z.enum(Object.keys(mcpActivityLabels) as Array<keyof typeof mcpActivityLabels>),
    outcome: z.enum(['succeeded', 'denied', 'failed', 'partial', 'replayed']),
    status: z.number().int().min(200).max(599),
  }).strict(),
]);
export type ActivityEntry = z.infer<typeof activityEntrySchema>;
type WithoutEntry<T> = T extends ActivityEntry ? Omit<T, 'at' | 'id'> : never;
export type ActivityInput = WithoutEntry<ActivityEntry>;
export type McpActivity = Extract<ActivityInput, { action: 'mcp.call' }>;
export interface ActivityPage {
  entries: ActivityEntry[];
  nextCursor: string | null;
  incomplete: boolean;
}
