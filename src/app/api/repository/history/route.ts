import { getConfig } from '@/server/config';
import { readGitHistory } from '@/server/repository/gitHistory';
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
    if (!checkoutId || checkoutId.length > 128) return safeJsonResponse({ error: 'A valid checkout id is required.' }, { status: 400 });
    const config = getConfig();
    const checkout = await getCheckoutRegistry(config.repositoriesRoot, config.repositoryDiscoveryDepth).resolve(checkoutId);
    return safeJsonResponse({ history: await readGitHistory(checkout.realPath) });
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: 400 });
  }
}
