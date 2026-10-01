import { authorizeDeviceRequest } from '@/server/devices/deviceAuthorization';
import { getConfig } from '@/server/config';
import { getSessionStore, sessionStoreStatus } from '@/server/storage/sessionStore';
import { getCheckoutRegistry } from '@/server/repository/checkoutRegistry';
import { getTurnCheckpoints } from '@/server/repository/turnCheckpoints';
import { runRegistry } from '@/server/runs/runRegistry';
import { undoTurnRequestSchema } from '@/shared/turnCheckpoint';
import { publicError, safeJsonResponse } from '@/shared/protocol';
import { boundedRequestBody } from '@/server/machines/boundedBody';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const denied = await authorizeDeviceRequest(request); if (denied) return denied;
  let bytes;
  try { bytes = await boundedRequestBody(request, 1024); }
  catch { return safeJsonResponse({ error: 'Undo request is too large or was interrupted.' }, { status: 413 }); }
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder().decode(bytes)); } catch { return safeJsonResponse({ error: 'Undo request must be JSON.' }, { status: 400 }); }
  const parsed = undoTurnRequestSchema.safeParse(raw);
  if (!parsed.success) return safeJsonResponse({ error: 'Invalid Undo request.' }, { status: 400 });
  const config = getConfig(); const store = getSessionStore(config.dataDir, config.hostLabel);
  let session;
  try { session = await store.getSession(parsed.data.sessionId); }
  catch (error) { return safeJsonResponse({ error: publicError(error) }, { status: sessionStoreStatus(error) }); }
  const checkpoints = getTurnCheckpoints(config.dataDir);
  let identity;
  try { identity = await checkpoints.identity(parsed.data.checkpointId); }
  catch { return safeJsonResponse({ error: 'That checkpoint is unavailable or expired.' }, { status: 404 }); }
  const host = await store.host();
  if (identity.sessionId !== session.id || !session.messages.some((message) => message.id === identity.messageId)
    || !session.repositories.some((binding) => binding.hostId === host.id && binding.checkoutId === identity.checkoutId)) {
    return safeJsonResponse({ error: 'That checkpoint does not belong to this session and repository.' }, { status: 409 });
  }
  let checkout;
  try { checkout = await getCheckoutRegistry(config.repositoriesRoot, config.repositoryDiscoveryDepth).resolve(identity.checkoutId); }
  catch { return safeJsonResponse({ error: 'The checkpoint checkout is unavailable on this machine.' }, { status: 409 }); }
  if (checkout.realPath !== identity.checkoutPath) return safeJsonResponse({ error: 'The checkpoint checkout has moved.' }, { status: 409 });
  if (runRegistry.hasLiveSession(session.id)) return safeJsonResponse({ error: 'Wait for this session’s turn to finish before Undo.' }, { status: 409 });
  const release = runRegistry.acquireCheckoutWrite(checkout.realPath);
  if (!release) return safeJsonResponse({ error: 'The checkout is busy with another turn, repository read, or build. Try Undo after it finishes.' }, { status: 409 });
  try {
    return safeJsonResponse({ checkpoint: await checkpoints.undo(parsed.data.checkpointId, release.token) });
  } catch (error) {
    const known = error instanceof Error && error.name === 'CheckpointError';
    return safeJsonResponse({ error: known ? error.message : 'Undo could not validate recovery. No automatic retry is available.' }, {
      status: known ? (error as Error & { status: number }).status : 503,
    });
  } finally { release(); }
}
