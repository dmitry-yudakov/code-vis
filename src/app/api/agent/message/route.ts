import { randomUUID } from 'node:crypto';
import type { AgentEvent } from '@/shared/types';
import { agentMessageRequestSchema, publicError, safeJsonResponse } from '@/shared/protocol';
import { getConfig } from '@/server/config';
import { getProjectRegistry } from '@/server/projects/projectRegistry';
import {
  conversationStoreStatus, getConversationStore, primaryAttachment, serverAgent,
} from '@/server/storage/conversationStore';
import { runRegistry } from '@/server/runs/runRegistry';
import { AgentRunError } from '@/server/agents/agentRunError';
import { getProviderAdapters } from '@/server/agents/providerRegistry';
import { runConversation } from '@/server/conversation/conversationService';
import { agentEventStream } from '../eventStream';
import { buildTranscriptDelta, canonicalTranscript } from '@/server/conversation/transcript';
import type { CanvasKind, DiagramArtifact, SketchCanvas, UserMessage } from '@/shared/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
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
  const store = getConversationStore(config.dataDir, config.hostLabel);
  let thread;
  try {
    thread = await store.getConversation(parsed.data.threadId);
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: conversationStoreStatus(error) });
  }
  const mode = parsed.data.mode || 'ask';
  const participant = serverAgent(thread, parsed.data.participantId);
  if (!participant) {
    return safeJsonResponse({ error: 'The addressed participant is not an agent in this conversation.' }, { status: 400 });
  }
  const attachment = primaryAttachment(thread);
  if (!attachment) {
    return safeJsonResponse({
      error: 'This conversation has no working directory yet. Attachment management is not available in this version.',
    }, { status: 400 });
  }
  const host = await store.host();
  if (attachment.hostId !== host.id) {
    return safeJsonResponse({
      error: `This conversation's primary project belongs to another host (${attachment.hostId}) and is unavailable here.`,
    }, { status: 409 });
  }
  if (participant.session.started && participant.session.hostId !== host.id) {
    return safeJsonResponse({
      error: `This provider session belongs to another host (${participant.session.hostId}) and cannot be resumed here.`,
    }, { status: 409 });
  }
  let project;
  try {
    project = await getProjectRegistry(config.projectsRoot, config.projectDiscoveryDepth).resolve(attachment.checkoutId);
  } catch (error) {
    return safeJsonResponse({
      error: `This conversation's project attachment no longer resolves on this host. Rebinding attachments is not available yet. ${publicError(error)}`,
    }, { status: 409 });
  }
  const canvases = new Map<string, { kind: CanvasKind; source: string }>();
  for (const sketch of thread.sketches as SketchCanvas[]) canvases.set(sketch.id, { kind: 'sketch', source: '' });
  for (const message of thread.messages) {
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
    return safeJsonResponse({ error: 'One or more canvas attachments are not available in this conversation.' }, { status: 400 });
  }
  const messageAttachments = parsed.data.diagramAttachments.map((item) => ({
    diagramId: item.diagramId,
    kind: item.kind,
    marksSnapshot: structuredClone(item.marks),
    viewport: item.viewport,
    compositeIncluded: Boolean(item.compositePngDataUrl),
  }));
  const priorRequest = thread.messages.find((message) => message.id === parsed.data.messageId);
  if (priorRequest) {
    const sameRequest = priorRequest.role === 'user'
      && priorRequest.addressedParticipantId === participant.id
      && priorRequest.text === parsed.data.text
      && (priorRequest.mode || 'ask') === mode
      && JSON.stringify(priorRequest.diagramAttachments) === JSON.stringify(messageAttachments);
    return safeJsonResponse({
      error: sameRequest
        ? 'This message request was already accepted. Reload the conversation to see its durable state.'
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

  const runId = randomUUID();
  const abortController = new AbortController();
  if (!runRegistry.start({
    runId,
    threadId: thread.id,
    participantId: participant.id,
    cancel: () => abortController.abort(),
  })) {
    return safeJsonResponse({
      error: 'Another agent turn is already running.',
      activeRun: runRegistry.currentRuns[0],
    }, { status: 409 });
  }

  const human = thread.participants.find((item) => item.kind === 'human');
  if (!human) {
    runRegistry.finish(runId);
    return safeJsonResponse({ error: 'This conversation has no human participant.' }, { status: 400 });
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
    const accepted = await store.appendUserMessage(thread.id, userMessage);
    thread = accepted.conversation;
    if (!accepted.appended) {
      runRegistry.finish(runId);
      return safeJsonResponse({
        error: 'This message request was already accepted. Reload the conversation to see its durable state.',
      }, { status: 409 });
    }
  } catch (error) {
    runRegistry.finish(runId);
    return safeJsonResponse({ error: publicError(error) }, { status: conversationStoreStatus(error) });
  }
  const currentParticipant = serverAgent(thread, participant.id)!;
  const transcriptDelta = buildTranscriptDelta(thread, currentParticipant, canonicalTranscript(thread.messages), {
    maxMessages: config.maxTranscriptMessages,
    maxBytes: config.maxTranscriptBytes,
  }).text;

  // Every event goes through the registry so it is buffered for replay, then out to this stream.
  const emit = (event: AgentEvent) => runRegistry.record(runId, event);

  return agentEventStream({
    runId,
    // A closed browser tab must not kill work the user already approved: detach, never cancel.
    onDetach: () => runRegistry.unsubscribe(runId),
    start(write) {
      runRegistry.subscribe(runId, write);
      const runner = adapter.createRunner();
      return runConversation({
        runId,
        request: parsed.data,
        project,
        thread,
        config,
        runner,
        conversationStore: store,
        transcriptDelta,
        signal: abortController.signal,
        emit,
        onPermissionBroker: (broker) => runRegistry.attachPermissions(runId, broker),
      }).catch(async (error: unknown) => {
        const known = error instanceof AgentRunError ? error : undefined;
        const delivery = known?.delivery || (abortController.signal.aborted || currentParticipant.session.started ? 'possibly-sent' : 'not-sent');
        await store.failUserMessage(
          thread.id,
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
      }).finally(() => runRegistry.finish(runId));
    },
  });
}
