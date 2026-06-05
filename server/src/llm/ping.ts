/**
 * Dev smoke check for the provider-agnostic LLM client (STORY-20260604).
 *
 *   yarn llm:ping   # from server/, with CODEAI_LLM_* env configured
 *
 * Proves end-to-end connectivity to a configured provider (real Ollama / OpenAI
 * / …) without building any consumer feature. Prints the model reply, the
 * "no client configured" path, or the fail-safe error a consumer would catch.
 */
import { getLlmClient } from './index';

async function main(): Promise<void> {
  const client = getLlmClient();
  if (!client) {
    console.log(
      'no client configured — set CODEAI_LLM_BASE_URL + CODEAI_LLM_MODEL (see the story for the provider table)'
    );
    return;
  }

  console.log(`pinging ${client.id} …`);
  try {
    const text = await client.complete({
      system: 'Reply with JSON {"ok":true}.',
      user: 'ping',
    });
    console.log('reply:', text);
  } catch (err) {
    console.error(
      'complete() threw — this is the fail-safe path consumers catch:',
      err instanceof Error ? err.message : err
    );
    process.exitCode = 1;
  }
}

main();
