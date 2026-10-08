import { sessionCreationFailure } from '@/server/storage/creationRequests';
import { getConfig } from '@/server/config';
import {
  sessionStoreStatus, getSessionStore, publicSession,
} from '@/server/storage/sessionStore';
import { createSessionRequestSchema, publicError, safeJsonResponse } from '@/shared/protocol';
import { authorizeDeviceRequest } from '@/server/devices/deviceAuthorization';
import { autoArchiveSessions } from '@/server/storage/autoArchiveSessions';
import { createRequestedSession } from '@/server/conversation/sessionCreation';
import { WorktreeCreationBusyError } from '@/server/repository/managedWorktrees';
import { worktreeCreationConflictSchema } from '@/shared/worktreeCreation';

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
    await autoArchiveSessions(config);
    const sessions = await getSessionStore(config.dataDir, config.hostLabel).listSessions({ projectId, loose });
    return safeJsonResponse({ sessions: sessions.map(publicSession) });
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: sessionStoreStatus(error) });
  }
}

export async function POST(request: Request): Promise<Response> {
  const denied = await authorizeDeviceRequest(request);
  if (denied) return denied;
  let creationRequestId: string | undefined;
  try {
    const parsed = createSessionRequestSchema.safeParse(await request.json());
    if (!parsed.success) return safeJsonResponse({ error: 'Choose valid session settings. Worktree creation requires one source repository and a creation request UUID.', creationState: 'none' }, { status: 400 });
    const config = getConfig();
    creationRequestId = parsed.data.creationRequestId;
    const session = await createRequestedSession(parsed.data, config);
    return safeJsonResponse({ session: publicSession(session) }, { status: 201 });
  } catch (error) {
    return safeJsonResponse({ error: publicError(error), ...(error instanceof WorktreeCreationBusyError ? { worktreeConflict: worktreeCreationConflictSchema.parse(error.worktreeConflict) } : {}), ...(creationRequestId ? await sessionCreationFailure(creationRequestId, getConfig()) : {}) }, { status: sessionStoreStatus(error) });
  }
}
