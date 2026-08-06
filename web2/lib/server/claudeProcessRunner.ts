import { spawn } from 'node:child_process';
import path from 'node:path';
import type { AgentErrorCode, AgentProcessResult, AgentProcessRun, AgentProcessRunner } from '@/lib/shared/types';
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
}

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

    return new Promise<AgentProcessResult>((resolve, reject) => {
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

      const finish = (operation: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutTimer);
        if (killTimer) clearTimeout(killTimer);
        input.signal.removeEventListener('abort', abort);
        operation();
      };

      const terminate = (reason: 'cancelled' | 'timeout') => {
        if (settled || termination) return;
        termination = reason;
        child.kill('SIGTERM');
        killTimer = setTimeout(() => child.kill('SIGKILL'), this.options.killGraceMs ?? 1_500);
      };

      const abort = () => terminate('cancelled');
      input.signal.addEventListener('abort', abort, { once: true });
      const timeoutTimer = setTimeout(() => terminate('timeout'), input.policy.timeoutMs);

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

        if (event.type === 'system' && event.subtype === 'init' && typeof event.session_id === 'string') {
          sessionId = event.session_id;
          input.emit({ type: 'session-started', sessionId });
          return;
        }
        if (event.type === 'stream_event') {
          const stream = event.event as Record<string, unknown> | undefined;
          const delta = stream?.delta as Record<string, unknown> | undefined;
          if (stream?.type === 'content_block_delta' && delta?.type === 'text_delta' && typeof delta.text === 'string') {
            input.emit({ type: 'text-delta', text: delta.text });
          }
          const block = stream?.content_block as Record<string, unknown> | undefined;
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
            input.emit({ type: 'activity', ...describeToolUse(part.name, toolInput, input.project.realPath, input.attachmentDirectory) });
          }
          assistantFallback = parts
            .filter((part) => part.type === 'text' && typeof part.text === 'string')
            .map((part) => part.text as string)
            .join('');
          return;
        }
        if (event.type === 'result') {
          if (event.is_error === true || event.subtype === 'error') {
            throw classifyFailure(String(event.result || event.error || ''), input.session.action);
          }
          if (typeof event.result === 'string') finalText = event.result;
          if (typeof event.session_id === 'string') sessionId = event.session_id;
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
      child.stdin.end(input.prompt, 'utf8');
      if (input.signal.aborted) abort();
    });
  }
}
