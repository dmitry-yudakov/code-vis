/**
 * Stage 1 adapter (STORY-20260604): one `fetch` → every local + cloud
 * API-key provider that speaks the OpenAI Chat Completions wire shape
 * (Ollama, vLLM, llama.cpp, LM Studio, OpenAI, Gemini-compat, Anthropic-compat,
 * OpenRouter, …). The wire shape is the de-facto lingua franca, so this single
 * code path covers them all — the provider is chosen by config, never by code.
 *
 * Uses the Node 22 global `fetch` / `AbortController` (no runtime dependency).
 */
import { LlmClient } from './types';

export interface OpenAiCompatibleConfig {
  /** Provider `/v1` base, e.g. `http://localhost:11434/v1`. */
  baseUrl: string;
  /** Model id, e.g. `gpt-4o-mini` or `qwen2.5-coder`. */
  model: string;
  /** Omitted for local providers (Ollama/llama.cpp need no key). */
  apiKey?: string;
  /** Send `response_format: { type: 'json_object' }`. Default true; some local
   *  models 400 on it, so callers can turn it off. */
  jsonMode?: boolean;
  /** Default per-call timeout; overridable per `complete()` call. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 20000;

export function createOpenAiCompatibleClient(
  config: OpenAiCompatibleConfig
): LlmClient {
  const { baseUrl, model, apiKey, jsonMode = true } = config;
  const defaultTimeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;

  return {
    id: `openai-compatible(${model})`,
    async complete({ system, user, timeoutMs }) {
      const effectiveTimeout = timeoutMs ?? defaultTimeoutMs;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), effectiveTimeout);

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      // Authorization only when a key is present — local providers need none.
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

      const body: Record<string, unknown> = {
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0,
      };
      if (jsonMode) body.response_format = { type: 'json_object' };

      try {
        console.log(
          `openai-compatible request to ${url} with model ${model} (timeout ${effectiveTimeout}ms)`
        );
        console.debug('request body', body);
        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        // Throw on non-2xx so the consumer's try/catch can fall back.
        if (!response.ok) {
          console.error(
            `openai-compatible request to ${url} failed: ${response.status} ${response.statusText}`
          );
          const detail = await response.text().catch(() => '');
          throw new Error(
            `openai-compatible request to ${url} failed: ${response.status} ${response.statusText}` +
              (detail ? ` — ${detail.slice(0, 500)}` : '')
          );
        }

        const payload = (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const content = payload.choices?.[0]?.message?.content;
        if (typeof content !== 'string' || content.length === 0) {
          throw new Error(
            'openai-compatible response missing choices[0].message.content'
          );
        }
        console.debug('response payload', payload);
        return content;
      } catch (err) {
        // Surface a timeout as a clear message rather than a bare AbortError.
        if (controller.signal.aborted) {
          throw new Error(
            `openai-compatible request to ${url} timed out after ${effectiveTimeout}ms`
          );
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
