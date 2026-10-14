import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type {
  AgentProcessResult, AgentProcessRun, AgentProcessRunner, PermissionResolution,
  ResolvedAgentPolicy,
} from '@/shared/types';
import { changesCheckout } from '@/shared/agentModes';
import { buildClaudeArgs } from './claudeInvocation';
import { frameGlobalInstructions } from './globalInstructions';
import { AgentRunError } from './agentRunError';
import type { ProcessTransport } from '@/server/execution/processTransport';
import { claudeDisplayInput, displayIdentity, displayResult, displayText } from './providerDisplay';
import type { ActivityActor } from '@/shared/turnActivity';

export { AgentRunError } from './agentRunError';

interface RunnerOptions {
  transport?: ProcessTransport;
  /** Docker only: where the worker sees the user's allowlisted customizations. */
  customizationsPath?: string;
  binary: string;
  model?: string;
  maxOutputBytes: number;
  killGraceMs?: number;
  debug?: boolean;
}

const DENIAL_MESSAGE: Record<Exclude<PermissionResolution, 'allow'>, string> = {
  deny: 'The user denied this action in CodeAI. Do not retry it; continue with what is allowed, or explain what you would need.',
  timeout: 'The approval request expired without an answer. Treat this action as denied and continue without it.',
  cancelled: 'The conversation turn was cancelled, so this action was denied. Stop here.',
};

function relativeWithin(root: string, target: string): string | undefined {
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return undefined;
  return relative.split(path.sep).join('/');
}

function sanitizeDetail(value: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replaceAll(/[\u0000-\u001f\u007f]+/g, " ").replaceAll(/\s+/g, " ").trim();
  return cleaned.length > 120 ? `${cleaned.slice(0, 119)}…` : cleaned;
}

const PATH_INPUT_KEYS = ['file_path', 'notebook_path', 'path'] as const;

/**
 * Bounds one stream line, finished or not. The stream as a whole is not capped: tool results,
 * thinking, and partial messages make a long turn's stream far larger than its answer, and only the
 * unfinished line is held in memory. The answer has its own cap (`maxOutputBytes`).
 */
const MAX_STREAM_EVENT_BYTES = 1_048_576;
const oversizedEvent = () => new AgentRunError('oversized-output', 'Claude emitted an oversized stream event.');

function describeToolUse(
  name: string,
  input: Record<string, unknown> | undefined,
  repositoryRoot: string,
  attachmentDirectory: string,
): { tool: string; detail?: string } {
  const searchScope = () => {
    const scope = typeof input?.path === 'string' ? relativeWithin(repositoryRoot, input.path) : undefined;
    return scope ? ` in ${scope}` : '';
  };
  if (name === 'Read' && typeof input?.file_path === 'string') {
    const repositoryPath = relativeWithin(repositoryRoot, input.file_path);
    if (repositoryPath) return { tool: name, detail: sanitizeDetail(repositoryPath) };
    const contextPath = relativeWithin(attachmentDirectory, input.file_path);
    if (contextPath) return { tool: name, detail: sanitizeDetail(`attached context: ${path.posix.basename(contextPath)}`) };
    return { tool: name };
  }
  if ((name === 'Grep' || name === 'Glob') && typeof input?.pattern === 'string') {
    return { tool: name, detail: sanitizeDetail(`${input.pattern.slice(0, 80)}${searchScope()}`) };
  }
  if (name === 'Bash' && typeof input?.command === 'string') {
    return { tool: name, detail: sanitizeDetail(input.command.slice(0, 200)) };
  }
  for (const key of PATH_INPUT_KEYS) {
    const value = input?.[key];
    if (typeof value !== 'string') continue;
    const repositoryPath = relativeWithin(repositoryRoot, value);
    if (repositoryPath) return { tool: name, detail: sanitizeDetail(repositoryPath) };
  }
  return { tool: name };
}

