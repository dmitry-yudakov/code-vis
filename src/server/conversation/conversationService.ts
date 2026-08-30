import { randomUUID } from 'node:crypto';
import type {
  AgentEvent, AgentMessageRequest, AgentProcessRunner, AssistantMessage, DurableSession, ServerCheckout,
} from '@/shared/types';
import type { AppConfig } from '@/server/config';
import type { SessionStore } from '@/server/storage/sessionStore';
import { resolveAgentPolicy } from '@/server/agents/agentPolicy';
import { PermissionBroker } from '@/server/runs/permissionBroker';
import { createRunDirectory, removeRunDirectory, writeDiagramAttachments } from '@/server/storage/tempAttachments';
import { writeRepositoryContext } from '@/server/repository/repositoryContext';
import { hasProposedPlan, stripPlanMarkers } from '@/shared/plan';
import { buildConversationPrompt } from './prompt';
import { parseAssistantResponse } from './responseParser';
import { serverAgent } from '@/server/storage/sessionStore';
import { roleContract } from '@/server/agents/agentRoles';

export async function publishCompletedAssistant(input: {
  runId: string;
  sessionId: string;
  participantId: string;
  userMessageId: string;
  message: AssistantMessage;
  emit(event: AgentEvent): void;
  commit(
    sessionId: string,
    participantId: string,
    userMessageId: string,
    message: AssistantMessage,
  ): Promise<unknown>;
}): Promise<void> {
  // The event is a durable-completion claim, so the complete message, user delivery state, and
  // participant cursor must be one successful store revision before the browser sees it.
  await input.commit(input.sessionId, input.participantId, input.userMessageId, input.message);
  input.emit({ type: 'assistant-message', runId: input.runId, message: input.message });
}

