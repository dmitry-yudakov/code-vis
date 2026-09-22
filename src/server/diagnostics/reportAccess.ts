import { getConfig, type AppConfig } from '@/server/config';
import { authorizePersonalDeviceRequest } from '@/server/devices/deviceAuthorization';
import { resolveSelfProject } from '@/server/repository/selfProject';
import { isImmersiveReportId } from '@/shared/immersiveReport';
import { publicError, safeJsonResponse } from '@/shared/protocol';

/** Report reads carry device-private evidence, so no shared cache may keep them. */
export const PRIVATE_NO_STORE = 'private, no-store';

export function privateJson(data: unknown, init?: ResponseInit): Response {
  const response = safeJsonResponse(data, init);
  response.headers.set('Cache-Control', PRIVATE_NO_STORE);
  return response;
}

/**
 * Admits a report read only for the personal device, a well-formed id (checked before anything
 * touches the filesystem), and a project that is a self project at the time of this request.
 */
export async function reportAccess(
  request: Request,
  reportId?: string,
): Promise<{ config: AppConfig } | { denied: Response }> {
  if (reportId !== undefined && !isImmersiveReportId(reportId)) {
    return { denied: privateJson({ error: 'That is not a CodeAI report id.' }, { status: 400 }) };
  }
  const denied = await authorizePersonalDeviceRequest(request);
  if (denied) return { denied };
  try {
    const config = getConfig();
    const projectId = new URL(request.url).searchParams.get('projectId') || undefined;
    if (!await resolveSelfProject(projectId, config)) {
      return { denied: privateJson({ available: false }, { status: reportId === undefined ? 200 : 404 }) };
    }
    return { config };
  } catch (error) {
    return { denied: privateJson({ error: publicError(error) }, { status: 503 }) };
  }
}
