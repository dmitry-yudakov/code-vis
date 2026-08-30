import { getConfig } from '@/server/config';
import { getCheckoutRegistry } from '@/server/repository/checkoutRegistry';
import { getSessionStore, publicSession, sessionStoreStatus } from '@/server/storage/sessionStore';
import { publicError, safeJsonResponse, setSessionRepositoriesRequestSchema } from '@/shared/protocol';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SessionRouteContext = { params: Promise<{ sessionId: string }> };

export async function PUT(request: Request, context: SessionRouteContext): Promise<Response> {
  try {
    const parsed = setSessionRepositoriesRequestSchema.safeParse(await request.json());
    if (!parsed.success) return safeJsonResponse({ error: 'Valid repositories and a session revision are required.' }, { status: 400 });
    const { sessionId } = await context.params;
    const config = getConfig();
    const store = getSessionStore(config.dataDir, config.hostLabel);
    const host = await store.host();
    const registry = getCheckoutRegistry(config.repositoriesRoot, config.repositoryDiscoveryDepth);
    await Promise.all(parsed.data.repositories
      .filter((repository) => repository.hostId === host.id)
      .map((repository) => registry.resolve(repository.checkoutId)));
    const session = await store.setSessionRepositories(
      sessionId,
      parsed.data.repositories,
      parsed.data.expectedRevision,
    );
    return safeJsonResponse({ session: publicSession(session) });
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: sessionStoreStatus(error) });
  }
}
