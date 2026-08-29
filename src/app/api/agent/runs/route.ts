import { safeJsonResponse } from '@/shared/protocol';
import { runRegistry } from '@/server/runs/runRegistry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Lists host-wide run ownership, optionally narrowed to one canonical session. */
export async function GET(request: Request): Promise<Response> {
  const sessionId = new URL(request.url).searchParams.get('sessionId') || undefined;
  if (sessionId && !/^[0-9a-f-]{36}$/i.test(sessionId)) {
    return safeJsonResponse({ error: 'Session id is invalid.' }, { status: 400 });
  }
  return safeJsonResponse(runRegistry.list(sessionId));
}