function classifyFailure(stderr: string, action: 'start' | 'resume'): AgentRunError {
  const normalized = stderr.toLowerCase();
  if (/not authenticated|authentication|please log in|login required/.test(normalized)) {
    return new AgentRunError('unauthenticated', 'Claude Code is not authenticated. Run `claude` locally and sign in.', 'not-sent');
  }
  if (action === 'resume' && /session.*(not found|missing|invalid|corrupt)|no conversation found/.test(normalized)) {
    return new AgentRunError('missing-session', 'The native Claude session is missing or cannot be resumed. Continue in a new provider session.', 'not-sent');
  }
  if (/unknown option|unknown argument|unrecognized option/.test(normalized)) {
    return new AgentRunError('unsupported-flags', 'The installed Claude Code version does not support the required safe conversation flags.', 'not-sent', false);
  }
  return new AgentRunError('process-failed', 'Claude Code exited before returning a complete response.');
}

/**
 * A `result` frame whose subtype starts with `error_` means the CLI stopped deliberately. These
 * deserve their own message: the generic process failure hides the one thing the user can act on.
 */
function classifyResultError(
  subtype: string,
  detail: string,
  policy: ResolvedAgentPolicy,
  action: 'start' | 'resume',
): AgentRunError {
  if (subtype === 'error_max_turns') {
    const setting = changesCheckout(policy.mode) ? 'CODEAI_BUILD_MAX_TURNS' : 'CODEAI_AGENT_MAX_TURNS';
    return new AgentRunError(
      'max-turns',
      `The agent used all ${policy.maxTurns} tool turns allowed for one message before it finished. `
      + `Its session is intact — send "continue" to pick up where it stopped, or raise ${setting}.`,
    );
  }
  return classifyFailure(detail, action);
}

export class ClaudeProcessRunner implements AgentProcessRunner {
  constructor(private readonly options: RunnerOptions) {}

