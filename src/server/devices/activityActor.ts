import { webActivityActor, type ActivityActor, type ActivityInput } from '@/shared/activityLog';
import { authenticatedDevice, authenticatedMachineRequest } from './deviceAuthorization';
import { machineRequestAllowed } from '@/server/machines/machineRoutePolicy';
import { recordActivity } from '@/server/storage/activityLog';
import { getConfig } from '@/server/config';

/** Called only after the operation's ordinary authorization has succeeded. */
export async function webActor(request: Request): Promise<ActivityActor> {
  try {
    const machine = machineRequestAllowed(request) ? await authenticatedMachineRequest(request) : undefined;
    const identity = machine ?? await authenticatedDevice(request);
    if (identity) return { source: 'web', id: identity.id, label: identity.label };
  } catch { /* Attribution must not change access or the outcome of the underlying action. */ }
  return webActivityActor;
}

export async function webActivityRecorder(request: Request, dataDir = getConfig().dataDir) {
  const actor = await webActor(request);
  return (input: Omit<Exclude<ActivityInput, { action: 'mcp.call' }>, 'actor'>) => recordActivity(dataDir, { ...input, actor });
}
