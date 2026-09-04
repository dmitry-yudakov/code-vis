import { getConfig } from '@/server/config';
import {
  deviceCredentialCookie, requestHasExpectedMutationOrigin, requestHasSecureTransport,
} from '@/server/devices/deviceAuthorization';
import { DeviceAuthError, getDeviceAuthStore } from '@/server/devices/deviceAuthStore';
import { pairDeviceRequestSchema, publicError, safeJsonResponse } from '@/shared/protocol';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Exchanges one terminal-issued challenge for one durable, revocable device credential. */
export async function POST(request: Request): Promise<Response> {
  try {
    const config = getConfig();
    if (config.remoteAccess !== 'paired') {
      return safeJsonResponse({ error: 'Device pairing is not enabled.' }, { status: 404 });
    }
    if (!requestHasSecureTransport(request, config)) {
      return safeJsonResponse({ error: 'Pairing requires the configured CodeAI HTTPS server.' }, { status: 426 });
    }
    if (!requestHasExpectedMutationOrigin(request, config)) {
      return safeJsonResponse({ error: 'Request origin is not authorized.' }, { status: 403 });
    }
    const contentLength = Number(request.headers.get('content-length') || 0);
    if (contentLength > 4_096) return safeJsonResponse({ error: 'Pairing request is too large.' }, { status: 413 });
    const parsed = pairDeviceRequestSchema.safeParse(await request.json().catch(() => undefined));
    if (!parsed.success) {
      return safeJsonResponse({ error: 'A device name and valid pairing code are required.' }, { status: 400 });
    }
    const paired = await getDeviceAuthStore(config.dataDir).pair(parsed.data.code, parsed.data.label);
    const headers = new Headers({ 'Set-Cookie': deviceCredentialCookie(paired.credential, paired.device.expiresAt) });
    return safeJsonResponse({ device: paired.device }, { status: 201, headers });
  } catch (error) {
    const status = error instanceof DeviceAuthError && error.code === 'invalid-code' ? 401
      : error instanceof DeviceAuthError && error.code === 'device-limit' ? 409
        : 503;
    return safeJsonResponse({ error: publicError(error) }, { status });
  }
}
