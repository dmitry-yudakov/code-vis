import { getConfig } from '@/server/config';
import { getProjectRegistry } from '@/server/projects/projectRegistry';
import { getThreadRegistry, publicParticipants } from '@/server/storage/threadRegistry';
import {
  addParticipantRequestSchema, publicError, safeJsonResponse, setPrimaryAgentRequestSchema,
} from '@/shared/protocol';
import { getProviderAdapters } from '@/server/agents/providerRegistry';
import { AGENT_ROLE_DEFAULT_MODES } from '@/shared/participants';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ threadId: string }> };

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const projectId = new URL(request.url).searchParams.get('projectId') || '';
  if (!projectId || projectId.length > 128) {
    return safeJsonResponse({ error: 'A valid project id is required.' }, { status: 400 });
  }
  try {
    const { threadId } = await context.params;
    const config = getConfig();
    await getProjectRegistry(config.projectsRoot, config.projectDiscoveryDepth).resolve(projectId);
    const thread = await getThreadRegistry(config.dataDir).get(threadId, projectId);
    return safeJsonResponse({ participants: publicParticipants(thread), primaryAgentId: thread.primaryAgentId });
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: 404 });
  }
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const parsed = addParticipantRequestSchema.safeParse(await request.json());
    if (!parsed.success) return safeJsonResponse({ error: 'A valid provider and role are required.' }, { status: 400 });
    const { threadId } = await context.params;
    const config = getConfig();
    await getProjectRegistry(config.projectsRoot, config.projectDiscoveryDepth).resolve(parsed.data.projectId);
    const health = await getProviderAdapters(config)[parsed.data.provider].checkHealth();
    if (!health.available || !health.supportedModes.includes(AGENT_ROLE_DEFAULT_MODES[parsed.data.role])) {
      return safeJsonResponse({ error: health.message || 'That provider is not healthy for this role.' }, { status: 409 });
    }
    const registry = getThreadRegistry(config.dataDir);
    await registry.addAgent(
      threadId,
      parsed.data.projectId,
      parsed.data.provider,
      parsed.data.role,
      parsed.data.requestId,
    );
    const thread = await registry.get(threadId, parsed.data.projectId);
    return safeJsonResponse({ participants: publicParticipants(thread), primaryAgentId: thread.primaryAgentId }, { status: 201 });
  } catch (error) {
    const message = publicError(error);
    return safeJsonResponse({ error: message }, { status: message.includes('Unknown project-bound thread') ? 404 : 400 });
  }
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  try {
    const parsed = setPrimaryAgentRequestSchema.safeParse(await request.json());
    if (!parsed.success) return safeJsonResponse({ error: 'A valid main agent is required.' }, { status: 400 });
    const { threadId } = await context.params;
    const config = getConfig();
    const registry = getThreadRegistry(config.dataDir);
    await registry.setPrimaryAgent(threadId, parsed.data.projectId, parsed.data.primaryAgentId);
    const thread = await registry.get(threadId, parsed.data.projectId);
    return safeJsonResponse({ participants: publicParticipants(thread), primaryAgentId: thread.primaryAgentId });
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: 400 });
  }
}
