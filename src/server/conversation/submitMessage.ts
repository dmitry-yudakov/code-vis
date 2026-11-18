import { createTurn } from '@/shared/turnActivity';
import { randomUUID } from 'node:crypto';
import { boundedRequestBody } from '@/server/machines/boundedBody';
import { textFileRecords } from '@/server/storage/textFiles';
import type { TextFileRecord } from '@/shared/textFiles';
import type { AgentEvent } from '@/shared/types';
import { agentMessageRequestSchema, publicError, safeJsonResponse } from '@/shared/protocol';
import { getConfig } from '@/server/config';
import { authenticatedMachineRequest } from '@/server/devices/deviceAuthorization';
import { getCheckoutRegistry } from '@/server/repository/checkoutRegistry';
import {
  sessionStoreStatus, getSessionStore, primaryRepository, serverAgent,
} from '@/server/storage/sessionStore';
import { runRegistry } from '@/server/runs/runRegistry';
import { sessionQueueBlockers } from '@/server/runs/sessionQueue';
import { TurnMode } from '@/server/runs/turnMode';
import { TurnSuspension, TurnSuspended, type ContinuationProgress } from '@/server/runs/turnSuspension';
import { SuspendedTurns, type SuspendedTurn } from '@/server/lifecycle/suspendedTurns';
import { AgentRunError } from '@/server/agents/agentRunError';
import { autoDataDirectoryIssue, resolveAgentPolicy } from '@/server/agents/agentPolicy';
import { nativeClaudeIsolationIssue } from '@/shared/globalInstructions';
import { getProviderAdapters } from '@/server/agents/providerRegistry';
import { DOCKER_RECOVERY_MESSAGE, recoverDockerExecution } from '@/server/execution/dockerRecovery';
import { runConversation } from '@/server/conversation/conversationService';
import { generateConversationTitle } from '@/server/conversation/conversationTitle';
import { checkSessionCompletion } from '@/server/conversation/agentSessionArchive';
import { buildTranscriptDelta, canonicalTranscript } from '@/server/conversation/transcript';
import { changesCheckout, nativeMessageLevel } from '@/shared/agentModes';
import { getTurnCheckpoints } from '@/server/repository/turnCheckpoints';
import { offeredModelSelection } from '@/shared/modelChoices';
import { PROVIDER_LABELS } from '@/shared/participants';
import { MAX_REPORTS_PER_MESSAGE, MAX_SESSION_REPORT_EVIDENCE_BYTES } from '@/shared/limits';
import { resolveSelfProject } from '@/server/repository/selfProject';
import {
  promoteReportEvidence, promotedReportBytes, reportCopyBytes, resolveReportEvidence, type ResolvedReportEvidence,
} from '@/server/storage/reportEvidence';
import { decodeImageAttachments } from '@/server/storage/tempAttachments';
import { validateManagedPath } from '@/server/repository/managedWorktrees';
import type {
  AgentMode, CanvasKind, DiagramArtifact, DurableSession, ImageAttachmentRecord, SketchCanvas, UserMessage, ServerCheckout,
} from '@/shared/types';

