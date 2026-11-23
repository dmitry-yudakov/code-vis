import { z } from 'zod';
import { getConfig } from '@/server/config';
import { getCheckoutRegistry } from '@/server/repository/checkoutRegistry';
import { changeGitIndex } from '@/server/repository/gitChanges';
import { authorizeDeviceRequest, requestHasExactOrigin } from '@/server/devices/deviceAuthorization';
import { webActivityRecorder } from '@/server/devices/activityActor';
import { boundedRequestBody } from '@/server/machines/boundedBody';
import { publicError, safeJsonResponse } from '@/shared/protocol';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const schema = z.object({
  checkoutId: z.string().min(1).max(128), action: z.enum(['stage', 'unstage']),
  paths: z.array(z.string().min(1).max(4096).refine(value => !value.includes('\0'))).min(1).max(1000),
  indexState: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export async function POST(request: Request): Promise<Response> {
  const denied = await authorizeDeviceRequest(request);
  if (denied) return denied;
  const config = getConfig();
  if (!requestHasExactOrigin(request, config)) return safeJsonResponse({ error: 'Stage files from this CodeAI page.' }, { status: 403 });
  let parsed;
  try { parsed = schema.safeParse(JSON.parse(new TextDecoder().decode(await boundedRequestBody(request, 256 * 1024)))); }
  catch { return safeJsonResponse({ error: 'Invalid staging request.' }, { status: 400 }); }
  if (!parsed.success) return safeJsonResponse({ error: 'Invalid staging request.' }, { status: 400 });
  try {
    const record = await webActivityRecorder(request, config.dataDir);
    const checkout = await getCheckoutRegistry(config.repositoriesRoot, config.repositoryDiscoveryDepth).resolve(parsed.data.checkoutId);
    await changeGitIndex(checkout.realPath, parsed.data.action, parsed.data.paths, parsed.data.indexState);
    await record({ action: parsed.data.action === 'stage' ? 'git.stage' : 'git.unstage', checkoutId: checkout.id });
    return safeJsonResponse({ ok: true });
  } catch (error) { return safeJsonResponse({ error: publicError(error) }, { status: 409 }); }
}
