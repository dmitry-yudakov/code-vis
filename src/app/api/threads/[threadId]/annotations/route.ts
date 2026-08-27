import { getConfig } from '@/server/config';
import {
  conversationStoreStatus, getConversationStore, publicConversation,
} from '@/server/storage/conversationStore';
import { publicError, putAnnotationRequestSchema, safeJsonResponse } from '@/shared/protocol';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ threadId: string }> };

export async function PUT(request: Request, context: RouteContext): Promise<Response> {
  try {
    const parsed = putAnnotationRequestSchema.safeParse(await request.json());
    if (!parsed.success) return safeJsonResponse({ error: 'A valid annotation and expected revision are required.' }, { status: 400 });
    const { threadId } = await context.params;
    const config = getConfig();
    const conversation = await getConversationStore(config.dataDir, config.hostLabel).putAnnotation(
      threadId,
      parsed.data.annotation,
      parsed.data.expectedRevision,
    );
    return safeJsonResponse({ thread: publicConversation(conversation) });
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: conversationStoreStatus(error) });
  }
}