export async function submitMessage(
  request: Request, recovery?: SuspendedTurn, laterQueuedSessions: ReadonlySet<string> = new Set(),
): Promise<Response> {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > 6_000_000) return safeJsonResponse({ error: 'Request body is too large.' }, { status: 413 });

  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await boundedRequestBody(request, 6_000_000)));
  } catch (error) {
    if (error instanceof Error && error.message === 'Request body is too large.') return safeJsonResponse({ error: error.message }, { status: 413 });
    return safeJsonResponse({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }
  const parsed = agentMessageRequestSchema.safeParse(raw);
  if (!parsed.success) return safeJsonResponse({ error: 'Message request is invalid.' }, { status: 400 });

  const data = parsed.data;
  const config = getConfig();
  if (data.diagramAttachments.length > config.maxDiagramAttachments) {
    return safeJsonResponse({ error: `At most ${config.maxDiagramAttachments} diagrams may be attached.` }, { status: 400 });
  }
  const reportIds = data.reportAttachments.map((item) => item.reportId);
  if (reportIds.length > MAX_REPORTS_PER_MESSAGE || new Set(reportIds).size !== reportIds.length) {
    return safeJsonResponse({ error: `At most ${MAX_REPORTS_PER_MESSAGE} different CodeAI reports may be attached.` }, { status: 400 });
  }
  // Images are checked whole before anything is reserved or stored; the message keeps only what they were.
  let imageRecords: ImageAttachmentRecord[];
  let fileRecords: TextFileRecord[];
  try {
    imageRecords = decodeImageAttachments(data.imageAttachments).map((image) => image.record);
    fileRecords = textFileRecords(data.fileAttachments);
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: 400 });
  }
  const store = getSessionStore(config.dataDir, config.hostLabel);
  let session: DurableSession;
  try {
    session = await store.getSession(data.sessionId);
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: sessionStoreStatus(error) });
  }
  const mode = data.mode || 'ask';
  const participant = serverAgent(session, data.participantId);
  if (!participant) {
    return safeJsonResponse({ error: 'The addressed participant is not an agent in this session.' }, { status: 400 });
  }
  if (!recovery && session.messages.some(message => message.role === 'user' && message.turn?.lifecycle === 'suspended')) {
    return safeJsonResponse({ error: 'This conversation is suspended for a CodeAI restart. Its saved work will continue after restart.' }, { status: 409 });
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
  const activeFile = data.activeFile;
  if (activeFile && !session.repositories.some(binding => binding.checkoutId === activeFile.checkoutId && binding.hostId === host.id
    && (session.execution !== 'docker' || binding.id === repository.id))) {
    return safeJsonResponse({ error: 'The active file must belong to a repository available in this conversation. Remove it from context and try again.' }, { status: 400 });
  }
  if (participant.session.started && participant.session.hostId !== host.id) {
    return safeJsonResponse({
      error: `This provider session belongs to another host (${participant.session.hostId}) and cannot be resumed here.`,
    }, { status: 409 });
  }
  let checkout: ServerCheckout;
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
  if (!recovery && data.diagramAttachments.some((item) => {
    const canonical = canvases.get(item.diagramId);
    return !canonical || canonical.kind !== item.kind || canonical.source !== item.source;
  })) {
    return safeJsonResponse({ error: 'One or more canvas attachments are not available in this session.' }, { status: 400 });
  }
  const messageAttachments = data.diagramAttachments.map((item) => ({
    diagramId: item.diagramId,
    kind: item.kind,
    marksSnapshot: structuredClone(item.marks),
    viewport: item.viewport,
    compositeIncluded: Boolean(item.compositePngDataUrl),
  }));
  const priorRequest = session.messages.find((message) => message.id === data.messageId);
  if (recovery && (!priorRequest || priorRequest.role !== 'user' || priorRequest.status !== 'sending'
    || priorRequest.turn?.runId !== recovery.runId || priorRequest.turn.lifecycle !== 'suspended'
    || priorRequest.addressedParticipantId !== participant.id || session.archivedAt
    || recovery.hostId !== host.id || recovery.checkoutPath !== checkout.realPath || recovery.execution !== (session.execution ?? 'local')
    || recovery.providerSessionId !== participant.session.sessionId)) {
    return safeJsonResponse({ error: 'The suspended turn no longer matches its session, provider or repository.' }, { status: 409 });
  }
  if (priorRequest && !recovery) {
    const sameRequest = priorRequest.role === 'user'
      && priorRequest.addressedParticipantId === participant.id
      && priorRequest.text === data.text
      && (priorRequest.mode || 'ask') === mode
      && JSON.stringify(priorRequest.diagramAttachments) === JSON.stringify(messageAttachments)
      && JSON.stringify(priorRequest.reportAttachments?.map((item) => item.reportId) ?? []) === JSON.stringify(reportIds)
      && JSON.stringify(priorRequest.imageAttachments ?? []) === JSON.stringify(imageRecords)
      && JSON.stringify(priorRequest.fileAttachments ?? []) === JSON.stringify(fileRecords)
      && JSON.stringify(priorRequest.activeFile ?? null) === JSON.stringify(activeFile ?? null);
    return safeJsonResponse({
      error: sameRequest
        ? 'This message request was already accepted. Reload the session to see its durable state.'
        : 'This message id was already used with different content.',
    }, { status: sameRequest ? 409 : 400 });
  }
  // Every report file is resolved here, from the session's own copy or the diagnostics directory;
  // the browser only names ids. Nothing is copied until the turn has a reservation.
  let reportEvidence: ResolvedReportEvidence[] = [];
  if (reportIds.length) {
    // An attached home machine may run turns here, but this machine's reports stay with its own devices.
    if (!recovery && await authenticatedMachineRequest(request)) {
      return safeJsonResponse({ error: 'CodeAI reports can be attached only from a device paired with their own machine.' }, { status: 403 });
    }
    let selfProject: boolean;
    try {
      selfProject = Boolean(await resolveSelfProject(session.projectId, config));
    } catch (error) {
      return safeJsonResponse({ error: publicError(error) }, { status: sessionStoreStatus(error) });
    }
    if (!selfProject) {
      return safeJsonResponse({
        error: 'CodeAI reports can be attached only in a session of CodeAI’s own project on this machine.',
      }, { status: 400 });
    }
    const resolved = await Promise.all(reportIds.map((reportId) => resolveReportEvidence(config.dataDir, session.id, reportId)));
    if (resolved.some((item) => !item)) {
      return safeJsonResponse({ error: 'One or more attached CodeAI reports are no longer available. Remove them and try again.' }, { status: 400 });
    }
    reportEvidence = resolved as ResolvedReportEvidence[];
    const adding = reportCopyBytes(reportEvidence);
    if (adding && await promotedReportBytes(config.dataDir, session.id) + adding > MAX_SESSION_REPORT_EVIDENCE_BYTES) {
      return safeJsonResponse({
        error: `This session already holds close to ${MAX_SESSION_REPORT_EVIDENCE_BYTES / 1_048_576} MB of report evidence. Continue in a new session to attach more reports.`,
      }, { status: 413 });
    }
  }
  try {
    await recoverDockerExecution(config);
  } catch {
    return safeJsonResponse({ error: DOCKER_RECOVERY_MESSAGE }, { status: 409 });
  }
  // Version 3 records predate the field; absence is Local.
  const execution = session.execution ?? 'local';
  const adapter = getProviderAdapters(config, execution, { sessionId: session.id, participantId: participant.id })[participant.provider];
  const providerHealth = await adapter.checkHealth(mode);
  if (!providerHealth.available || !providerHealth.supportedModes.includes(mode)) {
    return safeJsonResponse({
      error: providerHealth.message
        || `${participant.provider === 'codex' ? 'Codex' : 'Claude'} is not healthy for ${mode} mode in this CodeAI configuration.`,
    }, { status: 409 });
  }
  const policy = resolveAgentPolicy(config, mode, execution);
  const isolationIssue = nativeClaudeIsolationIssue({ provider: participant.provider, execution, level: policy.level, mode, choice: session.instructions });
  if (isolationIssue) return safeJsonResponse({ error: isolationIssue }, { status: 409 });
  if (mode === 'auto' && policy.level === 'guarded') {
    const issue = await autoDataDirectoryIssue(config.dataDir, checkout.realPath);
    if (issue) return safeJsonResponse({ error: issue }, { status: 409 });
  }
  // The browser may name only a model and effort this machine lists for the addressed provider.
  const { model, effort } = data;
  const offered = offeredModelSelection({ model, effort }, providerHealth);
  if (offered.model !== model || offered.effort !== effort) {
    const provider = PROVIDER_LABELS[participant.provider];
    return safeJsonResponse({
      error: offered.model !== model
        ? `${provider} does not offer model "${model}" on this machine.`
        : `${provider} does not offer effort "${effort}" for ${model ? `model "${model}"` : 'its default model'} on this machine.`,
    }, { status: 400 });
  }

  const human = session.participants.find((item) => item.kind === 'human');
  if (!human) {
    return safeJsonResponse({ error: 'This session has no human participant.' }, { status: 400 });
  }
  const runId = recovery?.runId ?? randomUUID();
  const journal = new SuspendedTurns(config.dataDir);
  const suspension = new TurnSuspension();
  let executing = false;
  // A resumed writing segment starts after possible console repairs. Its Undo must preserve
  // those repairs, rather than extending the earlier segment's recovery fingerprint over them.
  let checkpointId: string | undefined;
  let suspendedProgress: ContinuationProgress | undefined;
  let suspensionRecord: SuspendedTurn | undefined;
  let pendingRequest: SuspendedTurn;
  let preparationError: unknown;
  const abortController = new AbortController();
  const turnMode = new TurnMode(mode);
  const providerKey = participant.session.started
    ? `${host.id}:${execution}:${participant.provider}:session:${participant.session.sessionId}`
    : `${host.id}:${execution}:${participant.provider}:participant:${participant.id}`;
  const reserve = (blockedBySessions?: string[]) => runRegistry.reserve({
    runId,
    sessionId: session.id,
    participantId: participant.id,
    providerKey,
    checkoutId: repository.checkoutId,
    checkoutPath: checkout.realPath,
    access: changesCheckout(mode) ? 'write' : 'read',
    waitForCheckout: data.waitForCheckout,
    blockedBySessions,
    execution,
    mode,
    async changeMode(next) {
      const health = await adapter.checkHealth(next);
      if (!health.available || !health.supportedModes.includes(next)) {
        return { ok: false, status: 409, error: health.message || `This provider does not support ${next} mode here.` };
      }
      const nextPolicy = resolveAgentPolicy(config, next, execution);
      const isolation = nativeClaudeIsolationIssue({ provider: participant.provider, execution,
        level: nextPolicy.level, mode: next, choice: session.instructions });
      if (isolation) return { ok: false, status: 409, error: isolation };
      if (next === 'auto' && nextPolicy.level === 'guarded') {
        const issue = await autoDataDirectoryIssue(config.dataDir, checkout.realPath);
        if (issue) return { ok: false, status: 409, error: issue };
      }
      if (abortController.signal.aborted) {
        return { ok: false, status: 409, error: 'That turn can no longer change mode.' };
      }
      if (!executing) {
        const updated = { ...pendingRequest, request: { ...pendingRequest.request, mode: next } };
        await journal.save(updated);
        pendingRequest = updated;
      }
      if (!turnMode.change(next)) {
        return { ok: false, status: 409, error: 'That turn can no longer change mode.' };
      }
      return { ok: true };
    },
    cancel: () => abortController.abort(),
    suspend: suspendRun,
  }, Boolean(recovery));
  let reservation;
  try {
    reservation = data.waitForCheckout
      ? await store.withActiveSessionSnapshot(async sessions => reserve(await sessionQueueBlockers(
        sessions.filter(item => !recovery || !laterQueuedSessions.has(item.id)),
        session, checkout, getCheckoutRegistry(config.repositoriesRoot, config.repositoryDiscoveryDepth),
        recovery?.acceptedAt,
      )))
      : reserve();
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: sessionStoreStatus(error) });
  }
  if (!reservation.accepted) {
    if (reservation.reason === 'session-archiving') {
      return safeJsonResponse({ error: 'This session is being archived. Restore it from the Arena archive to continue.' }, { status: 409 });
    }
    if (reservation.reason === 'maintenance') {
      return safeJsonResponse({
        error: 'CodeAI is building a new release of itself and will restart. Send again once it is back.',
      }, { status: 503, headers: { 'Retry-After': '30' } });
    }
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
    turn: createTurn(runId, data.messageId, participant.id, new Date().toISOString()),
    id: data.messageId,
    role: 'user',
    authorId: human.id,
    addressedParticipantId: participant.id,
    text: data.text,
    createdAt: new Date().toISOString(),
    status: 'sending',
    diagramAttachments: messageAttachments,
    ...(reportEvidence.length ? { reportAttachments: reportEvidence.map((item) => item.record) } : {}),
    ...(imageRecords.length ? { imageAttachments: imageRecords } : {}),
    ...(fileRecords.length ? { fileAttachments: fileRecords } : {}),
    ...(activeFile ? { activeFile } : {}),
    mode,
    ...(nativeMessageLevel(mode, policy.level) ? { level: 'native' as const } : {}),
  };
  pendingRequest = recovery ?? {
    version: 1, runId, hostId: host.id, checkoutPath: checkout.realPath, execution,
    providerSessionId: participant.session.sessionId, state: 'ready', acceptedAt: userMessage.turn!.acceptedAt,
    request: { ...data, mode }, progress: { attempt: 0, spentMs: 0, usedTurns: 0, continuation: false },
  };
  let promotionFailed = false;
  let requestSaveFailed = false;
  try {
    // Promote only after all message validation, inside the same writer boundary as file capacity.
    if (recovery) {
      session = await store.resumeSuspendedMessage(session.id, data.messageId, runId);
    } else {
      const accepted = await store.appendUserMessage(session.id, userMessage, async () => {
        try { await promoteReportEvidence(config.dataDir, session.id, reportEvidence); }
        catch (error) { promotionFailed = true; throw error; }
        try { await journal.save(pendingRequest); }
        catch (error) { requestSaveFailed = true; throw error; }
      });
      session = accepted.session;
      if (!accepted.appended) {
        runRegistry.release(runId);
        return safeJsonResponse({
          error: 'This message request was already accepted. Reload the session to see its durable state.',
        }, { status: 409 });
      }
    }
  } catch (error) {
    runRegistry.release(runId);
    return safeJsonResponse({ error: requestSaveFailed
      ? 'The request could not be saved on this machine. Your draft is preserved.' : promotionFailed
        ? 'The attached report could not be saved on this machine. Your draft is preserved.' : publicError(error) },
    { status: requestSaveFailed || promotionFailed ? 503 : sessionStoreStatus(error) });
  }
  // Every event goes through the registry so it is buffered for replay, then out to this stream.
  let doneEvent: Extract<AgentEvent, { type: 'done' }> | undefined;
  const emit = (event: AgentEvent) => {
    // A terminal event also promises that recovery has been finalized under checkout access.
    if (event.type === 'done') doneEvent = event;
    else runRegistry.record(runId, event);
  };

  async function suspendRun(): Promise<void> {
    const current = await store.getSession(session.id);
    const message = current.messages.find(item => item.id === data.messageId);
    if (!message || message.role !== 'user' || message.status !== 'sending') return;
    data.text = message.text;
    const record: SuspendedTurn = {
      version: 1, runId, hostId: host.id, checkoutPath: checkout.realPath, execution,
      acceptedAt: message.turn!.acceptedAt, state: executing ? 'preparing' : 'ready',
      providerSessionId: serverAgent(current, participant!.id)?.session.sessionId, checkpointId,
      request: { ...data, mode: turnMode.mode },
      progress: recovery?.progress ?? { attempt: 0, spentMs: 0, usedTurns: 0, continuation: false },
    };
    suspensionRecord = record;
    await journal.save(record);
    if (!runRegistry.hasLiveSession(session.id)) { await journal.remove(runId); return; }
    if (!executing) {
      try {
        await store.suspendUserMessage(session.id, data.messageId);
        runRegistry.record(runId, { type: 'turn-activity', runId, turn: (await store.getSession(session.id)).messages
          .flatMap(item => item.role === 'user' && item.id === data.messageId && item.turn ? [item.turn] : [])[0] });
        runRegistry.record(runId, { type: 'done', runId, durationMs: 0, cancelled: false, suspended: true });
        runRegistry.finish(runId);
      } catch (error) {
        const current = await store.getSession(session.id);
        if (current.messages.some(message => message.id === data.messageId && message.status === 'cancelled')) {
          await journal.remove(runId);
          return;
        }
        throw error;
      }
    } else {
      suspension.request();
      await runRegistry.wait(runId);
      if (preparationError) throw new Error('The turn did not finish a clean suspension.');
      const saved = await store.getSession(session.id);
      const message = saved.messages.find(item => item.id === data.messageId);
      if (message?.role === 'user' && message.turn?.lifecycle === 'suspended') {
        const ready = await journal.get(runId);
        if (ready?.state !== 'ready') throw new Error('The turn could not save its restart checkpoint.');
      }
    }
  }

  const execute = async () => {
    executing = true;
    let currentParticipant = serverAgent(session, participant.id)!;
    let providerInvoked = false;
    const beforeAttempt = async (next: AgentMode) => {
      if (!changesCheckout(next)) return;
      try {
        await runRegistry.upgradeToWrite(runId, AbortSignal.any([abortController.signal, suspension.signal]));
      } catch (error) {
        if (!abortController.signal.aborted && suspension.signal.aborted && error === suspension.signal.reason) {
          throw new TurnSuspended(recovery?.progress ?? { attempt: 0, spentMs: 0, usedTurns: 0, continuation: false });
        }
        throw error;
      }
      // A second selection may have changed the mode while the checkout was busy.
      if (!changesCheckout(turnMode.mode) || checkpointId) return;
      emit({ type: 'status', runId, phase: 'starting', label: 'Saving turn checkpoint' });
      try {
        checkpointId = await getTurnCheckpoints(config.dataDir).capture({
          runId, sessionId: session.id, messageId: data.messageId,
          checkoutId: checkout.id, checkoutPath: checkout.realPath,
        });
      } catch (error) {
        throw new AgentRunError('internal', error instanceof Error && error.name === 'CheckpointError'
          ? error.message : 'The turn checkpoint could not be saved. The agent did not start. Check recovery storage and try again.',
        providerInvoked ? 'possibly-sent' : 'not-sent');
      }
    };
    try {
      // Queued work resolves its canonical snapshot and repository context only when it actually
      // starts, so it sees the checkout at execution time and holds no temporary directory early.
      session = await store.getSession(session.id);
      const canonicalMessage = session.messages.find(message => message.id === data.messageId);
      if (!canonicalMessage || canonicalMessage.role !== 'user') throw new AgentRunError('internal', 'The queued message is unavailable.', 'not-sent');
      data.text = canonicalMessage.text;
      // Claim before any execution side effects. Waiting restored turns remain ready so another
      // process restart can restore them again; a started/uncertain attempt must never be replayed.
      await journal.save({ ...pendingRequest, state: 'resuming', request: { ...data, mode: turnMode.mode } });
      await validateManagedPath(checkout.realPath, config);
      currentParticipant = serverAgent(session, participant.id) || currentParticipant;
      await beforeAttempt(turnMode.mode);
      if (abortController.signal.aborted) throw new AgentRunError('cancelled', 'The request was cancelled before the provider started.', 'not-sent');
      const transcriptDelta = buildTranscriptDelta(session, currentParticipant, canonicalTranscript(session.messages), {
        maxMessages: config.maxTranscriptMessages,
        maxBytes: config.maxTranscriptBytes,
      }).text;
      providerInvoked = true;
      const reply = await runConversation({
        runId,
        request: data,
        checkout,
        session,
        config,
        runner: adapter.createRunner(),
        sessionStore: store,
        transcriptDelta,
        signal: abortController.signal,
        emit,
        onPermissionBroker: (broker) => runRegistry.attachPermissions(runId, broker),
        turnMode,
        suspension,
        continuationProgress: recovery?.progress,
        beforeAttempt,
      });
      void generateConversationTitle({ session, participantId: participant.id, messageId: data.messageId,
        sessionStore: store, config, choices: providerHealth, model: data.model });
      if (reply) void checkSessionCompletion({ sessionId: session.id, messageId: reply.id,
        sessionStore: store, config, afterRunId: runId, model: data.model, effort: data.effort });
    } catch (error: unknown) {
      if (!abortController.signal.aborted && error instanceof TurnSuspended) {
        suspendedProgress = error.progress;
        return;
      }
      if (suspensionRecord && !abortController.signal.aborted) preparationError = error;
      const known = error instanceof AgentRunError ? error : undefined;
      const delivery = known?.delivery || (providerInvoked && (abortController.signal.aborted || currentParticipant.session.started) ? 'possibly-sent' : 'not-sent');
      await store.failUserMessage(
        session.id,
        data.messageId,
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
    } finally {
      turnMode.close();
      if (checkpointId) {
        await getTurnCheckpoints(config.dataDir).finish(checkpointId).catch(() => {
          emit({ type: 'status', runId, phase: 'completed', label: 'Undo unavailable: recovery fingerprint could not be saved. The original checkpoint is retained.' });
        });
      }
      if (suspendedProgress && suspensionRecord) {
        await store.suspendUserMessage(session.id, data.messageId);
        const current = await store.getSession(session.id);
        await journal.save({ ...suspensionRecord, state: 'ready', checkpointId,
          providerSessionId: serverAgent(current, participant.id)?.session.sessionId, progress: suspendedProgress });
        const message = current.messages.find(item => item.id === data.messageId);
        if (message?.role === 'user' && message.turn) runRegistry.record(runId, { type: 'turn-activity', runId, turn: message.turn });
        runRegistry.record(runId, { type: 'done', runId, durationMs: 0, cancelled: false, suspended: true });
      } else {
        if (!preparationError) await journal.remove(runId);
        if (doneEvent) runRegistry.record(runId, doneEvent);
      }
    }
  };

  const activated = runRegistry.activate(runId, {
    execute,
    async editQueued(text, expectedText) {
      await store.editQueuedMessage(session.id, runId, data.messageId, text, expectedText);
    },
    async cancelQueued() {
      // The terminal stream event is only truthful after the canonical user message is cancelled.
      // A write failure rejects back to the scheduler, which parks this queue entry for retry.
      await store.failUserMessage(session.id, data.messageId, 'cancelled', 'not-sent');
      await journal.remove(runId);
      emit({
        type: 'error',
        runId,
        code: 'cancelled',
        message: 'The queued request was cancelled before it reached the agent.',
        retryable: true,
        delivery: 'not-sent',
      });
      emit({ type: 'done', runId, durationMs: 0, cancelled: true });
      if (doneEvent) runRegistry.record(runId, doneEvent);
    },
  });
  if (!activated) {
    await store.failUserMessage(session.id, data.messageId, 'failed', 'not-sent').catch(() => undefined);
    runRegistry.release(runId);
    return safeJsonResponse({ error: 'The accepted turn could not enter the machine scheduler.' }, { status: 500 });
  }

  return safeJsonResponse({ runId }, { status: 202, headers: { 'X-CodeAI-Run-Id': runId } });
}
