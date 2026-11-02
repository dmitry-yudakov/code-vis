import { z } from 'zod';
import { getConfig } from '@/server/config';
import { getCheckoutRegistry } from '@/server/repository/checkoutRegistry';
import { pushCurrentBranch } from '@/server/repository/gitPush';
import { authorizeDeviceRequest, requestHasExactOrigin } from '@/server/devices/deviceAuthorization';
import { boundedRequestBody } from '@/server/machines/boundedBody';
import { publicError, safeJsonResponse } from '@/shared/protocol';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const pushRequestSchema = z.object({
  checkoutId: z.string().min(1).max(128), target: z.string().min(1).max(512),
}).strict();

export async function POST(request: Request): Promise<Response> {
  const denied = await authorizeDeviceRequest(request);
  if (denied) return denied;
  const config = getConfig();
  // A push spends the user's credentials, so a page elsewhere must not reach it through localhost.
  if (!requestHasExactOrigin(request, config)) {
    return safeJsonResponse({ error: 'Push must come from this CodeAI page.' }, { status: 403 });
  }
  let parsed;
  try { parsed = pushRequestSchema.safeParse(JSON.parse(new TextDecoder().decode(await boundedRequestBody(request, 1024)))); }
  catch { return safeJsonResponse({ error: 'Push request is not valid JSON.' }, { status: 400 }); }
  if (!parsed.success) return safeJsonResponse({ error: 'Invalid push request.' }, { status: 400 });
  try {
    const checkout = await getCheckoutRegistry(config.repositoriesRoot, config.repositoryDiscoveryDepth).resolve(parsed.data.checkoutId);
    return safeJsonResponse({ target: await pushCurrentBranch(checkout.realPath, parsed.data.target) });
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: 409 });
  }
}
