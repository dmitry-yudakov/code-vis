import { getConfig } from '@/server/config';
import { authorizeDeviceRequest } from '@/server/devices/deviceAuthorization';
import { runRegistry } from '@/server/runs/runRegistry';
import { completedArchiveReply, getSessionStore, sessionStoreStatus } from '@/server/storage/sessionStore';
import { checkSessionCompletion } from '@/server/conversation/agentSessionArchive';
import { publicError, safeJsonResponse, sessionCompletionCheckRequestSchema } from '@/shared/protocol';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }): Promise<Response> {
  const denied = await authorizeDeviceRequest(request);
  if (denied) return denied;
  try {
    const parsed = sessionCompletionCheckRequestSchema.safeParse(await request.json());
    if (!parsed.success) return safeJsonResponse({ error: 'Choose a saved final reply to check.' }, { status: 400 });
    const { sessionId } = await context.params;
    const config = getConfig();
    const store = getSessionStore(config.dataDir, config.hostLabel);
    const session = await store.getSession(sessionId);
    if (!session.allowAgentArchive || runRegistry.hasLiveSession(sessionId) || !completedArchiveReply(session, parsed.data.messageId)) {
      return safeJsonResponse({ error: 'Enable archive permission and wait for the latest turn to finish.' }, { status: 409 });
    }
    void checkSessionCompletion({ sessionId, messageId: parsed.data.messageId, sessionStore: store, config });
    return safeJsonResponse({ accepted: true }, { status: 202 });
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: sessionStoreStatus(error) });
  }
}
