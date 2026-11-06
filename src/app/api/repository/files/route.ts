import { getConfig } from '@/server/config';
import { getCheckoutRegistry } from '@/server/repository/checkoutRegistry';
import { listRepositoryDirectory, RepositoryFileError } from '@/server/repository/repositoryFiles';
import { publicError, safeJsonResponse } from '@/shared/protocol';
import { authorizeDeviceRequest } from '@/server/devices/deviceAuthorization';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const denied = await authorizeDeviceRequest(request);
  if (denied) return denied;
  try {
    const query = new URL(request.url).searchParams;
    const checkoutId = query.get('checkoutId') || '';
    const requested = query.get('path') || '';
    if (!checkoutId || checkoutId.length > 128 || requested.length > 4096) {
      return safeJsonResponse({ error: 'A valid checkout and folder path are required.' }, { status: 400 });
    }
    const config = getConfig();
    const checkout = await getCheckoutRegistry(config.repositoriesRoot, config.repositoryDiscoveryDepth).resolve(checkoutId);
    return safeJsonResponse({ directory: await listRepositoryDirectory(checkout.realPath, requested) });
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: error instanceof RepositoryFileError ? error.status : 400 });
  }
}
