import { getConfig } from '@/server/config';
import { getCheckoutRegistry } from '@/server/repository/checkoutRegistry';
import { getSessionStore, sessionStoreStatus } from '@/server/storage/sessionStore';
import {
  deleteProjectRequestSchema, publicError, safeJsonResponse, updateProjectRequestSchema,
} from '@/shared/protocol';
import { authorizeDeviceRequest } from '@/server/devices/deviceAuthorization';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ProjectRouteContext = { params: Promise<{ projectId: string }> };

export async function GET(request: Request, context: ProjectRouteContext): Promise<Response> {
  const denied = await authorizeDeviceRequest(request);
  if (denied) return denied;
  try {
    const { projectId } = await context.params;
    const config = getConfig();
    const project = await getSessionStore(config.dataDir, config.hostLabel).getProject(projectId);
    return safeJsonResponse({ project });
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: sessionStoreStatus(error) });
  }
}

export async function PATCH(request: Request, context: ProjectRouteContext): Promise<Response> {
  const denied = await authorizeDeviceRequest(request);
  if (denied) return denied;
  try {
    const parsed = updateProjectRequestSchema.safeParse(await request.json());
    if (!parsed.success) return safeJsonResponse({ error: 'A valid revision and project update are required.' }, { status: 400 });
    const { projectId } = await context.params;
    const config = getConfig();
    const store = getSessionStore(config.dataDir, config.hostLabel);
    if (parsed.data.repositories) {
      const host = await store.host();
      const registry = getCheckoutRegistry(config.repositoriesRoot, config.repositoryDiscoveryDepth);
      await registry.resolveMany(parsed.data.repositories
        .filter((repository) => repository.hostId === host.id)
        .map((repository) => repository.checkoutId));
    }
    const project = await store.updateProject(projectId, parsed.data);
    return safeJsonResponse({ project });
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: sessionStoreStatus(error) });
  }
}

export async function DELETE(request: Request, context: ProjectRouteContext): Promise<Response> {
  const denied = await authorizeDeviceRequest(request);
  if (denied) return denied;
  try {
    const parsed = deleteProjectRequestSchema.safeParse(await request.json());
    if (!parsed.success) return safeJsonResponse({ error: 'A valid project revision is required.' }, { status: 400 });
    const { projectId } = await context.params;
    const config = getConfig();
    const result = await getSessionStore(config.dataDir, config.hostLabel)
      .deleteProject(projectId, parsed.data.expectedRevision);
    return safeJsonResponse(result);
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: sessionStoreStatus(error) });
  }
}
