import { getConfig } from '@/server/config';
import { getProjectRegistry } from '@/server/projects/projectRegistry';
import { recentProjectIds } from '@/server/projects/recentProjects';
import { getSessionStore } from '@/server/storage/sessionStore';
import { publicError, safeJsonResponse } from '@/shared/protocol';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    const config = getConfig();
    const store = getSessionStore(config.dataDir, config.hostLabel);
    const [projects, sessions, host] = await Promise.all([
      getProjectRegistry(config.projectsRoot, config.projectDiscoveryDepth).list(),
      store.listSessions(),
      store.host(),
    ]);
    return safeJsonResponse({
      projects,
      recentProjectIds: recentProjectIds(projects, sessions, host.id),
      discoveryDepth: config.projectDiscoveryDepth,
    });
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: 503 });
  }
}
