import { authorizePersonalDeviceRequest } from '@/server/devices/deviceAuthorization';
import { fetchExecutorSnapshot } from '@/server/machines/machineClient';
import { localExecutorSnapshot } from '@/server/machines/localExecutorSnapshot';
import { getMachineRegistry, type MachineConnection } from '@/server/machines/machineRegistry';
import { getConfig } from '@/server/config';
import { publicError, safeJsonResponse } from '@/shared/protocol';
import type { ArenaMachineSnapshot, ExecutorSnapshot, ProviderHealth } from '@/shared/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const unavailableProvider: ProviderHealth = {
  available: false,
  authenticated: 'unknown',
  supportedModes: [],
  message: 'This execution machine is offline.',
};

function remoteProjection(
  connection: MachineConnection,
  snapshot: ExecutorSnapshot | undefined,
  state: 'online' | 'offline',
  observedAt?: string,
): ArenaMachineSnapshot {
  const cached = snapshot || connection.cachedSnapshot;
  return {
    machine: {
      id: connection.machine.id,
      label: cached?.machine.label || connection.machine.label,
      kind: 'remote',
      state,
      ...(observedAt || connection.lastSeenAt ? { lastSeenAt: observedAt || connection.lastSeenAt } : {}),
    },
    projects: cached?.projects || [],
    checkouts: cached?.checkouts || [],
    recentCheckoutIds: cached?.recentCheckoutIds || [],
    providers: state === 'online' && cached
      ? cached.providers
      : { claude: unavailableProvider, codex: unavailableProvider },
    sessions: cached?.sessions || [],
    archivedSessions: cached?.archivedSessions || [],
    runs: state === 'online' && cached ? cached.runs : { active: [], recent: [] },
  };
}

async function observeRemote(connection: MachineConnection): Promise<ArenaMachineSnapshot> {
  try {
    const snapshot = await fetchExecutorSnapshot(connection);
    const observedAt = new Date().toISOString();
    await getMachineRegistry(getConfig().dataDir).observe(connection.machine.id, snapshot, observedAt);
    return remoteProjection(connection, snapshot, 'online', observedAt);
  } catch {
    return remoteProjection(connection, undefined, 'offline');
  }
}

/** A bounded, no-cache overview of this machine and its explicitly attached executors. */
export async function GET(request: Request = new Request('http://localhost/api/arena')): Promise<Response> {
  const denied = await authorizePersonalDeviceRequest(request);
  if (denied) return denied;
  try {
    const config = getConfig();
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
