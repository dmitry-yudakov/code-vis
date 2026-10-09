import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type {
  AgentProcessResult, AgentProcessRun, AgentProcessRunner, PermissionResolution,
} from '@/shared/types';
import { AgentRunError } from './agentRunError';
import type { ProcessTransport } from '@/server/execution/processTransport';
import {
  buildCodexAppServerArgs, codexDeveloperInstructions, codexIsolationIssue,
  codexMcpServerNames, codexThreadConfig, codexThreadPolicyIssue, codexTurnSecurity,
} from './codexInvocation';
import { frameGlobalInstructions } from './globalInstructions';
import { codexThreadId, CodexSubagentThreads } from './codexSubagentThreads';
import { captureDescendantProcesses, ProcessCaptureError, readProcessIdentity, stopDescendantProcesses } from './processDescendants';

interface RunnerOptions {
  transport?: ProcessTransport;
  /** Docker only: where the worker sees the user's allowlisted customizations. */
  customizationsPath?: string;
  imagePaths?: string[];
  binary: string;
  model?: string;
  maxOutputBytes: number;
  killGraceMs?: number;
  debug?: boolean;
}

type RpcId = string | number;
type JsonRecord = Record<string, unknown>;

/**
 * Bounds one App Server line, finished or not. The stream as a whole is not capped: command output
 * and reasoning make a long turn's stream far larger than its answer, and only the unfinished line
 * is held in memory. The answer has its own cap (`maxOutputBytes`).
 */
const MAX_EVENT_BYTES = 1_048_576;
const oversizedEvent = (sent: boolean, resuming: boolean) => new AgentRunError('oversized-output',
  !sent && resuming ? 'Codex emitted an oversized App Server event before starting the resumed turn. Update the executing machine\'s Codex CLI and retry.'
    : 'Codex emitted an oversized App Server event.', sent ? 'possibly-sent' : 'not-sent');

class RpcResponseError extends Error {
  constructor(public readonly code: number, message: string) {
    super(message);
    this.name = 'RpcResponseError';
  }
}

function record(value: unknown): JsonRecord | undefined {
  return value && typeof value === 'object' ? value as JsonRecord : undefined;
}

function cleanDetail(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replaceAll(/[\u0000-\u001f\u007f]+/g, ' ').replaceAll(/\s+/g, ' ').trim();
}

function sanitizeDetail(value: string): string {
  const clean = cleanDetail(value);
  return clean.length > 160 ? `${clean.slice(0, 159)}…` : clean;
}

/** Shortens the run's own paths. Whole path prefixes only: `/repo-secrets` is not inside `/repo`. */
function withoutRunPaths(value: string, repositoryRoot: string, attachmentDirectory: string): string {
  const prefix = (root: string) => new RegExp(`${root.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w.-])`, 'g');
  return value.replaceAll(prefix(repositoryRoot), '.').replaceAll(prefix(attachmentDirectory), '[attachment]');
}

function sanitizeRunDetail(value: string, repositoryRoot: string, attachmentDirectory: string): string {
  return sanitizeDetail(withoutRunPaths(value, repositoryRoot, attachmentDirectory));
}

const APPROVAL_HEAD_CHARS = 560;
const APPROVAL_TAIL_CHARS = 240;

/**
 * What an approval card asks about. It is never cut silently: a long command keeps both ends, where
 * what it runs last is, and says how much is missing between them.
 */
