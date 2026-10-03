# Story 6 — Capture agent-emitted software-model suggestions

**Status:** Shipped · **Type:** Server-only · **Depends on:** [Story 18](STORY-20260805-web2-agent-mermaid-canvas.md)

## Motivation

Q4 in the [development queue](../docs/development-queue.md#q4-first-software-model-producer)
starts Phase A of the [software-model epic](EPIC-20260705-north-star-roadmap.md#phase-a--re-found-the-model-on-the-running-product-now).
Agent turns already inspect repositories and author Mermaid. Capture their structured discoveries
without introducing another model client, and measure whether identities can support Story 7.

## Current behavior (where the code is)

- [prompt.ts:46](../src/server/conversation/prompt.ts#L46) — frames normal Markdown and optional Mermaid.
- [responseParser.ts:46](../src/server/conversation/responseParser.ts#L46) — splits prose, code and Mermaid.
- [conversationService.ts:22](../src/server/conversation/conversationService.ts#L22) — saves an answer before publishing completion.
- [types.ts:20](../src/shared/types.ts#L20) — server-owned checkout identity and resolved path.
- The reference identity builder is [legacy/server/src/model/entityId.ts:52](../legacy/server/src/model/entityId.ts#L52);
  the current application neither builds nor imports it.

## Desired behavior

Opt in for a turn by putting `/model` on the first line of the request, followed by a scope or
question. The normal answer and optional Mermaid still work. Only these turns receive the model
output contract; unsolicited output never updates the model. No automatic extraction or new UI
control is needed for this producer slice.

The agent may include one `codeai-model` fenced JSON object with `schema: 'codeai.software-model.v1'`,
`entities` and `relations`. Entities have an emission-local `key`, a supported `kind`, exact source
`name`, optional owning `container`, source `location` (repository-relative `filename`, one-based
`startLine`, optional `endLine`), required finite `confidence` in [0,1], and optional `description`.
Relations have `kind`, `source` and `target` referring to keys in that same emission, required
confidence and optional description. Both endpoints must be included. This is a partial repository
discovery, not a replacement snapshot or deletion command.

The shared contract starts with Story 3's six structural kinds and four relations, plus
`db-table`, `external-service`, `api-endpoint`, `api-call`, `exposes`, `consumes`, `queries`,
`depends-on` and `bridge` for agent-discovered connections. Structural entities require locations;
methods also require their container. Resource/interface entities may be location-less, with exact
canonical names. Traits, code content and change overlays wait for concrete consumers.

The server assigns every accepted fact `origin: 'llm'`. Description has that same suggested
provenance. The agent cannot supply ids or claim static/user verification. Server-generated located
ids follow `kind:file#container.name$ordinal`; line numbers are refreshed facts, never identity.
Source-order ordinals distinguish same-name siblings. Location-less ids use `kind:canonical-name`.
Reserved separators are escaped so names cannot collide with containers or ordinal suffixes.
Rename/move means a new id; absence never deletes an older suggestion. No rename matching.

Validate the entire bounded emission before merging. Reject invalid JSON, unknown fields/kinds,
unsafe/noncanonical source paths, ambiguous sibling locations, duplicate keys/facts, dangling
relations, multiple or unclosed emissions and exceeded bounds without changing any model facts.
Keep rejected JSON copyable with an explanation; normal prose/Mermaid and turn delivery still succeed.
Validation diagnostics are bounded independently of the JSON so an oversized unknown field name
cannot make the ordinary answer exceed the durable code-block warning limit.

Successful durable assistant completion then merges into a bounded, machine-process-local model
keyed by the resolved checkout path, shared across sessions. Repeated ids refresh the whole suggested
fact (including confidence/description/location); omitted facts remain. Failed answer persistence or
provider execution never updates the model. Restart or least-recently-updated repository eviction
clears this disposable accumulation. Story 7 owns durable records, caching and invalidation; Story 9
owns querying the model into Mermaid lenses. The answer labels accepted records as suggestions and
explains that the accumulation is temporary.

An existing same-name sibling group's cardinality must match a later emission. Growth or shrinkage
rejects the entire merge, because emission-local ordinals otherwise overwrite different siblings
and redirect existing relations. Missing a whole group leaves it untouched. The first discovery
and equal-size subsets still rely on the agent's completeness; the producer does not verify source
declarations. Sibling reconciliation needs a future invalidation/extraction contract. Merge refusal
(capacity or changed sibling coverage) is explained through the existing turn activity after the
ordinary answer is saved; parser rejection is labeled in the copyable code block itself.

## Acceptance criteria

- [x] Shared, side-effect-free types and server-generated collision-safe ids preserve the reference
      scheme for ordinary names, container distinctions and source-order siblings.
- [x] `/model` opts into the contract; ordinary output and missing model output work unchanged.
- [x] A complete emission validates atomically and merges across turns/sessions for one checkout;
      independent checkouts stay isolated and storage is bounded.
- [x] Malformed, duplicate, oversized, dangling, multiple and unclosed output never partially merges;
      rejected output remains copyable and the ordinary answer completes.
- [x] All suggestions and descriptions retain LLM provenance/confidence; successful answer storage
      precedes merge, and provider/storage failures leave the model unchanged.
- [x] Repeated independent real-agent passes over the same scoped repository are measured for
      identity overlap; record evidence and whether Story 7 should proceed or Story 8 move forward.
- [x] Focused tests, TypeScript, production build and an end-of-work review pass.

## Out of scope

- Durable model storage, cache invalidation or replay on restart (Story 7).
- Static extraction or verified facts (Story 8), lenses/arrangement/UI (Story 9), MCP (Story 11).
- Whole-repository coverage, automatic extraction, deletion, semantic rename/move matching,
  change status, traits and language-specific parsers.

## How to verify

1. Run the focused software-model, response-parser and conversation tests; verify failure tests
   fail before implementation. Run `npm run lint` and `npm run build`.
2. In Ask, send `/model` followed by a narrow scope. Confirm normal prose, copyable suggested JSON
   and optional Mermaid. Repeat the scoped request in an independent provider session: compare
   generated ids, refresh location/description/confidence, and check model counts do not double.
3. Run ordinary and malformed-output fake-provider turns through `runConversation`; confirm
   completed durable answers and whole-or-nothing accumulation. Force answer storage failure.
4. Record at least three independent real-agent passes, common entity/relation ids and known
   source identities. Record limitations; do not present fixture-only determinism as empirical
   agent stability. Run a review subagent and resolve material findings.

## Implementation (where the code is)

- [softwareModel.ts:1](../src/shared/softwareModel.ts#L1) — shared kinds, fact types and bounded
  emission constants; [line 62](../src/shared/softwareModel.ts#L62) builds escaped stable ids.
- [prompt.ts:11](../src/server/conversation/prompt.ts#L11) — the opt-in output contract.
- [responseParser.ts:36](../src/server/conversation/responseParser.ts#L36) — preserves an unclosed
  model block for explicit rejection, rather than accepting an earlier block alone.
- [agentEmission.ts:39](../src/server/model/agentEmission.ts#L39) — atomic strict validation,
  source-order sibling assignment and endpoint resolution; [line 91](../src/server/model/agentEmission.ts#L91)
  labels suggestions or rejected copyable output.
- [repositoryModelStore.ts:12](../src/server/model/repositoryModelStore.ts#L12) — process-local
  checkout accumulation, whole-fact refresh and whole-merge bounds (16 repositories; 2,000 entities,
  4,000 relations and 2 MiB each), with oldest-update eviction.
- [conversationService.ts:174](../src/server/conversation/conversationService.ts#L174) — reads the
  model output; [line 199](../src/server/conversation/conversationService.ts#L199) merges only after
  durable assistant publication and reports capture/capacity outcome through existing activity.
- [softwareModel.test.ts:1](../test/softwareModel.test.ts#L1),
  [softwareModelConversation.test.ts:1](../test/softwareModelConversation.test.ts#L1), and
  [software-model.spec.ts:1](../e2e/software-model.spec.ts#L1) — contract, actual turn delivery,
  concurrency, recorded real outputs and production-browser behavior.

## Verification evidence — October 3, 2026

The new suite failed before implementation because the model modules were absent. Focused
validation/merge tests then passed; the delivery suite exposed a test spy shared incorrectly
between concurrent turns, corrected before the final checks. The full offline suite passed
(108 files / 1,038 tests after the recorded-output and review regressions). TypeScript and the
production build passed. Two production Chrome journeys, dark and light, sent `/model`, rendered
Mermaid and labeled copyable suggested JSON, completed a rejected emission, and retained both labels
on reload. Existing filesystem-boundary tests required access to `/var/tmp`; the build needed its
existing Google Font download and the browser needed local server/Chrome access.

The end-of-work review found three defects: changes in same-name sibling coverage could redirect
stored facts/edges; an unclosed second model fence without a trailing newline could allow the first
emission through; and a long unknown JSON key could create a rejection warning larger than the
durable message's limit. All were reproduced with failing regression tests before fixes. The
accumulator now refuses changed known sibling cardinality, the scanner recognizes model openers
at EOF, and diagnostic text is bounded to 1,000 characters. The reviewer rechecked the changes and
reported no remaining actionable findings. The full suite, TypeScript and production build were
rerun after the fixes; the production browser journey was also repeated against that build.

### Real-agent identity decision

Claude Code **2.1.288**, through CodeAI's real `ClaudeProcessRunner` and Guarded Ask policy, made
three **independent fresh provider sessions**, with the same prompt and unchanged source. No earlier
output, expected names/ids or accumulated model was passed to any extraction. The scope was:

> Inspect only `src/server/conversation/responseParser.ts` and
> `src/server/model/repositoryModelStore.ts`. Include every named module-level function declaration,
> class, and public nonconstructor class method in those files. Exclude variables, constants,
> types, files, private members, nested functions and other files. Include class → method declares
> relations and direct calls only between included declarations. Read the files first.

Each pass used the production `/model` output contract and requested a brief explanation, Mermaid
and JSON. Raw completed answers are preserved as test data in
[claude-pass-1.txt](../test/fixtures/software-model/claude-pass-1.txt),
[claude-pass-2.txt](../test/fixtures/software-model/claude-pass-2.txt), and
[claude-pass-3.txt](../test/fixtures/software-model/claude-pass-3.txt). They reparse through the running
app's parser/validator in the recorded-output regression.

| Pass | Time | Entity ids | Relation ids | Accumulated entities / relations |
|---|---|---|---|---|
| 1 | 19.540 s | 5 | 3 | 5 / 3 |
| 2 | 20.760 s | Same 5 (100% overlap) | Same 3 (100% overlap) | 5 / 3 |
| 3 | 20.630 s | Same 5 (100% overlap) | Same 3 (100% overlap) | 5 / 3 |

Known declarations were `scanFences`, `parseAssistantResponse`, `RepositoryModelStore`, and its
`get` and `merge` methods. Known edges were `parseAssistantResponse` → `scanFences` (`calls`), and
the two class → method (`declares`) edges. All three passes matched those source identities and
reported LLM confidence/description independently. The sandboxed real probe could not complete;
the three measured passes used approved normal provider network/storage access.

**Decision:** proceed with **Story 7** persistence and then **Story 9**'s first Mermaid lens. There
is no observed reason to move Story 8 ahead for this measured scope. This is a bounded feasibility
result, not a whole-repository, other-provider or cross-language guarantee. Location-less resource
naming, completeness of the first sibling discovery or equal-size sibling subsets, renames/moves
and changes in entity classification
remain limitations. Source locations are suggestions, not independent grammar verification;
Story 8 remains the planned static floor. A changed known sibling-group cardinality refuses the
whole merge; neither this producer nor the probe establishes rename/deletion reconciliation.
The three recorded passes preceded the review fixes; those fixes changed parsing/merge behavior
without changing the five probed declaration identities.
