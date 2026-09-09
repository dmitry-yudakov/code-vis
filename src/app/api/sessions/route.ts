import { getConfig } from '@/server/config';
import {
  sessionStoreStatus, getSessionStore, publicSession,
} from '@/server/storage/sessionStore';
import { createSessionRequestSchema, publicError, safeJsonResponse } from '@/shared/protocol';
import { authorizeDeviceRequest } from '@/server/devices/deviceAuthorization';
import { getCheckoutRegistry } from '@/server/repository/checkoutRegistry';
import { getDockerRuntime } from '@/server/execution/dockerRuntime';
import { validateDockerCheckout } from '@/server/execution/dockerProfile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const denied = await authorizeDeviceRequest(request);
  if (denied) return denied;
  const query = new URL(request.url).searchParams;
  const projectId = query.get('projectId') || undefined;
  const loose = query.get('loose') === 'true';
  if (projectId && loose) {
    return safeJsonResponse({ error: 'Choose either a project or loose sessions, not both.' }, { status: 400 });
  }
  if (projectId && !/^[0-9a-f-]{36}$/i.test(projectId)) {
    return safeJsonResponse({ error: 'A valid project id is required.' }, { status: 400 });
  }
  try {
    const config = getConfig();
    const sessions = await getSessionStore(config.dataDir, config.hostLabel).listSessions({ projectId, loose });
    return safeJsonResponse({ sessions: sessions.map(publicSession) });
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: sessionStoreStatus(error) });
  }
}

export async function POST(request: Request): Promise<Response> {
  const denied = await authorizeDeviceRequest(request);
  if (denied) return denied;
  try {
    const parsed = createSessionRequestSchema.safeParse(await request.json());
    if (!parsed.success) return safeJsonResponse({ error: 'A valid project, provider, and role are required.' }, { status: 400 });
    const config = getConfig();
    const store = getSessionStore(config.dataDir, config.hostLabel);
    const project = parsed.data.projectId ? await store.getProject(parsed.data.projectId) : undefined;
    const registry = getCheckoutRegistry(config.repositoriesRoot, config.repositoryDiscoveryDepth);
    if (parsed.data.checkoutId) await registry.resolve(parsed.data.checkoutId);
    if (parsed.data.execution === 'docker') {
      const health = await getDockerRuntime(config).health();
      if (!health.available) return safeJsonResponse({ error: health.message }, { status: 409 });
      const host = await store.host();
      const bindings = project?.repositories || (parsed.data.checkoutId ? [{
        checkoutId: parsed.data.checkoutId, role: 'primary', hostId: host.id,
      }] : []);
      if (bindings.length !== 1 || bindings[0].role !== 'primary' || bindings[0].hostId !== host.id) {
        return safeJsonResponse({ error: 'Docker requires exactly one primary repository on this machine.' }, { status: 400 });
      }
      await validateDockerCheckout((await registry.resolve(bindings[0].checkoutId)).realPath, config);
    }
    const session = await store.createSession(parsed.data);
    return safeJsonResponse({ session: publicSession(session) }, { status: 201 });
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: sessionStoreStatus(error) });
  }
}
