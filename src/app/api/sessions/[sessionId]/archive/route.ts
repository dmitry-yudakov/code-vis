import { getConfig } from '@/server/config';
import { runRegistry } from '@/server/runs/runRegistry';
import {
  arenaSessionSummary, getSessionStore, sessionStoreStatus,
} from '@/server/storage/sessionStore';
import {
  publicError, safeJsonResponse, sessionLifecycleRequestSchema,
} from '@/shared/protocol';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ sessionId: string }> };

export async function POST(request: Request, context: RouteContext): Promise<Response> {
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
    const session = await getSessionStore(config.dataDir, config.hostLabel)
      .archiveSession(sessionId, parsed.data.expectedRevision);
    return safeJsonResponse({ session: arenaSessionSummary(session) });
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: sessionStoreStatus(error) });
  }
}
