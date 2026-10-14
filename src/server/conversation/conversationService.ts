import { randomUUID } from 'node:crypto';
import type {
  AgentEvent, AgentMessageRequest, AgentMode, AgentProcessResult, AgentProcessRunner, AssistantMessage, DurableSession, ServerCheckout,
} from '@/shared/types';
import type { AppConfig } from '@/server/config';
import type { SessionStore } from '@/server/storage/sessionStore';
import { resolveAgentPolicy } from '@/server/agents/agentPolicy';
import { PermissionBroker } from '@/server/runs/permissionBroker';
import { TurnMode } from '@/server/runs/turnMode';
import { AgentRunError } from '@/server/agents/agentRunError';
import {
  createRunDirectory, removeRunDirectory, writeDiagramAttachments, writeImageAttachments,
} from '@/server/storage/tempAttachments';
import { writeReportAttachments } from '@/server/storage/reportEvidence';
import { writeTextFiles } from '@/server/storage/textFiles';
import { writeRepositoryContext } from '@/server/repository/repositoryContext';
import { hasProposedPlan, stripPlanMarkers } from '@/shared/plan';
import { buildConversationPrompt } from './prompt';
import { parseAssistantResponse } from './responseParser';
import { serverAgent } from '@/server/storage/sessionStore';
import { roleContract } from '@/server/agents/agentRoles';
import { turnGlobalInstructions } from '@/server/agents/globalInstructions';
import { nativeMessageLevel } from '@/shared/agentModes';
import { isSoftwareModelRequest } from '@/shared/softwareModel';
import { readModelEmission } from '@/server/model/agentEmission';
import { repositoryModels, type RepositoryModelStore } from '@/server/model/repositoryModelStore';
import { createTurn, updateActivity, finishTurn, type ProcessActivity, type TurnRecord } from '@/shared/turnActivity';
import { TurnHistoryWriter } from './turnHistoryWriter';

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
  onPermissionBroker?(broker: PermissionBroker | undefined): void;
  turnMode?: TurnMode;
  beforeAttempt?(mode: AgentMode): Promise<void>;
  modelStore?: RepositoryModelStore;
}): Promise<void> {
  const { runId, request, checkout, session, config, runner, sessionStore, transcriptDelta, signal, emit } = input;
  const startedAt = Date.now();
  const turnMode = input.turnMode ?? new TurnMode(request.mode || 'ask');
  let mode = turnMode.mode;
  let directory: string | undefined;
  let sessionMark = Promise.resolve();
  let sessionMarkError: unknown;
  let inputPossiblySent = false;
  const participant = serverAgent(session, request.participantId);
  if (!participant) throw new Error('Unknown addressed agent participant');
  const user = session.messages.find(message => message.id === request.messageId);
  let turn: TurnRecord = { ...(user?.role === 'user' && user.turn || createTurn(runId, request.messageId, participant.id, new Date().toISOString())), lifecycle: 'running' };
  let attemptNumber = 0;
  let sawHistory = false;
  const historyWriter = new TurnHistoryWriter(record => sessionStore.saveTurnActivity(session.id, record), record => {
    if (record.sequence !== turn.sequence) return;
    turn = record;
    emit({ type: 'turn-activity', runId, turn });
  });
  const activity = (event: ProcessActivity, flush = false) => {
    turn = updateActivity(turn, attemptNumber, event);
    emit({ type: 'turn-activity', runId, turn });
    historyWriter.set(turn);
    if (flush) void historyWriter.flush();
  };
  const host = await sessionStore.host();
  if (participant.session.started && participant.session.hostId !== host.id) {
    throw new Error(`This provider session belongs to another host (${participant.session.hostId}) and cannot be resumed here.`);
  }
  emit({ type: 'run-started', runId, sessionId: session.id, messageId: request.messageId, participantId: participant.id });
  let resuming = participant.session.started && Boolean(participant.session.sessionId);
  let providerSessionId = resuming ? participant.session.sessionId : undefined;
  const providerName = participant.provider === 'codex' ? 'Codex' : 'Claude';
  emit({
    type: 'status',
    runId,
    phase: resuming ? 'resuming' : 'starting',
    label: resuming ? `Resuming ${providerName} provider session` : `Starting ${providerName} provider session`,
  });

  try {
    historyWriter.set(turn);
    directory = await createRunDirectory(config.dataDir);
    const manifest = await writeDiagramAttachments(directory, request.diagramAttachments, {
      maxCount: config.maxDiagramAttachments,
      maxBytes: config.maxAttachmentBytes,
      maxMermaidBytes: config.maxMermaidBytes,
    });
    // The canonical message says which reports this turn carries; their files are the session's copies.
    const userMessage = session.messages.find((message) => message.id === request.messageId);
    const reports = await writeReportAttachments(directory, config.dataDir, session.id,
      userMessage?.role === 'user' ? userMessage.reportAttachments ?? [] : []);
    // The request is checked here again: a queued turn holds it in memory until it starts.
    const images = await writeImageAttachments(directory, request.imageAttachments ?? []);
    const files = await writeTextFiles(directory, request.fileAttachments ?? []);
    emit({ type: 'status', runId, phase: 'reading-context', label: 'Preparing repository context' });
    await writeRepositoryContext(checkout.realPath, directory, config.maxGitContextBytes);
    let result: AgentProcessResult | undefined;
    let policy = resolveAgentPolicy(config, mode, session.execution);
    let continuation = false;
    let spentMs = 0;
    let usedTurns = 0;
    for (;;) {
      signal.throwIfAborted();
      const attempt = turnMode.begin();
      attemptNumber += 1;
      mode = attempt.mode;
      await input.beforeAttempt?.(mode);
      if (attempt.signal.aborted) continue;
      signal.throwIfAborted();
      policy = resolveAgentPolicy(config, mode, session.execution);
      // Switching modes must not reset time already spent working. Approval waits remain free.
      if (policy.timeoutMs !== 0 && spentMs >= policy.timeoutMs) throw new AgentRunError('timeout', 'The agent exceeded the configured time limit for this message.');
      if (usedTurns >= policy.maxTurns) throw new AgentRunError('max-turns',
        `The agent used all ${policy.maxTurns} tool turns allowed for one message. Send "continue" to pick up where it stopped.`);
      policy = { ...policy, timeoutMs: policy.timeoutMs === 0 ? 0 : policy.timeoutMs - spentMs, maxTurns: policy.maxTurns - usedTurns };
      const permissions = policy.interactivePermissions
        ? new PermissionBroker(policy.approvalTimeoutMs ?? config.approvalTimeoutMs) : undefined;
      input.onPermissionBroker?.(permissions);
      let workingSince = Date.now();
      const pending = new Set<string>();
      const prompt = buildConversationPrompt({
        userText: request.text,
        attachmentDirectory: directory,
        attachedCanvasNames: manifest.map((item, index) => `${item.kind === 'sketch' ? 'Sketch' : 'Diagram'} ${index + 1} (${item.diagramId})`),
        hasSketchAttachment: manifest.some((item) => item.kind === 'sketch'),
        attachedReportNames: reports.map((item, index) => `Report ${index + 1} (${item.kind}, received ${item.receivedAt}${item.imageFile ? ', with screenshot' : ''})`),
        attachedImageNames: images.map((item, index) => `Image ${index + 1} (${item.imageFile})`),
        attachedFileNames: files.map((file) => file.name),
        mode,
        level: policy.level,
        execution: session.execution,
        participantIdentity: `You are ${participant.displayName}, a ${participant.provider} participant in this CodeAI session. Your stable participant id is ${participant.id}.`,
        roleContract: roleContract(participant.role),
        transcriptDelta,
        modeContinuation: continuation,
      });
      // Resolved for every turn: a switch made in the Arena reaches the next one.
      const instructions = policy.level === 'native' && participant.provider === 'claude' ? {} : await turnGlobalInstructions(config, {
        provider: participant.provider, execution: session.execution ?? 'local', choice: session.instructions,
      });
      try {
        if (attempt.signal.aborted) continue;
        result = await runner.run({
          runId,
          checkout,
          session: {
            // Claude accepts a client-generated session id; Codex owns ids returned when it starts one.
            // Either way the provider id is distinct from the CodeAI session id.
            id: providerSessionId ?? (participant.provider === 'claude' ? randomUUID() : undefined),
            action: resuming ? 'resume' : 'start',
          },
          prompt,
          attachmentDirectory: directory,
          policy,
          permissions,
          signal: AbortSignal.any([signal, attempt.signal]),
          model: request.model,
          effort: request.effort,
          ...instructions,
          emit(event) {
            if (event.type === 'history' && event.activity) {
              sawHistory = true;
              activity(event.activity, event.activity.kind !== 'assistant' || Boolean(event.activity.complete));
            } else if (event.type === 'session-started' && event.sessionId) {
              providerSessionId = event.sessionId;
              resuming = true;
              sessionMark = sessionMark
                .then(async () => { await sessionStore.markProviderSessionStarted(session.id, participant.id, participant.provider, event.sessionId!); })
                .catch((error: unknown) => { sessionMarkError = error; });
            } else if (event.type === 'turn-started') {
              inputPossiblySent = true;
              usedTurns += 1;
            } else if (event.type === 'text-delta' && event.text) {
              emit({ type: 'assistant-delta', runId, delta: event.text });
            } else if (event.type === 'activity') {
              emit({ type: 'tool-activity', runId, tool: event.tool || 'tool', detail: event.detail, denied: event.denied });
            } else if (event.type === 'permission-request' && event.requestId) {
              if (!pending.size) spentMs += Date.now() - workingSince;
              pending.add(event.requestId);
              activity({ kind: 'approval', key: `approval:${event.requestId}`, requestId: event.requestId,
                tool: event.tool || 'tool', summary: event.detail || '', state: 'pending', toolKey: event.toolKey, review: event.review, actor: event.actor });
              // Flush preceding display activity before exposing a decision. A failed history write
              // reports incomplete history but cannot disable the broker. A resolved request stays stale.
              // A storage stall must not hide an answerable broker request indefinitely.
              let timer: ReturnType<typeof setTimeout> | undefined;
              void Promise.race([historyWriter.flush(), new Promise<void>(resolve => {
                timer = setTimeout(resolve, 1000); timer.unref?.();
              })]).then(() => {
                if (timer) clearTimeout(timer);
                if (pending.has(event.requestId!)) emit({ type: 'permission-request', runId, requestId: event.requestId!, participantId: participant.id,
                  tool: event.tool || 'tool', detail: event.detail || '', review: event.review, actor: event.actor, toolKey: event.toolKey });
              });
            } else if (event.type === 'permission-resolved' && event.requestId && event.decision) {
              pending.delete(event.requestId);
              if (!pending.size) workingSince = Date.now();
              const previous = turn.entries.find(entry => entry.kind === 'approval' && entry.requestId === event.requestId);
              activity({ kind: 'approval', key: `approval:${event.requestId}`, requestId: event.requestId, tool: previous?.kind === 'approval' ? previous.tool : 'tool',
                summary: previous?.kind === 'approval' ? previous.summary : '', state: 'resolved', decision: event.decision,
                ...(previous?.kind === 'approval' ? { review: previous.review } : {}) }, true);
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
        inputPossiblySent = true;
      } catch (error) {
        if (error instanceof AgentRunError && error.delivery === 'possibly-sent') inputPossiblySent = true;
        // Only our mode interruption may resume. A provider error/denial must remain an error.
        if (!attempt.signal.aborted || signal.aborted
          || !(error instanceof AgentRunError) || error.code !== 'cancelled') throw error;
      } finally {
        permissions?.cancelAll();
        input.onPermissionBroker?.(undefined);
        if (!pending.size) spentMs += Date.now() - workingSince;
      }
      await sessionMark;
      if (sessionMarkError) throw sessionMarkError;
      signal.throwIfAborted();
      if (!attempt.signal.aborted) break;
      // Cleanup has ended this attempt. Its missing outcomes cannot remain live while the next
      // namespace runs, even though the user's overall turn is still in progress.
      turn = finishTurn(turn, 'running');
      emit({ type: 'turn-activity', runId, turn });
      historyWriter.set(turn);
      void historyWriter.flush();
      continuation = true;
      emit({ type: 'status', runId, phase: 'resuming', label: `Resuming ${providerName} in ${turnMode.mode} mode` });
      // The retained attachment directory contains the original evidence and refreshed Git context.
      await writeRepositoryContext(checkout.realPath, directory, config.maxGitContextBytes);
    }
    turnMode.close();
    if (!result) throw new AgentRunError('internal', 'The provider did not return a response.');
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
    const model = readModelEmission(blocks, isSoftwareModelRequest(request.text));
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
      ...(nativeMessageLevel(mode, policy.level) ? { level: 'native' as const } : {}),
      planProposed: planProposed || undefined,
    };
    if (!sawHistory) activity({ kind: 'gap', key: 'legacy-history', reason: 'This provider supplied summary-only activity; ordered details are unavailable.' });
    // A history write failure is independent of the canonical answer commit.
    await historyWriter.flush();
    const finalTurn = finishTurn(turn, 'completed', { attempt: attemptNumber, key: result.finalBlockId, keys: result.finalBlockIds, messageId: assistantId });
    await publishCompletedAssistant({
      runId,
      sessionId: session.id,
      participantId: participant.id,
      userMessageId: request.messageId,
      message,
      emit,
      commit: async (sessionId, participantId, userMessageId, assistantMessage) => {
        const saved = await sessionStore.completeAssistantMessage(sessionId, participantId, userMessageId, assistantMessage, finalTurn);
        turn = { ...finalTurn, history: 'saved' };
        emit({ type: 'turn-activity', runId, turn });
        return saved;
      },
    });
    if (model.status === 'accepted') {
      const merged = (input.modelStore ?? repositoryModels).merge(checkout.realPath, model.emission);
      emit({ type: 'tool-activity', runId, tool: 'Software model', detail: merged.ok
        ? `Captured ${model.emission.entities.length} entity and ${model.emission.relations.length} relation suggestions (LLM) in temporary repository memory.`
        : merged.error });
    }
    emit({ type: 'status', runId, phase: 'completed', label: 'Complete' });
    emit({ type: 'done', runId, durationMs: Date.now() - startedAt, cancelled: false });
  } catch (error) {
    turn = finishTurn(turn, signal.aborted || error instanceof AgentRunError && error.code === 'cancelled' ? 'cancelled' : 'failed');
    historyWriter.set(turn);
    await historyWriter.flush();
    // A saved message spans mode attempts, including input sent before a provider acknowledged it.
    if (inputPossiblySent && error instanceof AgentRunError && error.delivery === 'not-sent') {
      throw new AgentRunError(error.code, error.message, 'possibly-sent', error.retryable);
    }
    throw error;
  } finally {
    await historyWriter.close();
    turnMode.close();
    if (directory) await removeRunDirectory(directory).catch(() => undefined);
  }
}
