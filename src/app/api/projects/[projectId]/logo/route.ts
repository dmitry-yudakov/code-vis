import { getConfig } from '@/server/config';
import { authorizeDeviceRequest } from '@/server/devices/deviceAuthorization';
import { readProjectLogo } from '@/server/repository/projectLogo';
import { RepositoryFileError } from '@/server/repository/repositoryFiles';
import { getSessionStore, sessionStoreStatus } from '@/server/storage/sessionStore';
import { publicError, safeJsonResponse } from '@/shared/protocol';
import { projectLogoSchema } from '@/shared/sessionSchema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ projectId: string }> }): Promise<Response> {
  const denied = await authorizeDeviceRequest(request);
  if (denied) return denied;
  try {
    const { projectId } = await context.params;
    const config = getConfig();
    const store = getSessionStore(config.dataDir, config.hostLabel);
    const project = await store.getProject(projectId);
    const query = new URL(request.url).searchParams;
    if (query.has('repositoryId') || query.has('path')) {
      const parsed = projectLogoSchema.safeParse({ repositoryId: query.get('repositoryId'), path: query.get('path') });
      if (!parsed.success) return safeJsonResponse({ error: 'Choose a valid repository image path.' }, { status: 400 });
      project.logo = parsed.data;
    }
    const image = await readProjectLogo(project, (await store.host()).id, config);
    return new Response(image.bytes, { headers: {
      'Content-Type': image.contentType,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'none'",
    } });
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: error instanceof RepositoryFileError ? error.status : sessionStoreStatus(error) });
  }
}
