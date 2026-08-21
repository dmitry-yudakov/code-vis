import { getConfig } from '@/server/config';
import { readWorkingTree } from '@/server/repository/gitRepository';
import { getProjectRegistry } from '@/server/projects/projectRegistry';
import { publicError, safeJsonResponse } from '@/shared/protocol';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  try {
    const projectId = new URL(request.url).searchParams.get('projectId') || '';
    if (!projectId || projectId.length > 128) {
      return safeJsonResponse({ error: 'A valid project id is required.' }, { status: 400 });
    }
    const config = getConfig();
    const project = await getProjectRegistry(config.projectsRoot, config.projectDiscoveryDepth).resolve(projectId);
    return safeJsonResponse({ tree: await readWorkingTree(project.realPath) });
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: 400 });
  }
}
