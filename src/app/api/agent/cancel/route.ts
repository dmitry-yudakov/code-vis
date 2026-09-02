import { cancelRunRequestSchema, safeJsonResponse } from '@/shared/protocol';
import { runRegistry } from '@/server/runs/runRegistry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Cancelling is now an explicit act. Closing the tab no longer stops a run, so this is the only
 * way a user ends one early.
 */
export async function POST(request: Request): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return safeJsonResponse({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }
  const parsed = cancelRunRequestSchema.safeParse(raw);
  if (!parsed.success) return safeJsonResponse({ error: 'Cancel request is invalid.' }, { status: 400 });
  const outcome = await runRegistry.cancel(parsed.data.runId);
  if (outcome === 'unknown-run') {
    return safeJsonResponse({ error: 'That agent run is no longer active.' }, { status: 404 });
  }
  if (outcome === 'failed') {
    return safeJsonResponse({
      error: 'Cancellation could not be recorded. The turn remains queued; retry cancellation.',
    }, { status: 500 });
  }
  return safeJsonResponse({ ok: true });
}
