import { permissionDecisionRequestSchema, safeJsonResponse } from '@/shared/protocol';
import { runRegistry } from '@/server/runs/runRegistry';
import { authorizeDeviceRequest } from '@/server/devices/deviceAuthorization';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const denied = await authorizeDeviceRequest(request);
  if (denied) return denied;
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return safeJsonResponse({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }
  const parsed = permissionDecisionRequestSchema.safeParse(raw);
  if (!parsed.success) return safeJsonResponse({ error: 'Permission decision is invalid.' }, { status: 400 });

  const outcome = runRegistry.decide(parsed.data.runId, parsed.data.requestId, parsed.data.decision);
  if (outcome === 'unknown-run') {
    return safeJsonResponse({ error: 'That agent run is no longer active.' }, { status: 404 });
  }
  if (outcome === 'unknown-request') {
    return safeJsonResponse({ error: 'That approval was already resolved.' }, { status: 409 });
  }
  return safeJsonResponse({ ok: true, decision: parsed.data.decision });
}
