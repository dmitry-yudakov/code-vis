import { authorizeDeviceRequest } from '@/server/devices/deviceAuthorization';
import { boundedRequestBody } from '@/server/machines/boundedBody';
import { runRegistry } from '@/server/runs/runRegistry';
import { sessionStoreStatus } from '@/server/storage/sessionStore';
import { editQueuedMessageRequestSchema, publicError, safeJsonResponse } from '@/shared/protocol';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const denied = await authorizeDeviceRequest(request);
  if (denied) return denied;
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder().decode(await boundedRequestBody(request, 2_000_000))); }
  catch { return safeJsonResponse({ error: 'Queued message request is invalid or too large.' }, { status: 400 }); }
  const parsed = editQueuedMessageRequestSchema.safeParse(raw);
  if (!parsed.success) return safeJsonResponse({ error: 'Queued message request is invalid.' }, { status: 400 });
  try {
    const result = await runRegistry.editQueuedMessage(parsed.data.runId, parsed.data.text, parsed.data.expectedText);
    return safeJsonResponse(result.ok ? result : { error: result.error }, { status: result.ok ? 200 : result.status });
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: sessionStoreStatus(error) });
  }
}
