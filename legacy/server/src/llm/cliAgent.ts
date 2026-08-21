/**
 * Stage 2 adapter (STORY-20260604): ride a Claude Pro/Max or ChatGPT Plus/Pro
 * subscription by spawning the official, already-authenticated CLI in headless,
 * tools-disabled mode and reading its machine-readable stdout. Same `LlmClient`
 * contract as Stage 1; auth is entirely the CLI's concern (the user has already
 * run `claude` / `claude setup-token` or `codex login`).
 *
 * This stores and reverse-engineers NO tokens — it runs the real official
 * client, which keeps its auth, tool support, and the provider ToS intact. The
 * HTTP-400-on-`tools` subscription limit documented in docs/research/ does not
 * apply: we ask only for a plain completion via the sanctioned client.
 *
 * Verified against the locally installed CLIs (2026-06-05):
 *   claude  -p --output-format json --append-system-prompt <s> --allowedTools ""
 *           → JSON envelope; assistant text is the `result` field.
 *   codex   exec --json --skip-git-repo-check --sandbox read-only
 *           → JSONL event stream; assistant text is the last `item.completed`
 *             event whose `item.type === 'agent_message'`.
 * Both read the prompt from stdin (avoids arg-length / shell-escaping issues).
 *
 * NB: `claude --bare` is deliberately NOT used — its OAuth/keychain auth is
 * disabled in bare mode, which would defeat the whole subscription purpose.
 */
import { spawn } from 'child_process';
import { LlmClient } from './types';

export type CliProvider = 'claude-code' | 'codex';

export interface CliAgentConfig {
  /** Which official CLI to drive. */
  provider: CliProvider;
  /** Override the binary path (default: `claude` | `codex` per provider). */
  bin?: string;
  /** Model id passed through to the CLI; omitted → the CLI's own default. */
  model?: string;
  /** Default per-call timeout; overridable per `complete()` call. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 20000;

/** The short CLI name used for the binary default and the client `id`. */
function cliName(provider: CliProvider): string {
  return provider === 'codex' ? 'codex' : 'claude';
}

/** Build the spawn args + the prompt to feed on stdin for a given provider. */
function buildInvocation(
  provider: CliProvider,
  model: string | undefined,
  system: string,
  user: string
): { args: string[]; stdin: string } {
  if (provider === 'codex') {
    // Codex has no separate system-prompt flag — prepend it to the prompt.
    const args = [
      'exec',
      '--json',
      '--skip-git-repo-check',
      '--sandbox',
      'read-only',
    ];
    if (model) args.push('--model', model);
    return { args, stdin: `${system}\n\n${user}` };
  }
  // claude-code: print mode, JSON envelope, tools disabled (empty allowlist).
  const args = [
    '-p',
    '--output-format',
    'json',
    '--append-system-prompt',
    system,
    '--allowedTools',
    '',
  ];
  if (model) args.push('--model', model);
  return { args, stdin: user };
}

/** Spawn the CLI, feed the prompt on stdin, enforce the timeout by killing the
 *  child, and resolve with its stdout. Rejects on spawn error / non-zero exit /
 *  timeout — exactly the fail-safe surface a consumer's try/catch expects. */
function runChild(
  command: string,
  args: string[],
  stdin: string,
  timeoutMs: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (cb: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cb();
    };

    const child = spawn(command, args);
    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(() =>
        reject(new Error(`cli(${command}) timed out after ${timeoutMs}ms`))
      );
    }, timeoutMs);

    // ENOENT when the binary is absent — fail fast with a clear message.
    child.on('error', (err) =>
      finish(() =>
        reject(new Error(`cli(${command}) failed to start: ${err.message}`))
      )
    );
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (code) =>
      finish(() => {
        if (code !== 0) {
          // Surface stderr when present; otherwise fall back to stdout — some
          // CLIs (codex) report the failure in their stdout event stream.
          const detail = (stderr.trim() || stdout.trim()).slice(0, 800);
          reject(
            new Error(
              `cli(${command}) exited with code ${code}` +
                (detail ? ` — ${detail}` : '')
            )
          );
          return;
        }
        resolve(stdout);
      })
    );

    // Feed the prompt and close stdin so the CLI stops waiting for input.
    child.stdin.end(stdin);
  });
}

/** Parse the `claude --output-format json` envelope → assistant text. */
function parseClaude(stdout: string): string {
  let envelope: { is_error?: boolean; result?: unknown; subtype?: string };
  try {
    envelope = JSON.parse(stdout.trim());
  } catch {
    throw new Error('cli(claude) produced unparseable JSON output');
  }
  if (envelope.is_error) {
    const detail =
      typeof envelope.result === 'string'
        ? envelope.result
        : (envelope.subtype ?? 'unknown');
    throw new Error(`cli(claude) reported an error: ${detail}`);
  }
  const result = envelope.result;
  if (typeof result !== 'string' || result.length === 0) {
    throw new Error('cli(claude) output missing "result" text');
  }
  return result;
}

/** Parse the `codex exec --json` JSONL stream → the final assistant message. */
function parseCodex(stdout: string): string {
  let text: string | undefined;
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let evt: { type?: string; item?: { type?: string; text?: unknown } };
    try {
      evt = JSON.parse(trimmed);
    } catch {
      continue; // ignore any non-JSON preamble (e.g. "Reading prompt…")
    }
    if (
      evt.type === 'item.completed' &&
      evt.item?.type === 'agent_message' &&
      typeof evt.item.text === 'string'
    ) {
      text = evt.item.text; // keep the last one — that's the final answer
    }
  }
  if (typeof text !== 'string' || text.length === 0) {
    throw new Error('cli(codex) output had no agent_message event');
  }
  return text;
}

export function createCliAgentClient(config: CliAgentConfig): LlmClient {
  const { provider, model } = config;
  const name = cliName(provider);
  const bin = config.bin || name;
  const defaultTimeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    id: `cli(${name})`,
    async complete({ system, user, timeoutMs }) {
      const effectiveTimeout = timeoutMs ?? defaultTimeoutMs;
      const { args, stdin } = buildInvocation(provider, model, system, user);
      console.log(
        `invoking cli(${bin}) with args ${args.join(' ')} (timeout ${effectiveTimeout}ms)`
      );
      console.debug('cli stdin', stdin);
      const stdout = await runChild(bin, args, stdin, effectiveTimeout);
      console.debug('cli stdout', stdout);
      return provider === 'codex' ? parseCodex(stdout) : parseClaude(stdout);
    },
  };
}
