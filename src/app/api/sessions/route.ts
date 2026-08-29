import { getConfig } from '@/server/config';
import { getProjectRegistry } from '@/server/projects/projectRegistry';
import {
  sessionStoreStatus, getSessionStore, publicSession,
} from '@/server/storage/sessionStore';
import { createSessionRequestSchema, publicError, safeJsonResponse } from '@/shared/protocol';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const checkoutId = new URL(request.url).searchParams.get('checkoutId') || undefined;
  if (checkoutId && checkoutId.length > 128) {
    return safeJsonResponse({ error: 'A valid checkout id is required.' }, { status: 400 });
  }
  try {
    const config = getConfig();
    const sessions = await getSessionStore(config.dataDir, config.hostLabel).listSessions(checkoutId);
    return safeJsonResponse({ sessions: sessions.map(publicSession) });
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: sessionStoreStatus(error) });
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const parsed = createSessionRequestSchema.safeParse(await request.json());
    if (!parsed.success) return safeJsonResponse({ error: 'A valid checkout, provider, and role are required.' }, { status: 400 });
    const config = getConfig();
    if (parsed.data.checkoutId) {
      await getProjectRegistry(config.projectsRoot, config.projectDiscoveryDepth).resolve(parsed.data.checkoutId);
    }
    const session = await getSessionStore(config.dataDir, config.hostLabel).createSession(parsed.data);
    return safeJsonResponse({ session: publicSession(session) }, { status: 201 });
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: sessionStoreStatus(error) });
  }
}
