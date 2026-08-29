import { getConfig } from '@/server/config';
import {
  sessionStoreStatus, getSessionStore, publicSession,
} from '@/server/storage/sessionStore';
import { publicError, safeJsonResponse, setPinsRequestSchema } from '@/shared/protocol';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ sessionId: string }> };

export async function PUT(request: Request, context: RouteContext): Promise<Response> {
  try {
    const parsed = setPinsRequestSchema.safeParse(await request.json());
    if (!parsed.success) return safeJsonResponse({ error: 'Valid pins and an expected revision are required.' }, { status: 400 });
    const { sessionId } = await context.params;
    const config = getConfig();
    const session = await getSessionStore(config.dataDir, config.hostLabel).setPins(
      sessionId,
      parsed.data.pinnedDiagramIds,
      parsed.data.expectedRevision,
    );
    return safeJsonResponse({ session: publicSession(session) });
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: sessionStoreStatus(error) });
  }
}
