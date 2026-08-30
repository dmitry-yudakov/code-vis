import { getConfig } from '@/server/config';
import { getCheckoutRegistry } from '@/server/repository/checkoutRegistry';
import { recentCheckoutIds } from '@/server/repository/recentCheckouts';
import { getSessionStore } from '@/server/storage/sessionStore';
import { publicError, safeJsonResponse } from '@/shared/protocol';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    const config = getConfig();
    const store = getSessionStore(config.dataDir, config.hostLabel);
    const [checkouts, sessions, host] = await Promise.all([
      getCheckoutRegistry(config.repositoriesRoot, config.repositoryDiscoveryDepth).list(),
      store.listSessions(),
      store.host(),
    ]);
    return safeJsonResponse({
      checkouts,
      recentCheckoutIds: recentCheckoutIds(checkouts, sessions, host.id),
      discoveryDepth: config.repositoryDiscoveryDepth,
      hostId: host.id,
    });
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: 503 });
  }
}
