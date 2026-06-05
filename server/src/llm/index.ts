/**
 * `getLlmClient()` — the public entry point of the provider-agnostic LLM client
 * (STORY-20260604). Env-driven and fail-safe: returns a configured `LlmClient`
 * or `null` (feature unconfigured → every consumer no-ops cleanly).
 *
 * Selection by `CODEAI_LLM_PROVIDER` (optional; inferred when unset):
 *   unset + BASE_URL + MODEL set → openaiCompatible (the common case)
 *   'openai-compatible'          → openaiCompatible (explicit)
 *   'claude-code' / 'codex'      → cliAgent (Stage 2 — not built yet)
 *   unset and nothing configured → null
 *
 * Env surface (all optional; absence = feature off):
 *   CODEAI_LLM_PROVIDER  CODEAI_LLM_BASE_URL  CODEAI_LLM_MODEL
 *   CODEAI_LLM_API_KEY   CODEAI_LLM_JSON_MODE  CODEAI_LLM_TIMEOUT_MS
 */
import { LlmClient } from './types';
import { createOpenAiCompatibleClient } from './openaiCompatible';

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

  // Stage 2 (cliAgent) is not built in this stage. Selecting a subscription
  // provider therefore no-ops cleanly (null) until cliAgent lands.
  if (provider === 'claude-code' || provider === 'codex') {
    return null;
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
