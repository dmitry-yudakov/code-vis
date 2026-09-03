import { getConfig } from '@/server/config';
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
    const config = getConfig();
    const session = await getSessionStore(config.dataDir, config.hostLabel)
      .restoreSession(sessionId, parsed.data.expectedRevision);
    return safeJsonResponse({ session: arenaSessionSummary(session) });
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: sessionStoreStatus(error) });
  }
}
