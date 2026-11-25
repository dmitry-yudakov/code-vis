import type { AppConfig } from '@/server/config';
import { getConfig } from '@/server/config';
import { boundedRequestBody } from '@/server/machines/boundedBody';
import { workspaceFeeds } from '@/server/workspace/workspaceFeed';
import { snapshotStream } from '@/server/workspace/snapshotStream';
import { safeJsonResponse } from '@/shared/protocol';
import { MCP_REQUEST_BYTES, MCP_RESPONSE_BYTES, mcpBridgeRequestSchema, mcpToolAllowed, type McpBridgeRequest } from '@/shared/mcp';
import type { ActivityActor, McpActivity } from '@/shared/activityLog';
import { recordActivity } from '@/server/storage/activityLog';
import { sessionStoreStatus } from '@/server/storage/sessionStore';
import { getCodeAiLifecycle } from '@/server/lifecycle/codeAiLifecycle';
import { authorizeIntegration, digest, grantExists, McpError, type McpGrant } from './grants';
import { currentSnapshot, executionChoices, McpListings, projectRows, readSession, sessionRow, workspaceHeader } from './reads';
import { addParticipant, archive, createSession, sendMessage } from './actions';
import { queueProject, queueReviewUrl, releaseQueueReview, scopedQueueRequest } from './queueApproval';

class BridgeState {
  readonly listings: McpListings;
  constructor(config: AppConfig) { this.listings = new McpListings(id => grantExists(config, id)); }
  readonly operations = new Map<string, number>();
  readonly scopedLaunches = new Map<string, ReturnType<typeof createSession>>();
  subscriptions = 0;
}
const scope = globalThis as typeof globalThis & { __codeaiMcpBridges?: Map<string, BridgeState> };
function stateFor(config: AppConfig) {
  const states = scope.__codeaiMcpBridges ??= new Map();
  let state = states.get(config.dataDir);
  if (!state) states.set(config.dataDir, state = new BridgeState(config));
  return state;
}
export function bridgeError(error: unknown): Response {
  const status = error instanceof McpError ? error.status : sessionStoreStatus(error);
  return safeJsonResponse({ error: { code: error instanceof McpError ? error.code : status === 409 ? 'conflict' : 'unavailable',
    message: error instanceof Error ? error.message.slice(0, 1000) : 'CodeAI integration is unavailable.',
    retryable: error instanceof McpError ? error.retryable : status >= 500 } }, { status,
    ...(status === 429 ? { headers: { 'Retry-After': '1' } } : {}) });
}
function boundedResult(result: unknown): Response {
  if (Buffer.byteLength(JSON.stringify(result)) > MCP_RESPONSE_BYTES) throw new McpError('too_large', 'Result exceeds 64 KiB. Request a smaller page or bounded detail.', 413);
  return safeJsonResponse(result);
}
const grantActor = (grant: McpGrant): ActivityActor => ({ source: 'mcp', id: grant.id, label: grant.name });
const rejectedOutcome = (status: number) => status === 401 || status === 403 ? 'denied' : 'failed';

function operationTargets(input: McpBridgeRequest['input']) {
  return {
    sessionId: 'sessionId' in input ? input.sessionId : undefined,
    projectId: 'projectId' in input ? input.projectId : undefined,
    participantId: 'participantId' in input ? input.participantId : undefined,
    messageId: 'messageId' in input ? input.messageId : 'firstMessage' in input ? input.firstMessage?.messageId : undefined,
    checkoutId: 'checkoutId' in input ? input.checkoutId : undefined,
    requestId: 'creationRequestId' in input ? input.creationRequestId : 'requestId' in input ? input.requestId : undefined,
  };
}

