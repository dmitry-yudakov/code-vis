import { changeRunModeRequestSchema, publicError, safeJsonResponse } from '@/shared/protocol';
import { authorizeDeviceRequest } from '@/server/devices/deviceAuthorization';
import { runRegistry } from '@/server/runs/runRegistry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const denied = await authorizeDeviceRequest(request);
  if (denied) return denied;
  let raw: unknown;
  try { raw = await request.json(); }
  catch { return safeJsonResponse({ error: 'Request body must be valid JSON.' }, { status: 400 }); }
  const parsed = changeRunModeRequestSchema.safeParse(raw);
  if (!parsed.success) return safeJsonResponse({ error: 'Mode change request is invalid.' }, { status: 400 });
  try {
    const result = await runRegistry.changeMode(parsed.data.runId, parsed.data.mode);
    return result.ok ? safeJsonResponse(result) : safeJsonResponse({ error: result.error }, { status: result.status });
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: 500 });
  }
}
