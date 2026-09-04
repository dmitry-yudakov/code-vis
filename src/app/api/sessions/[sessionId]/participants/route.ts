import { getConfig } from '@/server/config';
import {
  sessionStoreStatus, getSessionStore, publicSession,
} from '@/server/storage/sessionStore';
import {
  addParticipantRequestSchema, publicError, safeJsonResponse, setPrimaryAgentRequestSchema,
} from '@/shared/protocol';
import { getProviderAdapters } from '@/server/agents/providerRegistry';
import { AGENT_ROLE_DEFAULT_MODES } from '@/shared/participants';
import { authorizeDeviceRequest } from '@/server/devices/deviceAuthorization';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ sessionId: string }> };

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const denied = await authorizeDeviceRequest(request);
  if (denied) return denied;
  try {
    const { sessionId } = await context.params;
    const config = getConfig();
    const session = await getSessionStore(config.dataDir, config.hostLabel).getSession(sessionId);
    return safeJsonResponse({ session: publicSession(session) });
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: sessionStoreStatus(error) });
  }
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const denied = await authorizeDeviceRequest(request);
  if (denied) return denied;
  try {
    const parsed = addParticipantRequestSchema.safeParse(await request.json());
    if (!parsed.success) return safeJsonResponse({ error: 'A valid provider, role, and request id are required.' }, { status: 400 });
    const { sessionId } = await context.params;
    const config = getConfig();
    const health = await getProviderAdapters(config)[parsed.data.provider].checkHealth();
    if (!health.available || !health.supportedModes.includes(AGENT_ROLE_DEFAULT_MODES[parsed.data.role])) {
      return safeJsonResponse({ error: health.message || 'That provider is not healthy for this role.' }, { status: 409 });
    }
    const session = await getSessionStore(config.dataDir, config.hostLabel).addAgent(
      sessionId,
      parsed.data.provider,
      parsed.data.role,
      parsed.data.requestId,
    );
    return safeJsonResponse({ session: publicSession(session) }, { status: 201 });
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: sessionStoreStatus(error) });
  }
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  const denied = await authorizeDeviceRequest(request);
  if (denied) return denied;
  try {
    const parsed = setPrimaryAgentRequestSchema.safeParse(await request.json());
    if (!parsed.success) return safeJsonResponse({ error: 'A valid main agent and expected revision are required.' }, { status: 400 });
    const { sessionId } = await context.params;
    const config = getConfig();
    const session = await getSessionStore(config.dataDir, config.hostLabel).setPrimaryAgent(
      sessionId,
      parsed.data.primaryAgentId,
      parsed.data.expectedRevision,
    );
    return safeJsonResponse({ session: publicSession(session) });
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: sessionStoreStatus(error) });
  }
}
