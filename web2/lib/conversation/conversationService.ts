import { randomUUID } from 'node:crypto';
import type {
  AgentEvent, AgentMessageRequest, AgentProcessRunner, AssistantMessage, ServerProject, ServerThread,
} from '@/lib/shared/types';
import type { Web2Config } from '@/lib/server/config';
import type { ThreadRegistry } from '@/lib/server/threadRegistry';
import { resolveAgentPolicy } from '@/lib/server/agentPolicy';
import { PermissionBroker } from '@/lib/server/permissionBroker';
import { createRunDirectory, removeRunDirectory, writeDiagramAttachments } from '@/lib/server/tempAttachments';
import { writeRepositoryContext } from '@/lib/server/repositoryContext';
import { hasProposedPlan, stripPlanMarkers } from '@/lib/shared/plan';
import { buildConversationPrompt } from './prompt';
import { parseAssistantResponse } from './responseParser';

export async function runConversation(input: {
  runId: string;
  request: AgentMessageRequest;
  project: ServerProject;
  thread: ServerThread;
  config: Web2Config;
  runner: AgentProcessRunner;
  threadRegistry: ThreadRegistry;
  signal: AbortSignal;
  emit(event: AgentEvent): void;
  onPermissionBroker?(broker: PermissionBroker): void;
}): Promise<void> {
  const { runId, request, project, thread, config, runner, threadRegistry, signal, emit } = input;
  const startedAt = Date.now();
  const mode = request.mode || 'ask';
  let directory: string | undefined;
  let sessionMark = Promise.resolve();
  let sessionMarkError: unknown;
  emit({ type: 'run-started', runId, threadId: thread.id, messageId: request.messageId });
  emit({ type: 'status', runId, phase: thread.claudeSessionStarted ? 'resuming' : 'starting', label: thread.claudeSessionStarted ? 'Resuming conversation' : 'Starting conversation' });

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
    emit({ type: 'status', runId, phase: 'reading-context', label: 'Preparing read-only project context' });
    await writeRepositoryContext(project.realPath, directory, config.maxGitContextBytes);
    const prompt = buildConversationPrompt({
      userText: request.text,
      attachmentDirectory: directory,
      attachedDiagramNames: manifest.map((item, index) => `Diagram ${index + 1} (${item.diagramId})`),
      mode,
    });
    const result = await runner.run({
      runId,
      project,
      session: { id: thread.id, action: thread.claudeSessionStarted ? 'resume' : 'start' },
      prompt,
      attachmentDirectory: directory,
      policy,
      permissions,
      signal,
      emit(event) {
        if (event.type === 'session-started' && event.sessionId) {
          sessionMark = sessionMark
            .then(() => threadRegistry.markSessionStarted(thread.id, event.sessionId!))
            .catch((error: unknown) => { sessionMarkError = error; });
        } else if (event.type === 'text-delta' && event.text) {
          emit({ type: 'assistant-delta', runId, delta: event.text });
        } else if (event.type === 'activity') {
          emit({ type: 'tool-activity', runId, tool: event.tool || 'tool', detail: event.detail, denied: event.denied });
        } else if (event.type === 'permission-request' && event.requestId) {
          emit({ type: 'permission-request', runId, requestId: event.requestId, tool: event.tool || 'tool', detail: event.detail || '' });
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
      createdAt: new Date().toISOString(),
      status: 'complete',
      rawMarkdown: markdown,
      blocks,
      metrics: { durationMs: result.durationMs, outputBytes: result.outputBytes },
      mode,
      planProposed: planProposed || undefined,
    };
    emit({ type: 'assistant-message', runId, message });
    emit({ type: 'status', runId, phase: 'completed', label: 'Complete' });
    emit({ type: 'done', runId, durationMs: Date.now() - startedAt, cancelled: false });
  } finally {
    permissions?.cancelAll();
    if (directory) await removeRunDirectory(directory).catch(() => undefined);
  }
}
