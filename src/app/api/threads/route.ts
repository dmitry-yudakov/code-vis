import { getConfig } from '@/server/config';
import { getProjectRegistry } from '@/server/projects/projectRegistry';
import {
  conversationStoreStatus, getConversationStore, publicConversation,
} from '@/server/storage/conversationStore';
import { createThreadRequestSchema, publicError, safeJsonResponse } from '@/shared/protocol';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const checkoutId = new URL(request.url).searchParams.get('checkoutId') || undefined;
  if (checkoutId && checkoutId.length > 128) {
    return safeJsonResponse({ error: 'A valid checkout id is required.' }, { status: 400 });
  }
  try {
    const config = getConfig();
    const conversations = await getConversationStore(config.dataDir, config.hostLabel).listConversations(checkoutId);
    return safeJsonResponse({ threads: conversations.map(publicConversation) });
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: conversationStoreStatus(error) });
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const parsed = createThreadRequestSchema.safeParse(await request.json());
    if (!parsed.success) return safeJsonResponse({ error: 'A valid checkout, provider, and role are required.' }, { status: 400 });
    const config = getConfig();
    if (parsed.data.checkoutId) {
      await getProjectRegistry(config.projectsRoot, config.projectDiscoveryDepth).resolve(parsed.data.checkoutId);
    }
    const conversation = await getConversationStore(config.dataDir, config.hostLabel).createConversation(parsed.data);
    return safeJsonResponse({ thread: publicConversation(conversation) }, { status: 201 });
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: conversationStoreStatus(error) });
  }
}
