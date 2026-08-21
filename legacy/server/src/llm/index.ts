/**
 * `getLlmClient()` — the public entry point of the provider-agnostic LLM client
 * (STORY-20260604). Env-driven and fail-safe: returns a configured `LlmClient`
 * or `null` (feature unconfigured → every consumer no-ops cleanly).
 *
 * Selection by `CODEAI_LLM_PROVIDER` (optional; inferred when unset):
 *   unset + BASE_URL + MODEL set → openaiCompatible (the common case)
 *   'openai-compatible'          → openaiCompatible (explicit)
 *   'claude-code' / 'codex'      → cliAgent (Stage 2 — subscription via the CLI)
 *   unset and nothing configured → null
 *
 * Env surface (all optional; absence = feature off):
 *   CODEAI_LLM_PROVIDER  CODEAI_LLM_BASE_URL  CODEAI_LLM_MODEL (Stage 1)
 *   CODEAI_LLM_API_KEY   CODEAI_LLM_JSON_MODE  CODEAI_LLM_TIMEOUT_MS
 *   CODEAI_LLM_CLI_BIN    (Stage 2: override the claude|codex binary path)
 *   CODEAI_LLM_CLI_MODEL  (Stage 2: model passed to the CLI; the Stage-1
 *                          CODEAI_LLM_MODEL is intentionally NOT forwarded, so
 *                          a leftover local/openai model id can't reach — and
 *                          be rejected by — claude|codex. Unset → CLI default.)
 */
import { LlmClient } from './types';
import { createOpenAiCompatibleClient } from './openaiCompatible';
import { createCliAgentClient } from './cliAgent';

export { LlmClient } from './types';

/** Parse an `on|off` flag; everything but an explicit off-ish value is on. */
function readBoolEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return !/^(off|false|0|no)$/i.test(value.trim());
}

/** Parse a positive integer ms value; ignore blank/invalid (adapter default). */
function readTimeoutEnv(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function getLlmClient(): LlmClient | null {
  const env = process.env;
  const provider = env.CODEAI_LLM_PROVIDER?.trim() || undefined;

  // Stage 2: subscription via the official CLI (auth is the CLI's concern;
  // no tokens are stored or extracted here). Missing/logged-out CLI surfaces
  // as a thrown error from complete(), which consumers catch and fall back on.
  if (provider === 'claude-code' || provider === 'codex') {
    return createCliAgentClient({
      provider,
      bin: env.CODEAI_LLM_CLI_BIN?.trim() || undefined,
      // NB: read CODEAI_LLM_CLI_MODEL, not the Stage-1 CODEAI_LLM_MODEL — a
      // leftover local/openai model id (e.g. `gpt-oss:20b`) forwarded as the
      // CLI's `--model` makes claude|codex exit 1 at startup. Unset → CLI's own
      // configured default.
      model: env.CODEAI_LLM_CLI_MODEL?.trim() || undefined,
      timeoutMs: readTimeoutEnv(env.CODEAI_LLM_TIMEOUT_MS),
    });
  }

  const baseUrl = env.CODEAI_LLM_BASE_URL?.trim() || undefined;
  const model = env.CODEAI_LLM_MODEL?.trim() || undefined;

  const wantsOpenAiCompatible =
    provider === 'openai-compatible' || (!provider && !!baseUrl && !!model);
  if (!wantsOpenAiCompatible) return null;

  // Misconfigured (explicit provider but missing base/model) → fail-safe null.
  if (!baseUrl || !model) return null;

  return createOpenAiCompatibleClient({
    baseUrl,
    model,
    apiKey: env.CODEAI_LLM_API_KEY?.trim() || undefined,
    jsonMode: readBoolEnv(env.CODEAI_LLM_JSON_MODE, true),
    timeoutMs: readTimeoutEnv(env.CODEAI_LLM_TIMEOUT_MS),
  });
}
