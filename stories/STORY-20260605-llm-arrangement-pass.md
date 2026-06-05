# Story 5 — LLM arrangement pass: editorial visibility & emphasis over the Review slice (MVP Milestone 2)

**Status:** In progress — core landed & green (on-demand visibility + emphasis); regions rendering and the empirical side-by-side signal still open. · **Type:** Full-stack · **Depends on:** [Story 4](STORY-20260604-provider-agnostic-llm-client.md) (the LLM client) and [Story 3](STORY-20260603-static-entity-relation-model.md) (the static `Entity`/`Relation` model). Realizes [vision.md](../docs/vision.md) step 5 (Arrangement) / MVP Milestone 2, and is the graduation of Story 2's superseded `narrativeRank` from one ordering axis to a full editorial spec.

---

## Implementation status (2026-06-05)

**Landed & verified** — `server` typechecks + 97 tests (incl. 8 for `arrangeReview`); `web` typechecks + 25 tests.

- **Server pass** — [arrangeReview.ts](../server/src/model/arrangeReview.ts): prompt → tolerant JSON parse → validate against the slice (drop unknown ids, force changed entities `shown`, dedupe/clean regions) → per-(client, slice) in-memory cache. Never throws. Unit-tested with a fake client (no real LLM).
- **On-demand wiring** — `arrangeReview` socket command ([project.ts `handleCommandArrangeReview`](../server/src/project.ts) + [index.ts handler](../server/src/index.ts)) returns `ReviewArrangementResult`; `buildFocusedReviewMap` only sets `llmAvailable` and never blocks on the LLM. Client method [`projectApi.arrangeReview`](../web/src/connection/index.ts) (180s request timeout) + [App.tsx](../web/src/App.tsx) wiring.
- **Web realization** — [IncludesHierarchy.tsx](../web/src/components/IncludesHierarchy.tsx): **✨ Arrange with AI** button (only when `llmAvailable`) with `Arranging…` / inline-error states; arrangement held in local state, reset on a new slice; `hidden` filtered out (both granularities, edges cascade), `emphasis` → amber ring, `collapsed` → recessed; `Arranged`/`elk only` toggle, `Reveal N hidden`, `Re-arrange`. CSS in [IncludesHierarchy.css](../web/src/components/IncludesHierarchy.css).
- **Dev tooling** — `yarn arrange:smoke` ([arrangeReview.smoke.ts](../server/src/model/arrangeReview.smoke.ts)) prints validated JSON on a fixture, no web needed.
- **Timeout fix (post-impl)** — `arrangeReview` no longer forces a 30s timeout; it passes none so the client adapter's configured timeout governs and `CODEAI_LLM_TIMEOUT_MS` is honored (it was previously shadowed). The web request timeout (180s) is kept above the server's LLM timeout so the server's own fail-safe wins.

**Still open**

