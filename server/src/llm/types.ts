/**
 * The entire public contract of the provider-agnostic LLM client
 * (STORY-20260604-provider-agnostic-llm-client).
 *
 * Deliberately narrow and provenance-agnostic: `complete()` returns the *raw*
 * assistant message text. The caller parses JSON and assigns provenance
 * (`origin: 'llm'`) — this layer is pure transport. Resist adding streaming,
 * tool-use, or multi-turn here until a consumer actually needs them; the M2
 * annotation + arrangement passes are single-shot JSON completions.
 */
export interface LlmClient {
  /** Stable id for logs, e.g. "openai-compatible(gpt-4o-mini)" or "cli(claude)". */
  readonly id: string;
  /** Returns the raw assistant message text. The caller parses JSON and assigns provenance. */
  complete(input: {
    system: string;
    user: string;
    timeoutMs?: number;
  }): Promise<string>;
}