export async function bridgeOperation(request: Request): Promise<Response> {
  const config = getConfig(); let release: (() => void) | undefined;
  let activity: McpActivity | undefined;
  try {
    const grant = await authorizeIntegration(request, config);
    activity = { actor: grantActor(grant), action: 'mcp.call', operation: 'request', outcome: 'succeeded', status: 200 };
    const state = stateFor(config); const count = state.operations.get(grant.id) ?? 0;
    if (count >= 2) throw new McpError('busy', 'Two MCP operations are already in flight for this grant.', 429, true);
    state.operations.set(grant.id, count + 1);
    release = () => { const remaining = (state.operations.get(grant.id) ?? 1) - 1;
      if (remaining) state.operations.set(grant.id, remaining); else state.operations.delete(grant.id); };
    let raw: unknown;
    try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await boundedRequestBody(request, MCP_REQUEST_BYTES))); }
    catch { throw new McpError('invalid', 'MCP requests must be valid UTF-8 JSON within 16 KiB.', 400); }
    const parsed = mcpBridgeRequestSchema.safeParse(raw);
    if (!parsed.success) throw new McpError('invalid', 'Invalid MCP operation or arguments.', 400);
    const { operation } = parsed.data;
    Object.assign(activity, operationTargets(parsed.data.input), { operation });
    const checkScope = (current: McpGrant) => {
      if (current.queueProjectId !== grant.queueProjectId || (
        operation !== 'get_capabilities' && operation !== 'release_listing' && !mcpToolAllowed(operation, current.scopes)
      )) throw new McpError('forbidden', 'This MCP operation is outside the grant scope.', 403);
    };
    const authorize = async () => checkScope(await authorizeIntegration(request, config));
    const access = { authorize, actor: activity.actor };
    checkScope(grant);
    let result: unknown;
    switch (operation) {
      case 'get_capabilities': result = { scopes: grant.scopes }; break;
      case 'release_listing': state.listings.release(grant.id, parsed.data.input.cursor); result = { released: true }; break;
      case 'get_workspace': {
        const snapshot = await currentSnapshot(config);
        result = { ...workspaceHeader(snapshot, await executionChoices(config, snapshot)), scopes: grant.scopes }; break;
      }
      case 'list_projects': {
        await state.listings.prune();
        const data = parsed.data.input as Extract<typeof parsed.data, { operation: 'list_projects' }>['input'];
        const rows = data.cursor ? undefined : grant.queueProjectId
          ? [await queueProject(config, grant)] : projectRows(await currentSnapshot(config, true));
        result = state.listings.page(grant.id, operation, data.cursor, data.limit, rows); break;
      }
      case 'list_sessions': {
        await state.listings.prune();
        const data = parsed.data as Extract<typeof parsed.data, { operation: 'list_sessions' }>;
        const snapshot = data.input.cursor ? undefined : await currentSnapshot(config, true);
        const rows = snapshot ? [...snapshot.sessions, ...(data.input.archived ? snapshot.archivedSessions : [])]
          .filter(s => !data.input.projectId || s.projectId === data.input.projectId).map(s => sessionRow(s, snapshot)) : undefined;
        result = state.listings.page(grant.id, JSON.stringify([operation, data.input.projectId, data.input.archived]), data.input.cursor, data.input.limit, rows); break;
      }
      case 'read_session': result = await readSession(config, parsed.data.input.sessionId, parsed.data.input.archived); break;
      case 'create_session': {
        const input = parsed.data.input;
        const scoped = grant.queueProjectId ? scopedQueueRequest(config, grant, input) : undefined;
        if (scoped) {
          const confirmationUrl = await queueReviewUrl(config, grant, scoped, authorize);
          if (confirmationUrl) {
            activity.outcome = 'partial';
            result = { accepted: false, state: 'confirmation_required', confirmationUrl, creationRequestId: input.creationRequestId };
            break;
          }
        }
        let launch: ReturnType<typeof createSession>;
        if (scoped) {
          // Overlapping retries must share the result even before the canonical message is saved.
          const key = digest([grant.id, scoped]);
          const existing = state.scopedLaunches.get(key);
          launch = existing ?? createSession(scoped, config, access, grant.id).finally(() => state.scopedLaunches.delete(key));
          if (!existing) state.scopedLaunches.set(key, launch);
        } else launch = createSession(input, config, access);
        const created = await launch;
        if (grant.queueProjectId && 'sessionId' in created && created.sessionId) {
          // The canonical creation receipt now authorizes exact retries, including retained partial launches.
          await releaseQueueReview(config, grant.id, input.creationRequestId).catch(() => undefined);
        }
        activity.sessionId = 'sessionId' in created ? created.sessionId : undefined;
        if ('runId' in created) activity.runId = created.runId ?? undefined;
        if ('participantId' in created) activity.participantId = created.participantId;
        if ('creationState' in created) activity.outcome = created.creationState === 'retained' ? 'partial' : 'failed';
        else if (created.state === 'first_message_not_accepted' || created.state === 'first_message_unknown') activity.outcome = 'partial';
        else if (created.state === 'archived') activity.outcome = 'replayed';
        result = created; break;
      }
      case 'archive_session': {
        const archived = await archive(parsed.data.input, config, access);
        if (archived.state === 'already_archived') activity.outcome = 'replayed';
        result = archived; break;
      }
      case 'add_participant': {
        const added = await addParticipant(parsed.data.input, config, access);
        activity.participantId = added.participant.id;
        result = added; break;
      }
      case 'send_message': {
        const sent = await sendMessage(parsed.data.input, config, access);
        activity.runId = sent.runId ?? undefined;
        result = sent; break;
      }
      case 'get_build_and_restart_status': {
        const lifecycle = getCodeAiLifecycle();
        result = lifecycle?.managed
          ? { snapshot: lifecycle.snapshot(), requestId: lifecycle.restartRequestId }
          : { snapshot: { available: false, reason: 'not-managed' }, requestId: null };
        break;
      }
      case 'build_and_restart': {
        await authorize();
        const { requestId } = parsed.data.input;
        const lifecycle = getCodeAiLifecycle();
        if (!lifecycle?.managed) throw new McpError('not_managed', 'Build & restart requires npm run start:managed.', 409);
        const snapshot = lifecycle.snapshot();
        if (snapshot.operationId === requestId || snapshot.lastOperation?.operationId === requestId) {
          activity.outcome = 'replayed';
          result = { accepted: true, operationId: requestId, snapshot, replayed: true };
          break;
        }
        if (lifecycle.restartRequestId !== requestId) {
          throw new McpError('conflict', 'Refresh restart status before requesting a new build.', 409);
        }
        const started = lifecycle.start(requestId);
        if (!started.accepted) {
          throw new McpError(started.reason, 'The managed build could not start. Check restart status and the server terminal.', 409);
        }
        await recordActivity(config.dataDir, { actor: activity.actor, action: 'machine.restart', requestId });
        result = { accepted: true, operationId: requestId, snapshot: started.snapshot, replayed: false };
        break;
      }
    }
    await authorize();
    return boundedResult(result);
  } catch (error) {
    const response = bridgeError(error);
    if (activity) { activity.status = response.status; activity.outcome = rejectedOutcome(response.status); }
    return response;
  } finally {
    try { if (activity) await recordActivity(config.dataDir, activity); }
    finally { release?.(); }
  }
}
export async function bridgeSubscription(request: Request): Promise<Response> {
  const config = getConfig();
  let actor: ActivityActor | undefined;
  let status = 200;
  try {
    const grant = await authorizeIntegration(request, config);
    actor = grantActor(grant);
    if (!grant.scopes.includes('sessions:read')) throw new McpError('forbidden', 'MCP grant requires sessions:read.', 403);
    const state = stateFor(config);
    if (request.signal.aborted) throw new McpError('cancelled', 'Subscription request was cancelled.', 400);
    if (state.subscriptions >= 8) throw new McpError('busy', 'Eight MCP subscriptions are already connected.', 429, true);
    state.subscriptions++;
    const feed = workspaceFeeds(config).executor;
    return snapshotStream(request, {
      browserBudget: false,
      maximumBytes: MCP_RESPONSE_BYTES,
      async authorize() {
        try { await authorizeIntegration(request, config, 'sessions:read'); return undefined; }
        catch (error) { state.listings.release(grant.id); return bridgeError(error); }
      },
      subscribe(receive, fail) {
        let latest: Parameters<typeof workspaceHeader>[0] | undefined;
        let loading = false; let closed = false;
        const drain = async () => {
          if (loading) return;
          loading = true;
          try {
            while (latest && !closed) {
              const snapshot = latest; latest = undefined;
              const choices = await executionChoices(config, snapshot);
              if (!closed) receive(workspaceHeader(snapshot, choices));
            }
          } catch (error) { if (!closed) fail(error); }
          finally { loading = false; }
        };
        const release = feed.subscribe(snapshot => { latest = snapshot; void drain(); }, fail);
        return () => { closed = true; latest = undefined; release(); state.subscriptions--; };
      },
    });
  } catch (error) {
    const response = bridgeError(error);
    status = response.status;
    return response;
  } finally {
    if (actor) await recordActivity(config.dataDir, { actor, action: 'mcp.call', operation: 'subscribe',
      outcome: status === 200 ? 'succeeded' : rejectedOutcome(status), status });
  }
}
