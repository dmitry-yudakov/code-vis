import { getConfig } from '@/lib/server/config';
import { getProjectRegistry } from '@/lib/server/projectRegistry';
import { publicError, safeJsonResponse } from '@/lib/shared/protocol';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    const config = getConfig();
    const projects = await getProjectRegistry(config.projectsRoot, config.projectDiscoveryDepth).list();
    return safeJsonResponse({ projects, discoveryDepth: config.projectDiscoveryDepth });
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: 503 });
  }
}
