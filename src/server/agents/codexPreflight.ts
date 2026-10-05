import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import type { AgentMode, ModelChoices, ProviderHealth, SecurityLevel } from '@/shared/types';
import { changesCheckout } from '@/shared/agentModes';
import {
  buildCodexAppServerArgs, buildCodexSandboxCheckArgs, codexAmbientInstructionNote, codexAmbientSkillNote, codexIsolationIssue,
  codexMcpServerNames, codexModelChoices, codexSupportedModes, codexThreadConfig, codexThreadPolicyIssue,
  codexTurnSecurity,
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
  /** Combined Native readiness omits expected instruction/skill notices; checks still run. */
  suppressAmbientNotes?: boolean;
  level?: SecurityLevel;
}

/** `choices` is present only when a signed-out handshake passed. */
type Handshake = { health: ProviderHealth; choices?: ModelChoices };

// A turn still checks its policy afresh. Only verified model choices survive a transient missing
// response, for the same 10 s as Local provider health; no browser choice enters this cache.
let nativeChoices: { key: string; checkedAt: number; choices: ModelChoices } | undefined;

/**
 * A bounded, model-free App Server handshake that verifies login and capability isolation. Auto is
 * also withheld unless the workspace sandbox starts, so a turn whose sandbox cannot start is
 * refused with that reason instead of turning every command into an approval request.
 */
export async function checkCodex(
  binary: string,
  cwd: string,
  agentEnabled: boolean,
  level: SecurityLevel = 'guarded',
  mode?: AgentMode,
): Promise<ProviderHealth> {
  // The picker needs both policies; a selected turn needs only the one it will execute.
  const nativeWriting = level === 'native' && mode !== undefined && changesCheckout(mode);
  const [guarded, native, sandboxStarts] = await Promise.all([
    nativeWriting ? undefined : codexHandshake(binary, cwd, agentEnabled, {
      suppressAmbientNotes: level === 'native' && mode === undefined,
    }),
    level === 'native' && (mode === undefined || nativeWriting) ? codexHandshake(binary, cwd, agentEnabled, { level }) : undefined,
    agentEnabled && (mode === undefined || mode === 'auto') ? codexSandboxStarts(binary, cwd) : false,
  ]);
  const guardedHealth = guarded?.health;
  const guardedNote = !native?.health.available || !guardedHealth ? undefined
    : guardedHealth.available ? guardedHealth.message && `Ask and Plan: ${guardedHealth.message}`
      : `Ask and Plan unavailable: ${guardedHealth.message || 'Guarded isolation failed.'}`;
  let health: ProviderHealth = native
    ? { ...native.health,
      supportedModes: native.health.available
        ? codexSupportedModes(agentEnabled, level).filter((mode) => changesCheckout(mode) || guardedHealth?.supportedModes.includes(mode)) : [],
      message: [native.health.message, guardedNote].filter(Boolean).join(' ') || undefined,
      // Both handshakes use the same provider account. Keep its verified choices when the shorter
      // Native handshake cannot list them, rather than dropping the Guarded result.
      ...(!native.health.models?.length && guardedHealth?.models?.length
        ? { models: guardedHealth.models, efforts: guardedHealth.efforts } : {}),
    } : guarded!.health;
  if (level === 'native') {
    const key = `${binary}\0${cwd}\0${process.env.CODEX_HOME || ''}`;
    if (health.available && health.models?.length) {
      nativeChoices = { key, checkedAt: Date.now(), choices: structuredClone({ models: health.models, efforts: health.efforts }) };
    } else if (health.available && nativeChoices?.key === key && Date.now() - nativeChoices.checkedAt < 10_000) {
      health = { ...health, ...structuredClone(nativeChoices.choices) };
    } else if (health.authenticated === false) nativeChoices = undefined;
  }
  if (mode !== undefined) health = { ...health, supportedModes: health.supportedModes.filter((ready) => ready === mode) };
  if (sandboxStarts || !health.supportedModes.includes('auto')) return health;
  return {
    ...health,
    supportedModes: health.supportedModes.filter((mode) => mode !== 'auto'),
    message: [health.message, 'Codex\'s sandbox cannot start on this machine, so Auto is withheld.'].filter(Boolean).join(' '),
  };
}

/** Whether `codex sandbox` can run a command here. It spawns no App Server and no model turn. */
function codexSandboxStarts(binary: string, cwd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(binary, buildCodexSandboxCheckArgs(), { cwd, shell: false, stdio: 'ignore' });
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(false); }, 3_000);
    child.once('error', () => { clearTimeout(timer); resolve(false); });
    child.once('close', (code) => { clearTimeout(timer); resolve(code === 0); });
  });
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
      ? options.spawn(binary, buildCodexAppServerArgs(options.level))
      : spawn(binary, buildCodexAppServerArgs(options.level), {
        cwd,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    const supportedModes = [...codexSupportedModes(agentEnabled, options.level)];
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
        // Choices are optional and bounded. Start the request early so inventory checks give it
        // time to finish. Native has no inventories, so it gives the list its own bounded wait.
        const modelList = request('model/list', { includeHidden: false, limit: 50 }).catch(() => undefined);
        if (options.level === 'native') {
          const account = record(await request('account/read', { refreshToken: false }));
          const authenticated = Boolean(account?.account) || account?.requiresOpenaiAuth === false;
          const models = authenticated
            ? await Promise.race([modelList, new Promise((resolve) => setTimeout(resolve, 1_500))]) : undefined;
          finish({ available: authenticated, authenticated, supportedModes: authenticated ? supportedModes : [],
            message: authenticated ? undefined : 'Codex is not authenticated. Run `codex login` locally and sign in.',
            ...codexModelChoices(models),
          });
          return;
        }
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
          const security = codexTurnSecurity('ask');
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
            issue = codexThreadPolicyIssue(threadResult, cwd, security);
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
          options.suppressAmbientNotes ? undefined : note,
          options.suppressAmbientNotes ? undefined : codexAmbientSkillNote(skills),
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
