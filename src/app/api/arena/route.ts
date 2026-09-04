import { getConfig } from '@/server/config';
import { runRegistry } from '@/server/runs/runRegistry';
import {
  arenaSessionSummary, getSessionStore, sessionStoreStatus,
} from '@/server/storage/sessionStore';
import { publicError, safeJsonResponse } from '@/shared/protocol';
import { authorizeDeviceRequest } from '@/server/devices/deviceAuthorization';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A bounded, no-cache cross-project snapshot for cards and attention polling. */
export async function GET(request: Request = new Request('http://localhost/api/arena')): Promise<Response> {
  const denied = await authorizeDeviceRequest(request);
  if (denied) return denied;
  try {
    const config = getConfig();
    const store = getSessionStore(config.dataDir, config.hostLabel);
    const [sessions, archivedSessions] = await Promise.all([
      store.listSessions(),
      store.listArchivedSessions(),
    ]);
    return safeJsonResponse({
      sessions: sessions.map(arenaSessionSummary),
      archivedSessions: archivedSessions.map(arenaSessionSummary),
      runs: runRegistry.list(),
    });
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: sessionStoreStatus(error) });
  }
}
