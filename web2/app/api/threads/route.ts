import { getConfig } from '@/lib/server/config';
import { getProjectRegistry } from '@/lib/server/projectRegistry';
import { getThreadRegistry } from '@/lib/server/threadRegistry';
import { createThreadRequestSchema, publicError, safeJsonResponse } from '@/lib/shared/protocol';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  try {
    const parsed = createThreadRequestSchema.safeParse(await request.json());
    if (!parsed.success) return safeJsonResponse({ error: 'A valid project id is required.' }, { status: 400 });
    const config = getConfig();
    const projects = getProjectRegistry(config.projectsRoot, config.projectDiscoveryDepth);
    await projects.resolve(parsed.data.projectId);
    const thread = await getThreadRegistry(config.dataDir).create(parsed.data.projectId, parsed.data.provider);
    return safeJsonResponse({
      thread: {
        id: thread.id,
        projectId: thread.projectId,
        createdAt: thread.createdAt,
        provider: thread.agent.provider,
      },
    }, { status: 201 });
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: 400 });
  }
}
