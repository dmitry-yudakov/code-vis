import { getConfig } from '@/server/config';
import { authorizeDeviceRequest, requestHasExactOrigin } from '@/server/devices/deviceAuthorization';
import { dockerVersionsStatus, startDockerUpdate, DockerUpdateBusy } from '@/server/execution/dockerUpdates';
import { DockerUpdateRejected } from '@/server/execution/dockerUpgrade';
import { dockerUpdateRequestSchema, safeJsonResponse } from '@/shared/protocol';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** This machine's recorded Docker CLIs, what npm offers, and the running or last update. */
export async function GET(request: Request): Promise<Response> {
  const denied = await authorizeDeviceRequest(request);
  if (denied) return denied;
  try {
    const refresh = new URL(request.url).searchParams.get('refresh') === '1';
    return safeJsonResponse(await dockerVersionsStatus(getConfig(), refresh));
  } catch (error) {
    if (error instanceof DockerUpdateRejected) return safeJsonResponse({ error: error.message }, { status: 409 });
    return safeJsonResponse({ error: 'Could not read the Docker CLI versions. Check that Docker is running.' }, { status: 503 });
  }
}

/** Starts one update. The body names a provider and `latest` or `previous`, never a version. */
export async function POST(request: Request): Promise<Response> {
  const denied = await authorizeDeviceRequest(request);
  if (denied) return denied;
  const config = getConfig();
  if (!requestHasExactOrigin(request, config)) {
    return safeJsonResponse({ error: 'Request origin is not authorized.' }, { status: 403 });
  }
  const parsed = dockerUpdateRequestSchema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return safeJsonResponse({ error: 'Name a provider and latest or previous.' }, { status: 400 });
  try {
    return safeJsonResponse({ operation: await startDockerUpdate(config, parsed.data) }, { status: 202 });
  } catch (error) {
    if (error instanceof DockerUpdateBusy) return safeJsonResponse({ error: error.message }, { status: 409 });
    if (error instanceof DockerUpdateRejected) return safeJsonResponse({ error: error.message }, { status: 400 });
    return safeJsonResponse({ error: 'Could not start the update. Check that Docker is running.' }, { status: 503 });
  }
}
