import type { AgentEvent } from '@/shared/types';
import { safeJsonResponse } from '@/shared/protocol';
import { runRegistry } from '@/server/runs/runRegistry';
import { agentEventStream } from '../eventStream';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Attaches directly to a live or retained run and replays what the caller missed. Page reload uses
 * discovery first and selects only a live run; retained replay remains available for diagnostics.
 */
export async function GET(request: Request): Promise<Response> {
  const runId = new URL(request.url).searchParams.get('runId') || '';
  if (!/^[0-9a-f-]{36}$/i.test(runId)) {
    return safeJsonResponse({ error: 'A run id is required.' }, { status: 400 });
  }

  let live: ((event: AgentEvent) => void) | undefined;
  const attachment = runRegistry.subscribe(runId, (event) => live?.(event));
  if (!attachment) return safeJsonResponse({ error: 'That agent run is no longer available.' }, { status: 404 });

  return agentEventStream({
    runId: attachment.runId,
    replay: attachment.replay,
    headers: { 'X-CodeAI-Run-Finished': String(attachment.finished) },
    onDetach: () => runRegistry.unsubscribe(attachment.runId),
    start(write) {
      if (attachment.finished) return Promise.resolve();
      live = write;
      // Held open until the run emits `done`, which the client uses to close its side too.
      return new Promise((resolve) => {
        live = (event) => {
          write(event);
          if (event.type === 'done') resolve(undefined);
        };
      });
    },
  });
}
