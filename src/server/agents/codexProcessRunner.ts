import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type {
  AgentProcessResult, AgentProcessRun, AgentProcessRunner, PermissionResolution,
} from '@/shared/types';
import { AgentRunError } from './agentRunError';
import {
  buildCodexAppServerArgs, CODEX_DEVELOPER_INSTRUCTIONS, codexIsolationIssue,
  codexMcpServerNames, codexThreadConfig, codexThreadPolicyIssue, codexTurnSecurity,
} from './codexInvocation';

interface RunnerOptions {
  binary: string;
  model?: string;
  maxOutputBytes: number;
  killGraceMs?: number;
  debug?: boolean;
}

type RpcId = string | number;
type JsonRecord = Record<string, unknown>;

class RpcResponseError extends Error {
  constructor(public readonly code: number, message: string) {
    super(message);
    this.name = 'RpcResponseError';
  }
}

function record(value: unknown): JsonRecord | undefined {
  return value && typeof value === 'object' ? value as JsonRecord : undefined;
}

function sanitizeDetail(value: string): string {
  // eslint-disable-next-line no-control-regex
  const clean = value.replaceAll(/[\u0000-\u001f\u007f]+/g, ' ').replaceAll(/\s+/g, ' ').trim();
  return clean.length > 160 ? `${clean.slice(0, 159)}…` : clean;
}

function sanitizeRunDetail(value: string, repositoryRoot: string, attachmentDirectory: string): string {
  return sanitizeDetail(value
    .replaceAll(repositoryRoot, '.')
    .replaceAll(attachmentDirectory, '[attachment]'));
}

function codexErrorKind(value: unknown): string {
  if (typeof value === 'string') return value;
  const details = record(value);
  return details ? Object.keys(details)[0] || 'unknown' : 'unknown';
}

function relativeWithin(root: string, target: string): string | undefined {
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return undefined;
  return relative.split(path.sep).join('/');
}

function describeFileChanges(item: JsonRecord, repositoryRoot: string): string | undefined {
  if (!Array.isArray(item.changes)) return undefined;
  const paths = item.changes.flatMap((change) => {
    const value = record(change);
    if (typeof value?.path !== 'string') return [];
    return [relativeWithin(repositoryRoot, value.path) || path.basename(value.path)];
  });
  return paths.length ? sanitizeDetail(paths.slice(0, 4).join(', ')) : undefined;
}

