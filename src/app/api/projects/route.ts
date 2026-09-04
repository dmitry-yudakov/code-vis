import { getConfig } from '@/server/config';
import { getCheckoutRegistry } from '@/server/repository/checkoutRegistry';
import { getSessionStore } from '@/server/storage/sessionStore';
import { createProjectRequestSchema, publicError, safeJsonResponse } from '@/shared/protocol';
import { authorizeDeviceRequest } from '@/server/devices/deviceAuthorization';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request = new Request('http://localhost/api/projects')): Promise<Response> {
  const denied = await authorizeDeviceRequest(request);
  if (denied) return denied;
  try {
    const config = getConfig();
    const projects = await getSessionStore(config.dataDir, config.hostLabel).listProjects();
    return safeJsonResponse({ projects });
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: 503 });
  }
}

export async function POST(request: Request): Promise<Response> {
  const denied = await authorizeDeviceRequest(request);
  if (denied) return denied;
  try {
    const parsed = createProjectRequestSchema.safeParse(await request.json());
    if (!parsed.success) return safeJsonResponse({ error: 'A valid project name and repositories are required.' }, { status: 400 });
    const config = getConfig();
    const registry = getCheckoutRegistry(config.repositoriesRoot, config.repositoryDiscoveryDepth);
    await registry.resolveMany(parsed.data.checkoutIds);
    const project = await getSessionStore(config.dataDir, config.hostLabel)
      .createProject(parsed.data.name, parsed.data.checkoutIds);
    return safeJsonResponse({ project }, { status: 201 });
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: 400 });
  }
}
