import { sessionCreationFailure } from '@/server/storage/creationRequests';
import { getConfig } from '@/server/config';
import { authenticatedMachineRequest, authorizePersonalDeviceRequest, requestHasExpectedMutationOrigin } from '@/server/devices/deviceAuthorization';
import { boundedRequestBody } from '@/server/machines/boundedBody';
import { privateJson } from '@/server/diagnostics/reportAccess';
import { publicSession, sessionStoreStatus } from '@/server/storage/sessionStore';
import { createRequestedSession } from '@/server/conversation/sessionCreation';
import { WorktreeCreationBusyError } from '@/server/repository/managedWorktrees';
import { codeAiSessionAvailability, prepareCodeAiSession, validatePreparedCodeAiSession } from '@/server/conversation/codeAiSession';
import { codeAiSessionRequestSchema } from '@/shared/codeAiSession';
import { createSessionRequestSchema, publicError } from '@/shared/protocol';
import { worktreeCreationConflictSchema } from '@/shared/worktreeCreation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function access(request: Request) {
  if (await authenticatedMachineRequest(request)) return privateJson({ error: 'CodeAI session setup is available only to personal devices.' }, { status: 403 });
  return authorizePersonalDeviceRequest(request);
}

export async function GET(request: Request): Promise<Response> {
  const denied = await access(request);
  if (denied) return denied;
  try { return privateJson(await codeAiSessionAvailability(getConfig())); }
  catch (error) { return privateJson({ error: publicError(error) }, { status: 503 }); }
}

export async function POST(request: Request): Promise<Response> {
  const denied = await access(request);
  if (denied) return denied;
  const config = getConfig();
  if (!requestHasExpectedMutationOrigin(request, config)) return privateJson({ error: 'Request origin is not authorized.' }, { status: 403 });
  let creationRequestId: string | undefined;
  try {
    const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await boundedRequestBody(request, 8_000)));
    const parsed = codeAiSessionRequestSchema.safeParse(body);
    if (!parsed.success) return privateJson({ error: 'Choose valid CodeAI session settings.', creationState: 'none' }, { status: 400 });
    if (parsed.data.action === 'prepare') return privateJson(await prepareCodeAiSession(config));
    const { action: _action, preparedContext, ...settings } = parsed.data;
    creationRequestId = settings.creationRequestId;
    const creation = createSessionRequestSchema.parse({ ...settings, execution: 'local', projectId: preparedContext.projectId,
      expectedProjectBindings: preparedContext.bindingsFingerprint, expectedPrimaryCheckoutId: preparedContext.checkoutId });
    const session = await createRequestedSession(creation, config, () => validatePreparedCodeAiSession(preparedContext, config));
    return privateJson({ session: publicSession(session) }, { status: 201 });
  } catch (error) {
    return privateJson({ error: publicError(error),
      ...(error instanceof WorktreeCreationBusyError ? { worktreeConflict: worktreeCreationConflictSchema.parse(error.worktreeConflict) } : {}),
      ...await sessionCreationFailure(creationRequestId, config) },
      { status: error instanceof Error && error.message === 'Request body is too large.' ? 413 : sessionStoreStatus(error) });
  }
}
