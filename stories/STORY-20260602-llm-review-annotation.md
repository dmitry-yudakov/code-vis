# Story 2 — Provider-agnostic LLM annotation for the Review-changes graph

**Type:** Server + a focused frontend layout change · **Depends on:** shares a type contract
with [Story 1](STORY-20260602-review-card-declutter.md) but can be built in parallel.

---

## Motivation

The Review-changes graph is built by **structural** analysis: dagre/elk lay nodes out by
call-graph topology (callers left, callees right, minimize edge crossings), and the node
cards describe graph relationships. That answers *"how is this code wired?"* but the
reviewer is asking a **semantic** question: *"what did this change do, and why does each of
these nodes matter to it?"*

elk/dagre aren't too weak — they're solving the wrong problem. They optimize for edge
crossings; we need to optimize for *comprehension of intent*. The fix is to add a thin
semantic layer: one LLM pass that looks at the actual changed source and emits, per
declaration:

- `summary` — what changed and why it matters (kills the useless "modified").
- `causalReason` — the node's role in the change story.
- `narrativeRank` — 0 = root cause, 1 = direct effect, 2 = downstream… This is a *narrative*
  ordering that frequently differs from topological call order, and we use it to reorder the
  graph's horizontal spine so the layout tells the story left-to-right.

Must be **provider-agnostic**: the user wants to point this at local Ollama, OpenAI, or
Gemini interchangeably. And it must be **opt-in and fail-safe**: reviews must stay fast and
must never break when the LLM is unconfigured, slow, or returns garbage.

---

## Current state (relevant code)

- The server has **no LLM integration at all** (no SDK, no API key wiring) — this story
  stands it up from scratch. `server/package.json` has no AI deps.
