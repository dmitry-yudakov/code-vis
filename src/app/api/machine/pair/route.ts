import { getConfig } from '@/server/config';
import { requestHasSecureTransport } from '@/server/devices/deviceAuthorization';
import { boundedRequestBody } from '@/server/machines/boundedBody';
import { MachineAuthError, getMachineAuthStore } from '@/server/machines/machineAuthStore';
import { getSessionStore } from '@/server/storage/sessionStore';
import { machinePairRequestSchema } from '@/shared/machineSchema';
import { publicError, safeJsonResponse } from '@/shared/protocol';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The only unauthenticated machine endpoint; possession of the short-lived code is the proof. */
export async function POST(request: Request): Promise<Response> {
  const config = getConfig();
  if (config.remoteAccess !== 'paired' || !requestHasSecureTransport(request, config)) {
    return safeJsonResponse({ error: 'Machine pairing requires the configured CodeAI HTTPS server.' }, { status: 426 });
  }
  let raw: unknown;
  try {
    const bytes = await boundedRequestBody(request, 4_096);
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    if (error instanceof Error && error.message === 'Request body is too large.') {
      return safeJsonResponse({ error: error.message }, { status: 413 });
    }
    return safeJsonResponse({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }
  const parsed = machinePairRequestSchema.safeParse(raw);
  if (!parsed.success) return safeJsonResponse({ error: 'Machine pairing request is invalid.' }, { status: 400 });
  try {
    const machine = await getSessionStore(config.dataDir, config.hostLabel).host();
    if (machine.id === parsed.data.machine.id) {
      return safeJsonResponse({ error: 'A machine cannot attach to itself.' }, { status: 409 });
    }
    const paired = await getMachineAuthStore(config.dataDir).pair(parsed.data.code, parsed.data.machine);
    return safeJsonResponse({
      machine,
      credential: paired.credential,
      expiresAt: paired.peer.expiresAt,
    }, { status: 201 });
  } catch (error) {
    const known = error instanceof MachineAuthError ? error : undefined;
    const status = known?.code === 'invalid-code' ? 401
      : known?.code === 'duplicate-peer' ? 409
        : known?.code === 'peer-limit' ? 429 : 503;
    return safeJsonResponse({ error: publicError(error) }, { status });
  }
}
