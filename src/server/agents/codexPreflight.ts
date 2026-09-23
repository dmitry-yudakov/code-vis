import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import type { ModelChoices, ProviderHealth } from '@/shared/types';
import {
  buildCodexAppServerArgs, codexAmbientInstructionNote, codexIsolationIssue, codexMcpServerNames,
  codexModelChoices, codexSupportedModes, codexThreadConfig, codexThreadPolicyIssue,
} from './codexInvocation';

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | undefined {
  return value && typeof value === 'object' ? value as JsonRecord : undefined;
}

interface HandshakeOptions {
  /** Starts App Server elsewhere, such as in a candidate Docker worker; the host binary otherwise. */
  spawn?: (binary: string, args: string[]) => ChildProcessWithoutNullStreams;
  timeoutMs?: number;
  /**
   * A home nobody signed in to: stop after the capability inventories, before any provider
   * session, and wait for `model/list` as long as the check allows.
   */
  signedOut?: boolean;
}

/** `choices` is present only when a signed-out handshake passed. */
type Handshake = { health: ProviderHealth; choices?: ModelChoices };

/** A bounded, model-free App Server handshake that verifies login and capability isolation. */
export async function checkCodex(
  binary: string,
  cwd: string,
  agentEnabled: boolean,
): Promise<ProviderHealth> {
  return (await codexHandshake(binary, cwd, agentEnabled, {})).health;
}

export type CodexWorkerCheck =
  | { passed: true; choices: ModelChoices }
  | { passed: false; check: 'codex-handshake' | 'codex-models'; message: string };

/**
 * A candidate worker's check: CodeAI's handshake in a throwaway home completes, reports that nobody
 * is signed in, and answers `model/list`. Nothing signs in and no provider session starts.
 */
export async function checkCodexWorker(
  binary: string,
  cwd: string,
  options: Pick<HandshakeOptions, 'spawn' | 'timeoutMs'>,
): Promise<CodexWorkerCheck> {
  const { health, choices } = await codexHandshake(binary, cwd, false, { ...options, signedOut: true });
  if (!choices) {
    return { passed: false, check: 'codex-handshake', message: health.message || 'Codex App Server did not complete CodeAI’s handshake.' };
  }
  if (!choices.models?.length) return { passed: false, check: 'codex-models', message: 'Codex App Server did not answer model/list with any model.' };
  return { passed: true, choices };
}

