import { authorizePersonalDeviceRequest } from '@/server/devices/deviceAuthorization';
import { proxyMachineRequest } from '@/server/machines/machineGateway';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ machineId: string; path: string[] }> };

async function handle(request: Request, context: Context): Promise<Response> {
  const denied = await authorizePersonalDeviceRequest(request);
  if (denied) return denied;
  const { machineId, path } = await context.params;
  return proxyMachineRequest(machineId, path, request);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
