import { getConfig } from '@/server/config';
import { findChangedFile, readFileDiff, readWorkingTree } from '@/server/repository/gitRepository';
import { getCheckoutRegistry } from '@/server/repository/checkoutRegistry';
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
    const requestedPath = query.get('path') || '';
    if (!checkoutId || checkoutId.length > 128 || !requestedPath || requestedPath.length > 4_096) {
      return safeJsonResponse({ error: 'A valid checkout and changed file are required.' }, { status: 400 });
    }

    const config = getConfig();
    const checkout = await getCheckoutRegistry(config.repositoriesRoot, config.repositoryDiscoveryDepth).resolve(checkoutId);
    const tree = await readWorkingTree(checkout.realPath);
    const file = findChangedFile(tree, requestedPath);
    if (!file) return safeJsonResponse({ error: 'That file is not in the current change set.' }, { status: 404 });
    return safeJsonResponse({ diff: await readFileDiff(checkout.realPath, file) });
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: 400 });
  }
}
