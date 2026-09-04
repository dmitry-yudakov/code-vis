import { getConfig } from '@/server/config';
import {
  sessionStoreStatus, getSessionStore, publicSession,
} from '@/server/storage/sessionStore';
import { publicError, safeJsonResponse } from '@/shared/protocol';
import { authorizeDeviceRequest } from '@/server/devices/deviceAuthorization';

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
    return safeJsonResponse({ session: publicSession(session) });
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: sessionStoreStatus(error) });
  }
}