- Graph is built in `buildFocusedDeclarationGraph(...)` in
  [server/src/project.ts](../server/src/project.ts#L942) (~line 942). It already loads
  each visible file into a `mappings: Map<filename, { content, mapping }>` and builds
  `focusedDeclarations: Map<id, FocusedDeclarationInfo>` with `pos`/`end` offsets, so the
  **declaration source text is recoverable** via `content.slice(decl.pos, decl.end)`. It
  returns `{ declarations, declarationCalls }` near [line 1200](../server/src/project.ts#L1200).
- Entry point: `handleCommandFocusedReview(source, options)` at
  [project.ts:1218](../server/src/project.ts#L1218); `options` is `FocusedReviewOptions`
  (currently just `{ includeTests?: boolean }`) in
  [server/src/types.d.ts](../server/src/types.d.ts#L84) (~line 84).
- The raw git diff is parsed to line *ranges* only and discarded (`parseUnifiedDiffLineRanges`
  ~line 213 in project.ts). So feed the LLM the **declaration source slices**, not a patch.
- Declaration type `FocusedDeclarationInfo`:
  [server/src/types.d.ts:107](../server/src/types.d.ts#L107) — mirror in
  [web/src/types.d.ts:107](../web/src/types.d.ts#L107).
- Layout consumes nodes in the web `graphLayout/` module. The declaration spine ordering is
  computed by `computeDeclarationCallRanks(...)` in
  [web/src/graphLayout/declarationLayout.ts](../web/src/graphLayout/declarationLayout.ts#L13)
  (~line 13) and used by the review-declarations strategy in
  [web/src/graphLayout/reviewLayout.ts](../web/src/graphLayout/reviewLayout.ts#L697)
  (`computeDeclarationCallRanks` / `layoutReviewDeclarations`). The web layout node type
  `CodeLayoutNode` is in
  [web/src/graphLayout/types.ts](../web/src/graphLayout/types.ts#L37) (~line 37).

---

## Design

### 1. Provider-agnostic LLM client  (new `server/src/llm/`)

Rationale: OpenAI's Chat Completions shape is the de-facto lingua franca. **One**
`fetch`-based client covers all three named targets by changing base URL + model:

| Provider | `CODEAI_LLM_BASE_URL` | `CODEAI_LLM_MODEL` example |
|----------|----------------------|----------------------------|
| Ollama (local) | `http://localhost:11434/v1` | `llama3.1`, `qwen2.5-coder` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| Gemini (OpenAI-compat endpoint) | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.0-flash` |

Files:

- `server/src/llm/types.ts`
  ```ts
  export interface LlmClient {
    // Returns the raw assistant message text. Caller parses JSON.
    complete(input: {
      system: string;
      user: string;
      timeoutMs?: number;
    }): Promise<string>;
  }
  ```
- `server/src/llm/openaiCompatible.ts` — implements `LlmClient` via
  `POST {baseUrl}/chat/completions` with body
  `{ model, messages:[{role:'system',...},{role:'user',...}], temperature:0, response_format:{ type:'json_object' } }`
  and `Authorization: Bearer ${apiKey}` when a key is present (Ollama needs none). Use an
  `AbortController` for `timeoutMs`. Throw on non-2xx so the caller's try/catch can fall back.
- `server/src/llm/index.ts` — `getLlmClient(): LlmClient | null`. Reads
  `CODEAI_LLM_BASE_URL`, `CODEAI_LLM_MODEL`, `CODEAI_LLM_API_KEY`. **Returns `null` if base
  URL or model is unset** → the whole feature no-ops cleanly. Leave a comment noting that an
  `anthropicAdapter.ts` (or any OpenAI-compatible proxy) can satisfy `LlmClient` later for
  native Anthropic.

**HTTP detail (decision needed, defaulting):** use the built-in global `fetch` and bump
`@types/node` to `^18` (and document Node 18+ as the runtime requirement). The server's
`@types/node` is currently `^14`. If the deployment must stay on Node <18, add `undici`
instead and import `fetch` from it — isolate that choice inside `openaiCompatible.ts` so
nothing else cares. **Default chosen: global fetch + bump types.**

### 2. Annotation module  (new `server/src/reviewAnnotate.ts`)

`annotateChangedDeclarations(declarations, mappings, client, opts): Promise<void>` (mutates
declarations in place, or returns a new array — implementer's choice, keep it pure if easy):

- Select the changed declarations (`isChanged`), cap at **~25** (log if truncated — never
  silently drop coverage).
- For each, slice source from `mappings.get(filename)?.content.slice(pos, end)`, truncate to
  ~2000 chars. Include signature (`name(args)`) and `file:startLine-endLine`.
- Also pass the **call edges among the selected nodes** (`from`/`to` ids) so the model can
  reason about ordering for `narrativeRank`.
- **One** request. System prompt = stable instructions (kept constant so OpenAI/most gateways
  apply automatic prefix caching). User message = the JSON change payload.
- Ask for strict JSON:
  ```json
  { "annotations": [
    { "id": "<decl id>",
      "summary": "what changed & why it matters, <=120 chars",
      "causalReason": "this node's role, <=80 chars",
      "narrativeRank": 0 }
  ] }
  ```
- Parse, map by `id`, assign `summary` / `causalReason` / `narrativeRank` onto the matching
  declarations. Ignore unknown ids; leave unmatched declarations untouched.
- **Fail-safe:** wrap the whole thing in try/catch with a timeout (~20s). On any error,
  timeout, or unparseable output, log a warning and leave declarations unchanged. A review
  must always succeed.

### 3. Wiring + opt-in flag

- Extend `FocusedReviewOptions` (server types.d.ts ~line 84) with `annotate?: boolean`.
- In `buildFocusedDeclarationGraph`, after `focusedDeclarations` is populated and before the
  final sort/return ([~line 1200](../server/src/project.ts#L1200)): if
  `options?.annotate` **and** `getLlmClient()` returns a client, run the annotation pass
  (await, inside try/catch). Otherwise skip entirely.
  - Note: `buildFocusedDeclarationGraph`'s current signature is
    `(changeSet, visibleFiles)`. Thread `options` (or just the `annotate` boolean + client)
    down from `buildFocusedReviewMap` / `handleCommandFocusedReview`.
- Frontend: add a UI toggle that sets `annotate: true` on the focused-review request.
  Reuse the existing **+ Context / Related tests** control cluster styling in the Review
  controls panel. Default **off** so reviews stay fast until the user asks for the richer view.

### 4. Type changes (both sides — shared contract with Story 1)

Add to `FocusedDeclarationInfo` in **both** `server/src/types.d.ts` and `web/src/types.d.ts`:
```ts
  summary?: string;
  causalReason?: string;
  narrativeRank?: number;
```

### 5. Narrative layout rerank  (frontend layout — the "details + layout rerank" scope)

Make the graph spine follow the *story*, not raw call topology:

- When building `CodeLayoutNode`s for the review-declarations strategy in
  [IncludesHierarchy.tsx](../web/src/components/IncludesHierarchy.tsx#L742) (~line 742),
  carry `narrativeRank` onto the layout node (extend `CodeLayoutNode` in
  [graphLayout/types.ts](../web/src/graphLayout/types.ts#L37) with optional
  `narrativeRank?: number`).
- In `computeDeclarationCallRanks` /
  [reviewLayout.ts](../web/src/graphLayout/reviewLayout.ts#L697): **when a node has a
  defined `narrativeRank`, use it as the rank (horizontal lane) instead of the
  topological call-rank.** Fall back to the existing topological computation for nodes
  without a rank (i.e. when annotation is off or the model omitted one). This keeps the
  layout fully functional with the LLM disabled.
- Result: root-cause declarations sit at the left of the spine, their effects to the right,
  regardless of which direction the call arrows happen to point.

---

## Acceptance criteria

- [ ] With no `CODEAI_LLM_*` env set, behavior is byte-for-byte unchanged (feature off).
- [ ] With env set + `annotate` flag off, behavior is unchanged (no LLM call made).
- [ ] With env set + flag on, changed-declaration cards receive `summary` / `causalReason`
      and the spine reorders by `narrativeRank`.
- [ ] Points at local Ollama, OpenAI, and Gemini by env alone — no code change to switch.
- [ ] LLM timeout / 5xx / malformed JSON → review still returns, declarations unannotated,
      one warning logged. Verified by pointing base URL at a dead port.
- [ ] Declaration cap is enforced and logged when exceeded.
- [ ] `server` and `web` both typecheck.

## Out of scope

- The card visual declutter / badge / detail rendering — that's [Story 1](STORY-20260602-review-card-declutter.md).
- Native Anthropic adapter (interface should allow it; not required now).
- Annotating *file-level* review or the overview lens — declarations only for v1.
- Caching annotations across requests (fine to recompute per review for v1).

## Risks / notes

- Latency & cost: bounded by the declaration cap, single request, temperature 0, and the
  opt-in flag. Local Ollama makes iteration free.
- Prompt-injection from repo source is low-risk here (output is short structured strings
  rendered as text, never executed), but keep the system prompt firm about output shape.
- `narrativeRank` quality varies by model; the topological fallback guarantees a sane layout
  even when the model is weak or omits ranks.
