import { getConfig } from '@/server/config';
import { authorizePersonalDeviceRequest } from '@/server/devices/deviceAuthorization';
import { readActivity } from '@/server/storage/activityLog';
import { activitySourceSchema } from '@/shared/activityLog';
import { safeJsonResponse } from '@/shared/protocol';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const denied = await authorizePersonalDeviceRequest(request);
  if (denied) return denied;
  const query = new URL(request.url).searchParams;
  const source = activitySourceSchema.optional().safeParse(query.get('source') ?? undefined);
  const before = z.string().uuid().optional().safeParse(query.get('before') ?? undefined);
  if (!source.success || !before.success) return safeJsonResponse({ error: 'Invalid activity filter or cursor.' }, { status: 400 });
  try {
    const page = await readActivity(getConfig().dataDir, source.data, before.data);
    if (!page) return safeJsonResponse({ error: 'Older entries have expired. Refresh to see the retained activity.' }, { status: 409 });
    return safeJsonResponse(page);
  } catch {
    return safeJsonResponse({ error: 'The activity log could not be read. Try refreshing.' }, { status: 503 });
  }
}
