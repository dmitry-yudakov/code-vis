import { getConfig } from '@/server/config';
import {
  authenticatedDevice, authorizeDeviceRequest, clearDeviceCredentialCookie,
} from '@/server/devices/deviceAuthorization';
import { getDeviceAuthStore } from '@/server/devices/deviceAuthStore';
import { publicError, revokeDeviceRequestSchema, safeJsonResponse } from '@/shared/protocol';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  try {
    const denied = await authorizeDeviceRequest(request);
    if (denied) return denied;
    const config = getConfig();
    if (config.remoteAccess !== 'paired') return safeJsonResponse({ devices: [] });
    const current = await authenticatedDevice(request);
    if (!current) return safeJsonResponse({ error: 'Pair this device to continue.' }, { status: 401 });
    return safeJsonResponse({ devices: await getDeviceAuthStore(config.dataDir).list(current.id) });
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: 503 });
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    const denied = await authorizeDeviceRequest(request);
    if (denied) return denied;
    const parsed = revokeDeviceRequestSchema.safeParse(await request.json().catch(() => undefined));
    if (!parsed.success) return safeJsonResponse({ error: 'A valid device id is required.' }, { status: 400 });
    const config = getConfig();
    if (config.remoteAccess !== 'paired') return safeJsonResponse({ error: 'Device pairing is not enabled.' }, { status: 404 });
    const current = await authenticatedDevice(request);
    if (!current) return safeJsonResponse({ error: 'Pair this device to continue.' }, { status: 401 });
    const revoked = await getDeviceAuthStore(config.dataDir).revoke(parsed.data.deviceId);
    if (!revoked) return safeJsonResponse({ error: 'That paired device does not exist.' }, { status: 404 });
    const headers = new Headers();
    if (parsed.data.deviceId === current.id) headers.set('Set-Cookie', clearDeviceCredentialCookie());
    return safeJsonResponse({ ok: true, signedOut: parsed.data.deviceId === current.id }, { headers });
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: 503 });
  }
}
