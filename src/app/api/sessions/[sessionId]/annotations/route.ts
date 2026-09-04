import { getConfig } from '@/server/config';
import {
  sessionStoreStatus, getSessionStore, publicSession,
} from '@/server/storage/sessionStore';
import { publicError, putAnnotationRequestSchema, safeJsonResponse } from '@/shared/protocol';
import { authorizeDeviceRequest } from '@/server/devices/deviceAuthorization';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ sessionId: string }> };

export async function PUT(request: Request, context: RouteContext): Promise<Response> {
  const denied = await authorizeDeviceRequest(request);
  if (denied) return denied;
  try {
    const parsed = putAnnotationRequestSchema.safeParse(await request.json());
    if (!parsed.success) return safeJsonResponse({ error: 'A valid annotation and expected revision are required.' }, { status: 400 });
    const { sessionId } = await context.params;
    const config = getConfig();
    const session = await getSessionStore(config.dataDir, config.hostLabel).putAnnotation(
      sessionId,
      parsed.data.annotation,
      parsed.data.expectedRevision,
    );
    return safeJsonResponse({ session: publicSession(session) });
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: sessionStoreStatus(error) });
  }
}
