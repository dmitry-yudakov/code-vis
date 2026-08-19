import { getConfig } from '@/lib/server/config';
import { getProjectRegistry } from '@/lib/server/projectRegistry';
import { getThreadRegistry, publicParticipants } from '@/lib/server/threadRegistry';
import {
  addParticipantRequestSchema, publicError, safeJsonResponse, setPrimaryAgentRequestSchema,
} from '@/lib/shared/protocol';
import { getProviderAdapters } from '@/lib/server/providerRegistry';
import { AGENT_ROLE_DEFAULT_MODES } from '@/lib/shared/participants';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ threadId: string }> };

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
    await registry.addAgent(threadId, parsed.data.projectId, parsed.data.provider, parsed.data.role);
    const thread = await registry.get(threadId, parsed.data.projectId);
    return safeJsonResponse({ participants: publicParticipants(thread), primaryAgentId: thread.primaryAgentId }, { status: 201 });
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: 400 });
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
