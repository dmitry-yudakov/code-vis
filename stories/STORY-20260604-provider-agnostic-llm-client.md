# Story 4 — Provider-agnostic LLM client (`server/src/llm/`): OpenAI-compatible transport, optional subscription subprocess

**Status:** Stage 1 & Stage 2 complete & verified (2026-06-05) · **Type:** Server-only · **Depends on:** nothing to build (foundation). Unblocks
the M2 annotation + arrangement passes. **Supersedes** [Story 2](STORY-20260602-llm-review-annotation.md)
§1 ("Provider-agnostic LLM client") — the client is carved out of Story 2 into this dedicated story;
Story 2's annotation pass and `narrativeRank` are unaffected by this split (see
[vision.md MVP](../docs/vision.md#L438)).

> This is **MVP Milestone 2's first build step** ([vision.md:460](../docs/vision.md#L460)): "standing
> up `server/src/llm/` … is M2's first build step — Story 2's client is not optional background, it is
> a dependency." It ships the LLM **transport layer only** — the `LlmClient` interface plus its
> adapters — decoupled from any *use* of it. The annotation pass (M2 cards, step 6) and the
> arrangement pass (step 5) are separate downstream stories that consume `getLlmClient()`; neither is
> in scope here.

---

## Progress

**Stage 1 — DONE & verified (2026-06-05).** The OpenAI-compatible HTTP client ships and is
provider-agnostic by env alone. Files in [`server/src/llm/`](../server/src/llm/): `types.ts` (contract),
`openaiCompatible.ts` (the single `fetch` adapter), `index.ts` (`getLlmClient()` factory + env
selection), `ping.ts` (`yarn llm:ping` smoke check), `llm.test.ts` (11 unit tests).

- **Verified live:** `yarn llm:ping` round-trips against **Ollama (local)** and **OpenAI (cloud)** with
  *no code change* — provider switched by `CODEAI_LLM_*` env only (the core provider-agnostic claim).
- **Fail-safe paths confirmed:** no env → `getLlmClient()` is `null`, ping prints "no client
  configured"; dead port → ping reports the thrown error cleanly (the path consumers catch).
- **Toolchain bumps (done):** `@types/node` `^14.14.10` → `^22.5.5` and `typescript` → `^5.6.3` in
  [server/package.json](../server/package.json); **no runtime dep added** (global `fetch` /
  `AbortController`). `tsc --noEmit` clean in **server** and **web**; `yarn test` green
  (**77/77**, incl. the 11 new LLM tests).
- **Test-env shim (new, outside `src/llm/`):** jest 26's sandboxed `node` VM omits Node 18+ globals
  (`fetch`, `AbortController`). Added [server/jest.env.js](../server/jest.env.js) — a custom environment
  copying them from the host realm — wired via [server/jest.config.js](../server/jest.config.js). Zero
  new deps. (ts-jest 26 warns the resolved TS 5.9.x is newer than it tests against; non-fatal. A
  jest + ts-jest upgrade would retire both the shim and the warning — deferred, out of scope.)
- **Secrets:** `.env` / `.env.*` added to [.gitignore](../.gitignore) so a local `CODEAI_LLM_API_KEY`
  is never committed; env is sourced into the shell (no `dotenv` dep, as designed).

**Stage 2 — DONE & verified (2026-06-05).** [`cliAgent.ts`](../server/src/llm/cliAgent.ts) drives the
official, already-authenticated CLI as a subprocess to ride a Claude Pro/Max or ChatGPT Plus/Pro
subscription — same `LlmClient` contract, **no tokens stored or extracted** (the non-goal is honored).

- **Flags verified against the installed CLIs** (`claude` 2.1.153, `codex-cli` 0.137.0), per the
  implementer note:
  - **claude** (`CODEAI_LLM_PROVIDER=claude-code`): `claude -p --output-format json
    --append-system-prompt <system> --allowedTools ""` (+ `--model` when set); the **user prompt is
    fed on stdin** (avoids arg-length/escaping); the assistant text is the `result` field of the JSON
    envelope (`is_error` surfaces errors). **`--bare` is deliberately avoided** — in bare mode the CLI
    reads neither OAuth nor keychain, which would defeat the whole subscription purpose.
  - **codex** (`CODEAI_LLM_PROVIDER=codex`): `codex exec --json --skip-git-repo-check --sandbox
    read-only` (+ `--model`); codex has no system-prompt flag, so `system` is prepended to the prompt
    on stdin; the answer is the last `item.completed` event whose `item.type === 'agent_message'` in
    the JSONL stream.
- **Timeout** enforced by `SIGKILL`-ing the child; **throws** on spawn error (ENOENT → "failed to
  start"), non-zero exit (with stderr detail), or unparseable output — the same fail-safe surface
  consumers already catch from Stage 1.
- **Wired into [`index.ts`](../server/src/llm/index.ts):** `claude-code`/`codex` now return a
  `cliAgent` client (previously no-op `null`); added the `CODEAI_LLM_CLI_BIN` binary override and a
  **Stage-2-only `CODEAI_LLM_CLI_MODEL`**. The Stage-1 `CODEAI_LLM_MODEL` is **deliberately not
  forwarded** to the CLI: a leftover local/openai id (e.g. `gpt-oss:20b`) passed as the CLI's
  `--model` makes `claude`/`codex` exit 1 at startup with no output — a cross-stage footgun hit during
  live testing. Unset `CODEAI_LLM_CLI_MODEL` → the CLI uses its own configured model. The non-zero-exit
  error now also surfaces stdout (codex reports failures there), so such cases are no longer silent.
- **Verified live (subscription, no code change):** `CODEAI_LLM_PROVIDER=claude-code yarn llm:ping` and
  `CODEAI_LLM_PROVIDER=codex yarn llm:ping` both return `{"ok":true}`; a bogus `CODEAI_LLM_CLI_BIN`
  fails fast with a clear ENOENT message (never hangs, never leaks a credential).
- **Tests:** 10 new `cliAgent` unit tests (spawn spied via `jest.spyOn` on the real `require()`'d
  module — `jest.mock()` can't be used because its ts-jest 26 hoist transformer calls the
  TS-5-removed `ts.getMutableClone`, the documented toolchain mismatch). `yarn test` green
  (**87/87**); `tsc --noEmit` clean in **server** and **web**.

---

## Motivation

The product wants LLM enrichment (descriptions, the arrangement director, later semantic extraction),
and the user's two requirements are explicit:

1. **Provider-agnostic** — point the same code at a **local** model (Ollama, vLLM, llama.cpp /
   `llama-server`, LM Studio) or an **external** one (OpenAI, Gemini, Anthropic, OpenRouter, …) by
   configuration alone, no code change to switch.
2. **Subscription-capable** — optionally ride an existing **Claude Pro/Max** or **ChatGPT Plus/Pro**
   subscription instead of a pay-per-token platform key.

These are two *different* transport mechanisms, and conflating them is what makes the feature feel
"too complex." The insight that collapses the complexity: **one narrow `LlmClient` interface, with
pluggable adapters.** Requirement (1) is a single OpenAI-compatible HTTP adapter — the
Chat Completions wire shape is the de-facto lingua franca, so local *and* cloud API-key providers are
one code path. Requirement (2) cannot be served by an API key (a subscription exposes no
chat-completions URL); the only durable, sanctioned route is to **shell out to the already-installed,
already-authenticated official CLI** (`claude -p`, `codex exec`) — a second adapter behind the same
interface. The messiness is quarantined to that one optional adapter; the core stays trivial.

This is why the story is **two stages**:

- **Stage 1 (mandatory):** the OpenAI-compatible HTTP client. Covers every local + cloud API-key
  target. This alone is a complete, shippable LLM client.
- **Stage 2 (optional):** the `cliAgent` subprocess adapter for subscriptions. Strictly additive;
  Stage 1 ships and is useful without it.

**Why subprocess, not a "3rd-party token" (the rejected path).** We researched how tools like
`openclaw` and `NousResearch/hermes-agent` ride subscriptions — see
[docs/research/](../docs/research/) (`openclaw.md`, `hermes-agent.md`,
`claude-subscription-tokens.md`, `codex-subscription-tokens.md`). They reuse the official CLI's OAuth
client ID and **impersonate the harness** (spoofed `user-agent`, `anthropic-beta` flags, a forced
`"You are Claude Code…"` system block). That path is (a) against provider Terms, (b) actively
enforced — Anthropic's April 4 2026 block named OpenClaw explicitly — and (c) breaking precisely where
we need it: subscription-OAuth requests carrying `tools` now return **HTTP 400** from a server-side
classifier. So token extraction is an explicit **non-goal** (see [Out of scope](#out-of-scope)); the
subprocess adapter gets the same subscription benefit by running the *real* official client, which
keeps its auth, its tool support, and the ToS intact.

---

## Current behavior (where the code is)

- **No LLM integration exists.** No `server/src/llm/` directory; `grep` for `CODEAI_LLM` /
  `getLlmClient` returns nothing. [server/package.json](../server/package.json) has **no AI/SDK
  dependency**.
- **Runtime is Node v22**, so the global `fetch`, `AbortController`, and `AbortSignal` are available
  natively — **no runtime dependency is needed**. The only gap is *types*: `@types/node` is pinned
  `^14.14.10` ([server/package.json](../server/package.json)), which predates global `fetch` typings,
  so TS will not know about `fetch`. The fix is a `@types/node` bump (no `undici` shim required, unlike
  the cautious default Story 2 wrote before the runtime was confirmed to be Node 22).
- **tsconfig:** `target: es5`, `lib: ["es2019"]`, `module: commonjs`, `strict: true`
  ([server/tsconfig.json](../server/tsconfig.json)). `fetch` / `AbortController` types come from
  `@types/node`, not from `lib`, so the bump covers them; no `lib` change needed.
- **`server/src/model/`** already exists from M1 (`entityId.ts`, `reviewModel.ts`) — the new
  `server/src/llm/` sits beside it as a peer concern.
- **Env handling:** the server reads no runtime env today (only `js.test.ts` reads `DEBUG`). Env vars
  are passed inline to `ts-node-dev` (`CODEAI_LLM_… yarn start path/to/project`); **no `dotenv`
  dependency is added** (kept out of scope — easy to add later if desired).
- **Story 2 wrote the Stage-1 design first** (the provider table, the `LlmClient` shape, the
  global-`fetch` decision). This story adopts that design verbatim for Stage 1, adds the adapter
  registry + Stage 2, and is the thing the annotation/arrangement stories now depend on.

---

## Desired behavior

A small `server/src/llm/` module exposes **`getLlmClient(): LlmClient | null`**. Consumers call it,
get either a client or `null` (feature unconfigured → no-op), and call `complete(...)`. The interface
is deliberately narrow and provenance-agnostic: it returns raw assistant text; the *caller* parses
JSON and tags results `origin: 'llm'`.

### File layout

```
server/src/llm/
  types.ts             # LlmClient interface (the linchpin — keep narrow)
  openaiCompatible.ts  # Stage 1: one fetch → all local + cloud API-key providers
  cliAgent.ts          # Stage 2: spawn `claude -p` / `codex exec` for subscriptions (optional)
  index.ts             # getLlmClient() factory/registry + env selection
  llm.test.ts          # adapter unit tests (mocked fetch / mocked spawn)
```

### Stage 1 — OpenAI-compatible HTTP client (mandatory)

**`types.ts`** — the contract both stages implement and both consumers depend on. Keep it the exact
shape Story 2 specified so nothing downstream churns; **resist** adding streaming, tool-use, or
multi-turn until a consumer needs them (the M2 annotation + arrangement passes are single-shot JSON
completions — `complete()` is right-sized):

```ts
export interface LlmClient {
  /** Stable id for logs, e.g. "openai-compatible(gpt-4o-mini)" or "cli(claude)". */
  readonly id: string;
  /** Returns the raw assistant message text. The caller parses JSON and assigns provenance. */
  complete(input: { system: string; user: string; timeoutMs?: number }): Promise<string>;
}
```

**`openaiCompatible.ts`** — `POST {baseUrl}/chat/completions` via the global `fetch`:

- Body: `{ model, messages: [{role:'system',content:system},{role:'user',content:user}],
  temperature: 0, response_format: { type: 'json_object' } }`.
- Header `Authorization: Bearer ${apiKey}` **only when a key is present** (local Ollama/llama.cpp need
  none).
- `AbortController` for `timeoutMs` (default ~20s). **Throw on non-2xx** and on a missing
  `choices[0].message.content`, so the consumer's try/catch can fall back.
- **`response_format` is opt-out** via `CODEAI_LLM_JSON_MODE=off` — some local models 400 on it; off
  means rely on the prompt + the consumer's lenient parse. Default on.

One adapter, switched by env, covers all named targets (the Story 2 table, extended):

| Provider | `CODEAI_LLM_BASE_URL` | `CODEAI_LLM_MODEL` example | Key |
|---|---|---|---|
| Ollama (local) | `http://localhost:11434/v1` | `qwen2.5-coder`, `llama3.1` | none |
| vLLM / llama.cpp / LM Studio (local) | `http://localhost:<port>/v1` | served model id | none |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` | yes |
| Gemini (OpenAI-compat) | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.0-flash` | yes |
| Anthropic (OpenAI-compat shim) | `https://api.anthropic.com/v1` | `claude-3-5-haiku-latest` | yes |
| OpenRouter / Together / Groq | provider base URL | provider model id | yes |

### Stage 2 — `cliAgent` subprocess for subscriptions (optional, additive)

**`cliAgent.ts`** — implements the same `LlmClient` by spawning the official, already-authenticated
CLI in **headless, tools-disabled** mode and reading its stdout. One adapter, parameterized by which
CLI (`claude` | `codex`); auth is entirely the CLI's concern (the user has already run `claude` login
/ `claude setup-token`, or `codex login`) — **this story stores and reverse-engineers no tokens.**

- **Claude** (`CODEAI_LLM_PROVIDER=claude-code`): spawn
  `claude -p <user> --output-format json --append-system-prompt <system>` with tools disabled, parse
  the `result` field from the JSON envelope.
- **Codex** (`CODEAI_LLM_PROVIDER=codex`): spawn `codex exec --json <prompt>`, parse the final
  assistant message from the JSONL event stream.
- Enforce `timeoutMs` by killing the child; throw on non-zero exit or unparseable stdout (consumer
  falls back, exactly like Stage 1).

> **Implementer note — verify flags against the installed CLI.** CLI flag names churn between
> versions (the research reports document how brittle harness-coupling is). Treat the commands above
> as the intent — *headless print mode, tools off, machine-readable output* — and confirm the exact
> flags (`--output-format`, the tool-disable flag, system-prompt flag) against the locally installed
> `claude` / `codex --help` before committing. Prefer stdin piping for the prompt if arg length is a
> concern.

**Honest constraints (documented, not hidden):** these are coding *agents*, not raw completion
endpoints — they carry large system prompts, spawn a process per call, and adhere to JSON more loosely
than `response_format`. That is acceptable because (a) the consumer's fail-safe absorbs weak JSON, and
(b) this is **low-volume, opt-in** enrichment. The HTTP-400-on-`tools` subscription limit from the
research **does not apply**: we ask only for a plain completion and run the official client, which is
the sanctioned path.

### `index.ts` — selection (env-driven, fail-safe)

`getLlmClient(): LlmClient | null`, choosing by `CODEAI_LLM_PROVIDER` (optional; inferred when unset):

| `CODEAI_LLM_PROVIDER` | Result |
|---|---|
| unset, but `CODEAI_LLM_BASE_URL` + `CODEAI_LLM_MODEL` set | `openaiCompatible` (the common case) |
| `openai-compatible` | `openaiCompatible` (explicit) |
| `claude-code` / `codex` | `cliAgent` (Stage 2) |
| unset and nothing configured | **`null`** → whole feature no-ops cleanly |

Env surface (all optional; absence = feature off):

```
CODEAI_LLM_PROVIDER     # openai-compatible (default) | claude-code | codex
CODEAI_LLM_BASE_URL     # Stage 1: provider /v1 base
CODEAI_LLM_MODEL        # Stage 1 only: openai-compatible model id (NOT forwarded to the CLI)
CODEAI_LLM_API_KEY      # Stage 1: omitted for local providers
CODEAI_LLM_JSON_MODE    # Stage 1: on (default) | off  — send response_format or not
CODEAI_LLM_TIMEOUT_MS   # both: default ~20000
CODEAI_LLM_CLI_BIN      # Stage 2: override binary path (default: claude | codex per provider)
CODEAI_LLM_CLI_MODEL    # Stage 2: model passed to the CLI (default: the CLI's own configured model)
```

### Verification surface (so the foundation is shippable on its own)

The client is not user-visible, so add a thin **dev smoke check** decoupled from annotation: a
standalone script `server/src/llm/ping.ts` runnable as `yarn llm:ping` (a `package.json` script) that
calls `getLlmClient()?.complete({ system: 'Reply with JSON {"ok":true}.', user: 'ping' })` and prints
the result or the fail-safe path. This proves end-to-end connectivity to a configured provider
(real Ollama / OpenAI / `claude` CLI) without building any consumer feature.

### Type contract

New types live only in `server/src/llm/` (server-only; **no `web` type change** — the client is
server-internal). The shared `Entity`/`Relation` contract is untouched by this story; provenance
(`origin: 'llm'`) is set by the *consumer* stories when they attach `description`/arrangement, not
here.

```ts
// server/src/llm/types.ts — the entire public contract of this story
export interface LlmClient {
  readonly id: string;
  complete(input: { system: string; user: string; timeoutMs?: number }): Promise<string>;
}
export function getLlmClient(): LlmClient | null; // server/src/llm/index.ts
```

---

## Acceptance criteria

**Stage 1 (mandatory):**

- [x] `server/src/llm/types.ts` defines `LlmClient` with exactly `complete({system,user,timeoutMs})`
      + `id`; no streaming/tool/multi-turn surface added.
- [x] `openaiCompatible.ts` issues one `chat/completions` POST via global `fetch`, `temperature:0`,
      optional `response_format`, `Authorization` header only when a key is set, `AbortController`
      timeout, **throws on non-2xx and on missing content**.
- [x] `@types/node` bumped (≥ `^20`, matching the Node 22 runtime) so global `fetch` /
      `AbortController` typecheck; **no runtime dep added** (no `undici`, no SDK). `server` typechecks
      (`tsc --noEmit`). _(bumped to `^22.5.5`; `typescript` → `^5.6.3`.)_
- [x] `getLlmClient()` returns an `openaiCompatible` client when `CODEAI_LLM_BASE_URL` +
      `CODEAI_LLM_MODEL` are set, and **`null`** when nothing is configured.
- [x] Unit tests (mocked `fetch`): success returns assistant text; non-2xx throws; abort/timeout
      throws; missing content throws.
- [x] `yarn llm:ping` round-trips against a real local provider (Ollama) and a cloud provider by env
      alone — **no code change to switch** (the core provider-agnostic claim). _(verified live:
      Ollama + OpenAI.)_

**Stage 2 (optional, additive):**

- [x] `cliAgent.ts` implements `LlmClient` by spawning `claude -p` (and `codex exec`) in headless,
      tools-disabled mode, parsing the machine-readable output; enforces timeout by killing the child;
      throws on non-zero exit / unparseable output.
- [x] `CODEAI_LLM_PROVIDER=claude-code` (with the `claude` CLI installed + logged in) makes
      `yarn llm:ping` return text **using the subscription**, storing/extracting no tokens. _(verified
      live: claude + codex both return `{"ok":true}`.)_
- [x] With the selected CLI absent or not logged in, `getLlmClient()` either returns `null` or the
      client fails fast with a clear error — never a hang, never a leaked credential. _(bogus
      `CODEAI_LLM_CLI_BIN` → clean ENOENT "failed to start", exit 1.)_
- [x] Unit test with a mocked child process: stdout JSON → parsed text; non-zero exit → throws.
      _(10 tests covering both CLIs, timeout-kill, spawn error, unparseable/`is_error` output.)_

**Cross-cutting:**

- [x] With **no `CODEAI_LLM_*` env**, `getLlmClient()` is `null` and nothing LLM-related runs
      (the global fail-safe every consumer relies on).
- [x] No `web` change; `web` still typechecks unchanged.
- [x] No token extraction / OAuth-harness-spoofing code exists anywhere (the non-goal is honored).

## Out of scope

- **Any *consumer* of the client.** The annotation pass (`summary`/`causalReason`, M2 cards) and the
  LLM **arrangement** pass (the `Arrangement` spec) are separate M2 stories that wire
  `getLlmClient()` into the review path ([vision.md step 5/6](../docs/vision.md#L424)). This story
  ships only the client + the `ping` smoke check.
- **3rd-party / subscription token extraction or OAuth-harness impersonation** — the `openclaw` /
  `hermes-agent` approach. **Explicit non-goal**, on three grounds documented in
  [docs/research/](../docs/research/): against provider ToS, actively enforced (Anthropic's
  2026-04-04 block), and broken for tool use (HTTP 400). Subscriptions are served **only** by the
  Stage 2 subprocess adapter running the official CLI.
- **Streaming, tool/function calling, multi-turn** in the interface — added only when a consumer
  needs them (likely the step-7 change loop, far off).
- **Caching / batching / retry** of completions — a consumer concern; the client is a thin transport.
- **`dotenv`**, a settings UI, or per-project LLM config — env-only for now.
- **A native Anthropic-SDK adapter** — unnecessary; the OpenAI-compat shim (Stage 1) and the `claude`
  CLI (Stage 2) both reach Anthropic.

## How to verify

1. **Stage 1, local:** start Ollama (`ollama serve`, pull `qwen2.5-coder`); run
   `CODEAI_LLM_BASE_URL=http://localhost:11434/v1 CODEAI_LLM_MODEL=qwen2.5-coder yarn llm:ping` in
   `server/` → prints a model reply.
2. **Stage 1, cloud:** swap to `CODEAI_LLM_BASE_URL=https://api.openai.com/v1
   CODEAI_LLM_MODEL=gpt-4o-mini CODEAI_LLM_API_KEY=sk-…` — same command, no code change → reply.
3. **Stage 1, fail-safe:** point `CODEAI_LLM_BASE_URL` at a dead port → `yarn llm:ping` reports the
   thrown error cleanly (proves consumers can catch + fall back); unset all env → `getLlmClient()` is
   `null`, ping prints "no client configured".
4. **Stage 2 (if built):** with `claude` installed + logged in, run
   `CODEAI_LLM_PROVIDER=claude-code yarn llm:ping` → reply via the subscription, no token handling.
5. `yarn test` (server) green; `tsc --noEmit` clean in both `server` and `web`.