function codexHandshake(
  binary: string,
  cwd: string,
  agentEnabled: boolean,
  options: HandshakeOptions,
): Promise<Handshake> {
  return new Promise((resolve) => {
    const child = options.spawn
      ? options.spawn(binary, buildCodexAppServerArgs())
      : spawn(binary, buildCodexAppServerArgs(), {
        cwd,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    const supportedModes = [...codexSupportedModes(agentEnabled)];
    const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
    let nextId = 1;
    let buffer = '';
    let settled = false;
    let stderr = '';

    const finish = (health: ProviderHealth, choices?: ModelChoices) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdin.end();
      child.kill('SIGTERM');
      resolve({ health, ...(choices ? { choices } : {}) });
    };
    const request = (method: string, params: JsonRecord = {}) => {
      const id = nextId++;
      return new Promise<unknown>((requestResolve, requestReject) => {
        pending.set(String(id), { resolve: requestResolve, reject: requestReject });
        child.stdin.write(`${JSON.stringify({ method, id, params })}\n`);
      });
    };
    const processLine = (line: string) => {
      if (Buffer.byteLength(line) > 1_048_576) throw new Error('oversized protocol event');
      const message = JSON.parse(line) as JsonRecord;
      if (message.id === undefined) return;
      const waiter = pending.get(String(message.id));
      if (!waiter) return;
      pending.delete(String(message.id));
      const error = record(message.error);
      if (error) waiter.reject(new Error(typeof error.message === 'string' ? error.message : 'App Server request failed'));
      else waiter.resolve(message.result);
    };
    const timer = setTimeout(() => finish({
      available: false,
      authenticated: 'unknown',
      supportedModes: [],
      message: 'Codex App Server readiness check timed out.',
    }), options.timeoutMs ?? 5_000);

    child.once('error', (error) => finish({
      available: false,
      authenticated: 'unknown',
      supportedModes: [],
      message: (error as NodeJS.ErrnoException).code === 'ENOENT'
        ? `Codex executable was not found: ${path.basename(binary)}`
        : 'Codex App Server could not be started.',
    }));
    child.stdout.on('data', (chunk: Buffer) => {
      if (settled) return;
      try {
        buffer += chunk.toString('utf8');
        let newline = buffer.indexOf('\n');
        while (newline >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (line) processLine(line);
          newline = buffer.indexOf('\n');
        }
      } catch {
        finish({
          available: false,
          authenticated: 'unknown',
          supportedModes: [],
          message: 'The installed Codex emitted an incompatible App Server protocol.',
        });
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (Buffer.byteLength(stderr) < 16_384) stderr += chunk.toString('utf8').slice(0, 16_384);
    });
    child.once('close', () => {
      if (!settled) finish({
        available: false,
        authenticated: 'unknown',
        supportedModes: [],
        message: /unknown|unrecognized|invalid/i.test(stderr)
          ? 'The installed Codex does not support the required App Server configuration.'
          : 'Codex App Server readiness check exited early.',
      });
    });
    child.stdin.once('error', () => undefined);

    void (async () => {
      try {
        await request('initialize', {
          // `title` is display metadata; `name`/`serviceName` are the provider-side identifiers
          // Codex already knows this app by, so they keep their historical spelling.
          clientInfo: { name: 'cartograph_web2', title: 'CodeAI', version: '0.1.0' },
          capabilities: null,
        });
        child.stdin.write(`${JSON.stringify({ method: 'initialized', params: {} })}\n`);
        // Choices are optional and never awaited with the handshake: a Codex without this method, or
        // one slow to answer it, still runs every turn on Default.
        const modelList = request('model/list', { includeHidden: false, limit: 50 }).catch(() => undefined);
        const [accountValue, mcp, hooks, skills] = await Promise.all([
          request('account/read', { refreshToken: false }),
          request('mcpServerStatus/list', { cursor: null, limit: 100, detail: 'toolsAndAuthOnly' }),
          request('hooks/list', { cwds: [cwd] }),
          request('skills/list', { cwds: [cwd], forceReload: true }),
        ]);
        const account = record(accountValue);
        const authenticated = Boolean(account?.account) || account?.requiresOpenaiAuth === false;
        if (options.signedOut) {
          const issue = authenticated
            ? 'Codex App Server reports an account although nobody signed in to its new home.'
            : !codexMcpServerNames(mcp)
              ? 'Codex did not return a complete MCP capability inventory.'
              : codexIsolationIssue({ mcp, hooks, skills });
          if (issue) {
            finish({ available: false, authenticated, supportedModes: [], message: issue });
            return;
          }
          finish({ available: false, authenticated: false, supportedModes: [] }, codexModelChoices(await modelList));
          return;
        }
        if (!authenticated) {
          finish({
            available: false,
            authenticated: false,
            supportedModes: [],
            message: 'Codex is not authenticated. Run `codex login` locally and sign in.',
          });
          return;
        }
        const mcpServerNames = codexMcpServerNames(mcp);
        let note: string | undefined;
        let issue = mcpServerNames
          ? codexIsolationIssue({ mcp: { data: [] }, hooks, skills })
          : 'Codex did not return a complete MCP capability inventory.';
        if (!issue && mcpServerNames) {
          const security = { approvalPolicy: 'never' as const, sandbox: 'read-only' as const };
          const threadResult = record(await request('thread/start', {
            cwd,
            approvalPolicy: security.approvalPolicy,
            sandbox: security.sandbox,
            config: codexThreadConfig(mcpServerNames),
            developerInstructions: 'CodeAI readiness probe. Do not use tools or external integrations.',
            ephemeral: true,
            serviceName: 'cartograph_web2_preflight',
          }));
          const thread = record(threadResult?.thread);
          if (typeof thread?.id !== 'string') {
            issue = 'Codex App Server could not create an isolated readiness provider session.';
          } else {
            issue = codexThreadPolicyIssue(threadResult, cwd, security.approvalPolicy);
            note = codexAmbientInstructionNote(threadResult, cwd);
            if (!issue) {
              const scopedMcp = await request('mcpServerStatus/list', {
                cursor: null, limit: 100, detail: 'toolsAndAuthOnly', threadId: thread.id,
              });
              issue = codexIsolationIssue({ mcp: scopedMcp, hooks, skills });
            }
          }
        }
        if (issue) {
          finish({
            available: false,
            authenticated: true,
            supportedModes: [],
            message: `${issue} Disable it in Codex before using this provider in CodeAI.`,
          });
          return;
        }
        const notes = [
          note,
          agentEnabled ? undefined : 'Codex Ask and Plan are ready. Agent remains disabled until its real approval-parity smoke passes.',
        ].filter(Boolean);
        const models = await Promise.race([modelList, new Promise((resolve) => setTimeout(resolve, 300))]);
        finish({
          available: true, authenticated: true, supportedModes, message: notes.length ? notes.join(' ') : undefined,
          ...codexModelChoices(models),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        // Without a login to blame, any refused request is a protocol failure.
        if (options.signedOut) {
          finish({ available: false, authenticated: 'unknown', supportedModes: [], message: 'Codex App Server refused a request of CodeAI’s handshake.' });
          return;
        }
        finish({
          available: false,
          authenticated: /unauthori[sz]ed|auth|login/i.test(message) ? false : 'unknown',
          supportedModes: [],
          message: /unauthori[sz]ed|auth|login/i.test(message)
            ? 'Codex is not authenticated. Run `codex login` locally and sign in.'
            : 'The installed Codex does not support CodeAI\'s required App Server protocol.',
        });
      }
    })();
  });
}
