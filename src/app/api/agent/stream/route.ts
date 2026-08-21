import type { AgentEvent } from '@/shared/types';
import { safeJsonResponse } from '@/shared/protocol';
import { runRegistry } from '@/server/runs/runRegistry';
import { agentEventStream } from '../eventStream';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Reattaches a browser to the turn already running (or just finished) on a thread, replaying what
 * it missed. This is what makes a page reload survivable: the run never depended on that page.
 */
export async function GET(request: Request): Promise<Response> {
  const threadId = new URL(request.url).searchParams.get('threadId') || '';
  if (!/^[0-9a-f-]{36}$/i.test(threadId)) {
    return safeJsonResponse({ error: 'A thread id is required.' }, { status: 400 });
  }

  let live: ((event: AgentEvent) => void) | undefined;
  const attachment = runRegistry.subscribe(threadId, (event) => live?.(event));
  if (!attachment) return safeJsonResponse({ error: 'No agent turn is running for this conversation.' }, { status: 404 });

  return agentEventStream({
    runId: attachment.runId,
    replay: attachment.replay,
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
