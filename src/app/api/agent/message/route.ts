import { randomUUID } from 'node:crypto';
import type { AgentEvent } from '@/shared/types';
import { agentMessageRequestSchema, publicError, safeJsonResponse } from '@/shared/protocol';
import { getConfig } from '@/server/config';
import { authorizeDeviceRequest } from '@/server/devices/deviceAuthorization';
import { getCheckoutRegistry } from '@/server/repository/checkoutRegistry';
import {
  sessionStoreStatus, getSessionStore, primaryRepository, serverAgent,
} from '@/server/storage/sessionStore';
import { runRegistry } from '@/server/runs/runRegistry';
import { AgentRunError } from '@/server/agents/agentRunError';
import { getProviderAdapters } from '@/server/agents/providerRegistry';
import { runConversation } from '@/server/conversation/conversationService';
import { agentEventStream } from '../eventStream';
import { buildTranscriptDelta, canonicalTranscript } from '@/server/conversation/transcript';
import type { CanvasKind, DiagramArtifact, DurableSession, SketchCanvas, UserMessage } from '@/shared/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const denied = await authorizeDeviceRequest(request);
  if (denied) return denied;
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > 6_000_000) return safeJsonResponse({ error: 'Request body is too large.' }, { status: 413 });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return safeJsonResponse({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }
  const parsed = agentMessageRequestSchema.safeParse(raw);
  if (!parsed.success) return safeJsonResponse({ error: 'Message request is invalid.' }, { status: 400 });

  const config = getConfig();
  if (parsed.data.diagramAttachments.length > config.maxDiagramAttachments) {
    return safeJsonResponse({ error: `At most ${config.maxDiagramAttachments} diagrams may be attached.` }, { status: 400 });
  }
  const store = getSessionStore(config.dataDir, config.hostLabel);
  let session: DurableSession;
  try {
    session = await store.getSession(parsed.data.sessionId);
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: sessionStoreStatus(error) });
  }
  const mode = parsed.data.mode || 'ask';
  const participant = serverAgent(session, parsed.data.participantId);
  if (!participant) {
    return safeJsonResponse({ error: 'The addressed participant is not an agent in this session.' }, { status: 400 });
  }
  const repository = primaryRepository(session);
  if (!repository) {
    return safeJsonResponse({
      error: 'This session has no repository yet. Attach a repository and make it primary to run an agent turn.',
    }, { status: 400 });
  }
  const host = await store.host();
  if (repository.hostId !== host.id) {
    return safeJsonResponse({
      error: `This session's primary repository belongs to another host (${repository.hostId}) and is unavailable here.`,
    }, { status: 409 });
  }
  if (participant.session.started && participant.session.hostId !== host.id) {
    return safeJsonResponse({
      error: `This provider session belongs to another host (${participant.session.hostId}) and cannot be resumed here.`,
    }, { status: 409 });
  }
  let checkout;
  try {
    checkout = await getCheckoutRegistry(config.repositoriesRoot, config.repositoryDiscoveryDepth)
      .resolve(repository.checkoutId);
  } catch (error) {
    return safeJsonResponse({
      error: `This session's primary repository no longer resolves on this host. Choose another checkout or reattach it. ${publicError(error)}`,
    }, { status: 409 });
  }
  const canvases = new Map<string, { kind: CanvasKind; source: string }>();
  for (const sketch of session.sketches as SketchCanvas[]) canvases.set(sketch.id, { kind: 'sketch', source: '' });
  for (const message of session.messages) {
    if (message.role !== 'assistant') continue;
    for (const block of message.blocks) {
      if (block.kind !== 'diagram') continue;
      const artifact = block.artifact as DiagramArtifact;
      canvases.set(artifact.id, { kind: 'diagram', source: artifact.source });
    }
  }
  if (parsed.data.diagramAttachments.some((item) => {
    const canonical = canvases.get(item.diagramId);
    return !canonical || canonical.kind !== item.kind || canonical.source !== item.source;
  })) {
    return safeJsonResponse({ error: 'One or more canvas attachments are not available in this session.' }, { status: 400 });
  }
  const messageAttachments = parsed.data.diagramAttachments.map((item) => ({
    diagramId: item.diagramId,
    kind: item.kind,
    marksSnapshot: structuredClone(item.marks),
    viewport: item.viewport,
    compositeIncluded: Boolean(item.compositePngDataUrl),
  }));
  const priorRequest = session.messages.find((message) => message.id === parsed.data.messageId);
  if (priorRequest) {
    const sameRequest = priorRequest.role === 'user'
      && priorRequest.addressedParticipantId === participant.id
      && priorRequest.text === parsed.data.text
      && (priorRequest.mode || 'ask') === mode
      && JSON.stringify(priorRequest.diagramAttachments) === JSON.stringify(messageAttachments);
    return safeJsonResponse({
      error: sameRequest
        ? 'This message request was already accepted. Reload the session to see its durable state.'
        : 'This message id was already used with different content.',
    }, { status: sameRequest ? 409 : 400 });
  }
  const adapter = getProviderAdapters(config)[participant.provider];
  const providerHealth = await adapter.checkHealth();
  if (!providerHealth.available || !providerHealth.supportedModes.includes(mode)) {
    return safeJsonResponse({
      error: providerHealth.message
        || `${participant.provider === 'codex' ? 'Codex' : 'Claude'} is not healthy for ${mode} mode in this CodeAI configuration.`,
    }, { status: 409 });
  }

  const human = session.participants.find((item) => item.kind === 'human');
  if (!human) {
    return safeJsonResponse({ error: 'This session has no human participant.' }, { status: 400 });
  }
  const runId = randomUUID();
  const abortController = new AbortController();
  const providerKey = participant.session.started
    ? `${host.id}:${participant.provider}:session:${participant.session.sessionId}`
    : `${host.id}:${participant.provider}:participant:${participant.id}`;
  const reservation = runRegistry.reserve({
    runId,
    sessionId: session.id,
    participantId: participant.id,
    providerKey,
    checkoutId: repository.checkoutId,
    access: mode === 'agent' ? 'write' : 'read',
    cancel: () => abortController.abort(),
  });
  if (!reservation.accepted) {
    if (reservation.reason === 'queue-full') {
      return safeJsonResponse({
        error: 'This machine already has 32 turns waiting. Cancel queued work or wait for capacity.',
      }, { status: 429 });
    }
    return safeJsonResponse({
      error: reservation.reason === 'session-conflict'
        ? 'This session already has an agent turn queued or running.'
        : 'This provider session already has an agent turn queued or running.',
      activeRun: reservation.activeRun,
    }, { status: 409 });
  }
  const userMessage: UserMessage = {
    id: parsed.data.messageId,
    role: 'user',
    authorId: human.id,
    addressedParticipantId: participant.id,
    text: parsed.data.text,
    createdAt: new Date().toISOString(),
    status: 'sending',
    diagramAttachments: messageAttachments,
    mode,
  };
  try {
    const accepted = await store.appendUserMessage(session.id, userMessage);
    session = accepted.session;
    if (!accepted.appended) {
      runRegistry.release(runId);
      return safeJsonResponse({
        error: 'This message request was already accepted. Reload the session to see its durable state.',
      }, { status: 409 });
    }
  } catch (error) {
    runRegistry.release(runId);
    return safeJsonResponse({ error: publicError(error) }, { status: sessionStoreStatus(error) });
  }
  // Every event goes through the registry so it is buffered for replay, then out to this stream.
  const emit = (event: AgentEvent) => runRegistry.record(runId, event);

  const execute = async () => {
    let currentParticipant = serverAgent(session, participant.id)!;
    try {
      // Queued work resolves its canonical snapshot and repository context only when it actually
      // starts, so it sees the checkout at execution time and holds no temporary directory early.
      session = await store.getSession(session.id);
      currentParticipant = serverAgent(session, participant.id) || currentParticipant;
      const transcriptDelta = buildTranscriptDelta(session, currentParticipant, canonicalTranscript(session.messages), {
        maxMessages: config.maxTranscriptMessages,
        maxBytes: config.maxTranscriptBytes,
      }).text;
      await runConversation({
        runId,
        request: parsed.data,
        checkout,
        session,
        config,
        runner: adapter.createRunner(),
        sessionStore: store,
        transcriptDelta,
        signal: abortController.signal,
        emit,
        onPermissionBroker: (broker) => runRegistry.attachPermissions(runId, broker),
      });
    } catch (error: unknown) {
      const known = error instanceof AgentRunError ? error : undefined;
      const delivery = known?.delivery || (abortController.signal.aborted || currentParticipant.session.started ? 'possibly-sent' : 'not-sent');
      await store.failUserMessage(
        session.id,
        parsed.data.messageId,
        known?.code === 'cancelled' || abortController.signal.aborted ? 'cancelled' : 'failed',
        delivery,
      ).catch(() => undefined);
      emit({
        type: 'error',
        runId,
        code: known?.code || (abortController.signal.aborted ? 'cancelled' : 'internal'),
        message: known?.message || (abortController.signal.aborted ? 'The request was cancelled.' : publicError(error)),
        retryable: known?.retryable ?? true,
        delivery,
      });
      emit({ type: 'done', runId, durationMs: 0, cancelled: known?.code === 'cancelled' || abortController.signal.aborted });
    }
  };

  const activated = runRegistry.activate(runId, {
    execute,
    async cancelQueued() {
      // The terminal stream event is only truthful after the canonical user message is cancelled.
      // A write failure rejects back to the scheduler, which parks this queue entry for retry.
      await store.failUserMessage(session.id, parsed.data.messageId, 'cancelled', 'not-sent');
      emit({
        type: 'error',
        runId,
        code: 'cancelled',
        message: 'The queued request was cancelled before it reached the agent.',
        retryable: true,
        delivery: 'not-sent',
      });
      emit({ type: 'done', runId, durationMs: 0, cancelled: true });
    },
  });
  if (!activated) {
    await store.failUserMessage(session.id, parsed.data.messageId, 'failed', 'not-sent').catch(() => undefined);
    runRegistry.release(runId);
    return safeJsonResponse({ error: 'The accepted turn could not enter the machine scheduler.' }, { status: 500 });
  }

  let attachmentId: string | undefined;
  return agentEventStream({
    runId,
    // A closed browser tab must not kill work the user already approved: detach, never cancel.
    onDetach: () => {
      if (attachmentId) runRegistry.unsubscribe(runId, attachmentId);
    },
    start(write) {
      const attachment = runRegistry.subscribe(runId, write);
      attachmentId = attachment?.attachmentId;
      for (const event of attachment?.replay || []) write(event);
      return runRegistry.wait(runId) || Promise.resolve();
    },
  });
}
