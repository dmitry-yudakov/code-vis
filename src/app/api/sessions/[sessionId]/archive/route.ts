import { getConfig } from '@/server/config';
import { runRegistry } from '@/server/runs/runRegistry';
import {
  arenaSessionSummary, getSessionStore, sessionStoreStatus,
} from '@/server/storage/sessionStore';
import {
  publicError, safeJsonResponse, sessionLifecycleRequestSchema,
} from '@/shared/protocol';
import { authorizeDeviceRequest } from '@/server/devices/deviceAuthorization';
import { recoverDockerExecution } from '@/server/execution/dockerRecovery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ sessionId: string }> };

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const denied = await authorizeDeviceRequest(request);
  if (denied) return denied;
  try {
    const parsed = sessionLifecycleRequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return safeJsonResponse({ error: 'A valid expected revision is required.' }, { status: 400 });
    }
    const { sessionId } = await context.params;
    if (runRegistry.hasLiveSession(sessionId)) {
      return safeJsonResponse({
        error: 'This session has an agent turn reserved, queued, running, or waiting for approval.',
      }, { status: 409 });
    }
    const config = getConfig();
    await recoverDockerExecution(config);
    const release = runRegistry.acquireSessionArchive(sessionId);
    if (!release) return safeJsonResponse({ error: 'This session is busy or is already being archived.' }, { status: 409 });
    try {
      const session = await getSessionStore(config.dataDir, config.hostLabel)
        .archiveSession(sessionId, parsed.data.expectedRevision);
      return safeJsonResponse({ session: arenaSessionSummary(session) });
    } finally {
      release();
    }
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: sessionStoreStatus(error) });
  }
}
