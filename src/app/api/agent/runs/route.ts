import { safeJsonResponse } from '@/shared/protocol';
import { runRegistry } from '@/server/runs/runRegistry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Lists host-wide run ownership, optionally narrowed to one canonical conversation. */
export async function GET(request: Request): Promise<Response> {
  const threadId = new URL(request.url).searchParams.get('threadId') || undefined;
  if (threadId && !/^[0-9a-f-]{36}$/i.test(threadId)) {
    return safeJsonResponse({ error: 'Thread id is invalid.' }, { status: 400 });
  }
  return safeJsonResponse(runRegistry.list(threadId));
}
