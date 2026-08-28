import { getConfig } from '@/server/config';
import { getProjectRegistry } from '@/server/projects/projectRegistry';
import { recentProjectIds } from '@/server/projects/recentProjects';
import { getConversationStore } from '@/server/storage/conversationStore';
import { publicError, safeJsonResponse } from '@/shared/protocol';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    const config = getConfig();
    const store = getConversationStore(config.dataDir, config.hostLabel);
    const [projects, conversations, host] = await Promise.all([
      getProjectRegistry(config.projectsRoot, config.projectDiscoveryDepth).list(),
      store.listConversations(),
      store.host(),
    ]);
    return safeJsonResponse({
      projects,
      recentProjectIds: recentProjectIds(projects, conversations, host.id),
      discoveryDepth: config.projectDiscoveryDepth,
    });
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: 503 });
  }
}
