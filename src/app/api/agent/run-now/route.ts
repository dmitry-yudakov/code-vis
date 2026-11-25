import { authorizeDeviceRequest } from '@/server/devices/deviceAuthorization';
import { webActivityRecorder } from '@/server/devices/activityActor';
import { boundedRequestBody } from '@/server/machines/boundedBody';
import { runRegistry } from '@/server/runs/runRegistry';
import { runNowRequestSchema, safeJsonResponse } from '@/shared/protocol';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const denied = await authorizeDeviceRequest(request);
  if (denied) return denied;
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder().decode(await boundedRequestBody(request, 1_024))); }
  catch { return safeJsonResponse({ error: 'Run now request is invalid.' }, { status: 400 }); }
  const parsed = runNowRequestSchema.safeParse(raw);
  if (!parsed.success) return safeJsonResponse({ error: 'Run now request is invalid.' }, { status: 400 });
  const { runId } = parsed.data;
  const record = await webActivityRecorder(request);
  const run = runRegistry.currentRuns.find(item => item.runId === runId);
  const result = await runRegistry.runNow(runId);
  if (result.ok && run?.canRunNow) await record({ action: 'run.start-queued', runId,
    sessionId: run.sessionId, participantId: run.participantId });
  return safeJsonResponse(result.ok ? result : { error: result.error }, { status: result.ok ? 200 : result.status });
}
