import { randomUUID } from 'node:crypto';
import type { AgentEvent } from '@/lib/shared/types';
import { agentMessageRequestSchema, publicError, safeJsonResponse } from '@/lib/shared/protocol';
import { getConfig } from '@/lib/server/config';
import { getProjectRegistry } from '@/lib/server/projectRegistry';
import { getThreadRegistry } from '@/lib/server/threadRegistry';
import { runRegistry } from '@/lib/server/runRegistry';
import { AgentRunError, ClaudeProcessRunner } from '@/lib/server/claudeProcessRunner';
import { runConversation } from '@/lib/conversation/conversationService';

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

  const runId = randomUUID();
  if (!runRegistry.acquire(runId, thread.id)) {
    return safeJsonResponse({ error: 'Another agent turn is already running.' }, { status: 409 });
  }

  const encoder = new TextEncoder();
  const abortController = new AbortController();
  const requestAbort = () => abortController.abort();
  request.signal.addEventListener('abort', requestAbort, { once: true });
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
  let closed = false;
  const emit = (event: AgentEvent) => {
    if (closed) return;
    try {
      streamController?.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
    } catch {
      abortController.abort();
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
      const runner = new ClaudeProcessRunner({
        binary: config.claudeBin,
        model: config.claudeModel,
        maxOutputBytes: config.maxAssistantBytes,
        debug: config.debugAgent,
      });
      void runConversation({
        runId,
        request: parsed.data,
        project,
        thread,
        config,
        runner,
        threadRegistry: getThreadRegistry(config.dataDir),
        signal: abortController.signal,
        emit,
      }).catch((error: unknown) => {
        const known = error instanceof AgentRunError ? error : undefined;
        emit({
          type: 'error',
          runId,
          code: known?.code || (abortController.signal.aborted ? 'cancelled' : 'internal'),
          message: known?.message || (abortController.signal.aborted ? 'The request was cancelled.' : publicError(error)),
          retryable: known?.retryable ?? true,
          delivery: known?.delivery || (thread.claudeSessionStarted ? 'possibly-sent' : 'not-sent'),
        });
        emit({ type: 'done', runId, durationMs: 0, cancelled: known?.code === 'cancelled' || abortController.signal.aborted });
      }).finally(() => {
        runRegistry.release(runId);
        request.signal.removeEventListener('abort', requestAbort);
        closed = true;
        try { controller.close(); } catch { /* client disconnected */ }
      });
    },
    cancel() {
      closed = true;
      abortController.abort();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
