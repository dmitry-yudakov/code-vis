import { authorizePersonalDeviceRequest } from '@/server/devices/deviceAuthorization';
import { boundedRequestBody } from '@/server/machines/boundedBody';
import { askObserver, ObserverError } from '@/server/observer/observerService';
import { observerRequestSchema } from '@/shared/observer';
import { safeJsonResponse } from '@/shared/protocol';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const denied = await authorizePersonalDeviceRequest(request);
  if (denied) return denied;
  let value: unknown;
  try { value = JSON.parse(new TextDecoder().decode(await boundedRequestBody(request, 160 * 1024, AbortSignal.any([request.signal, AbortSignal.timeout(15_000)])))); }
  catch { return safeJsonResponse({ error: 'Observer question is invalid or too large.' }, { status: 400 }); }
  const parsed = observerRequestSchema.safeParse(value);
  if (!parsed.success) return safeJsonResponse({ error: 'Choose a provider and a question of at most 8,000 characters.' }, { status: 400 });
  try {
    const result = await askObserver(parsed.data, request.signal);
    const revoked = await authorizePersonalDeviceRequest(request);
    if (revoked) return revoked;
    request.signal.throwIfAborted();
    return safeJsonResponse(result);
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    return safeJsonResponse({ error: error instanceof ObserverError ? error.message : 'Observer could not answer. Check the provider and retry.' },
      { status: error instanceof ObserverError ? error.status : 503 });
  }
}
