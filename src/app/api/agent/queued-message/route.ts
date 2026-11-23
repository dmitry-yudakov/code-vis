import { authorizeDeviceRequest } from '@/server/devices/deviceAuthorization';
import { webActivityRecorder } from '@/server/devices/activityActor';
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
    const record = await webActivityRecorder(request);
    const run = runRegistry.currentRuns.find(item => item.runId === parsed.data.runId);
    const result = await runRegistry.editQueuedMessage(parsed.data.runId, parsed.data.text, parsed.data.expectedText);
    if (result.ok) await record({ action: 'message.edit', runId: parsed.data.runId,
      sessionId: run?.sessionId, participantId: run?.participantId });
    return safeJsonResponse(result.ok ? result : { error: result.error }, { status: result.ok ? 200 : result.status });
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: sessionStoreStatus(error) });
  }
}
