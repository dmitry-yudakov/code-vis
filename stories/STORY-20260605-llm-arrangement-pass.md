# Story 5 — LLM arrangement pass: editorial visibility & emphasis over the Review slice (MVP Milestone 2)

**Status:** In progress — core landed & green (on-demand visibility + emphasis + editorial region bands); the empirical side-by-side signal still open. · **Type:** Full-stack · **Depends on:** [Story 4](STORY-20260604-provider-agnostic-llm-client.md) (the LLM client) and [Story 3](STORY-20260603-static-entity-relation-model.md) (the static `Entity`/`Relation` model). Realizes [vision.md](../docs/vision.md) step 5 (Arrangement) / MVP Milestone 2, and is the graduation of Story 2's superseded `narrativeRank` from one ordering axis to a full editorial spec.

---

## Implementation status (2026-06-05)

**Landed & verified** — `server` typechecks + 97 tests (incl. 8 for `arrangeReview`); `web` typechecks + 25 tests.

- **Server pass** — [arrangeReview.ts](../server/src/model/arrangeReview.ts): prompt → tolerant JSON parse → validate against the slice (drop unknown ids, force changed entities `shown`, dedupe/clean regions) → per-(client, slice) in-memory cache. Never throws. Unit-tested with a fake client (no real LLM).
- **On-demand wiring** — `arrangeReview` socket command ([project.ts `handleCommandArrangeReview`](../server/src/project.ts) + [index.ts handler](../server/src/index.ts)) returns `ReviewArrangementResult`; `buildFocusedReviewMap` only sets `llmAvailable` and never blocks on the LLM. Client method [`projectApi.arrangeReview`](../web/src/connection/index.ts) (180s request timeout) + [App.tsx](../web/src/App.tsx) wiring.
- **Web realization** — [IncludesHierarchy.tsx](../web/src/components/IncludesHierarchy.tsx): **✨ Arrange with AI** button (only when `llmAvailable`) with `Arranging…` / inline-error states; arrangement held in local state, reset on a new slice; `hidden` filtered out (both granularities, edges cascade), `emphasis` → amber ring, `collapsed` → recessed; `Arranged`/`elk only` toggle, `Reveal N hidden`, `Re-arrange`. CSS in [IncludesHierarchy.css](../web/src/components/IncludesHierarchy.css).
- **Region bands (Option A)** — `regions` render as soft indigo bands with a labeled corner chip, reusing the Overview lens's `regionBoundingBox` geometry. `arrangementProjection.regions` translates each region's `entityIds` into the web's id space; `reviewRegionNodes` draws a band per region from the members currently on-canvas (so it composes with hide / collapse / reveal and manual drags), needs ≥2 visible members, and is layered behind the real nodes in `renderedNodes`. Deliberately distinct from relation edges (no arrowheads, no stroke) and from the amber emphasis ring — a grouping, not verified structure. Suppressed when `elk only` is active.
- **Region clustering (Option B)** — the bands stop overlapping because elk now physically groups each region. `LayoutCluster` ([types.ts](../web/src/graphLayout/types.ts)) flows through `CodeLayoutInput.clusters`; [elkLayout.ts](../web/src/graphLayout/elkLayout.ts) nests each cluster's members under a synthetic group node (`org.eclipse.elk.hierarchyHandling: INCLUDE_CHILDREN`, per-group padding ≥ the band padding), and the result walker flattens nested child coords back to absolute (group ids stay layout-only). Membership is a partition (a node in several regions joins the first by id); clusters with <2 present members dissolve. The component derives clusters from `arrangementProjection.regions` scoped to the present node set (`buildLayoutClusters`, both granularities) and attaches them to the elk `asyncLayoutInput`. Covered by two elk tests (non-overlapping cluster bboxes; thin-cluster dissolve).
- **Dev tooling** — `yarn arrange:smoke` ([arrangeReview.smoke.ts](../server/src/model/arrangeReview.smoke.ts)) prints validated JSON on a fixture, no web needed.
- **Timeout fix (post-impl)** — `arrangeReview` no longer forces a 30s timeout; it passes none so the client adapter's configured timeout governs and `CODEAI_LLM_TIMEOUT_MS` is honored (it was previously shadowed). The web request timeout (180s) is kept above the server's LLM timeout so the server's own fail-safe wins.
- **Granularity-scoped arrangement input (2026-06-09)** — the LLM previously got the whole slice (file *and* declaration entities + all relations) even though the user views only one granularity, so ~half the model's output was discarded and it split attention across two editorial questions. [IncludesHierarchy.tsx](../web/src/components/IncludesHierarchy.tsx) `sliceForGranularity` now sends only the active granularity's nodes plus the relations whose endpoints both survive — files → file entities + `imports`; declarations → declaration entities + `calls`/`declares`; the cross-granularity `contains` (file→decl) drops out by endpoint-membership filtering. The fetched arrangement is held **per granularity** (`arrangements: Partial<Record<ReviewGranularity, Arrangement>>`, surfaced for the active one), so toggling files↔declarations shows that view's own arrangement or the elk view + button if it hasn't been asked yet. Halves the prompt and makes each pass one focused question; faster and higher-signal. No server change — `sliceSignature` keys off the entity set, so the two granularities cache separately for free. `web` typechecks + tests green.

