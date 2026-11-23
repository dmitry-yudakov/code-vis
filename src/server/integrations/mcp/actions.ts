import type { AppConfig } from '@/server/config';
import { getSessionStore, serverAgent, SessionStoreError } from '@/server/storage/sessionStore';
import { createRequestedSession } from '@/server/conversation/sessionCreation';
import { submitMessage } from '@/server/conversation/submitMessage';
import { archiveSession } from '@/server/conversation/archiveSession';
import { sessionCreationFailure, replaySessionCreation, type SessionCreationRequest } from '@/server/storage/creationRequests';
import { getProviderAdapters } from '@/server/agents/providerRegistry';
import { AGENT_ROLE_DEFAULT_MODES } from '@/shared/participants';
import { runRegistry } from '@/server/runs/runRegistry';
import type { DurableSession } from '@/shared/types';
import type { McpBridgeRequest } from '@/shared/mcp';
import type { ActivityActor } from '@/shared/activityLog';
import { digest, McpError } from './grants';
import { loadSession } from './reads';

type Input<K extends McpBridgeRequest['operation']> = Extract<McpBridgeRequest, { operation: K }>['input'];
type MutationAccess = { authorize(): Promise<void>; actor: ActivityActor };
function launchResult(session: DurableSession) {
  return { sessionId: session.id, link: `/?session=${session.id}`, revision: session.revision, archivedAt: session.archivedAt ?? null,
    execution: session.execution ?? 'local', primaryAgentId: session.primaryAgentId,
    checkoutIds: session.repositories.map(r => r.checkoutId), worktree: session.worktree ?? null };
}
function acceptance(session: DurableSession, id: string, fingerprint: string) {
  const prior = session.messages.find(m => m.id === id);
  if (!prior) return undefined;
  if (prior.role !== 'user' || prior.mcpFingerprint !== fingerprint) throw new McpError('conflict', 'Message id was already used with a different payload or outside MCP.', 409);
  const runId = prior.turn?.runId ?? null;
  const run = runRegistry.list(session.id); const live = [...run.active, ...run.recent].find(r => r.runId === runId);
  return { accepted: true, sessionId: session.id, messageId: id, participantId: prior.addressedParticipantId, runId,
    state: live?.state ?? prior.turn?.lifecycle ?? prior.status, outcome: live?.outcome ?? prior.status, archived: Boolean(session.archivedAt) };
}
export async function sendMessage(input: Input<'send_message'>, config: AppConfig, access: MutationAccess, waitForCheckout = false) {
  const session = await loadSession(config, input.sessionId, true);
  const fingerprint = digest({ ...input, waitForCheckout });
  const prior = acceptance(session, input.messageId, fingerprint);
  if (prior) return prior;
  if (session.archivedAt) throw new McpError('archived', 'Cannot send to an archived session.', 409);
  if (!serverAgent(session, input.participantId)) throw new McpError('invalid_participant', 'The participant does not belong to this session.', 400);
  await access.authorize();
  let response: Response | undefined;
  try {
    response = await submitMessage(new Request('http://codeai.internal/api/agent', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, diagramAttachments: [], waitForCheckout }) }),
      undefined, new Set(), { fingerprint, ...access });
  } catch { /* Reconcile durable acceptance even when submission lost its response. */ }
  let saved: DurableSession;
  try { saved = await loadSession(config, session.id, true); }
  catch { throw new McpError('unknown', 'Message outcome is unknown. Keep the exact request and retry after CodeAI storage recovers.', 503, true); }
  const result = acceptance(saved, input.messageId, fingerprint);
  if (result) return result;
  if (!response) throw new McpError('unknown', 'Message outcome is unknown. Read canonical state and retry the exact request.', 503, true);
  const body = await response.json();
  throw new McpError('rejected', body.error || 'Message was not accepted. Read the session and retry the exact request.', response.status, response.status >= 500 || response.status === 429);
}
export async function createSession(input: Input<'create_session'>, config: AppConfig, access: MutationAccess) {
  const { firstMessage, launch, ...creation } = input;
  const request: SessionCreationRequest = { ...creation, mcpLaunchFingerprint: digest(input) };
  // Replay the durable identity before preflight: archived or already accepted launches never execute again.
  let session = await replaySessionCreation(request, config);
  if (!session) {
    if (firstMessage) {
      const health = await getProviderAdapters(config, input.execution)[input.provider].checkHealth(firstMessage.mode);
      if (!health.available || !health.supportedModes.includes(firstMessage.mode)) throw new McpError('unavailable', health.message || 'Provider/mode is unavailable.', 409);
      const { offeredModelSelection } = await import('@/shared/modelChoices');
      const offered = offeredModelSelection(firstMessage, health);
      if (offered.model !== firstMessage.model || offered.effort !== firstMessage.effort) throw new McpError('unsupported', 'Choose an advertised model and effort.', 400);
    }
    try { session = await createRequestedSession(request, config, access.authorize, access.actor); }
    catch (error) {
      if (error instanceof SessionStoreError && error.message.includes('different choices')) throw error;
      const retained = await sessionCreationFailure(input.creationRequestId, config);
      return { ...retained, accepted: false, state: 'creation_failed', error: error instanceof Error ? error.message : 'Creation failed. Retry the exact request.' };
    }
  }
  const resolved = { provider: input.provider, execution: input.execution, checkoutMode: input.checkoutMode, launch,
    ...(firstMessage ? { mode: firstMessage.mode, model: firstMessage.model ?? null, effort: firstMessage.effort ?? null } : {}) };
  if (session.archivedAt || !firstMessage) return { ...launchResult(session), resolved, state: session.archivedAt ? 'archived' : 'empty', accepted: false };
  // The initially created agent remains the launch recipient even if the main agent later changes.
  const participantId = session.participants.find(p => p.kind === 'agent')!.id;
  try {
    const result = await sendMessage({ sessionId: session.id, participantId, ...firstMessage }, config, access, launch === 'queue');
    return { ...launchResult(session), resolved, ...result };
  } catch (error) {
    return { ...launchResult(session), resolved, accepted: false,
      state: error instanceof McpError && error.code === 'rejected' ? 'first_message_not_accepted' : 'first_message_unknown',
      error: error instanceof Error ? error.message : 'Outcome unknown. Read session and retry the exact launch.' };
  }
}
export async function addParticipant(input: Input<'add_participant'>, config: AppConfig, access: MutationAccess) {
  const session = await loadSession(config, input.sessionId);
  const prior = session.participants.find(p => p.kind === 'agent' && p.creationRequestId === input.requestId);
  if (prior?.kind === 'agent') {
    if (prior.provider !== input.provider || prior.role !== input.role) throw new McpError('conflict', 'Participant request id was used with different choices.', 409);
    return { sessionId: session.id, revision: session.revision, participant: { id: prior.id, name: prior.displayName, provider: prior.provider, role: prior.role, defaultMode: prior.defaultMode } };
  }
  const health = await getProviderAdapters(config, session.execution)[input.provider].checkHealth();
  if (!health.available || !health.supportedModes.includes(AGENT_ROLE_DEFAULT_MODES[input.role])) throw new McpError('unavailable', health.message || 'Provider is unavailable for this role.', 409);
  const saved = await getSessionStore(config.dataDir, config.hostLabel).addAgent(session.id, input.provider, input.role, input.requestId, access.authorize, access.actor);
  const participant = saved.participants.find(p => p.kind === 'agent' && p.creationRequestId === input.requestId)!;
  return { sessionId: session.id, revision: saved.revision, participant: { id: participant.id, name: participant.displayName,
    ...(participant.kind === 'agent' ? { provider: participant.provider, role: participant.role, defaultMode: participant.defaultMode } : {}) } };
}
export async function archive(input: Input<'archive_session'>, config: AppConfig, access: MutationAccess) {
  const session = await loadSession(config, input.sessionId, true);
  if (session.archivedAt) {
    if (session.revision !== input.expectedRevision + 1) throw new McpError('conflict', 'Archived revision changed since this request. Read canonical state.', 409);
    return { ...launchResult(session), state: 'already_archived' };
  }
  const saved = await archiveSession(session.id, input.expectedRevision, config, access.authorize, access.actor);
  return { ...launchResult(saved), state: 'archived' };
}