- Region soft-band rendering (`regions` flows end-to-end but isn't drawn) — and with it, the region-provenance acceptance criterion.
- `order` realization (carried/validated, not yet driving lane/row order).
- The objective side-by-side signal (success criterion #4) — pending a real model run.

---

## Motivation

> "ok, now with llm available - how could we try it for arrangement and perhaps selection of
> visible/hidden elements"

A geometry engine (elk/dagre) answers "given these nodes and edges, minimize crossings." It does
**not** answer the editorial question the user actually has in a review: *out of the 60 shortlisted
elements, which 12 should be visible first, which are noise, and what should I look at to lead?*
That triage — progressive disclosure and emphasis — is where much of "make agent code
comprehensible" lives, and it is exactly what an LLM is good at and a layout engine is not.

This is the real bet of the whole vision (MVP success criterion #4: *the arranged map reads clearer
than elk-only on the same commit*), deliberately isolated by spending the LLM **only on
arrangement, not extraction**. The static model (Story 3) and the LLM client (Story 4) are both in
place, so the prerequisite is met.

---

## Current behavior (where the code is)

- LLM client: [server/src/llm/index.ts](../server/src/llm/index.ts#L40) — `getLlmClient(): LlmClient | null`, env-driven, fail-safe; [complete()](../server/src/llm/types.ts#L15) returns raw text, caller assigns provenance.
- Static review model: [server/src/model/reviewModel.ts](../server/src/model/reviewModel.ts#L51) — `buildReviewEntityModel()` → `{ entities, relations }`, built and shipped from [project.ts](../server/src/project.ts#L948) inside `buildFocusedReviewMap`.
- Payload type: [server/src/types.d.ts `FocusedReviewMap`](../server/src/types.d.ts#L198) (mirrored in [web/src/types.d.ts](../web/src/types.d.ts#L223)).
- Web review render: [web/src/components/IncludesHierarchy.tsx](../web/src/components/IncludesHierarchy.tsx) builds layout nodes/edges for the Review lens; **declaration nodes use `decl.id` (= the entity id), file nodes use `toNodeId(filename)`**. Initial visibility is driven only by the coarse `showFocusedContext` ("Changed only / + Context") toggle.
- Geometry: [web/src/graphLayout/index.ts](../web/src/graphLayout/index.ts#L74) — `layoutCodeGraph` / `layoutCodeGraphAsync` (elk), already drops edges to absent nodes via `filterVisibleEdges`.

There was no notion of an editorial `Arrangement` — the LLM had no say in what is shown vs. hidden,
how things group, or what to lead with.

---

## Desired behavior

The server asks the LLM client for an editorial `Arrangement` over the static review slice and
returns it **on demand** (fail-safe), never on the review payload — so the structural review renders
instantly via elk and the LLM pass is an explicit, awaited user action. The web **realizes** the
arrangement — visibility, collapse, and emphasis — over its existing layout, with the deterministic
engine as the always-available fallback and an explicit on/off toggle. The LLM emits a *spec*, not
coordinates; the geometry engine still places nodes.

### Concrete changes

**Server**

1. New `Arrangement` type (and `Visibility` / `ArrangementRegion`) in both `types.d.ts` files.
2. New `arrangeReview()` pass ([server/src/model/arrangeReview.ts](../server/src/model/arrangeReview.ts)): compact prompt over `{ entities, relations }` → tolerant JSON parse → validate against the slice → in-memory cache. Never throws.
3. **On-demand, not inline.** A separate `arrangeReview` socket command ([project.ts `handleCommandArrangeReview`](../server/src/project.ts), [index.ts handler](../server/src/index.ts)) takes the review slice and returns a `ReviewArrangementResult`. `buildFocusedReviewMap` only sets a `llmAvailable` capability flag — it never computes the arrangement, so the structural review never blocks on the LLM. (No `CODEAI_LLM_ARRANGE` env flag — the user triggers it explicitly.)
4. Dev smoke script `yarn arrange:smoke` to eyeball the model's JSON on a fixture slice.

**Web** ([IncludesHierarchy.tsx](../web/src/components/IncludesHierarchy.tsx), [connection/index.ts](../web/src/connection/index.ts), [App.tsx](../web/src/App.tsx))

5. **"✨ Arrange with AI" button** (shown only when `focusedReview.llmAvailable`): renders the review
   instantly via elk, then on click fetches the arrangement (`requestReviewArrangement`) with an
   `Arranging…` loading state and an inline error on failure — so the user opts in and waits knowingly.
6. The fetched arrangement is held in local state (not the payload), reset when a new review slice
   arrives. `arrangementProjection` translates it (keyed by Entity id) into the web's node-id space via
   `focusedReview.entities` (declaration ids pass through; file ids → `toNodeId(filename)` — no id logic
   duplicated).
7. `hidden` entities are filtered out of `focusedFilesByName` / `focusedDeclarations` (composes with
   `showFocusedContext`; cascades to edges via the existing `activeIncludes` / `focusedDeclarationIds`).
   `collapsed` → recessed node, `emphasis` → amber ring (CSS `arranged-collapsed` / `arranged-emphasis`),
   at both the declaration and file node-class seams.
8. Once fetched: an `Arranged` vs `elk only` toggle (A/B without re-asking), a `Reveal N hidden`
   checkbox (progressive disclosure), and a `Re-arrange` button (cached for an unchanged slice).
   `projectionKey` includes the arrangement state.

### Type contract

```ts
// server/src/types.d.ts and web/src/types.d.ts — kept verbatim in sync (AGENTS.md)
export type Visibility = 'shown' | 'collapsed' | 'hidden';
export interface ArrangementRegion { id: string; label?: string; entityIds: string[]; }
export interface Arrangement {
  origin: 'llm';                                  // widens to 'algorithmic' | 'user' later
  visibility?: Record<string, Visibility>;        // by entity id; absent → 'shown'
  order?: string[];                               // reading order (generalizes narrativeRank)
  emphasis?: string[];                            // lead-with
  regions?: ArrangementRegion[];                  // editorial grouping — soft band, NOT an edge
}
// FocusedReviewMap gains: llmAvailable?: boolean;   (the arrangement is NOT shipped on the payload)
export interface ReviewArrangementResult {         // the arrangeReview command's response
  available: boolean;                              // false → no LLM client configured
  arrangement: Arrangement | null;                 // null → unavailable or model produced nothing
}
```

**Discipline (enforced in code, not just the prompt):** opt-in by explicit user action (the button,
only offered when a client is configured), scoped to the slice, fail-safe (any
error/timeout/unparseable → `null`/`undefined` → elk path untouched), validated (unknown ids dropped,
the LLM can't widen the node set or emit coordinates), guard-railed (every changed entity forced
`shown`), and cached per (client, slice signature). Provenance honesty: arrangement is opt-in and
visibly a *suggestion* (the toggle, the distinct emphasis styling); a region is a grouping, never a
verified relation edge.

---

## Acceptance criteria

- [x] `Arrangement` / `Visibility` / `ArrangementRegion` types + `llmAvailable?` on `FocusedReviewMap` + `ReviewArrangementResult`, in sync across `server` and `web`.
- [x] `arrangeReview()` is fail-safe: null client, throw, timeout, unparseable, or id-less output all return `undefined` (unit-tested with a fake client, no real LLM).
- [x] Validation: unknown ids dropped from visibility/order/emphasis/regions; empty regions dropped; region ids de-duped.
- [x] Guard-rail: a changed entity is never `hidden` (forced `shown`), tested.
- [x] On-demand: a dedicated `arrangeReview` command computes it; `buildFocusedReviewMap` never blocks on the LLM (only sets `llmAvailable`). No env flag.
- [x] Cached per (client, slice signature); the model is asked once per unchanged slice, tested.
- [x] `yarn arrange:smoke` prints a validated `Arrangement` against a fixture (or the "no client" / fallback path).
- [x] Web: an explicit **"Arrange with AI"** button (only when `llmAvailable`) with `Arranging…` / error states; the review renders via elk immediately and never waits on the LLM.
- [x] Web: `hidden` entities removed from the rendered Review graph (both file & declaration granularity), edges cascade.
- [x] Web: `emphasis` → highlight, `collapsed` → recessed; `Arranged`/`elk only` toggle; `Reveal N hidden`; `Re-arrange`.
- [x] With no LLM configured / before clicking / on error, the Review renders via elk **unchanged** (button absent or inert, zero behavior change).
- [x] `server` and `web` typecheck against the new types; existing `server` (97) and `web` (25) test suites pass.
- [ ] **Side-by-side signal** (success criterion #4): on a demo commit, capture at least one objective number — e.g. fewer expand/scroll actions to locate the changed endpoint, or N/M reviewer preference — comparing `Arranged` vs `elk only`. *(Pending a real model run.)*
- [ ] Provenance: regions render as a visibly-editorial soft band distinct from relation edges. *(Deferred with regions — see Out of scope.)*

## Out of scope

- **Region rendering (soft bands).** The `regions` field is parsed, validated, and returned, but the
  web does not yet draw grouped bands/labels (a React-Flow grouping lift). Visibility + emphasis is
  the independently-valuable, testable first cut; regions are the next step in this story.
- **`order` realization.** `order` is carried and validated but not yet used to drive lane/row
  ordering; emphasis covers the lead-with need for now.
- **LLM extraction / `consumes` edges, `api-call`/`api-endpoint` kinds, persistence, the change
  loop, multi-modal** — all deferred per the vision (steps 2, 3, 7, 8).

## How to verify

1. **Unit / type gate (no model):**
   `cd server && yarn jest arrangeReview` (8 pass), `npx tsc --noEmit`; `cd web && npx tsc --noEmit && yarn test`.
2. **Smoke the model's JSON (no web):**
   `cd server`, set a provider (e.g. `CODEAI_LLM_BASE_URL=http://localhost:11434/v1 CODEAI_LLM_MODEL=…`),
   then `yarn arrange:smoke` — eyeball what it shows vs. collapses/hides and how it groups.
3. **Live in the app:** start the server with a provider configured (e.g. `CODEAI_LLM_BASE_URL` +
   `CODEAI_LLM_MODEL`, or `CODEAI_LLM_PROVIDER=claude-code`), `cd web && yarn dev`, open the **Review**
   lens on a commit. Confirm: the **✨ Arrange with AI** button appears and the review is already
   rendered via elk; click it → `Arranging…` → the arranged view hides noise + rings the lead
   entities; `Reveal N hidden` brings folded entities back; `Arranged`/`elk only` toggles between the
   two without re-asking; `Re-arrange` re-runs.
4. **Fallback:** with no provider configured the button is absent and the Review is identical to today;
   on a model error an inline message shows and the elk view stays intact.

