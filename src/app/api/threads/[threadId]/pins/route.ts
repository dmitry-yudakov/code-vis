import { getConfig } from '@/server/config';
import {
  conversationStoreStatus, getConversationStore, publicConversation,
} from '@/server/storage/conversationStore';
import { publicError, safeJsonResponse, setPinsRequestSchema } from '@/shared/protocol';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ threadId: string }> };

export async function PUT(request: Request, context: RouteContext): Promise<Response> {
  try {
    const parsed = setPinsRequestSchema.safeParse(await request.json());
    if (!parsed.success) return safeJsonResponse({ error: 'Valid pins and an expected revision are required.' }, { status: 400 });
    const { threadId } = await context.params;
    const config = getConfig();
    const conversation = await getConversationStore(config.dataDir, config.hostLabel).setPins(
      threadId,
      parsed.data.pinnedDiagramIds,
      parsed.data.expectedRevision,
    );
    return safeJsonResponse({ thread: publicConversation(conversation) });
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: conversationStoreStatus(error) });
  }
}
