import { randomUUID } from 'node:crypto';
import type { AgentEvent } from '@/lib/shared/types';
import { agentMessageRequestSchema, publicError, safeJsonResponse } from '@/lib/shared/protocol';
import { getConfig } from '@/lib/server/config';
import { getProjectRegistry } from '@/lib/server/projectRegistry';
import { getThreadRegistry, serverAgent } from '@/lib/server/threadRegistry';
import { runRegistry } from '@/lib/server/runRegistry';
import { AgentRunError } from '@/lib/server/agentRunError';
import { getProviderAdapters } from '@/lib/server/providerRegistry';
import { runConversation } from '@/lib/conversation/conversationService';
import { agentEventStream } from '../eventStream';
import { buildTranscriptDelta } from '@/lib/conversation/transcript';

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
  let project;
  let thread;
  try {
    project = await getProjectRegistry(config.projectsRoot, config.projectDiscoveryDepth).resolve(parsed.data.projectId);
    thread = await getThreadRegistry(config.dataDir).get(parsed.data.threadId, parsed.data.projectId);
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: 404 });
  }
  const mode = parsed.data.mode || 'ask';
  const participant = serverAgent(thread, parsed.data.participantId);
  if (!participant) {
    return safeJsonResponse({ error: 'The addressed participant is not an agent in this conversation.' }, { status: 400 });
  }
  let transcriptDelta: string;
  try {
    transcriptDelta = buildTranscriptDelta(thread, participant, parsed.data.transcript).text;
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: 400 });
  }
  const adapter = getProviderAdapters(config)[participant.provider];
  const providerHealth = await adapter.checkHealth();
  if (!providerHealth.available || !providerHealth.supportedModes.includes(mode)) {
    return safeJsonResponse({
      error: providerHealth.message
        || `${participant.provider === 'codex' ? 'Codex' : 'Claude'} is not healthy for ${mode} mode in this Cartograph configuration.`,
    }, { status: 409 });
  }

  const runId = randomUUID();
  const abortController = new AbortController();
  if (!runRegistry.start({ runId, threadId: thread.id, cancel: () => abortController.abort() })) {
    return safeJsonResponse({ error: 'Another agent turn is already running.' }, { status: 409 });
  }

  // Every event goes through the registry so it is buffered for replay, then out to this stream.
  const emit = (event: AgentEvent) => runRegistry.record(runId, event);

  return agentEventStream({
    runId,
    // A closed browser tab must not kill work the user already approved: detach, never cancel.
    onDetach: () => runRegistry.unsubscribe(runId),
    start(write) {
      runRegistry.subscribe(thread.id, write);
      const runner = adapter.createRunner();
      return runConversation({
        runId,
        request: parsed.data,
        project,
        thread,
        config,
        runner,
        threadRegistry: getThreadRegistry(config.dataDir),
        transcriptDelta,
        signal: abortController.signal,
        emit,
        onPermissionBroker: (broker) => runRegistry.attachPermissions(runId, broker),
      }).catch((error: unknown) => {
        const known = error instanceof AgentRunError ? error : undefined;
        emit({
          type: 'error',
          runId,
          code: known?.code || (abortController.signal.aborted ? 'cancelled' : 'internal'),
          message: known?.message || (abortController.signal.aborted ? 'The request was cancelled.' : publicError(error)),
          retryable: known?.retryable ?? true,
          delivery: known?.delivery || (participant.session.started ? 'possibly-sent' : 'not-sent'),
        });
        emit({ type: 'done', runId, durationMs: 0, cancelled: known?.code === 'cancelled' || abortController.signal.aborted });
      }).finally(() => runRegistry.finish(runId));
    },
  });
}
