import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type {
  AgentErrorCode, AgentProcessResult, AgentProcessRun, AgentProcessRunner, PermissionResolution,
  ResolvedAgentPolicy,
} from '@/lib/shared/types';
import { buildClaudeArgs } from './claudeInvocation';

export class AgentRunError extends Error {
  constructor(
    public readonly code: AgentErrorCode,
    message: string,
    public readonly delivery: 'not-sent' | 'possibly-sent' = 'possibly-sent',
    public readonly retryable = true,
  ) {
    super(message);
    this.name = 'AgentRunError';
  }
}

interface RunnerOptions {
  binary: string;
  model?: string;
  maxOutputBytes: number;
  killGraceMs?: number;
  debug?: boolean;
}

const DENIAL_MESSAGE: Record<Exclude<PermissionResolution, 'allow'>, string> = {
  deny: 'The user denied this action in Cartograph. Do not retry it; continue with what is allowed, or explain what you would need.',
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

function describeToolUse(
  name: string,
  input: Record<string, unknown> | undefined,
  projectRoot: string,
  attachmentDirectory: string,
): { tool: string; detail?: string } {
  const searchScope = () => {
    const scope = typeof input?.path === 'string' ? relativeWithin(projectRoot, input.path) : undefined;
    return scope ? ` in ${scope}` : '';
  };
  if (name === 'Read' && typeof input?.file_path === 'string') {
    const projectPath = relativeWithin(projectRoot, input.file_path);
    if (projectPath) return { tool: name, detail: sanitizeDetail(projectPath) };
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
    const projectPath = relativeWithin(projectRoot, value);
    if (projectPath) return { tool: name, detail: sanitizeDetail(projectPath) };
  }
  return { tool: name };
}

function classifyFailure(stderr: string, action: 'start' | 'resume'): AgentRunError {
  const normalized = stderr.toLowerCase();
  if (/not authenticated|authentication|please log in|login required/.test(normalized)) {
    return new AgentRunError('unauthenticated', 'Claude Code is not authenticated. Run `claude` locally and sign in.', 'not-sent');
  }
  if (action === 'resume' && /session.*(not found|missing|invalid|corrupt)|no conversation found/.test(normalized)) {
    return new AgentRunError('missing-session', 'The native Claude session is missing or cannot be resumed. Continue in a new agent session.', 'not-sent');
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
    const setting = policy.mode === 'agent' ? 'CODEAI_WEB2_BUILD_MAX_TURNS' : 'CODEAI_WEB2_AGENT_MAX_TURNS';
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
    const startedAt = Date.now();
    const args = buildClaudeArgs({
      session: input.session,
      attachmentDirectory: input.attachmentDirectory,
      policy: input.policy,
      model: this.options.model,
    });
    const log = this.options.debug
      ? (message: string) => console.error(`[agent ${input.runId.slice(0, 8)}] +${((Date.now() - startedAt) / 1000).toFixed(1)}s ${message}`)
      : undefined;
    log?.(`spawn ${path.basename(this.options.binary)} ${args.join(' ')} (prompt ${Buffer.byteLength(input.prompt)}B)`);

    return new Promise<AgentProcessResult>((resolve, reject) => {
      // The environment is inherited untouched: whatever login, base URL, or token the user's own
      // Claude Code uses applies here too. web2 adds no provider variables of its own.
      const child = spawn(this.options.binary, args, {
        cwd: input.project.realPath,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdoutBuffer = '';
      let stderr = '';
      let outputBytes = 0;
      let finalText = '';
      let assistantFallback = '';
      let sessionId = input.session.id;
      let settled = false;
      let termination: 'cancelled' | 'timeout' | undefined;
      let fatalStreamError: unknown;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const emittedToolUseIds = new Set<string>();
      let textDeltaCount = 0;
      let textDeltaBytes = 0;
      let pendingPermissions = 0;
      let stdinOpen = input.policy.interactivePermissions;

      let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
      let clockStartedAt = Date.now();
      let remainingTimeoutMs = input.policy.timeoutMs;
      const startTimeoutClock = () => {
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
        if (!cliRequestId || request?.subtype !== 'can_use_tool') return;
        const tool = typeof request.tool_name === 'string' ? request.tool_name : 'tool';
        const toolInput = request.input && typeof request.input === 'object' ? request.input as Record<string, unknown> : undefined;
        const described = describeToolUse(tool, toolInput, input.project.realPath, input.attachmentDirectory);
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
        input.emit({ type: 'permission-request', requestId, tool: described.tool, detail: described.detail || '' });
        if (!input.permissions) {
          settle('deny');
          return;
        }
        input.permissions.request(requestId, settle);
      };

      const processLine = (raw: string) => {
        const line = raw.trim();
        if (!line) return;
        if (Buffer.byteLength(line) > 1_048_576) throw new AgentRunError('oversized-output', 'Claude emitted an oversized stream event.');
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
          const described = describeToolUse(tool, toolInput, input.project.realPath, input.attachmentDirectory);
          input.emit({ type: 'activity', ...described, denied: true });
          return;
        }
        if (event.type === 'stream_event') {
          const stream = event.event as Record<string, unknown> | undefined;
          const delta = stream?.delta as Record<string, unknown> | undefined;
          if (stream?.type === 'content_block_delta' && delta?.type === 'text_delta' && typeof delta.text === 'string') {
            if (textDeltaCount === 0) log?.('recv first text delta');
            textDeltaCount += 1;
            textDeltaBytes += Buffer.byteLength(delta.text);
            input.emit({ type: 'text-delta', text: delta.text });
          }
          const block = stream?.content_block as Record<string, unknown> | undefined;
          if (stream?.type === 'content_block_start' && typeof block?.type === 'string') {
            log?.(`recv ${block.type} block start`);
          }
          if (stream?.type === 'content_block_start' && block?.type === 'thinking') {
            input.emit({ type: 'phase', phase: 'thinking' });
          }
          if (stream?.type === 'content_block_start' && block?.type === 'text') {
            input.emit({ type: 'phase', phase: 'responding' });
          }
          return;
        }
        if (event.type === 'assistant') {
          const message = event.message as Record<string, unknown> | undefined;
          const content = Array.isArray(message?.content) ? message.content : [];
          const parts = content.filter((part): part is Record<string, unknown> => Boolean(part) && typeof part === 'object');
          for (const part of parts) {
            if (part.type !== 'tool_use' || typeof part.name !== 'string') continue;
            const toolUseId = typeof part.id === 'string' ? part.id : `${part.name}:${emittedToolUseIds.size}`;
            if (emittedToolUseIds.has(toolUseId)) continue;
            emittedToolUseIds.add(toolUseId);
            const toolInput = part.input && typeof part.input === 'object' ? part.input as Record<string, unknown> : undefined;
            const activity = describeToolUse(part.name, toolInput, input.project.realPath, input.attachmentDirectory);
            log?.(`recv tool_use ${activity.tool}${activity.detail ? ` (${activity.detail})` : ''}`);
            input.emit({ type: 'activity', ...activity });
          }
          assistantFallback = parts
            .filter((part) => part.type === 'text' && typeof part.text === 'string')
            .map((part) => part.text as string)
            .join('');
          return;
        }
        if (event.type === 'result') {
          const subtype = typeof event.subtype === 'string' ? event.subtype : '';
          if (event.is_error === true || subtype.startsWith('error')) {
            throw classifyResultError(subtype, String(event.result || event.error || ''), input.policy, input.session.action);
          }
          if (typeof event.result === 'string') finalText = event.result;
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
          if (outputBytes > this.options.maxOutputBytes * 4) {
            terminate('cancelled');
            throw new AgentRunError('oversized-output', 'Claude response exceeded the configured output limit.');
          }
          stdoutBuffer += chunk.toString('utf8');
          let newline = stdoutBuffer.indexOf('\n');
          while (newline >= 0) {
            processLine(stdoutBuffer.slice(0, newline));
            stdoutBuffer = stdoutBuffer.slice(newline + 1);
            newline = stdoutBuffer.indexOf('\n');
          }
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
        finalText ||= assistantFallback;
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
          session_id: input.session.id,
        })}\n`);
      } else {
        child.stdin.end(input.prompt, 'utf8');
      }
      if (input.signal.aborted) abort();
    });
  }
}
