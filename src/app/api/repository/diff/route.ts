import { getConfig } from '@/server/config';
import { findChangedFile, readFileDiff, readWorkingTree } from '@/server/repository/gitRepository';
import { getProjectRegistry } from '@/server/projects/projectRegistry';
import { publicError, safeJsonResponse } from '@/shared/protocol';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  try {
    const query = new URL(request.url).searchParams;
    const projectId = query.get('projectId') || '';
    const requestedPath = query.get('path') || '';
    if (!projectId || projectId.length > 128 || !requestedPath || requestedPath.length > 4_096) {
      return safeJsonResponse({ error: 'A valid project and changed file are required.' }, { status: 400 });
    }

    const config = getConfig();
    const project = await getProjectRegistry(config.projectsRoot, config.projectDiscoveryDepth).resolve(projectId);
    const tree = await readWorkingTree(project.realPath);
    const file = findChangedFile(tree, requestedPath);
    if (!file) return safeJsonResponse({ error: 'That file is not in the current change set.' }, { status: 404 });
    return safeJsonResponse({ diff: await readFileDiff(project.realPath, file) });
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: 400 });
  }
}