  async run(input: AgentProcessRun): Promise<AgentProcessResult> {
    if (input.policy.execution === 'docker' && !this.options.transport) {
      throw new AgentRunError('unsupported-flags', 'Docker requires its verified container transport.', 'not-sent', false);
    }
    if (input.policy.mode === 'auto' && input.policy.level !== 'native') {
      // Claude never advertises Auto, so the route refuses it first. This keeps an Auto policy from
      // ever reaching the CLI as if it were Agent's.
      throw new AgentRunError('unsupported-flags', 'Claude does not run Auto in this CodeAI version.', 'not-sent', false);
    }
    const startedAt = Date.now();
    const providerSessionId = input.session.id;
    if (!providerSessionId) {
      throw new AgentRunError('missing-session', 'The native Claude session id is missing. Continue in a new provider session.', 'not-sent');
    }
    const args = buildClaudeArgs({
      session: { ...input.session, id: providerSessionId },
      attachmentDirectory: input.attachmentDirectory,
      policy: input.policy,
      model: input.model ?? this.options.model,
      effort: input.effort,
      appendSystemPrompt: frameGlobalInstructions(input.globalInstructions, this.options.customizationsPath),
    });
    const log = this.options.debug
      ? (message: string) => console.error(`[agent ${input.runId.slice(0, 8)}] +${((Date.now() - startedAt) / 1000).toFixed(1)}s ${message}`)
      : undefined;
    // The appended prompt is the user's own file: its size is logged, never its text.
    const logged = args.map((arg, index) => args[index - 1] === '--append-system-prompt' ? `<${Buffer.byteLength(arg)}B>` : arg);
    log?.(`spawn ${path.basename(this.options.binary)} ${logged.join(' ')} (prompt ${Buffer.byteLength(input.prompt)}B)`);

    return new Promise<AgentProcessResult>((resolve, reject) => {
      // The environment is inherited untouched: whatever login, base URL, or token the user's own
      // Claude Code uses applies here too. CodeAI adds no provider variables of its own.
      const child = this.options.transport?.spawn(this.options.binary, args) ?? spawn(this.options.binary, args, {
        cwd: input.checkout.realPath,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdoutBuffer = '';
      let stderr = '';
      let outputBytes = 0;
      let finalText = '';
      let assistantFallback = '';
      let finalBlockId: string | undefined;
      let rootTextCandidate: string | undefined;
      let rootTextCandidates: string[] = [];
      let finalBlockIds: string[] | undefined;
      let rootFinalPhase = false;
      let anonymousMessage = 0;
      const messageScopes = new Map<string, { id: string; block: number; blockType?: string; streaming?: boolean }>();
      const toolNames = new Map<string, string>();
      const rememberTool = (key: string, name: string) => {
        if (toolNames.size >= 1000 && !toolNames.has(key)) toolNames.delete(toolNames.keys().next().value!);
        toolNames.set(key, name);
      };
      const actorFor = (parent?: string): ActivityActor => ({ provider: 'claude', ...(parent ? { parentToolId: parent, name: 'Subagent' } : {}) });
      const toolKey = (id: string, parent = '') => displayIdentity(['tool', parent, id]);
      const blockKey = (id: string, index: number, parent = '') => displayIdentity(['text', parent, id, index]);
      const scopeFor = (parent: string) => {
        const scopeKey = displayIdentity([parent]);
        let scope = messageScopes.get(scopeKey);
        if (!scope) {
          scope = { id: `anonymous-${++anonymousMessage}`, block: 0 };
          // Display-only scopes must not grow with an unbounded number of delegated messages.
          if (messageScopes.size >= 1000) messageScopes.delete(messageScopes.keys().next().value!);
          messageScopes.set(scopeKey, scope);
        }
        return scope;
      };
      let sessionId = providerSessionId;
      let settled = false;
      let termination: 'cancelled' | 'timeout' | undefined;
      let fatalStreamError: unknown;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const emittedToolUseIds = new Set<string>();
      const emittedTurnIds = new Set<string>();
      const countTurn = (id: string) => {
        id = displayIdentity([id]);
        if (emittedTurnIds.has(id)) return;
        emittedTurnIds.add(id);
        input.emit({ type: 'turn-started' });
      };
      let textDeltaCount = 0;
      let textDeltaBytes = 0;
      let pendingPermissions = 0;
      let stdinOpen = input.policy.interactivePermissions;

      let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
      let clockStartedAt = Date.now();
      let remainingTimeoutMs = input.policy.timeoutMs;
      const startTimeoutClock = () => {
        if (input.policy.timeoutMs === 0) return;
        clockStartedAt = Date.now();
        timeoutTimer = setTimeout(() => terminate('timeout'), remainingTimeoutMs);
      };
      const pauseTimeoutClock = () => {
        if (!timeoutTimer) return;
        clearTimeout(timeoutTimer);
        timeoutTimer = undefined;
        remainingTimeoutMs = Math.max(0, remainingTimeoutMs - (Date.now() - clockStartedAt));
      };

      const finish = (operation: () => void) => {
        if (settled) return;
        settled = true;
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (killTimer) clearTimeout(killTimer);
        input.signal.removeEventListener('abort', abort);
        operation();
      };

      const writeToChild = (payload: unknown) => {
        if (!stdinOpen || child.stdin.destroyed) return;
        child.stdin.write(`${JSON.stringify(payload)}\n`);
      };

      const closeChildInput = () => {
        if (!stdinOpen) return;
        stdinOpen = false;
        child.stdin.end();
      };

      const terminate = (reason: 'cancelled' | 'timeout') => {
        if (settled || termination) return;
        termination = reason;
        log?.(`terminate (${reason})`);
        // Answer everything the child is still waiting on before killing it, so the model is never
        // left blocked on a request that can no longer be answered.
        input.permissions?.cancelAll();
        closeChildInput();
        child.kill('SIGTERM');
        killTimer = setTimeout(() => child.kill('SIGKILL'), this.options.killGraceMs ?? 1_500);
      };

      const abort = () => terminate('cancelled');
      input.signal.addEventListener('abort', abort, { once: true });
      startTimeoutClock();

      const handlePermissionRequest = (event: Record<string, unknown>) => {
        const request = event.request as Record<string, unknown> | undefined;
        const cliRequestId = typeof event.request_id === 'string' ? event.request_id : undefined;
        if (!cliRequestId) return;
        if (request?.subtype !== 'can_use_tool') {
          if (input.policy.level !== 'native') return;
          const subtype = typeof request?.subtype === 'string' ? sanitizeDetail(request.subtype) : 'unknown control request';
          writeToChild({ type: 'control_response', response: { subtype: 'error', request_id: cliRequestId, error: `CodeAI cannot answer ${subtype}.` } });
          input.emit({ type: 'activity', tool: 'Control request', detail: `CodeAI cannot answer ${subtype}.` });
          return;
        }
        if (input.policy.execution === 'docker') {
          throw new AgentRunError('unsupported-flags', 'This action requires an escalation unsupported by the Docker profile.');
        }
        const tool = typeof request.tool_name === 'string' ? request.tool_name : 'tool';
        const toolInput = request.input && typeof request.input === 'object' ? request.input as Record<string, unknown> : undefined;
        const described = describeToolUse(tool, toolInput, input.checkout.realPath, input.attachmentDirectory);
        const projected = claudeDisplayInput(tool, toolInput, input.checkout.realPath, input.attachmentDirectory);
        const parent = typeof event.parent_tool_use_id === 'string' ? event.parent_tool_use_id
          : typeof request.parent_tool_use_id === 'string' ? request.parent_tool_use_id : '';
        const associatedTool = typeof request.tool_use_id === 'string' ? toolKey(request.tool_use_id, parent) : undefined;
        const requestId = randomUUID();
        log?.(`recv permission request ${tool}${described.detail ? ` (${described.detail})` : ''}`);

        const settle = (resolution: PermissionResolution) => {
          pendingPermissions = Math.max(0, pendingPermissions - 1);
          writeToChild({
            type: 'control_response',
            response: {
              subtype: 'success',
              request_id: cliRequestId,
              response: resolution === 'allow'
                ? { behavior: 'allow', updatedInput: toolInput || {} }
                : { behavior: 'deny', message: DENIAL_MESSAGE[resolution] },
            },
          });
          log?.(`permission ${resolution} for ${tool}`);
          input.emit({ type: 'permission-resolved', requestId, decision: resolution });
          // Approval time never counts against the run's own budget.
          if (pendingPermissions === 0 && !settled && !termination) startTimeoutClock();
        };

        pendingPermissions += 1;
        pauseTimeoutClock();
        input.emit({ type: 'permission-request', requestId, tool: described.tool, detail: described.detail || '',
          review: projected.review, actor: actorFor(parent), ...(associatedTool ? { toolKey: associatedTool } : {}) });
        if (!input.permissions) {
          settle('deny');
          return;
        }
        input.permissions.request(requestId, settle);
      };

      const processLine = (raw: string) => {
        const line = raw.trim();
        if (!line) return;
        if (Buffer.byteLength(line) > MAX_STREAM_EVENT_BYTES) throw oversizedEvent();
        let event: Record<string, unknown>;
        try {
          event = JSON.parse(line) as Record<string, unknown>;
        } catch {
          throw new AgentRunError('malformed-stream', 'Claude emitted malformed stream data.');
        }

        if (event.type !== 'stream_event' && event.type !== 'assistant') {
          log?.(`recv ${String(event.type)}${typeof event.subtype === 'string' ? `/${event.subtype}` : ''}`);
        }
        if (event.type === 'control_request') {
          handlePermissionRequest(event);
          return;
        }
        if (event.type === 'system' && event.subtype === 'init' && typeof event.session_id === 'string') {
          sessionId = event.session_id;
          input.emit({ type: 'session-started', sessionId });
          return;
        }
        if (event.type === 'system' && event.subtype === 'permission_denied') {
          // Auto-denials (no allowlist match, headless with no prompt) are visible rather than silent.
          const tool = typeof event.tool_name === 'string' ? event.tool_name : 'tool';
          const toolInput = event.tool_input && typeof event.tool_input === 'object' ? event.tool_input as Record<string, unknown> : undefined;
          const described = describeToolUse(tool, toolInput, input.checkout.realPath, input.attachmentDirectory);
          input.emit({ type: 'activity', ...described, denied: true });
          input.emit({ type: 'history', activity: { kind: 'tool', key: toolKey(typeof event.tool_use_id === 'string' ? event.tool_use_id : `denied-${++anonymousMessage}`),
            actor: actorFor(), tool, summary: described.detail, status: 'denied' } });
          return;
        }
        if (event.type === 'stream_event') {
          const stream = event.event as Record<string, unknown> | undefined;
          const message = stream?.message as Record<string, unknown> | undefined;
          const parent = typeof event.parent_tool_use_id === 'string' ? event.parent_tool_use_id : '';
          if (stream?.type === 'message_start') {
            messageScopes.delete(displayIdentity([parent]));
            const scope = scopeFor(parent);
            scope.streaming = true;
            if (typeof message?.id === 'string') scope.id = displayIdentity([message.id]);
            if (!parent) { rootTextCandidate = undefined; rootTextCandidates = []; rootFinalPhase = false; }
          }
          const scope = scopeFor(parent);
          if (typeof stream?.index === 'number') scope.block = stream.index;
          const key = blockKey(scope.id, scope.block, parent);
          if (!event.parent_tool_use_id && stream?.type === 'message_start' && typeof message?.id === 'string') countTurn(message.id);
          const delta = stream?.delta as Record<string, unknown> | undefined;
          if (!parent && stream?.type === 'message_delta' && typeof delta?.stop_reason === 'string') rootFinalPhase = delta.stop_reason === 'end_turn';
          if (stream?.type === 'content_block_delta' && delta?.type === 'text_delta' && typeof delta.text === 'string') {
            if (textDeltaCount === 0) log?.('recv first text delta');
            textDeltaCount += 1;
            textDeltaBytes += Buffer.byteLength(delta.text);
            input.emit({ type: 'text-delta', text: delta.text });
            input.emit({ type: 'history', activity: { kind: 'assistant', key, actor: actorFor(parent), text: delta.text, append: true } });
            if (!parent) {
              rootTextCandidate = key;
              if (!rootTextCandidates.includes(key)) rootTextCandidates = [...rootTextCandidates.slice(-999), key];
            }
          }
          const block = stream?.content_block as Record<string, unknown> | undefined;
          if (stream?.type === 'content_block_start' && typeof block?.type === 'string') {
            scope.blockType = block.type;
            log?.(`recv ${block.type} block start`);
          }
          if (stream?.type === 'content_block_start' && block?.type === 'thinking') {
            input.emit({ type: 'phase', phase: 'thinking' });
          }
          if (stream?.type === 'content_block_start' && block?.type === 'text') {
            input.emit({ type: 'phase', phase: 'responding' });
            input.emit({ type: 'history', activity: { kind: 'assistant', key, actor: actorFor(parent), text: typeof block.text === 'string' ? block.text : '' } });
            if (!parent) {
              rootTextCandidate = key;
              if (!rootTextCandidates.includes(key)) rootTextCandidates = [...rootTextCandidates.slice(-999), key];
            }
          }
          if (stream?.type === 'content_block_start' && block?.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
            rememberTool(toolKey(block.id, parent), block.name);
            const toolInput = block.input && typeof block.input === 'object' ? block.input as Record<string, unknown> : undefined;
            const projected = claudeDisplayInput(block.name, toolInput, input.checkout.realPath, input.attachmentDirectory);
            input.emit({ type: 'history', activity: { kind: 'tool', key: toolKey(block.id, parent), actor: actorFor(parent), tool: block.name,
              summary: describeToolUse(block.name, toolInput, input.checkout.realPath, input.attachmentDirectory).detail, input: projected.text,
              omittedBytes: projected.omittedBytes, status: 'running' } });
            if (!parent) { rootTextCandidate = undefined; rootTextCandidates = []; rootFinalPhase = false; }
          }
          if (stream?.type === 'content_block_stop' && scope.blockType === 'text') {
            // An empty append closes a block without replacing streamed text.
            input.emit({ type: 'history', activity: { kind: 'assistant', key, actor: actorFor(parent), text: '', append: true, complete: true } });
          }
          return;
        }
        if (event.type === 'assistant') {
          const message = event.message as Record<string, unknown> | undefined;
          const parent = typeof event.parent_tool_use_id === 'string' ? event.parent_tool_use_id : '';
          const scope = scopeFor(parent);
          const messageId = typeof message?.id === 'string' ? displayIdentity([message.id]) : scope.streaming ? scope.id : `assistant-${++anonymousMessage}`;
          if (!event.parent_tool_use_id) countTurn(typeof message?.id === 'string' ? message.id : `unidentified:${emittedTurnIds.size}`);
          const content = Array.isArray(message?.content) ? message.content : [];
          const parts = content.filter((part): part is Record<string, unknown> => Boolean(part) && typeof part === 'object');
          if (!parent) {
            rootTextCandidate = undefined; rootTextCandidates = [];
            rootFinalPhase = typeof message?.stop_reason === 'string' ? message.stop_reason === 'end_turn'
              : scope.streaming === true && scope.id === messageId && rootFinalPhase;
          }
          for (const [index, part] of parts.entries()) {
            if (part.type === 'text' && typeof part.text === 'string') {
              const key = blockKey(messageId, index, parent);
              input.emit({ type: 'history', activity: { kind: 'assistant', key, actor: actorFor(parent), text: part.text, complete: true } });
              if (!parent) { rootTextCandidate = key; rootTextCandidates = [...rootTextCandidates.slice(-999), key]; }
            }
            if (part.type !== 'tool_use' || typeof part.name !== 'string') continue;
            const toolUseId = typeof part.id === 'string' ? part.id : `unidentified-tool-${++anonymousMessage}`;
            const toolInput = part.input && typeof part.input === 'object' ? part.input as Record<string, unknown> : undefined;
            const activity = describeToolUse(part.name, toolInput, input.checkout.realPath, input.attachmentDirectory);
            const projected = claudeDisplayInput(part.name, toolInput, input.checkout.realPath, input.attachmentDirectory);
            rememberTool(toolKey(toolUseId, parent), part.name);
            input.emit({ type: 'history', activity: { kind: 'tool', key: toolKey(toolUseId, parent), actor: actorFor(parent), tool: part.name,
              summary: activity.detail, input: projected.text, omittedBytes: projected.omittedBytes, status: 'running' } });
            if (!parent) { rootTextCandidate = undefined; rootTextCandidates = []; rootFinalPhase = false; }
            if (emittedToolUseIds.has(toolKey(toolUseId, parent))) continue;
            if (emittedToolUseIds.size >= 1000) emittedToolUseIds.delete(emittedToolUseIds.values().next().value!);
            emittedToolUseIds.add(toolKey(toolUseId, parent));
            log?.(`recv tool_use ${activity.tool}${activity.detail ? ` (${activity.detail})` : ''}`);
            input.emit({ type: 'activity', ...activity });
          }
          if (!parent && parts.some(part => part.type === 'text')) assistantFallback = parts
            .filter((part) => part.type === 'text' && typeof part.text === 'string')
            .map((part) => part.text as string)
            .join('');
          scope.streaming = false;
          messageScopes.delete(displayIdentity([parent]));
          return;
        }
        if (event.type === 'user') {
          const parent = typeof event.parent_tool_use_id === 'string' ? event.parent_tool_use_id : '';
          const message = event.message as Record<string, unknown> | undefined;
          for (const part of Array.isArray(message?.content) ? message.content : []) {
            if (!part || part.type !== 'tool_result' || typeof part.tool_use_id !== 'string') continue;
            const output = displayResult(part.content);
            input.emit({ type: 'history', activity: { kind: 'tool', key: toolKey(part.tool_use_id, parent), actor: actorFor(parent), tool: toolNames.get(toolKey(part.tool_use_id, parent)) || 'Tool',
              output: output.text, omittedBytes: output.omittedBytes, status: part.is_error === true ? 'failed' : 'succeeded',
              ...(part.is_error === true ? { error: displayText(output.text).text } : {}) } });
          }
          return;
        }
        if (event.type === 'result') {
          const subtype = typeof event.subtype === 'string' ? event.subtype : '';
          if (event.is_error === true || subtype.startsWith('error')) {
            throw classifyResultError(subtype, String(event.result || event.error || ''), input.policy, input.session.action);
          }
          if (typeof event.result === 'string') finalText = event.result;
          finalBlockId = rootFinalPhase ? rootTextCandidate : undefined;
          finalBlockIds = rootFinalPhase && rootTextCandidates.length ? rootTextCandidates : undefined;
          if (typeof event.session_id === 'string') sessionId = event.session_id;
          // Streaming input keeps stdin open for control responses; the turn is over, so release it.
          closeChildInput();
        }
      };

      child.once('error', (error) => {
        finish(() => reject((error as NodeJS.ErrnoException).code === 'ENOENT'
          ? new AgentRunError('missing-binary', `Claude Code executable was not found: ${path.basename(this.options.binary)}`, 'not-sent', false)
          : new AgentRunError('process-failed', 'Claude Code could not be started.', 'not-sent')));
      });

      child.stdout.on('data', (chunk: Buffer) => {
        if (settled || fatalStreamError) return;
        try {
          outputBytes += chunk.length;
          stdoutBuffer += chunk.toString('utf8');
          let newline = stdoutBuffer.indexOf('\n');
          while (newline >= 0) {
            processLine(stdoutBuffer.slice(0, newline));
            stdoutBuffer = stdoutBuffer.slice(newline + 1);
            newline = stdoutBuffer.indexOf('\n');
          }
          if (Buffer.byteLength(stdoutBuffer) > MAX_STREAM_EVENT_BYTES) throw oversizedEvent();
        } catch (error) {
          fatalStreamError = error;
          terminate('cancelled');
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
        if (Buffer.byteLength(stderr) < 65_536) stderr += chunk.toString('utf8').slice(0, 65_536);
      });

      child.once('close', (code) => {
        log?.(`exit code=${code}${termination ? ` after ${termination}` : ''} (stdout ${outputBytes}B, ${textDeltaCount} text deltas ${textDeltaBytes}B${stderr.trim() ? `, stderr: ${stderr.trim().slice(0, 200).replaceAll(/\s+/g, ' ')}` : ''})`);
        input.permissions?.cancelAll();
        if (settled) return;
        if (fatalStreamError) {
          finish(() => reject(fatalStreamError));
          return;
        }
        try {
          if (stdoutBuffer.trim()) processLine(stdoutBuffer);
        } catch (error) {
          finish(() => reject(error));
          return;
        }
        if (termination === 'cancelled') {
          finish(() => reject(new AgentRunError('cancelled', 'The request was cancelled.')));
          return;
        }
        if (termination === 'timeout') {
          finish(() => reject(new AgentRunError('timeout', 'Claude Code exceeded the configured time limit.')));
          return;
        }
        if (code !== 0) {
          finish(() => reject(classifyFailure(stderr, input.session.action)));
          return;
        }
        if (!finalText) {
          finalText = assistantFallback;
          finalBlockId ||= rootFinalPhase ? rootTextCandidate : undefined;
          finalBlockIds ||= rootFinalPhase && rootTextCandidates.length ? rootTextCandidates : undefined;
        }
        if (!finalText.trim()) {
          finish(() => reject(new AgentRunError('absent-result', 'Claude Code finished without an assistant response.')));
          return;
        }
        if (Buffer.byteLength(finalText) > this.options.maxOutputBytes) {
          finish(() => reject(new AgentRunError('oversized-output', 'Claude response exceeded the configured assistant limit.')));
          return;
        }
        finish(() => resolve({
          finalText,
          ...(finalBlockId ? { finalBlockId } : {}),
          ...(finalBlockIds ? { finalBlockIds } : {}),
          sessionId,
          durationMs: Date.now() - startedAt,
          outputBytes: Buffer.byteLength(finalText),
        }));
      });

      child.stdin.once('error', () => undefined);
      if (input.policy.interactivePermissions) {
        // Streaming input: one user message now, stdin held open for permission responses.
        child.stdin.write(`${JSON.stringify({
          type: 'user',
          message: { role: 'user', content: [{ type: 'text', text: input.prompt }] },
          parent_tool_use_id: null,
          session_id: providerSessionId,
        })}\n`);
      } else {
        child.stdin.end(input.prompt, 'utf8');
      }
      if (input.signal.aborted) abort();
    });
  }
}
