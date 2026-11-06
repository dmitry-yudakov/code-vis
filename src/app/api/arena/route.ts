import { authorizePersonalDeviceRequest } from '@/server/devices/deviceAuthorization';
import { fetchExecutorSnapshot } from '@/server/machines/machineClient';
import { localExecutorSnapshot } from '@/server/machines/localExecutorSnapshot';
import { getMachineRegistry, type MachineConnection } from '@/server/machines/machineRegistry';
import { getConfig } from '@/server/config';
import { publicError, safeJsonResponse } from '@/shared/protocol';
import type { ArenaMachineSnapshot } from '@/shared/types';
import { refreshWorkspaceFeeds, remoteProjection, workspaceFeeds } from '@/server/workspace/workspaceFeed';
import { snapshotStream } from '@/server/workspace/snapshotStream';
import { WORKSPACE_STREAM_TYPE } from '@/shared/workspaceStream';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function observeRemote(connection: MachineConnection): Promise<ArenaMachineSnapshot> {
  try {
    const snapshot = await fetchExecutorSnapshot(connection);
    const observedAt = new Date().toISOString();
    await getMachineRegistry(getConfig().dataDir).observe(connection.machine.id, snapshot, observedAt);
    return remoteProjection(connection, snapshot, true, observedAt);
  } catch {
    return remoteProjection(connection, undefined, false);
  }
}

/** A bounded, no-cache overview of this machine and its explicitly attached executors. */
export async function GET(request: Request = new Request('http://localhost/api/arena')): Promise<Response> {
  const denied = await authorizePersonalDeviceRequest(request);
  if (denied) return denied;
  try {
    const config = getConfig();
    if (request.headers.get('accept')?.includes(WORKSPACE_STREAM_TYPE)) {
      const feed = workspaceFeeds(config).arena;
      return snapshotStream(request, {
        subscribe: (receive, fail) => feed.subscribe(receive, fail),
        authorize: () => authorizePersonalDeviceRequest(request),
      });
    }
    // Explicit refresh rechecks readiness and upstreams; idle streams never issue these reads.
    refreshWorkspaceFeeds(config);
    const [local, connections] = await Promise.all([
      localExecutorSnapshot(),
      getMachineRegistry(config.dataDir).list(),
    ]);
    const observedAt = new Date().toISOString();
    const remote = await Promise.all(connections.map(observeRemote));
    const localProjection: ArenaMachineSnapshot = {
      ...local,
      machine: { ...local.machine, kind: 'local', state: 'online', lastSeenAt: observedAt },
    };
    return safeJsonResponse({ machines: [localProjection, ...remote] });
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: 503 });
  }
}
