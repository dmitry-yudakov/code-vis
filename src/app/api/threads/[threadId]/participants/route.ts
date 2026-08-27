import { getConfig } from '@/server/config';
import {
  conversationStoreStatus, getConversationStore, publicConversation,
} from '@/server/storage/conversationStore';
import {
  addParticipantRequestSchema, publicError, safeJsonResponse, setPrimaryAgentRequestSchema,
} from '@/shared/protocol';
import { getProviderAdapters } from '@/server/agents/providerRegistry';
import { AGENT_ROLE_DEFAULT_MODES } from '@/shared/participants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ threadId: string }> };

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const { threadId } = await context.params;
    const config = getConfig();
    const conversation = await getConversationStore(config.dataDir, config.hostLabel).getConversation(threadId);
    return safeJsonResponse({ thread: publicConversation(conversation) });
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: conversationStoreStatus(error) });
  }
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const parsed = addParticipantRequestSchema.safeParse(await request.json());
    if (!parsed.success) return safeJsonResponse({ error: 'A valid provider, role, and request id are required.' }, { status: 400 });
    const { threadId } = await context.params;
    const config = getConfig();
    const health = await getProviderAdapters(config)[parsed.data.provider].checkHealth();
    if (!health.available || !health.supportedModes.includes(AGENT_ROLE_DEFAULT_MODES[parsed.data.role])) {
      return safeJsonResponse({ error: health.message || 'That provider is not healthy for this role.' }, { status: 409 });
    }
    const conversation = await getConversationStore(config.dataDir, config.hostLabel).addAgent(
      threadId,
      parsed.data.provider,
      parsed.data.role,
      parsed.data.requestId,
    );
    return safeJsonResponse({ thread: publicConversation(conversation) }, { status: 201 });
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: conversationStoreStatus(error) });
  }
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  try {
    const parsed = setPrimaryAgentRequestSchema.safeParse(await request.json());
    if (!parsed.success) return safeJsonResponse({ error: 'A valid main agent and expected revision are required.' }, { status: 400 });
    const { threadId } = await context.params;
    const config = getConfig();
    const conversation = await getConversationStore(config.dataDir, config.hostLabel).setPrimaryAgent(
      threadId,
      parsed.data.primaryAgentId,
      parsed.data.expectedRevision,
    );
    return safeJsonResponse({ thread: publicConversation(conversation) });
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: conversationStoreStatus(error) });
  }
}
