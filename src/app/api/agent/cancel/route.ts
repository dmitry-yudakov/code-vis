import { cancelRunRequestSchema, safeJsonResponse } from '@/shared/protocol';
import { runRegistry } from '@/server/runs/runRegistry';
import { authorizeDeviceRequest } from '@/server/devices/deviceAuthorization';
import { webActivityRecorder } from '@/server/devices/activityActor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Cancelling is now an explicit act. Closing the tab no longer stops a run, so this is the only
 * way a user ends one early.
 */
export async function POST(request: Request): Promise<Response> {
  const denied = await authorizeDeviceRequest(request);
  if (denied) return denied;
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return safeJsonResponse({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }
  const parsed = cancelRunRequestSchema.safeParse(raw);
  if (!parsed.success) return safeJsonResponse({ error: 'Cancel request is invalid.' }, { status: 400 });
  const record = await webActivityRecorder(request);
  const run = runRegistry.currentRuns.find(item => item.runId === parsed.data.runId);
  const outcome = await runRegistry.cancel(parsed.data.runId);
  if (outcome === 'unknown-run') {
    return safeJsonResponse({ error: 'That agent run is no longer active.' }, { status: 404 });
  }
  if (outcome === 'failed') {
    return safeJsonResponse({
      error: 'Cancellation could not be recorded. The turn remains queued; retry cancellation.',
    }, { status: 500 });
  }
  await record({ action: 'run.cancel', runId: parsed.data.runId, sessionId: run?.sessionId, participantId: run?.participantId });
  return safeJsonResponse({ ok: true });
}
