import { getConfig } from '@/server/config';
import { readWorkingTree } from '@/server/repository/gitRepository';
import { getCheckoutRegistry } from '@/server/repository/checkoutRegistry';
import { publicError, safeJsonResponse } from '@/shared/protocol';
import { authorizeDeviceRequest } from '@/server/devices/deviceAuthorization';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const denied = await authorizeDeviceRequest(request);
  if (denied) return denied;
  try {
    const checkoutId = new URL(request.url).searchParams.get('checkoutId') || '';
    if (!checkoutId || checkoutId.length > 128) {
      return safeJsonResponse({ error: 'A valid checkout id is required.' }, { status: 400 });
    }
    const config = getConfig();
    const checkout = await getCheckoutRegistry(config.repositoriesRoot, config.repositoryDiscoveryDepth).resolve(checkoutId);
    return safeJsonResponse({ tree: await readWorkingTree(checkout.realPath) });
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: 400 });
  }
}
