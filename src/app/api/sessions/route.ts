import { getConfig } from '@/server/config';
import {
  sessionStoreStatus, getSessionStore, publicSession,
} from '@/server/storage/sessionStore';
import { createSessionRequestSchema, publicError, safeJsonResponse } from '@/shared/protocol';
import { authorizeDeviceRequest } from '@/server/devices/deviceAuthorization';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const denied = await authorizeDeviceRequest(request);
  if (denied) return denied;
  const query = new URL(request.url).searchParams;
  const projectId = query.get('projectId') || undefined;
  const loose = query.get('loose') === 'true';
  if (projectId && loose) {
    return safeJsonResponse({ error: 'Choose either a project or loose sessions, not both.' }, { status: 400 });
  }
  if (projectId && !/^[0-9a-f-]{36}$/i.test(projectId)) {
    return safeJsonResponse({ error: 'A valid project id is required.' }, { status: 400 });
  }
  try {
    const config = getConfig();
    const sessions = await getSessionStore(config.dataDir, config.hostLabel).listSessions({ projectId, loose });
    return safeJsonResponse({ sessions: sessions.map(publicSession) });
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: sessionStoreStatus(error) });
  }
}

export async function POST(request: Request): Promise<Response> {
  const denied = await authorizeDeviceRequest(request);
  if (denied) return denied;
  try {
    const parsed = createSessionRequestSchema.safeParse(await request.json());
    if (!parsed.success) return safeJsonResponse({ error: 'A valid project, provider, and role are required.' }, { status: 400 });
    const config = getConfig();
    const store = getSessionStore(config.dataDir, config.hostLabel);
    if (parsed.data.projectId) await store.getProject(parsed.data.projectId);
    const session = await store.createSession(parsed.data);
    return safeJsonResponse({ session: publicSession(session) }, { status: 201 });
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: sessionStoreStatus(error) });
  }
}