**Still open**

- `order` realization (carried/validated, not yet driving lane/row order).
- The objective side-by-side signal (success criterion #4) — pending a real model run.
- Live verification of Option B against a real model (the elk grouping is unit-tested, but the look on a real, messy slice hasn't been eyeballed yet).

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
- [x] Provenance: regions render as a visibly-editorial soft band (labeled indigo band, no arrowheads/stroke) distinct from relation edges and the amber emphasis ring. *(Option A — bounding box; non-overlapping placement needs Option B layout clustering.)*

## Out of scope

- **React-Flow parent/group-node lift (Option C).** Both Option A (bounding-box bands) and Option B
  (elk hierarchical clustering, so the bands wrap tight non-overlapping areas) have landed. Not done —
  and deliberately deferred — is making regions *true* React-Flow container nodes (`parentNode` +
  `extent: 'parent'`), which would fight manual drag, parent-relative coordinates, and the async elk
  relayout. Only reach for it if soft bands + clustering prove insufficient.
- **The synchronous first-paint isn't clustered.** Clustering lives in the elk (async) path only; the
  transient semantic lane layout shown for the first beat is unclustered, then snaps to the grouped elk
  result — the same semantic→elk reflow the review lens already has.
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
5. **Granularity scoping (2026-06-09):** open the Review lens with a provider configured, click **Arrange
   with AI** in **Files** — only file entities + `imports` are sent. Toggle to **Declarations** → the button
   reappears (its own slice not yet asked); arrange it → only declaration entities + `calls`/`declares` are
   sent. Toggling back shows each granularity's own arrangement without re-asking.

---

## Future design — diff as a toggleable overlay (deferred 2026-06-09)

Captured from the discussion that motivated the granularity-scoped slice above; not yet promoted to its
own story.

Today change status (`added` / `modified` / `deleted`; **absence = unchanged / no-info**, kept as-is) is
**baked into each `Entity` at build time** by [reviewModel.ts](../server/src/model/reviewModel.ts) and exists
**only in the Review lens**. The idea: model the diff as a **separate overlay layer keyed by entity id,
attached only when a "Diff" toggle is on**, rather than a field on the entity. That one move buys:

- **An on/off toggle** that cuts both the prompt and the model's reasoning load — "Diff off" sheds the
  change fields entirely (the "reduce noise & speed up arrangement" goal), "Diff on" attaches them.
- **Reuse beyond review** — overlay the same diff layer onto the Overview / logic graph: explore some
  functionality, flip Diff on to see what changed and where, flip it off to study the structure clean.
- **Two arrangement strategies** — Diff-on: *"what changed + the minimal context to understand it"* (the
  current guard-rail force-shows changed entities). Diff-off: *"what is the core structure of this
  functionality"* (no force-shown set; the guard-rail is inert). Argues for per-mode (and per-granularity)
  system-prompt variants.
- **Free cache separation** — `sliceSignature` already folds change status into its key, so diff-on vs
  diff-off slices cache distinctly with no extra work.

**Open decision — the diff baseline.** In review it's the change set under review; in a non-review lens
"Diff on" needs a ref to diff against (working tree / last commit / vs `main` / a PR). The review path's
`reviewMode: 'diff' | 'branch' | 'commit'` already has the machinery — this is mostly lifting it out of the
review lens plus a baseline selector.

**Also deferred:** per-granularity / per-mode system-prompt tailoring (the server prompt is still the
generic multi-level one), and **background prefetch** of the other granularity so a toggle is instant.

