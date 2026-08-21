import { spawn } from 'node:child_process';
import path from 'node:path';
import type { ProviderHealth } from '@/shared/types';
import {
  buildCodexAppServerArgs, codexIsolationIssue, codexMcpServerNames, codexSupportedModes,
  codexThreadConfig, codexThreadPolicyIssue,
} from './codexInvocation';

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | undefined {
  return value && typeof value === 'object' ? value as JsonRecord : undefined;
}

/** A bounded, model-free App Server handshake that verifies login and capability isolation. */
export async function checkCodex(
  binary: string,
  cwd: string,
  agentEnabled: boolean,
): Promise<ProviderHealth> {
  return new Promise((resolve) => {
    const child = spawn(binary, buildCodexAppServerArgs(), {
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

    const finish = (health: ProviderHealth) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdin.end();
      child.kill('SIGTERM');
      resolve(health);
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
    }), 5_000);

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
        const [accountValue, mcp, hooks, skills] = await Promise.all([
          request('account/read', { refreshToken: false }),
          request('mcpServerStatus/list', { cursor: null, limit: 100, detail: 'toolsAndAuthOnly' }),
          request('hooks/list', { cwds: [cwd] }),
          request('skills/list', { cwds: [cwd], forceReload: true }),
        ]);
        const account = record(accountValue);
        const authenticated = Boolean(account?.account) || account?.requiresOpenaiAuth === false;
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
            issue = 'Codex App Server could not create an isolated readiness thread.';
          } else {
            issue = codexThreadPolicyIssue(threadResult, cwd, security.approvalPolicy);
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
        finish({
          available: true,
          authenticated: true,
          supportedModes,
          message: agentEnabled
            ? undefined
            : 'Codex Ask and Plan are ready. Agent remains disabled until its real approval-parity smoke passes.',
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
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
