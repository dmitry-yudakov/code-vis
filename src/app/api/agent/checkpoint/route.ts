import { z } from 'zod';
import { authorizeDeviceRequest } from '@/server/devices/deviceAuthorization';
import { getConfig } from '@/server/config';
import { getSessionStore, sessionStoreStatus } from '@/server/storage/sessionStore';
import { getTurnCheckpoints } from '@/server/repository/turnCheckpoints';
import { publicError, safeJsonResponse } from '@/shared/protocol';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const denied = await authorizeDeviceRequest(request); if (denied) return denied;
  const sessionId = z.string().uuid().safeParse(new URL(request.url).searchParams.get('sessionId'));
  if (!sessionId.success) return safeJsonResponse({ error: 'Invalid session identity.' }, { status: 400 });
  const config = getConfig();
  try { await getSessionStore(config.dataDir, config.hostLabel).getSession(sessionId.data); }
  catch (error) { return safeJsonResponse({ error: publicError(error) }, { status: sessionStoreStatus(error) }); }
  try {
    return safeJsonResponse({ checkpoint: await getTurnCheckpoints(config.dataDir).latest(sessionId.data) ?? null });
  } catch {
    return safeJsonResponse({ error: 'Recovery status could not be read on this machine.' }, { status: 503 });
  }
}
