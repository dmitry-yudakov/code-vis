import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { getConfig } from '@/server/config';
import { cachedLocalProviderHealth, dockerProviderHealth } from '@/server/agents/providerRegistry';
import { authorizeDeviceRequest } from '@/server/devices/deviceAuthorization';
import { dockerSettingsPath } from '@/server/execution/dockerSettings';
import { getDockerRuntime } from '@/server/execution/dockerRuntime';
import { atomicWrite } from '@/server/storage/sessionStore';
import { dockerSettingsSchema, safeJsonResponse } from '@/shared/protocol';

export const runtime = 'nodejs';

export async function PATCH(request: Request): Promise<Response> {
  try {
    const denied = await authorizeDeviceRequest(request);
    if (denied) return denied;
    const config = getConfig();
    const url = new URL(request.url);
    // Next.js may normalize request.url to its internal hostname. Host retains the browser origin.
    const origin = config.publicOrigin || `${url.protocol}//${request.headers.get('host') || url.host}`;
    if (request.headers.get('origin') !== origin) {
      return safeJsonResponse({ error: 'Request origin is not authorized.' }, { status: 403 });
    }
    const parsed = dockerSettingsSchema.safeParse(await request.json().catch(() => undefined));
    if (!parsed.success) {
      return safeJsonResponse({ error: 'Only a boolean enabled setting is supported.' }, { status: 400 });
    }
    const target = dockerSettingsPath(config.dataDir);
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await atomicWrite(target, parsed.data);
    const updated = getConfig();
    const [docker, local] = await Promise.all([getDockerRuntime(updated).health(), cachedLocalProviderHealth(updated)]);
    return safeJsonResponse({ enabled: updated.dockerEnabled, providers: dockerProviderHealth(updated, docker, local.codex) });
  } catch {
    return safeJsonResponse({ error: 'Could not save Docker settings. Check that CodeAI’s data directory is writable and try again.' }, { status: 503 });
  }
}
