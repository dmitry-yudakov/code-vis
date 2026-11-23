import { getConfig } from '@/server/config';
import {
  sessionStoreStatus, getSessionStore, publicSession,
} from '@/server/storage/sessionStore';
import { publicError, safeJsonResponse, sessionArchivePermissionRequestSchema } from '@/shared/protocol';
import { authorizeDeviceRequest } from '@/server/devices/deviceAuthorization';
import { webActor } from '@/server/devices/activityActor';
import { sessionCanvases, sessionPage } from '@/shared/sessionPaging';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SessionRouteContext = { params: Promise<{ sessionId: string }> };

export async function GET(request: Request, context: SessionRouteContext): Promise<Response> {
  const denied = await authorizeDeviceRequest(request);
  if (denied) return denied;
  try {
    const { sessionId } = await context.params;
    const config = getConfig();
    const session = await getSessionStore(config.dataDir, config.hostLabel).getSession(sessionId);
    const snapshot = publicSession(session);
    const query = new URL(request.url).searchParams;
    const view = query.get('view');
    if (view === 'recent') {
      const before = query.get('before') || undefined;
      if (before && !snapshot.messages.some(message => message.id === before)) {
        return safeJsonResponse({ error: 'This history position is no longer available. Reopen the conversation.' }, { status: 409 });
      }
      return safeJsonResponse(sessionPage(snapshot, before));
    }
    if (view === 'message') {
      const message = snapshot.messages.find(message => message.id === query.get('messageId'));
      return message ? safeJsonResponse({ revision: snapshot.revision, message })
        : safeJsonResponse({ error: 'This message is no longer available.' }, { status: 404 });
    }
    if (view === 'canvas') return safeJsonResponse(sessionCanvases(snapshot));
    if (view) return safeJsonResponse({ error: 'Choose a supported session view.' }, { status: 400 });
    return safeJsonResponse({ session: snapshot });
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: sessionStoreStatus(error) });
  }
}

export async function PATCH(request: Request, context: SessionRouteContext): Promise<Response> {
  const denied = await authorizeDeviceRequest(request);
  if (denied) return denied;
  try {
    const parsed = sessionArchivePermissionRequestSchema.safeParse(await request.json());
    if (!parsed.success) return safeJsonResponse({ error: 'Choose an archive permission and its previous value.' }, { status: 400 });
    const { sessionId } = await context.params;
    const config = getConfig();
    const session = await getSessionStore(config.dataDir, config.hostLabel).setAgentArchiveAllowed(
      sessionId, parsed.data.allowAgentArchive, parsed.data.expectedAllowAgentArchive, await webActor(request),
    );
    return safeJsonResponse({ session: publicSession(session) });
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: sessionStoreStatus(error) });
  }
}
