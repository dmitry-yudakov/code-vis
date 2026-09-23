import { getConfig } from '@/server/config';
import { authorizePersonalDeviceRequest, requestHasExactOrigin } from '@/server/devices/deviceAuthorization';
import { getCodeAiLifecycle, type CodeAiLifecycle } from '@/server/lifecycle/codeAiLifecycle';
import { resolveSelfProject } from '@/server/repository/selfProject';
import { buildAndRestartRequestSchema, type CodeAiLifecycleSnapshot } from '@/shared/codeAiLifecycle';
import { publicError, safeJsonResponse } from '@/shared/protocol';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Unavailable = Extract<CodeAiLifecycleSnapshot, { available: false }>;

const NOT_MANAGED = 'This CodeAI was not started with npm run start:managed, so it cannot rebuild and restart itself.';

/** Available only on a server `start:managed` spawned, and only for CodeAI's own project on this machine. */
async function eligibility(projectId: string | undefined): Promise<{ lifecycle: CodeAiLifecycle } | Unavailable> {
  const lifecycle = getCodeAiLifecycle();
  if (!lifecycle?.managed) return { available: false, reason: 'not-managed' };
  if (!await resolveSelfProject(projectId, getConfig())) return { available: false, reason: 'not-self-project' };
  return { lifecycle };
}

export async function GET(request: Request): Promise<Response> {
  const denied = await authorizePersonalDeviceRequest(request);
  if (denied) return denied;
  try {
    const access = await eligibility(new URL(request.url).searchParams.get('projectId') || undefined);
    return safeJsonResponse('lifecycle' in access ? access.lifecycle.snapshot() : access);
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: 503 });
  }
}

/** Starts the one fixed operation. The body names it and a project; nothing else is accepted. */
export async function POST(request: Request): Promise<Response> {
  const denied = await authorizePersonalDeviceRequest(request);
  if (denied) return denied;
  if (!requestHasExactOrigin(request, getConfig())) {
    return safeJsonResponse({ error: 'Request origin is not authorized.' }, { status: 403 });
  }
  const parsed = buildAndRestartRequestSchema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return safeJsonResponse({ error: 'Name the build-and-restart action and a project.' }, { status: 400 });
  let access: Awaited<ReturnType<typeof eligibility>>;
  try {
    access = await eligibility(parsed.data.projectId);
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: 503 });
  }
  if (!('lifecycle' in access)) {
    return access.reason === 'not-managed'
      ? safeJsonResponse({ error: NOT_MANAGED }, { status: 409 })
      : safeJsonResponse({ error: 'Build & restart is available only in CodeAI’s own project on this machine.' }, { status: 400 });
  }
  const started = access.lifecycle.start();
  if (started.accepted) return safeJsonResponse({ snapshot: started.snapshot }, { status: 202 });
  return safeJsonResponse({
    error: started.reason === 'not-managed' ? NOT_MANAGED
      : started.reason === 'busy' ? 'CodeAI is already building or restarting.'
        : 'Agent turns are queued or running on this machine. Build & restart once they finish.',
  }, { status: 409 });
}
