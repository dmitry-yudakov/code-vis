import { authenticatedMachineRequest, authorizeMachineRequest } from '@/server/devices/deviceAuthorization';
import { getConfig } from '@/server/config';
import { getMachineAuthStore } from '@/server/machines/machineAuthStore';
import { safeJsonResponse } from '@/shared/protocol';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Lets an attached home machine revoke its own bearer credential during a clean detach. */
export async function DELETE(request: Request): Promise<Response> {
  const denied = await authorizeMachineRequest(request);
  if (denied) return denied;
  const peer = await authenticatedMachineRequest(request);
  if (!peer) return safeJsonResponse({ error: 'This machine is not attached.' }, { status: 401 });
  await getMachineAuthStore(getConfig().dataDir).revoke(peer.connectionId);
  return safeJsonResponse({ ok: true });
}
