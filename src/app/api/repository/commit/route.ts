import { z } from 'zod';
import { getConfig } from '@/server/config';
import { getCheckoutRegistry } from '@/server/repository/checkoutRegistry';
import { commitGitIndex } from '@/server/repository/gitChanges';
import { readGitCommit, readGitCommitPatch } from '@/server/repository/gitHistory';
import { authorizeDeviceRequest, requestHasExactOrigin } from '@/server/devices/deviceAuthorization';
import { boundedRequestBody } from '@/server/machines/boundedBody';
import { publicError, safeJsonResponse } from '@/shared/protocol';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const schema = z.object({
  checkoutId: z.string().min(1).max(128), message: z.string().trim().min(1).max(16_000).refine(value => !value.includes('\0')),
  indexState: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export async function POST(request: Request): Promise<Response> {
  const denied = await authorizeDeviceRequest(request);
  if (denied) return denied;
  const config = getConfig();
  if (!requestHasExactOrigin(request, config)) return safeJsonResponse({ error: 'Commit from this CodeAI page.' }, { status: 403 });
  let parsed;
  try { parsed = schema.safeParse(JSON.parse(new TextDecoder().decode(await boundedRequestBody(request, 96 * 1024)))); }
  catch { return safeJsonResponse({ error: 'Invalid commit request.' }, { status: 400 }); }
  if (!parsed.success) return safeJsonResponse({ error: 'Invalid commit request.' }, { status: 400 });
  try {
    const checkout = await getCheckoutRegistry(config.repositoriesRoot, config.repositoryDiscoveryDepth).resolve(parsed.data.checkoutId);
    return safeJsonResponse({ hash: await commitGitIndex(checkout.realPath, parsed.data.message, parsed.data.indexState) });
  } catch (error) { return safeJsonResponse({ error: publicError(error) }, { status: 409 }); }
}

export async function GET(request: Request): Promise<Response> {
  const denied = await authorizeDeviceRequest(request);
  if (denied) return denied;
  const query = new URL(request.url).searchParams;
  const checkoutId = query.get('checkoutId') || '';
  const hash = query.get('hash') || '';
  const filePath = query.get('path');
  if (!checkoutId || checkoutId.length > 128 || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(hash)
    || (filePath !== null && (!filePath || filePath.length > 4096 || filePath.includes('\0')))) {
    return safeJsonResponse({ error: 'A valid checkout and full commit hash are required.' }, { status: 400 });
  }
  try {
    const config = getConfig();
    const checkout = await getCheckoutRegistry(config.repositoriesRoot, config.repositoryDiscoveryDepth).resolve(checkoutId);
    return safeJsonResponse(filePath === null ? { details: await readGitCommit(checkout.realPath, hash) }
      : { patch: await readGitCommitPatch(checkout.realPath, hash, filePath) });
  } catch (error) { return safeJsonResponse({ error: publicError(error) }, { status: 400 }); }
}
