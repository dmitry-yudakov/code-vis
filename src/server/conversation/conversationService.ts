import { randomUUID } from 'node:crypto';
import type {
  AgentEvent, AgentMessageRequest, AgentProcessRunner, AssistantMessage, ServerProject, ServerThread,
} from '@/shared/types';
import type { AppConfig } from '@/server/config';
import type { ConversationStore } from '@/server/storage/conversationStore';
import { resolveAgentPolicy } from '@/server/agents/agentPolicy';
import { PermissionBroker } from '@/server/runs/permissionBroker';
import { createRunDirectory, removeRunDirectory, writeDiagramAttachments } from '@/server/storage/tempAttachments';
import { writeRepositoryContext } from '@/server/repository/repositoryContext';
import { hasProposedPlan, stripPlanMarkers } from '@/shared/plan';
import { buildConversationPrompt } from './prompt';
import { parseAssistantResponse } from './responseParser';
import { serverAgent } from '@/server/storage/conversationStore';
import { roleContract } from '@/server/agents/agentRoles';

export async function publishCompletedAssistant(input: {
  runId: string;
  threadId: string;
  participantId: string;
  userMessageId: string;
  message: AssistantMessage;
  emit(event: AgentEvent): void;
  commit(
    threadId: string,
    participantId: string,
    userMessageId: string,
    message: AssistantMessage,
  ): Promise<unknown>;
}): Promise<void> {
  // The event is a durable-completion claim, so the complete message, user delivery state, and
  // participant cursor must be one successful store revision before the browser sees it.
  await input.commit(input.threadId, input.participantId, input.userMessageId, input.message);
  input.emit({ type: 'assistant-message', runId: input.runId, message: input.message });
}

export async function runConversation(input: {
  runId: string;
  request: AgentMessageRequest;
  project: ServerProject;
  thread: ServerThread;
  config: AppConfig;
  runner: AgentProcessRunner;
  conversationStore: ConversationStore;
  transcriptDelta: string;
  signal: AbortSignal;
  emit(event: AgentEvent): void;
  onPermissionBroker?(broker: PermissionBroker): void;
}): Promise<void> {
  const { runId, request, project, thread, config, runner, conversationStore, transcriptDelta, signal, emit } = input;
  const startedAt = Date.now();
  const mode = request.mode || 'ask';
  let directory: string | undefined;
  let sessionMark = Promise.resolve();
  let sessionMarkError: unknown;
  const participant = serverAgent(thread, request.participantId);
  if (!participant) throw new Error('Unknown addressed agent participant');
  const host = await conversationStore.host();
  if (participant.session.started && participant.session.hostId !== host.id) {
    throw new Error(`This provider session belongs to another host (${participant.session.hostId}) and cannot be resumed here.`);
  }
  emit({ type: 'run-started', runId, threadId: thread.id, messageId: request.messageId, participantId: participant.id });
  const resuming = participant.session.started && Boolean(participant.session.sessionId);
  const providerName = participant.provider === 'codex' ? 'Codex' : 'Claude';
  emit({
    type: 'status',
    runId,
    phase: resuming ? 'resuming' : 'starting',
    label: resuming ? `Resuming ${providerName} conversation` : `Starting ${providerName} conversation`,
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
    emit({ type: 'status', runId, phase: 'reading-context', label: 'Preparing project context' });
    await writeRepositoryContext(project.realPath, directory, config.maxGitContextBytes);
    const prompt = buildConversationPrompt({
      userText: request.text,
      attachmentDirectory: directory,
      attachedCanvasNames: manifest.map((item, index) => `${item.kind === 'sketch' ? 'Sketch' : 'Diagram'} ${index + 1} (${item.diagramId})`),
      hasSketchAttachment: manifest.some((item) => item.kind === 'sketch'),
      mode,
      participantIdentity: `You are ${participant.displayName}, a ${participant.provider} participant in this CodeAI conversation. Your stable participant id is ${participant.id}.`,
      roleContract: roleContract(participant.role),
      transcriptDelta,
    });
    const result = await runner.run({
      runId,
      project,
      session: {
        // Claude accepts a client-generated session id; Codex owns ids returned by thread/start.
        // Either way the provider id is distinct from the CodeAI thread id.
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
            .then(async () => { await conversationStore.markSessionStarted(thread.id, participant.id, participant.provider, event.sessionId!); })
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
      threadId: thread.id,
      messageId: assistantId,
      projectRoot: project.realPath,
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
      threadId: thread.id,
      participantId: participant.id,
      userMessageId: request.messageId,
      message,
      emit,
      commit: (threadId, participantId, userMessageId, assistantMessage) => (
        conversationStore.completeAssistantMessage(threadId, participantId, userMessageId, assistantMessage)
      ),
    });
    emit({ type: 'status', runId, phase: 'completed', label: 'Complete' });
    emit({ type: 'done', runId, durationMs: Date.now() - startedAt, cancelled: false });
  } finally {
    permissions?.cancelAll();
    if (directory) await removeRunDirectory(directory).catch(() => undefined);
  }
}