function classifyCodexFailure(
  error: unknown,
  action: 'start' | 'resume',
  delivery: 'not-sent' | 'possibly-sent',
): AgentRunError {
  if (error instanceof AgentRunError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  if (/unauthori[sz]ed|not authenticated|authentication|login required|sign in/.test(normalized)) {
    return new AgentRunError('unauthenticated', 'Codex is not authenticated. Run `codex login` locally and sign in.', 'not-sent');
  }
  if (action === 'resume' && /thread|session/.test(normalized) && /not found|missing|invalid|unknown/.test(normalized)) {
    return new AgentRunError('missing-session', 'The native Codex provider session is missing or cannot be resumed. Continue in a new provider session.', 'not-sent');
  }
  if (error instanceof RpcResponseError && (error.code === -32601 || /requires experimentalapi|invalid params/.test(normalized))) {
    return new AgentRunError('unsupported-flags', 'The installed Codex version does not support CodeAI\'s required App Server protocol.', 'not-sent', false);
  }
  return new AgentRunError('process-failed', 'Codex App Server exited before returning a complete response.', delivery);
}

function threadItem(value: unknown): JsonRecord | undefined {
  const item = record(value);
  return typeof item?.type === 'string' && typeof item.id === 'string' ? item : undefined;
}

export class CodexProcessRunner implements AgentProcessRunner {
  constructor(private readonly options: RunnerOptions) {}

  async run(input: AgentProcessRun): Promise<AgentProcessResult> {
    if (input.session.action === 'resume' && !input.session.id) {
      throw new AgentRunError('missing-session', 'The native Codex provider session id is missing. Continue in a new provider session.', 'not-sent');
    }
    const imagePaths = (await readdir(input.attachmentDirectory))
      .filter((name) => name.endsWith('.png'))
      .map((name) => path.join(input.attachmentDirectory, name));
    const startedAt = Date.now();
    const args = buildCodexAppServerArgs();
    const log = this.options.debug
      ? (message: string) => console.error(`[agent ${input.runId.slice(0, 8)} codex] +${((Date.now() - startedAt) / 1000).toFixed(1)}s ${message}`)
      : undefined;
    log?.(`spawn ${path.basename(this.options.binary)} ${args.join(' ')} (prompt ${Buffer.byteLength(input.prompt)}B)`);

    return new Promise<AgentProcessResult>((resolve, reject) => {
      const child = spawn(this.options.binary, args, {
        cwd: input.checkout.realPath,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const pending = new Map<string, { resolve(value: unknown): void; reject(error: unknown): void }>();
      const emittedItems = new Set<string>();
      const itemDetails = new Map<string, string>();
      const itemPhases = new Map<string, string>();
      let nextRequestId = 1;
      let stdoutBuffer = '';
      let stderr = '';
      let protocolBytes = 0;
      let sessionId = input.session.id || '';
      let turnId: string | undefined;
      let turnRequestSent = false;
      let turnCompleted = false;
      let finalText = '';
      let assistantFallback = '';
      let usage: AgentProcessResult['usage'];
      let settled = false;
      let fatalError: unknown;
      let termination: 'cancelled' | 'timeout' | undefined;
      let stdinOpen = true;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
      let clockStartedAt = Date.now();
      let remainingTimeoutMs = input.policy.timeoutMs;
      let pendingPermissions = 0;

      const startTimeoutClock = () => {
        if (settled || termination || pendingPermissions) return;
        clockStartedAt = Date.now();
        timeoutTimer = setTimeout(() => interrupt('timeout'), remainingTimeoutMs);
      };
      const pauseTimeoutClock = () => {
        if (!timeoutTimer) return;
        clearTimeout(timeoutTimer);
        timeoutTimer = undefined;
        remainingTimeoutMs = Math.max(0, remainingTimeoutMs - (Date.now() - clockStartedAt));
      };
      const write = (message: unknown) => {
        if (!stdinOpen || child.stdin.destroyed) throw new Error('Codex App Server input is closed');
        child.stdin.write(`${JSON.stringify(message)}\n`);
      };
      const notify = (method: string, params: JsonRecord = {}) => write({ method, params });
      const request = (method: string, params: JsonRecord = {}) => {
        const id = nextRequestId++;
        return new Promise<unknown>((requestResolve, requestReject) => {
          pending.set(String(id), { resolve: requestResolve, reject: requestReject });
          write({ method, id, params });
        });
      };
      const respond = (id: RpcId, result: unknown) => write({ id, result });
      const respondUnsupported = (id: RpcId) => write({
        id,
        error: { code: -32601, message: 'This server request is disabled by CodeAI.' },
      });
      const scheduleKill = () => {
        if (killTimer) clearTimeout(killTimer);
        killTimer = setTimeout(() => {
          child.kill('SIGTERM');
          killTimer = setTimeout(() => child.kill('SIGKILL'), this.options.killGraceMs ?? 1_500);
        }, this.options.killGraceMs ?? 1_500);
      };
      const closeInput = () => {
        if (!stdinOpen) return;
        stdinOpen = false;
        child.stdin.end();
        scheduleKill();
      };
      const stopWith = (error: unknown) => {
        if (fatalError) return;
        fatalError = error;
        pauseTimeoutClock();
        input.permissions?.cancelAll();
        closeInput();
      };
      const interrupt = (reason: 'cancelled' | 'timeout') => {
        if (settled || termination) return;
        termination = reason;
        pauseTimeoutClock();
        input.permissions?.cancelAll();
        log?.(`interrupt (${reason})`);
        if (sessionId && turnId && stdinOpen) {
          void request('turn/interrupt', { threadId: sessionId, turnId })
            .catch(() => undefined);
          scheduleKill();
        } else {
          closeInput();
        }
      };
      const abort = () => interrupt('cancelled');
      const finish = (operation: () => void) => {
        if (settled) return;
        settled = true;
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (killTimer) clearTimeout(killTimer);
        input.signal.removeEventListener('abort', abort);
        operation();
      };

      const emitItem = (item: JsonRecord, completed: boolean) => {
        const id = String(item.id);
        const type = String(item.type);
        if (type === 'reasoning') input.emit({ type: 'phase', phase: 'thinking' });
        if (type === 'agentMessage') {
          const phase = typeof item.phase === 'string' ? item.phase : itemPhases.get(id);
          if (phase) itemPhases.set(id, phase);
          input.emit({ type: 'phase', phase: 'responding' });
          if (completed && typeof item.text === 'string') {
            if (phase === 'final_answer') finalText = item.text;
            else assistantFallback = item.text;
          }
          return;
        }
        if (type === 'plan' && completed && typeof item.text === 'string') assistantFallback = item.text;
        if (type === 'commandExecution') {
          const detail = typeof item.command === 'string'
            ? sanitizeRunDetail(item.command, input.checkout.realPath, input.attachmentDirectory)
            : undefined;
          if (detail) itemDetails.set(id, detail);
          if (!emittedItems.has(id)) input.emit({ type: 'activity', tool: 'Shell', detail });
        } else if (type === 'fileChange') {
          const detail = describeFileChanges(item, input.checkout.realPath);
          if (detail) itemDetails.set(id, detail);
          if (!emittedItems.has(id)) input.emit({ type: 'activity', tool: 'Edit', detail });
        } else if (type === 'imageView') {
          if (!emittedItems.has(id)) input.emit({ type: 'activity', tool: 'View image' });
        } else if (['mcpToolCall', 'dynamicToolCall', 'collabAgentToolCall', 'webSearch', 'hookPrompt'].includes(type)) {
          stopWith(new AgentRunError(
            'unsupported-flags',
            `Codex attempted to use a capability CodeAI disabled (${type}).`,
            turnRequestSent ? 'possibly-sent' : 'not-sent',
            false,
          ));
        }
        emittedItems.add(id);
      };

      const handleApproval = (message: JsonRecord) => {
        const method = String(message.method);
        const rpcId = message.id;
        if ((typeof rpcId !== 'string' && typeof rpcId !== 'number') || !method.includes('/requestApproval')) return;
        const params = record(message.params);
        const correlated = params?.threadId === sessionId && (!turnId || params.turnId === turnId);
        const isCommand = method === 'item/commandExecution/requestApproval';
        const isFile = method === 'item/fileChange/requestApproval';
        if (!correlated || (!isCommand && !isFile)) {
          respondUnsupported(rpcId);
          return;
        }
        const itemId = typeof params?.itemId === 'string' ? params.itemId : '';
        const tool = isCommand ? 'Shell' : 'Edit';
        const rawDetail = isCommand
          ? (typeof params?.command === 'string' ? params.command : typeof params?.reason === 'string' ? params.reason : '')
          : (itemDetails.get(itemId) || (typeof params?.reason === 'string' ? params.reason : typeof params?.grantRoot === 'string' ? params.grantRoot : ''));
        const detail = sanitizeRunDetail(rawDetail, input.checkout.realPath, input.attachmentDirectory);
        const requestId = randomUUID();
        let answered = false;
        const settle = (resolution: PermissionResolution) => {
          if (answered) return;
          answered = true;
          pendingPermissions = Math.max(0, pendingPermissions - 1);
          const decision = resolution === 'allow' ? 'accept' : resolution === 'cancelled' ? 'cancel' : 'decline';
          try { respond(rpcId, { decision }); } catch { /* The child may already be gone. */ }
          input.emit({ type: 'permission-resolved', requestId, decision: resolution });
          if (!pendingPermissions && !termination && !fatalError) startTimeoutClock();
        };
        pendingPermissions += 1;
        pauseTimeoutClock();
        input.emit({ type: 'permission-request', requestId, tool, detail });
        if (input.permissions) input.permissions.request(requestId, settle);
        else settle('deny');
      };

      const handleNotification = (message: JsonRecord) => {
        const method = String(message.method);
        const params = record(message.params);
        if (method === 'item/started' || method === 'item/completed') {
          const item = threadItem(params?.item);
          if (item) emitItem(item, method === 'item/completed');
          return;
        }
        if (method === 'item/agentMessage/delta' && typeof params?.delta === 'string') {
          input.emit({ type: 'text-delta', text: params.delta });
          return;
        }
        if (method.startsWith('item/reasoning/')) {
          input.emit({ type: 'phase', phase: 'thinking' });
          return;
        }
        if (method === 'thread/tokenUsage/updated') {
          const tokenUsage = record(params?.tokenUsage);
          const total = record(tokenUsage?.total);
          usage = {
            inputTokens: typeof total?.inputTokens === 'number' ? total.inputTokens : undefined,
            outputTokens: typeof total?.outputTokens === 'number' ? total.outputTokens : undefined,
          };
          return;
        }
        if (method === 'error' && params?.willRetry !== true) {
          const error = record(params?.error);
          const errorKind = codexErrorKind(error?.codexErrorInfo);
          const errorMessage = typeof error?.message === 'string'
            ? sanitizeRunDetail(error.message, input.checkout.realPath, input.attachmentDirectory)
            : 'No error message';
          log?.(`turn error ${errorKind}: ${errorMessage}`);
          stopWith(new AgentRunError(
            errorKind === 'unauthorized' ? 'unauthenticated' : 'process-failed',
            errorKind === 'unauthorized'
              ? 'Codex is not authenticated. Run `codex login` locally and sign in.'
              : 'Codex reported an unrecoverable turn error.',
          ));
          return;
        }
        if (method === 'turn/completed') {
          const turn = record(params?.turn);
          if (Array.isArray(turn?.items)) {
            for (const value of turn.items) {
              const item = threadItem(value);
              if (item) emitItem(item, true);
            }
          }
          const status = typeof turn?.status === 'string' ? turn.status : '';
          turnCompleted = true;
          if (status === 'failed') {
            const turnError = record(turn?.error);
            log?.(`turn completed failed ${codexErrorKind(turnError?.codexErrorInfo)}: ${sanitizeRunDetail(
              typeof turnError?.message === 'string' ? turnError.message : 'No error message',
              input.checkout.realPath,
              input.attachmentDirectory,
            )}`);
            stopWith(new Error(typeof turnError?.message === 'string' ? turnError.message : 'Codex turn failed'));
            return;
          }
          closeInput();
        }
      };

      const processLine = (raw: string) => {
        const line = raw.trim();
        if (!line) return;
        if (Buffer.byteLength(line) > 1_048_576) {
          throw new AgentRunError('oversized-output', 'Codex emitted an oversized App Server event.');
        }
        let message: JsonRecord;
        try { message = JSON.parse(line) as JsonRecord; }
        catch { throw new AgentRunError('malformed-stream', 'Codex emitted malformed App Server data.'); }
        if (typeof message.method === 'string' && message.id !== undefined) {
          if (message.method.includes('/requestApproval')) handleApproval(message);
          else if (typeof message.id === 'string' || typeof message.id === 'number') respondUnsupported(message.id);
          return;
        }
        if (message.id !== undefined) {
          const waiter = pending.get(String(message.id));
          if (!waiter) return;
          pending.delete(String(message.id));
          const error = record(message.error);
          if (error) waiter.reject(new RpcResponseError(
            typeof error.code === 'number' ? error.code : -32000,
            typeof error.message === 'string' ? error.message : 'Codex App Server request failed',
          ));
          else waiter.resolve(message.result);
          return;
        }
        if (typeof message.method === 'string') handleNotification(message);
      };

      child.once('error', (error) => {
        finish(() => reject((error as NodeJS.ErrnoException).code === 'ENOENT'
          ? new AgentRunError('missing-binary', `Codex executable was not found: ${path.basename(this.options.binary)}`, 'not-sent', false)
          : new AgentRunError('process-failed', 'Codex App Server could not be started.', 'not-sent')));
      });
      child.stdout.on('data', (chunk: Buffer) => {
        if (settled || fatalError) return;
        try {
          protocolBytes += chunk.length;
          if (protocolBytes > Math.max(4_194_304, this.options.maxOutputBytes * 8)) {
            throw new AgentRunError('oversized-output', 'Codex App Server exceeded the configured stream limit.');
          }
          stdoutBuffer += chunk.toString('utf8');
          let newline = stdoutBuffer.indexOf('\n');
          while (newline >= 0) {
            processLine(stdoutBuffer.slice(0, newline));
            stdoutBuffer = stdoutBuffer.slice(newline + 1);
            newline = stdoutBuffer.indexOf('\n');
          }
        } catch (error) { stopWith(error); }
      });
      child.stderr.on('data', (chunk: Buffer) => {
        if (Buffer.byteLength(stderr) < 65_536) stderr += chunk.toString('utf8').slice(0, 65_536);
      });
      child.once('close', (code) => {
        log?.(`exit code=${code}${termination ? ` after ${termination}` : ''} (protocol ${protocolBytes}B)`);
        input.permissions?.cancelAll();
        for (const waiter of pending.values()) waiter.reject(new Error('Codex App Server closed'));
        pending.clear();
        if (settled) return;
        if (!fatalError && stdoutBuffer.trim()) {
          try { processLine(stdoutBuffer); }
          catch (error) { fatalError = error; }
        }
        if (fatalError) {
          finish(() => reject(classifyCodexFailure(fatalError, input.session.action, turnRequestSent ? 'possibly-sent' : 'not-sent')));
          return;
        }
        if (termination === 'cancelled') {
          finish(() => reject(new AgentRunError('cancelled', 'The request was cancelled.')));
          return;
        }
        if (termination === 'timeout') {
          finish(() => reject(new AgentRunError('timeout', 'Codex exceeded the configured time limit.')));
          return;
        }
        if (code !== 0 || !turnCompleted) {
          finish(() => reject(classifyCodexFailure(stderr || 'Codex App Server closed early', input.session.action, turnRequestSent ? 'possibly-sent' : 'not-sent')));
          return;
        }
        finalText ||= assistantFallback;
        if (!finalText.trim()) {
          finish(() => reject(new AgentRunError('absent-result', 'Codex finished without an assistant response.')));
          return;
        }
        if (Buffer.byteLength(finalText) > this.options.maxOutputBytes) {
          finish(() => reject(new AgentRunError('oversized-output', 'Codex response exceeded the configured assistant limit.')));
          return;
        }
        finish(() => resolve({
          finalText,
          sessionId,
          durationMs: Date.now() - startedAt,
          outputBytes: Buffer.byteLength(finalText),
          usage,
        }));
      });
      child.stdin.once('error', () => undefined);
      input.signal.addEventListener('abort', abort, { once: true });
      startTimeoutClock();

      void (async () => {
        try {
          await request('initialize', {
            // `title` is display metadata; `name` is the client identifier Codex already knows
            // this app by, so it keeps its historical spelling like `serviceName` below.
            clientInfo: { name: 'cartograph_web2', title: 'CodeAI', version: '0.1.0' },
            capabilities: null,
          });
          notify('initialized');
          const [mcp, hooks, skills] = await Promise.all([
            request('mcpServerStatus/list', { cursor: null, limit: 100, detail: 'toolsAndAuthOnly' }),
            request('hooks/list', { cwds: [input.checkout.realPath] }),
            request('skills/list', { cwds: [input.checkout.realPath], forceReload: true }),
          ]);
          const mcpServerNames = codexMcpServerNames(mcp);
          if (!mcpServerNames) {
            throw new AgentRunError(
              'unsupported-flags',
              'Codex did not return a complete MCP capability inventory.',
              'not-sent',
              false,
            );
          }
          const isolationIssue = codexIsolationIssue({ mcp: { data: [] }, hooks, skills });
          if (isolationIssue) {
            throw new AgentRunError(
              'unsupported-flags',
              `${isolationIssue} Disable it in Codex before using this provider in CodeAI.`,
              'not-sent',
              false,
            );
          }
          const security = codexTurnSecurity(input.policy.mode);
          const common = {
            cwd: input.checkout.realPath,
            approvalPolicy: security.approvalPolicy,
            sandbox: security.sandbox,
            config: codexThreadConfig(mcpServerNames),
            developerInstructions: CODEX_DEVELOPER_INSTRUCTIONS,
            ...(this.options.model ? { model: this.options.model } : {}),
          };
          const threadResult = record(await request(
            input.session.action === 'start' ? 'thread/start' : 'thread/resume',
            input.session.action === 'start'
              // Provider-side identifier for every thread started so far. Renaming it is a Codex
              // data migration, not branding, so it stays as it is.
              ? { ...common, serviceName: 'cartograph_web2' }
              : { ...common, threadId: input.session.id },
          ));
          const providerThread = record(threadResult?.thread);
          if (typeof providerThread?.id !== 'string') throw new Error('Codex App Server returned no provider session id');
          if (input.session.action === 'resume' && providerThread.id !== input.session.id) {
            throw new AgentRunError('missing-session', 'Codex resumed an unexpected native provider session.', 'not-sent');
          }
          sessionId = providerThread.id;
          const policyIssue = codexThreadPolicyIssue(threadResult, input.checkout.realPath, security.approvalPolicy);
          if (policyIssue) {
            throw new AgentRunError('unsupported-flags', policyIssue, 'not-sent', false);
          }
          const scopedMcp = await request('mcpServerStatus/list', {
            cursor: null, limit: 100, detail: 'toolsAndAuthOnly', threadId: sessionId,
          });
          const scopedIsolationIssue = codexIsolationIssue({ mcp: scopedMcp, hooks, skills });
          if (scopedIsolationIssue) {
            throw new AgentRunError(
              'unsupported-flags',
              `${scopedIsolationIssue} Disable it in Codex before using this provider in CodeAI.`,
              'not-sent',
              false,
            );
          }
          input.emit({ type: 'session-started', sessionId });
          const turnInput = [
            { type: 'text', text: input.prompt, text_elements: [] },
            ...imagePaths.map((imagePath) => ({ type: 'localImage', path: imagePath })),
          ];
          turnRequestSent = true;
          const turnResult = record(await request('turn/start', {
            threadId: sessionId,
            input: turnInput,
            cwd: input.checkout.realPath,
            approvalPolicy: security.approvalPolicy,
            sandboxPolicy: security.sandboxPolicy,
            ...(this.options.model ? { model: this.options.model } : {}),
          }));
          const turn = record(turnResult?.turn);
          if (typeof turn?.id !== 'string') throw new Error('Codex App Server returned no turn id');
          turnId = turn.id;
        } catch (error) {
          stopWith(error);
        }
      })();
      if (input.signal.aborted) abort();
    });
  }
}