export async function runConversation(input: {
  runId: string;
  request: AgentMessageRequest;
  checkout: ServerCheckout;
  session: DurableSession;
  config: AppConfig;
  runner: AgentProcessRunner;
  sessionStore: SessionStore;
  transcriptDelta: string;
  signal: AbortSignal;
  emit(event: AgentEvent): void;
  onPermissionBroker?(broker: PermissionBroker): void;
}): Promise<void> {
  const { runId, request, checkout, session, config, runner, sessionStore, transcriptDelta, signal, emit } = input;
  const startedAt = Date.now();
  const mode = request.mode || 'ask';
  let directory: string | undefined;
  let sessionMark = Promise.resolve();
  let sessionMarkError: unknown;
  const participant = serverAgent(session, request.participantId);
  if (!participant) throw new Error('Unknown addressed agent participant');
  const host = await sessionStore.host();
  if (participant.session.started && participant.session.hostId !== host.id) {
    throw new Error(`This provider session belongs to another host (${participant.session.hostId}) and cannot be resumed here.`);
  }
  emit({ type: 'run-started', runId, sessionId: session.id, messageId: request.messageId, participantId: participant.id });
  const resuming = participant.session.started && Boolean(participant.session.sessionId);
  const providerName = participant.provider === 'codex' ? 'Codex' : 'Claude';
  emit({
    type: 'status',
    runId,
    phase: resuming ? 'resuming' : 'starting',
    label: resuming ? `Resuming ${providerName} provider session` : `Starting ${providerName} provider session`,
  });

  const policy = resolveAgentPolicy(config, mode);
  const permissions = policy.interactivePermissions
    ? new PermissionBroker(policy.approvalTimeoutMs ?? config.approvalTimeoutMs)
    : undefined;
  if (permissions) input.onPermissionBroker?.(permissions);

  try {
    directory = await createRunDirectory();
    const manifest = await writeDiagramAttachments(directory, request.diagramAttachments, {
      maxCount: config.maxDiagramAttachments,
      maxBytes: config.maxAttachmentBytes,
      maxMermaidBytes: config.maxMermaidBytes,
    });
    emit({ type: 'status', runId, phase: 'reading-context', label: 'Preparing repository context' });
    await writeRepositoryContext(checkout.realPath, directory, config.maxGitContextBytes);
    const prompt = buildConversationPrompt({
      userText: request.text,
      attachmentDirectory: directory,
      attachedCanvasNames: manifest.map((item, index) => `${item.kind === 'sketch' ? 'Sketch' : 'Diagram'} ${index + 1} (${item.diagramId})`),
      hasSketchAttachment: manifest.some((item) => item.kind === 'sketch'),
      mode,
      participantIdentity: `You are ${participant.displayName}, a ${participant.provider} participant in this CodeAI session. Your stable participant id is ${participant.id}.`,
      roleContract: roleContract(participant.role),
      transcriptDelta,
    });
    const result = await runner.run({
      runId,
      checkout,
      session: {
        // Claude accepts a client-generated session id; Codex owns ids returned when it starts one.
        // Either way the provider id is distinct from the CodeAI session id.
        id: resuming ? participant.session.sessionId : participant.provider === 'claude' ? randomUUID() : undefined,
        action: resuming ? 'resume' : 'start',
      },
      prompt,
      attachmentDirectory: directory,
      policy,
      permissions,
      signal,
      emit(event) {
        if (event.type === 'session-started' && event.sessionId) {
          sessionMark = sessionMark
            .then(async () => { await sessionStore.markProviderSessionStarted(session.id, participant.id, participant.provider, event.sessionId!); })
            .catch((error: unknown) => { sessionMarkError = error; });
        } else if (event.type === 'text-delta' && event.text) {
          emit({ type: 'assistant-delta', runId, delta: event.text });
        } else if (event.type === 'activity') {
          emit({ type: 'tool-activity', runId, tool: event.tool || 'tool', detail: event.detail, denied: event.denied });
        } else if (event.type === 'permission-request' && event.requestId) {
          emit({ type: 'permission-request', runId, requestId: event.requestId, participantId: participant.id, tool: event.tool || 'tool', detail: event.detail || '' });
        } else if (event.type === 'permission-resolved' && event.requestId && event.decision) {
          emit({ type: 'permission-resolved', runId, requestId: event.requestId, decision: event.decision });
        } else if (event.type === 'phase' && event.phase) {
          emit({
            type: 'status',
            runId,
            phase: event.phase,
            label: event.phase === 'thinking' ? 'Thinking…' : 'Writing response…',
          });
        }
      },
    });
    await sessionMark;
    if (sessionMarkError) throw sessionMarkError;
    emit({ type: 'status', runId, phase: 'validating-artifacts', label: 'Validating response artifacts' });
    const assistantId = randomUUID();
    const planProposed = mode === 'plan' && hasProposedPlan(result.finalText);
    const markdown = stripPlanMarkers(result.finalText);
    const blocks = await parseAssistantResponse(markdown, {
      sessionId: session.id,
      messageId: assistantId,
      repositoryRoot: checkout.realPath,
      derivedFromDiagramIds: request.diagramAttachments.map((item) => item.diagramId),
      maxMermaidBytes: config.maxMermaidBytes,
      maxDiagrams: config.maxDiagramsPerMessage,
    });
    const message: AssistantMessage = {
      id: assistantId,
      role: 'assistant',
      authorId: participant.id,
      createdAt: new Date().toISOString(),
      status: 'complete',
      rawMarkdown: markdown,
      blocks,
      metrics: { durationMs: result.durationMs, outputBytes: result.outputBytes },
      mode,
      planProposed: planProposed || undefined,
    };
    await publishCompletedAssistant({
      runId,
      sessionId: session.id,
      participantId: participant.id,
      userMessageId: request.messageId,
      message,
      emit,
      commit: (sessionId, participantId, userMessageId, assistantMessage) => (
        sessionStore.completeAssistantMessage(sessionId, participantId, userMessageId, assistantMessage)
      ),
    });
    emit({ type: 'status', runId, phase: 'completed', label: 'Complete' });
    emit({ type: 'done', runId, durationMs: Date.now() - startedAt, cancelled: false });
  } finally {
    permissions?.cancelAll();
    if (directory) await removeRunDirectory(directory).catch(() => undefined);
  }
}
