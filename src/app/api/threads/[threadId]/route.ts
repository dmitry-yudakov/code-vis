import { getConfig } from '@/server/config';
import {
  conversationStoreStatus, getConversationStore, publicConversation,
} from '@/server/storage/conversationStore';
import { publicError, safeJsonResponse } from '@/shared/protocol';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ThreadRouteContext = { params: Promise<{ threadId: string }> };

export async function GET(_request: Request, context: ThreadRouteContext): Promise<Response> {
  try {
    const { threadId } = await context.params;
    const config = getConfig();
    const conversation = await getConversationStore(config.dataDir, config.hostLabel).getConversation(threadId);
    return safeJsonResponse({ thread: publicConversation(conversation) });
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: conversationStoreStatus(error) });
  }
}
