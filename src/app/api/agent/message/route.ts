import { authorizeDeviceRequest } from '@/server/devices/deviceAuthorization';
import { submitMessage } from '@/server/conversation/submitMessage';
import { runRegistry } from '@/server/runs/runRegistry';
import { withBrowserRunBudget } from '@/server/workspace/browserStreamBudget';
import { agentEventStream } from '../eventStream';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const denied = await authorizeDeviceRequest(request);
  if (denied) return denied;
  const response = await submitMessage(request);
  const runId = response.headers.get('X-CodeAI-Run-Id');
  if (!runId) return response;
  const state = runRegistry.currentRuns.find(run => run.runId === runId)?.state ?? 'finished';
  if (response.headers.get('X-CodeAI-Queue-Only') === 'true') {
    response.headers.delete('X-CodeAI-Queue-Only');
    response.headers.set('X-CodeAI-Run-State', state);
    return response;
  }
  let attachmentId: string | undefined;
  return withBrowserRunBudget(request, agentEventStream({
    runId,
    headers: { 'X-CodeAI-Run-Id': runId, 'X-CodeAI-Run-State': state },
    onDetach: () => { if (attachmentId) runRegistry.unsubscribe(runId, attachmentId); },
    start(write) {
      const attachment = runRegistry.subscribe(runId, write);
      attachmentId = attachment?.attachmentId;
      for (const event of attachment?.replay || []) write(event);
      return runRegistry.wait(runId) || Promise.resolve();
    },
  }));
}
