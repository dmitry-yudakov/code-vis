import { authorizeDeviceRequest } from '@/server/devices/deviceAuthorization';
import { webActivityRecorder } from '@/server/devices/activityActor';
import { boundedRequestBody } from '@/server/machines/boundedBody';
import { runRegistry } from '@/server/runs/runRegistry';
import { safeJsonResponse, steerQueuedMessageRequestSchema } from '@/shared/protocol';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const denied = await authorizeDeviceRequest(request);
  if (denied) return denied;
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder().decode(await boundedRequestBody(request, 2_000_000))); }
  catch { return safeJsonResponse({ error: 'Steering request is invalid or too large.' }, { status: 400 }); }
  const parsed = steerQueuedMessageRequestSchema.safeParse(raw);
  if (!parsed.success) return safeJsonResponse({ error: 'Steering request is invalid.' }, { status: 400 });
  const { runId, activeRunId, expectedText } = parsed.data;
  const record = await webActivityRecorder(request);
  const run = runRegistry.currentRuns.find(item => item.runId === runId);
  const result = await runRegistry.steerQueuedMessage(runId, activeRunId, expectedText);
  if (result.ok) await record({ action: 'message.steer', runId: activeRunId,
    sessionId: run?.sessionId, participantId: run?.participantId });
  return safeJsonResponse(result.ok ? result : { error: result.error }, { status: result.ok ? 200 : result.status });
}
