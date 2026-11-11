import { z } from 'zod';
import { getConfig } from '@/server/config';
import { getCheckoutRegistry } from '@/server/repository/checkoutRegistry';
import { listGitBranches, switchGitBranch } from '@/server/repository/gitBranches';
import { authorizeDeviceRequest, requestHasExactOrigin } from '@/server/devices/deviceAuthorization';
import { boundedRequestBody } from '@/server/machines/boundedBody';
import { publicError, safeJsonResponse } from '@/shared/protocol';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const switchSchema = z.object({
  checkoutId: z.string().min(1).max(128), branch: z.string().min(1).max(512), head: z.string().min(1).max(1024),
}).strict();

export async function GET(request: Request): Promise<Response> {
  const denied = await authorizeDeviceRequest(request);
  if (denied) return denied;
  const checkoutId = new URL(request.url).searchParams.get('checkoutId') || '';
  if (!checkoutId || checkoutId.length > 128) return safeJsonResponse({ error: 'A valid checkout id is required.' }, { status: 400 });
  try {
    const config = getConfig();
    const checkout = await getCheckoutRegistry(config.repositoriesRoot, config.repositoryDiscoveryDepth).resolve(checkoutId);
    return safeJsonResponse({ branches: await listGitBranches(checkout.realPath) });
  } catch (error) { return safeJsonResponse({ error: publicError(error) }, { status: 400 }); }
}

export async function POST(request: Request): Promise<Response> {
  const denied = await authorizeDeviceRequest(request);
  if (denied) return denied;
  const config = getConfig();
  if (!requestHasExactOrigin(request, config)) return safeJsonResponse({ error: 'Switch branches from this CodeAI page.' }, { status: 403 });
  let parsed;
  try { parsed = switchSchema.safeParse(JSON.parse(new TextDecoder().decode(await boundedRequestBody(request, 4096)))); }
  catch { return safeJsonResponse({ error: 'Branch request is not valid JSON.' }, { status: 400 }); }
  if (!parsed.success) return safeJsonResponse({ error: 'Invalid branch request.' }, { status: 400 });
  try {
    const checkout = await getCheckoutRegistry(config.repositoriesRoot, config.repositoryDiscoveryDepth).resolve(parsed.data.checkoutId);
    return safeJsonResponse({ branch: await switchGitBranch(checkout.realPath, parsed.data.branch, parsed.data.head) });
  } catch (error) { return safeJsonResponse({ error: publicError(error) }, { status: 409 }); }
}
