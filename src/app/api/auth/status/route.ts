import { deviceAuthStatus } from '@/server/devices/deviceAuthorization';
import { publicError, safeJsonResponse } from '@/shared/protocol';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The bounded bootstrap route: it reveals no records, providers, paths, or credentials. */
export async function GET(request: Request): Promise<Response> {
  try {
    return safeJsonResponse(await deviceAuthStatus(request));
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: 503 });
  }
}
