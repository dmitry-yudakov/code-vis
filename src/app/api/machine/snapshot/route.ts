import { authorizeMachineRequest } from '@/server/devices/deviceAuthorization';
import { localExecutorSnapshot } from '@/server/machines/localExecutorSnapshot';
import { publicError, safeJsonResponse } from '@/shared/protocol';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const denied = await authorizeMachineRequest(request);
  if (denied) return denied;
  try {
    return safeJsonResponse(await localExecutorSnapshot());
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: 503 });
  }
}