function approvalSubject(value: string, repositoryRoot: string, attachmentDirectory: string): string {
  const clean = cleanDetail(withoutRunPaths(value, repositoryRoot, attachmentDirectory));
  const omitted = clean.length - APPROVAL_HEAD_CHARS - APPROVAL_TAIL_CHARS;
  return omitted > 0
    ? `${clean.slice(0, APPROVAL_HEAD_CHARS)} …[${omitted} characters not shown]… ${clean.slice(-APPROVAL_TAIL_CHARS)}`
    : clean;
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

/**
 * The files one change touches. A path outside the checkout is named whole and listed first: it is
 * what an approval is about, and its file name alone would say nothing.
 */
function changedPaths(item: JsonRecord, repositoryRoot: string): string[] {
  if (!Array.isArray(item.changes)) return [];
  const inside: string[] = [];
  const outside: string[] = [];
  for (const change of item.changes) {
    const target = record(change)?.path;
    if (typeof target !== 'string') continue;
    const relative = relativeWithin(repositoryRoot, target);
    if (relative) inside.push(relative);
    else outside.push(target.startsWith(`${os.homedir()}${path.sep}`) ? `~${target.slice(os.homedir().length)}` : target);
  }
  return [...outside, ...inside];
}

function listPaths(paths: string[], limit: number): string {
  return paths.length > limit ? `${paths.slice(0, limit).join(', ')}, and ${paths.length - limit} more` : paths.join(', ');
}

function classifyCodexFailure(
  error: unknown,
  action: 'start' | 'resume',
  delivery: 'not-sent' | 'possibly-sent',
): AgentRunError {
  if (error instanceof AgentRunError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  if (error instanceof RpcResponseError && (error.code === -32601 || error.code === -32602 || /requires experimentalapi|invalid params/.test(normalized))) {
    return new AgentRunError('unsupported-flags', 'The installed Codex version does not support CodeAI\'s required App Server protocol.', 'not-sent', false);
  }
  if (/unauthori[sz]ed|not authenticated|authentication|login required|sign in/.test(normalized)) {
    return new AgentRunError('unauthenticated', 'Codex is not authenticated. Run `codex login` locally and sign in.', 'not-sent');
  }
  if (action === 'resume' && /thread|session/.test(normalized) && /not found|missing|invalid|unknown/.test(normalized)) {
    return new AgentRunError('missing-session', 'The native Codex provider session is missing or cannot be resumed. Continue in a new provider session.', 'not-sent');
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
    if (input.policy.execution === 'docker' && !this.options.transport) {
      throw new AgentRunError('unsupported-flags', 'Docker requires its verified container transport.', 'not-sent', false);
    }
    if (input.session.action === 'resume' && !input.session.id) {
      throw new AgentRunError('missing-session', 'The native Codex provider session id is missing. Continue in a new provider session.', 'not-sent');
    }
    // Canvas composites are PNG, report screenshots JPEG, and a message's images either; each was
    // validated and bounded when written.
    const imagePaths = this.options.imagePaths ?? (await readdir(input.attachmentDirectory))
      .filter((name) => /\.(png|jpg)$/.test(name))
      .map((name) => path.join(input.attachmentDirectory, name));
    const startedAt = Date.now();
    const args = buildCodexAppServerArgs(input.policy.level);
    const log = this.options.debug
      ? (message: string) => console.error(`[agent ${input.runId.slice(0, 8)} codex] +${((Date.now() - startedAt) / 1000).toFixed(1)}s ${message}`)
      : undefined;
    log?.(`spawn ${path.basename(this.options.binary)} ${args.join(' ')} (prompt ${Buffer.byteLength(input.prompt)}B)`);

    return new Promise<AgentProcessResult>((resolve, reject) => {
      const child = this.options.transport?.spawn(this.options.binary, args) ?? spawn(this.options.binary, args, {
        cwd: input.checkout.realPath,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const pending = new Map<string, { resolve(value: unknown): void; reject(error: unknown): void; timer?: ReturnType<typeof setTimeout> }>();
      const emittedItems = new Set<string>();
      const itemDetails = new Map<string, string>();
      const itemPhases = new Map<string, string>();
      const interruptions = new Map<string, Promise<unknown>>();
      const discoveries = new Map<string, Promise<unknown>>();
      const deferredCapabilities = new Set<string>();
      let nextRequestId = 1;
      let stdoutBuffer = '';
      let stderr = '';
      let protocolBytes = 0;
      let sessionId = input.session.id || '';
      let turnId: string | undefined;
      let turnStart: Promise<unknown> | undefined;
      let turnRequestSent = false;
      let turnCompleted = false;
      let finalText = '';
      let assistantFallback = '';
      let usage: AgentProcessResult['usage'];
      let settled = false;
      let fatalError: unknown;
      let termination: 'cancelled' | 'timeout' | undefined;
      let stdinOpen = true;
      let closingInput = false;
      let cleanup: Promise<void> | undefined;
      let descendants: Awaited<ReturnType<typeof captureDescendantProcesses>> = [];
      const processRoot = input.policy.execution === 'docker' ? Promise.resolve(undefined) : readProcessIdentity(child.pid);
      let processSnapshot: typeof descendants = [];
      let inventoryIncomplete = false;
      let cleanupReported = false;
      let sdkCleanupConfirmed = false;
      let captureInFlight: Promise<void> | undefined;
      let processMonitor: ReturnType<typeof setInterval> | undefined;
      let descendantCleanup: Promise<void> | undefined;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
      let clockStartedAt = Date.now();
      let remainingTimeoutMs = input.policy.timeoutMs;
      let pendingPermissions = 0;
      let subagents: CodexSubagentThreads | undefined;
      const callbacks = new Set<string>();
      const approvals = new Map<string, {
        threadId: string; turnId: string; requestId: string;
        published: boolean;
        cancel(sendResponse?: boolean): void;
        publish(): void;
      }>();
      const callbackKey = (id: RpcId) => `${typeof id}:${id}`;
      const itemKey = (thread: string, turn: unknown, item: string) => JSON.stringify([thread, turn, item]);
      const live = () => !settled && !termination && !fatalError && !turnCompleted && stdinOpen;
      const reconcileApprovals = () => {
        for (const approval of [...approvals.values()]) {
          if (approval.threadId === sessionId) {
            if (turnId && approval.turnId !== turnId) approval.cancel();
            else if (turnId && !approval.published) approval.publish();
            continue;
          }
          const invalid = approval.published
            ? !subagents?.active(approval.threadId, approval.turnId)
            : subagents?.ended(approval.threadId, approval.turnId);
          if (invalid) approval.cancel();
        }
      };

      const startTimeoutClock = () => {
        if (input.policy.timeoutMs === 0 || !live() || timeoutTimer || pendingPermissions) return;
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
      const request = (method: string, params: JsonRecord = {}, timeoutMs?: number) => {
        const id = nextRequestId++;
        return new Promise<unknown>((requestResolve, requestReject) => {
          const timer = timeoutMs === undefined ? undefined : setTimeout(() => {
            pending.delete(callbackKey(id));
            requestReject(new Error('Codex metadata lookup timed out'));
          }, timeoutMs);
          pending.set(callbackKey(id), { resolve: requestResolve, reject: requestReject, timer });
          try { write({ method, id, params }); }
          catch (error) {
            pending.delete(callbackKey(id));
            if (timer) clearTimeout(timer);
            requestReject(error);
          }
        });
      };
      const respond = (id: RpcId, result: unknown) => write({ id, result });
      const respondUnsupported = (id: RpcId) => write({
        id,
        error: { code: -32601, message: 'This server request is disabled by CodeAI.' },
      });
      const reportUnconfirmedCleanup = () => {
        if (cleanupReported) return;
        cleanupReported = true;
        input.emit({ type: 'activity', tool: 'Stopping Codex', detail: 'Delegated command termination or inventory is unconfirmed. The checkout and machine slot remain locked until cleanup can be confirmed.' });
      };
      const captureProcesses = async (retained: typeof descendants) => {
        const root = await processRoot;
        try {
          const captured = await captureDescendantProcesses(root, retained);
          processSnapshot = captured;
          // An absent launcher cannot prove that an earlier incomplete inventory is now full.
          if (inventoryIncomplete && root && (await readProcessIdentity(root.pid))?.started === root.started) {
            inventoryIncomplete = false;
          }
          return captured;
        } catch (error) {
          inventoryIncomplete = true;
          if (error instanceof ProcessCaptureError) processSnapshot = error.observed;
          throw error;
        }
      };
      const monitorProcesses = () => {
        if (process.platform !== 'linux' || input.policy.execution === 'docker' || processMonitor || closingInput) return;
        const capture = () => {
          if (captureInFlight) return;
          captureInFlight = (async () => {
            processSnapshot = await captureProcesses(processSnapshot);
          })().catch(() => stopWith(new AgentRunError('process-failed', 'Codex could not track its delegated process tree.')))
            .finally(() => { captureInFlight = undefined; });
        };
        capture();
        processMonitor = setInterval(capture, 100);
        processMonitor.unref();
      };
      const interruptTurn = (threadId: string, currentTurn: string) => {
        const key = itemKey(threadId, currentTurn, 'interrupt');
        if (interruptions.has(key) || !stdinOpen) return;
        const interruption = request('turn/interrupt', { threadId, turnId: currentTurn }, 3_000);
        interruptions.set(key, interruption);
        void interruption.catch(() => interruptions.delete(key));
      };
      const interruptAgents = () => {
        if (!stdinOpen) return;
        for (const { threadId, turnId: agentTurnId } of subagents?.activeTurns() ?? []) {
          interruptTurn(threadId, agentTurnId);
        }
      };
      const scheduleKill = (confirmed = false) => {
        if (killTimer) clearTimeout(killTimer);
        // Linux has a process-identity fallback; Docker owns whole-container teardown. Elsewhere
        // keep the SDK alive to retry rather than orphaning workers by killing their coordinator.
        if (!confirmed && turnRequestSent && process.platform !== 'linux' && input.policy.execution !== 'docker') return;
        killTimer = setTimeout(() => {
          // Graceful stopping belongs to the SDK/EOF path. Host fallback must not let a
          // launcher's TERM handler replace workers after the last ancestry snapshot either.
          child.kill('SIGKILL');
        }, this.options.killGraceMs ?? 1_500);
      };
      const discover = (id: string) => {
        if (!subagents || !codexThreadId(id) || id === sessionId || !stdinOpen || discoveries.has(id)) return;
        if (!subagents.discover(id)) return;
        monitorProcesses();
        if (closingInput) scheduleKill();
        const discovery = subagents.verify(id).then(() => {
          if (closingInput) interruptAgents();
        }).finally(() => discoveries.delete(id));
        discoveries.set(id, discovery);
      };
      const closeInput = () => {
        if (!stdinOpen || closingInput) return;
        closingInput = true;
        if (processMonitor) clearInterval(processMonitor);
        pauseTimeoutClock();
        scheduleKill();
        cleanup = (async () => {
          try {
            await captureInFlight;
            if (turnRequestSent && input.policy.execution !== 'docker') {
              descendants = await captureProcesses(processSnapshot);
            }
            for (;;) {
              try {
                while (discoveries.size) await Promise.all([...discoveries.values()]);
                if (turnRequestSent && !turnCompleted && !turnId) {
                  const response = record(await turnStart);
                  const id = record(response?.turn)?.id;
                  if (!codexThreadId(id)) throw new Error('Started turn identity is unconfirmed');
                  turnId = id;
                  reconcileApprovals();
                }
                interruptAgents();
                if (!turnCompleted && turnId) interruptTurn(sessionId, turnId);
                await Promise.all([...interruptions.values()]);
                // Interrupting a turn preserves background exec sessions, including those from
                // completed children. Only metadata-verified threads are SDK cleanup targets.
                const threads = new Set(turnRequestSent ? [sessionId, ...subagents?.verifiedThreads() ?? []] : []);
                for (const threadId of threads) {
                  const terminals = record(await request('thread/backgroundTerminals/list', { threadId }, 3_000));
                  if (!Array.isArray(terminals?.data) || terminals.nextCursor != null) throw new Error('Invalid background terminal inventory');
                  for (const value of terminals.data) {
                    const terminal = record(value);
                    if (typeof terminal?.processId !== 'string') throw new Error('Invalid background terminal id');
                    const stopped = record(await request('thread/backgroundTerminals/terminate', { threadId, processId: terminal.processId }, 3_000));
                    if (stopped?.terminated !== true) {
                      // A terminal can exit naturally between inventory and termination.
                      const remaining = record(await request('thread/backgroundTerminals/list', { threadId }, 3_000));
                      if (stopped?.terminated !== false || !Array.isArray(remaining?.data) || remaining.nextCursor != null
                        || remaining.data.some(value => record(value)?.processId === terminal.processId)) {
                        throw new Error('Background terminal termination was not confirmed');
                      }
                    }
                  }
                  while (discoveries.size) await Promise.all([...discoveries.values()]);
                  interruptAgents();
                  await Promise.all([...interruptions.values()]);
                  for (const agentId of subagents?.verifiedThreads() ?? []) threads.add(agentId);
                }
                if (process.platform !== 'linux' && input.policy.execution !== 'docker' && subagents?.cleanupUnverified) {
                  throw new Error('Delegated thread ownership is unconfirmed');
                }
                sdkCleanupConfirmed = true;
                break;
              } catch (error) {
                if (process.platform === 'linux' || input.policy.execution === 'docker') throw error;
                reportUnconfirmedCleanup();
                await delay(1_000);
              }
            }
          } catch {
            if (!termination) fatalError ||= new AgentRunError('process-failed', 'Codex could not confirm that delegated commands stopped.');
          } finally {
            if (turnRequestSent && input.policy.execution !== 'docker') {
              try { descendants = await captureProcesses([...descendants, ...processSnapshot]); }
              catch { fatalError ||= new AgentRunError('process-failed', 'Codex could not capture its delegated process tree.'); }
            }
            stdinOpen = false;
            child.stdin.end();
            if (sdkCleanupConfirmed) scheduleKill(true);
          }
        })();
      };
      const stopWith = (error: unknown) => {
        if (fatalError) return;
        fatalError = error;
        pauseTimeoutClock();
        input.permissions?.cancelAll();
        for (const approval of [...approvals.values()]) approval.cancel();
        closeInput();
      };
      const interrupt = (reason: 'cancelled' | 'timeout') => {
        if (settled || termination) return;
        termination = reason;
        pauseTimeoutClock();
        input.permissions?.cancelAll();
        for (const approval of [...approvals.values()]) approval.cancel();
        log?.(`interrupt (${reason})`);
        interruptAgents();
        if (sessionId && turnId && stdinOpen) {
          interruptTurn(sessionId, turnId);
        }
        closeInput();
      };
      const abort = () => interrupt('cancelled');
      const finish = (operation: () => void) => {
        if (settled) return;
        settled = true;
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (killTimer) clearTimeout(killTimer);
        if (processMonitor) clearInterval(processMonitor);
        input.signal.removeEventListener('abort', abort);
        operation();
      };

      const emitItem = (item: JsonRecord, completed: boolean, thread = sessionId, itemTurn: unknown = turnId, childTurn = false) => {
        const id = itemKey(thread, itemTurn, String(item.id));
        const type = String(item.type);
        // A child report belongs to its parent provider workflow, never to CodeAI's final answer.
        if (childTurn && ['reasoning', 'agentMessage', 'plan'].includes(type)) return;
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
          const paths = changedPaths(item, input.checkout.realPath);
          // An approval card lists many more paths than an activity line has room for.
          if (paths.length) itemDetails.set(id, listPaths(paths, 12));
          if (!emittedItems.has(id)) input.emit({ type: 'activity', tool: 'Edit', detail: paths.length ? sanitizeDetail(listPaths(paths, 4)) : undefined });
        } else if (type === 'imageView') {
          if (!emittedItems.has(id)) input.emit({ type: 'activity', tool: 'View image' });
        } else if (type === 'subAgentActivity' || type === 'collabAgentToolCall') {
          if (type === 'subAgentActivity' && typeof item.agentThreadId === 'string') {
            if (['started', 'interacted'].includes(String(item.kind))) discover(item.agentThreadId);
            if (item.kind === 'interrupted') subagents?.interrupted(item.agentThreadId);
          } else if (item.tool === 'spawnAgent' && item.senderThreadId === thread && Array.isArray(item.receiverThreadIds)) {
            for (const childId of item.receiverThreadIds) {
              if (codexThreadId(childId)) discover(childId);
            }
          }
          const detail = type === 'subAgentActivity' ? item.kind : item.tool;
          if (!emittedItems.has(id)) input.emit({ type: 'activity', tool: 'Subagent', detail: typeof detail === 'string' ? sanitizeDetail(detail) : undefined });
        } else if (['mcpToolCall', 'dynamicToolCall', 'webSearch', 'hookPrompt'].includes(type)) {
          if (input.policy.level === 'native') {
            const labels: Record<string, string> = { mcpToolCall: 'MCP', dynamicToolCall: 'Dynamic tool', webSearch: 'Web search', hookPrompt: 'Hook' };
            const detail = [item.server, item.tool, item.query].filter((value): value is string => typeof value === 'string').join(' · ');
            if (!emittedItems.has(id)) input.emit({ type: 'activity', tool: labels[type], detail: detail ? sanitizeRunDetail(detail, input.checkout.realPath, input.attachmentDirectory) : undefined });
          } else {
            stopWith(new AgentRunError(
              'unsupported-flags',
              `Codex attempted to use a capability CodeAI disabled (${type}).`,
              turnRequestSent ? 'possibly-sent' : 'not-sent',
              false,
            ));
          }
        }
        emittedItems.add(id);
      };

      const handleApproval = (message: JsonRecord) => {
        const method = String(message.method);
        const rpcId = message.id;
        if ((typeof rpcId !== 'string' && typeof rpcId !== 'number') || !method.includes('/requestApproval')) return;
        const key = callbackKey(rpcId);
        if (callbacks.has(key)) return;
        if (callbacks.size >= 1_024) {
          stopWith(new AgentRunError('oversized-output', 'Codex exceeded the per-turn approval callback limit.'));
          return;
        }
        callbacks.add(key);
        if (input.policy.execution === 'docker') {
          respondUnsupported(rpcId);
          stopWith(new AgentRunError('unsupported-flags', 'This escalation is unsupported by the Docker profile.'));
          return;
        }
        const params = record(message.params);
        const thread = params?.threadId;
        const requestedTurn = params?.turnId;
        const isChild = thread !== sessionId;
        const correlated = !isChild && (!turnId || requestedTurn === turnId);
        const isCommand = method === 'item/commandExecution/requestApproval';
        const isFile = method === 'item/fileChange/requestApproval';
        if (!live() || !codexThreadId(thread) || !codexThreadId(requestedTurn)
          || (!correlated && (!isChild || !subagents)) || (isChild && !subagents?.liveTurn(thread, requestedTurn))
          || !input.policy.interactivePermissions || (!isCommand && !isFile)) {
          respondUnsupported(rpcId);
          if (input.policy.level === 'native') input.emit({ type: 'activity', tool: 'Control request', detail: `CodeAI cannot answer ${sanitizeDetail(method)}.` });
          return;
        }
        if (approvals.size >= 32) { respondUnsupported(rpcId); return; }
        const itemId = itemKey(thread, requestedTurn, typeof params?.itemId === 'string' ? params.itemId : '');
        const tool = isCommand ? 'Shell' : 'Edit';
        const command = typeof params?.command === 'string' ? params.command : '';
        const subject = () => !isCommand ? itemDetails.get(itemId) || (typeof params?.grantRoot === 'string' ? params.grantRoot : '')
          // `writeStdin` is text typed into a command that is already running, not a new command.
          : params?.kind === 'writeStdin' ? `input to a running command: ${command}` : command;
        const networkHost = record(params?.networkApprovalContext)?.host;
        const reason = typeof params?.reason === 'string' ? params.reason : '';
        const detail = () => [
          isChild ? `Subagent ${sanitizeDetail(subagents!.label(thread))}` : '',
          approvalSubject(subject(), input.checkout.realPath, input.attachmentDirectory),
          typeof networkHost === 'string' && networkHost ? `network access to ${sanitizeDetail(networkHost)}` : '',
          // Codex asks in Auto for what leaves the sandbox, and also for commands its own rules flag.
          // The request does not say which, so the card says what Allow can mean at most.
          input.policy.mode === 'auto' ? `may ${isCommand ? 'run' : 'write'} outside the sandbox` : '',
          // The reason is the model's own words, so it is labelled and comes last.
          reason ? `reason given: ${sanitizeRunDetail(reason, input.checkout.realPath, input.attachmentDirectory)}` : '',
        ].filter(Boolean).join(' — ');
        const requestId = randomUUID();
        let answered = false;
        let published = false;
        let sendResponse = true;
        const settle = (resolution: PermissionResolution) => {
          if (answered) return;
          if (resolution === 'allow' && (!live() || (isChild ? !subagents!.active(thread, requestedTurn) : requestedTurn !== turnId))) resolution = 'cancelled';
          answered = true;
          approvals.delete(key);
          if (published) pendingPermissions = Math.max(0, pendingPermissions - 1);
          const decision = resolution === 'allow' ? 'accept' : resolution === 'cancelled' ? 'cancel' : 'decline';
          if (sendResponse) try { respond(rpcId, { decision }); } catch { /* The child may already be gone. */ }
          if (published) input.emit({ type: 'permission-resolved', requestId, decision: resolution });
          if (published && !pendingPermissions) startTimeoutClock();
        };
        approvals.set(key, { threadId: thread, turnId: requestedTurn, requestId, published: false, publish: () => publish(), cancel(send = true) {
          sendResponse = send;
          if (published && input.permissions) input.permissions.cancel(requestId);
          else settle('cancelled');
        } });
        const publish = () => {
          if (answered) return;
          if (!isChild && !turnId && live()) return;
          if (!live() || (isChild && !subagents!.active(thread, requestedTurn))) {
            approvals.delete(key);
            answered = true;
            try { respondUnsupported(rpcId); } catch { /* Provider closed during discovery. */ }
            return;
          }
          published = true;
          approvals.get(key)!.published = true;
          pendingPermissions += 1;
          pauseTimeoutClock();
          if (input.permissions) input.permissions.request(requestId, settle);
          else settle('deny');
          if (!answered) input.emit({ type: 'permission-request', requestId, tool, detail: detail() });
        };
        if (!isChild || subagents!.belongs(thread)) publish();
        else void subagents!.verify(thread).then(publish).catch(() => publish());
      };

      const handleNotification = (message: JsonRecord) => {
        const method = String(message.method);
        const params = record(message.params);
        const thread = params?.threadId;
        if (subagents && method === 'thread/started') {
          subagents.observe(params?.thread);
          const id = record(params?.thread)?.id;
          if (codexThreadId(id)) discover(id);
          return;
        }
        if (method === 'serverRequest/resolved' && (typeof params?.requestId === 'string' || typeof params?.requestId === 'number')) {
          const key = callbackKey(params.requestId);
          const approval = approvals.get(key);
          if (approval && approval.threadId === thread) approval.cancel(false);
          return;
        }
        if (thread === sessionId && method === 'turn/started') {
          const id = record(params?.turn)?.id;
          if (!turnId && codexThreadId(id)) {
            turnId = id;
            reconcileApprovals();
            if (closingInput) interruptTurn(sessionId, id);
          }
          return;
        }
        if (thread !== undefined && thread !== sessionId) {
          if (!codexThreadId(thread) || !subagents || !stdinOpen) return;
          if (method === 'turn/started') {
            subagents.started(thread, record(params?.turn)?.id);
            discover(thread);
          } else if (method === 'turn/completed') {
            const turn = record(params?.turn);
            if (subagents.active(thread, turn?.id) && Array.isArray(turn?.items)) {
              for (const value of turn.items) {
                const item = threadItem(value);
                if (item) emitItem(item, true, thread, turn?.id, true);
              }
            }
            subagents.completed(thread, record(params?.turn)?.id);
          } else if (['thread/closed', 'thread/archived', 'thread/deleted'].includes(method)) {
            subagents.closed(thread);
          }
          // Keep file preview data scoped to its observed live turn while ancestry is being read.
          // This grants no capability and is never shown until the descendant has been verified.
          if ((method === 'item/started' || method === 'item/completed') && subagents.liveTurn(thread, params?.turnId)) {
            const item = threadItem(params?.item);
            if (item?.type === 'fileChange') {
              const paths = changedPaths(item, input.checkout.realPath);
              if (paths.length) itemDetails.set(itemKey(thread, params?.turnId, item.id as string), listPaths(paths, 12));
            }
          }
          if (!subagents.belongs(thread)) {
            // Do not lose a disabled-capability event that precedes its lazy metadata response.
            // Its original turn must still be live when proof arrives.
            if ((method === 'item/started' || method === 'item/completed') && subagents.liveTurn(thread, params?.turnId)) {
              const item = threadItem(params?.item);
              const type = String(item?.type);
              if (input.policy.level !== 'native' && ['mcpToolCall', 'dynamicToolCall', 'webSearch', 'hookPrompt'].includes(type)
                && !deferredCapabilities.has(thread)) {
                deferredCapabilities.add(thread);
                const itemTurn = params?.turnId;
                void subagents.verify(thread).then(() => {
                  if (stdinOpen && subagents!.active(thread, itemTurn)) {
                    stopWith(new AgentRunError('unsupported-flags', `Codex attempted to use a capability CodeAI disabled (${type}).`,
                      turnRequestSent ? 'possibly-sent' : 'not-sent', false));
                  }
                }).finally(() => deferredCapabilities.delete(thread));
              }
            }
            return;
          }
          if (method === 'error' && params?.willRetry !== true) {
            const error = record(params?.error);
            input.emit({ type: 'activity', tool: 'Subagent', detail: sanitizeRunDetail(
              `Subagent ${subagents.label(thread)} failed: ${typeof error?.message === 'string' ? error.message : 'provider error'}`,
              input.checkout.realPath, input.attachmentDirectory) });
          } else if ((method === 'item/started' || method === 'item/completed') && subagents.active(thread, params?.turnId)) {
            const item = threadItem(params?.item);
            if (item) emitItem(item, method === 'item/completed', thread, params?.turnId, true);
          }
          return;
        }
        // Continue discovering teardown targets after completion; no late event may reopen cards,
        // alter the answer, or restart the execution clock.
        if (turnCompleted || termination || fatalError) {
          if (method === 'item/started' || method === 'item/completed') {
            const item = threadItem(params?.item);
            if (item && ['subAgentActivity', 'collabAgentToolCall'].includes(String(item.type))) {
              emitItem(item, method === 'item/completed', sessionId, params?.turnId);
            }
          }
          return;
        }
        if (input.policy.level === 'native' && method.startsWith('item/autoApprovalReview/')) {
          const review = record(params?.review);
          const status = typeof review?.status === 'string' ? review.status : method.split('/').at(-1)!;
          const rationale = typeof review?.rationale === 'string' ? ` — ${review.rationale}` : '';
          input.emit({ type: 'activity', tool: 'Auto review', detail: sanitizeRunDetail(`${status}${rationale}`, input.checkout.realPath, input.attachmentDirectory) });
          return;
        }
        if (method === 'item/started' || method === 'item/completed') {
          const item = threadItem(params?.item);
          if (item) emitItem(item, method === 'item/completed', sessionId, params?.turnId);
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
          if (params?.threadId !== sessionId || (turnId && turn?.id !== turnId)) return;
          turnCompleted = true;
          input.permissions?.cancelAll();
          for (const approval of [...approvals.values()]) approval.cancel();
          interruptAgents();
          if (Array.isArray(turn?.items)) {
            for (const value of turn.items) {
              const item = threadItem(value);
              if (item) emitItem(item, true, sessionId, turn?.id);
            }
          }
          const status = typeof turn?.status === 'string' ? turn.status : '';
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
        if (Buffer.byteLength(line) > MAX_EVENT_BYTES) throw oversizedEvent(turnRequestSent, input.session.action === 'resume');
        let message: JsonRecord;
        try { message = JSON.parse(line) as JsonRecord; }
        catch { throw new AgentRunError('malformed-stream', 'Codex emitted malformed App Server data.'); }
        if (typeof message.method === 'string' && message.id !== undefined) {
          if (!stdinOpen || turnCompleted || termination || fatalError) return;
          if (message.method.includes('/requestApproval')) handleApproval(message);
          else if (typeof message.id === 'string' || typeof message.id === 'number') {
            respondUnsupported(message.id);
            if (input.policy.level === 'native') input.emit({ type: 'activity', tool: 'Control request', detail: `CodeAI cannot answer ${sanitizeDetail(message.method)}.` });
          }
          return;
        }
        if (message.id !== undefined) {
          if (typeof message.id !== 'number' && typeof message.id !== 'string') return;
          const waiter = pending.get(callbackKey(message.id));
          if (!waiter) return;
          pending.delete(callbackKey(message.id));
          if (waiter.timer) clearTimeout(waiter.timer);
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

      child.on('error', (error) => {
        // A failed signal also emits `error`. A live launcher must finish cleanup before its
        // run can settle, and repeated failed signals must retain an error listener.
        if (child.pid) {
          reportUnconfirmedCleanup();
          stopWith(new AgentRunError('process-failed', 'Codex App Server failed during execution.', turnRequestSent ? 'possibly-sent' : 'not-sent'));
          return;
        }
        finish(() => reject((error as NodeJS.ErrnoException).code === 'ENOENT'
          ? new AgentRunError('missing-binary', `Codex executable was not found: ${path.basename(this.options.binary)}`, 'not-sent', false)
          : new AgentRunError('process-failed', 'Codex App Server could not be started.', 'not-sent')));
      });
      child.stdout.on('data', (chunk: Buffer) => {
        if (settled) return;
        try {
          protocolBytes += chunk.length;
          stdoutBuffer += chunk.toString('utf8');
          let newline = stdoutBuffer.indexOf('\n');
          while (newline >= 0) {
            processLine(stdoutBuffer.slice(0, newline));
            stdoutBuffer = stdoutBuffer.slice(newline + 1);
            newline = stdoutBuffer.indexOf('\n');
          }
          if (Buffer.byteLength(stdoutBuffer) > MAX_EVENT_BYTES) throw oversizedEvent(turnRequestSent, input.session.action === 'resume');
        } catch (error) { stdoutBuffer = ''; stopWith(error); }
      });
      child.stderr.on('data', (chunk: Buffer) => {
        if (Buffer.byteLength(stderr) < 65_536) stderr += chunk.toString('utf8').slice(0, 65_536);
      });
      const stopCapturedProcesses = async () => {
        await captureInFlight;
        if (!turnRequestSent && !descendants.length && !processSnapshot.length) return;
        if (process.platform !== 'linux' && input.policy.execution !== 'docker') {
          // Launcher exit cannot prove its background sessions died. Without host identities,
          // only completed SDK cleanup can release admission, even after inherited pipes close.
          await cleanup;
          while (!sdkCleanupConfirmed) { reportUnconfirmedCleanup(); await delay(1_000); }
          return;
        }
        let owned = [...descendants, ...processSnapshot];
        for (;;) {
          try {
            try { owned = await captureProcesses(owned); }
            catch { owned = processSnapshot; }
            await stopDescendantProcesses(owned);
            if (!inventoryIncomplete) return;
          } catch {
            // Keep admission while known workers are alive or the inventory is incomplete.
          }
          reportUnconfirmedCleanup();
          await delay(1_000);
        }
      };
      child.once('exit', () => {
        if (processMonitor) clearInterval(processMonitor);
        stdinOpen = false;
        pauseTimeoutClock();
        input.permissions?.cancelAll();
        // The launcher is dead. Release SDK waits here rather than waiting for inherited pipes.
        for (const waiter of pending.values()) {
          if (waiter.timer) clearTimeout(waiter.timer);
          waiter.reject(new Error('Codex App Server exited'));
        }
        pending.clear();
        // An inherited stdout/stderr can keep `close` waiting after the launcher exits. Stop
        // captured workers first, so those descriptors close and the run can settle.
        descendantCleanup = (async () => {
          await stopCapturedProcesses();
          await cleanup;
          // The final SDK capture can finish after the first stop. This pass must also run
          // before `close`, because a late worker may hold the inherited pipes open.
          await stopCapturedProcesses();
        })();
      });
      child.once('close', async (code) => {
        log?.(`exit code=${code}${termination ? ` after ${termination}` : ''} (protocol ${protocolBytes}B)`);
        input.permissions?.cancelAll();
        for (const approval of [...approvals.values()]) approval.cancel(false);
        for (const waiter of pending.values()) {
          if (waiter.timer) clearTimeout(waiter.timer);
          waiter.reject(new Error('Codex App Server closed'));
        }
        pending.clear();
        if (settled) return;
        await descendantCleanup;
        await cleanup;
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
          await processRoot;
          if (!live()) return;
          await request('initialize', {
            // `title` is display metadata; `name` is the client identifier Codex already knows
            // this app by, so it keeps its historical spelling like `serviceName` below.
            clientInfo: { name: 'cartograph_web2', title: 'CodeAI', version: '0.1.0' },
            capabilities: { experimentalApi: true },
          });
          if (!live()) return;
          notify('initialized');
          const [mcp, hooks, skills] = input.policy.level === 'native' ? [undefined, undefined, undefined] : await Promise.all([
            request('mcpServerStatus/list', { cursor: null, limit: 100, detail: 'toolsAndAuthOnly' }),
            request('hooks/list', { cwds: [input.checkout.realPath] }),
            request('skills/list', { cwds: [input.checkout.realPath], forceReload: true }),
          ]);
          const mcpServerNames = input.policy.level === 'native' ? [] : codexMcpServerNames(mcp);
          if (!mcpServerNames) {
            throw new AgentRunError(
              'unsupported-flags',
              'Codex did not return a complete MCP capability inventory.',
              'not-sent',
              false,
            );
          }
          const isolationIssue = input.policy.level === 'native' ? undefined : codexIsolationIssue({ mcp: { data: [] }, hooks, skills });
          if (isolationIssue) {
            throw new AgentRunError(
              'unsupported-flags',
              `${isolationIssue} Disable it in Codex before using this provider in CodeAI.`,
              'not-sent',
              false,
            );
          }
          const security = codexTurnSecurity(input.policy.mode, input.policy.execution, input.policy.level);
          if (!live()) return;
          const model = input.model ?? this.options.model;
          const common = {
            cwd: input.checkout.realPath,
            approvalPolicy: security.approvalPolicy,
            ...(security.sandbox ? { sandbox: security.sandbox } : {}),
            ...(security.approvalsReviewer ? { approvalsReviewer: security.approvalsReviewer } : {}),
            config: codexThreadConfig(mcpServerNames, security, input.policy.level),
            // Docker only: local Codex loads its own global file, so it never gets the text twice.
            developerInstructions: codexDeveloperInstructions(input.policy.mode, input.policy.execution === 'docker'
              ? frameGlobalInstructions(input.globalInstructions, this.options.customizationsPath) : undefined, input.policy.level),
            ...(model ? { model } : {}),
          };
          const threadResult = record(await request(
            input.session.action === 'start' ? 'thread/start' : 'thread/resume',
            input.session.action === 'start'
              // Provider-side identifier for every thread started so far. Renaming it is a Codex
              // data migration, not branding, so it stays as it is.
              ? { ...common, serviceName: 'cartograph_web2' }
              : { ...common, threadId: input.session.id, excludeTurns: true },
          ));
          const providerThread = record(threadResult?.thread);
          if (!live()) return;
          if (typeof providerThread?.id !== 'string') throw new Error('Codex App Server returned no provider session id');
          if (input.session.action === 'resume' && providerThread.id !== input.session.id) {
            throw new AgentRunError('missing-session', 'Codex resumed an unexpected native provider session.', 'not-sent');
          }
          sessionId = providerThread.id;
          subagents = new CodexSubagentThreads(sessionId,
            (id) => request('thread/read', { threadId: id, includeTurns: false }, 3_000), reconcileApprovals);
          const policyIssue = codexThreadPolicyIssue(threadResult, input.checkout.realPath, security, input.policy.level);
          if (policyIssue) {
            throw new AgentRunError('unsupported-flags', policyIssue, 'not-sent', false);
          }
          const scopedMcp = input.policy.level === 'native' ? undefined : await request('mcpServerStatus/list', {
            cursor: null, limit: 100, detail: 'toolsAndAuthOnly', threadId: sessionId,
          });
          const scopedIsolationIssue = input.policy.level === 'native' ? undefined : codexIsolationIssue({ mcp: scopedMcp, hooks, skills });
          if (!live()) return;
          if (scopedIsolationIssue) {
            throw new AgentRunError(
              'unsupported-flags',
              `${scopedIsolationIssue} Disable it in Codex before using this provider in CodeAI.`,
              'not-sent',
              false,
            );
          }
          // No model has run yet. Refuse an older protocol before delegation can leave commands
          // alive; listing an empty new thread also checks the experimental capability handshake.
          const terminals = record(await request('thread/backgroundTerminals/list', { threadId: sessionId }));
          if (!Array.isArray(terminals?.data)) throw new AgentRunError('unsupported-flags', 'Codex does not support delegated command cleanup. Update the Codex CLI.', 'not-sent', false);
          input.emit({ type: 'session-started', sessionId });
          if (!live()) return;
          const turnInput = [
            { type: 'text', text: input.prompt, text_elements: [] },
            ...imagePaths.map((imagePath) => ({ type: 'localImage', path: imagePath })),
          ];
          turnRequestSent = true;
          monitorProcesses();
          turnStart = request('turn/start', {
            threadId: sessionId,
            input: turnInput,
            cwd: input.checkout.realPath,
            approvalPolicy: security.approvalPolicy,
            ...(security.sandboxPolicy ? { sandboxPolicy: security.sandboxPolicy } : {}),
            ...(security.approvalsReviewer ? { approvalsReviewer: security.approvalsReviewer } : {}),
            ...(model ? { model } : {}),
            // Effort applies to this turn and those after it, so it is never part of the thread.
            ...(input.effort ? { effort: input.effort } : {}),
          });
          const turnResult = record(await turnStart);
          const turn = record(turnResult?.turn);
          if (typeof turn?.id !== 'string') throw new Error('Codex App Server returned no turn id');
          turnId = turn.id;
          reconcileApprovals();
          if (closingInput) interruptTurn(sessionId, turnId);
        } catch (error) {
          stopWith(error);
        }
      })();
      if (input.signal.aborted) abort();
    });
  }
}
