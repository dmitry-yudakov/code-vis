# Story 3 — Richer static Entity/Relation model, rendered via elk (MVP Milestone 1)

**Status:** In progress · **Type:** Full-stack · **Depends on:** nothing (no LLM — unblocked by the
Story 2 rewrite). Foundation for [Story 2](STORY-20260602-llm-review-annotation.md)'s successor
(MVP Milestone 2, the LLM arrangement pass).

> This is the first of the two MVP milestones in [vision.md](../docs/vision.md#L438). **M1 (this
> story)** proves the low-risk claim — *a richer typed static model beats files + functions +
> calls* — and ships on its own with **zero LLM**. **M2** (a later story) adds the LLM client and
> the arrangement pass (the real bet) on top. Threads transition-arc step 1 (model, minimal) and
> the static slice of step 3, all on the already-built Review lens.

---

## Motivation

Today the model is three things: files, function declarations, and function calls
([types.d.ts:33-44](../server/src/types.d.ts#L33)). A reviewer looking at a change sees functions
floating free of the classes that own them, with no module-level state (`const`/`let` config,
exported singletons) on the map at all — even though those are often *what changed*. The vision's
first claim is that **a richer typed model is more comprehensible than files + functions + calls**,
and it's the low-risk half of the MVP because it needs no LLM — just more from the static analyzer
we already have.

This story introduces the shared **`Entity` / `Relation`** model (the vision's center,
[vision.md:67](../docs/vision.md#L67)) as the internal representation, promotes `class`, `method`,
module-level `variable`, and `constant` to first-class entities, and renders them in the Review
lens via the existing elk layout. It also fixes the `web`↔`server` type drift the vision calls out
([vision.md:53-58](../docs/vision.md#L53)) by replacing the hand-synced narrow projection types
with one shared contract.

Crucially, it nails down the **stable entity id / merge key** — the design decision everything
downstream (caching, change overlays, the LLM merge) depends on, made now while it's cheap.

---

## Current behavior (where the code is)

- **Analyzer** extracts funcs + arrow-funcs + methods into a *flat* list and **discards the
  owning class**: [js.ts:305-326](../server/src/analyzers/js.ts#L305). The method branch already
  reads the class name at [js.ts:309](../server/src/analyzers/js.ts#L309)
  (`node.parent.name.escapedText`) purely to filter, then throws it away. **No `class` entity, no
  `variable`/`constant` entity is produced at all.**
- **Current id:** `decl:${filename}->${name}:${pos}` —
  [project.ts:342](../server/src/project.ts#L342). Position is *in* the identity, so it breaks on
  any edit above the declaration; and methods carry only their bare name, so same-named methods in
  two classes are told apart **only** by `pos`.
- **Declaration type** `FunctionDeclarationInfo` is `{name, filename, pos, end, args}`
  ([types.d.ts:33](../server/src/types.d.ts#L33)); the review projection
  `FocusedDeclarationInfo` ([types.d.ts:115](../server/src/types.d.ts#L115)) is mirrored by hand
  in `web/src/types.d.ts` — the drift the vision flags.
- **Review graph** is built in `buildFocusedDeclarationGraph(...)`
  ([project.ts:942](../server/src/project.ts#L942)), returning `{ declarations, declarationCalls }`
  (~[line 1200](../server/src/project.ts#L1200)); entry `handleCommandFocusedReview`
  ([project.ts:1218](../server/src/project.ts#L1218)).
- **Web layout already keys off `kind`/`role`:** `CodeLayoutNodeKind` is
  `module|directory|file|test|declaration` and edge kinds already include `declares`/`contains`
  ([web/src/graphLayout/types.ts:1-25](../web/src/graphLayout/types.ts#L1)). New entity kinds slot
  into this existing dimension rather than requiring new layout machinery (vision principle #4).

---

## Desired behavior

A shared `Entity`/`Relation` model is produced **by an adapter over the existing analyzer
output** (additive — the legacy `FocusedReviewMap` path is not deleted in this story), the analyzer
captures the owning container, and the Review lens renders the richer kinds via elk.

### Concrete changes

1. **Shared `Entity`/`Relation` types** (a *minimal, forward-compatible subset* of the vision's
   illustrative shape, [vision.md:148](../docs/vision.md#L148)) in one place, imported by both
   `server` and `web`. Only the fields M1 needs; the rest of the vision's fields (`confidence`,
   `traitOrigins`, `changePhase`, …) are omitted now but the shape must be a strict subset so they
   add cleanly later.
2. **Stable id / merge key** (the settled scheme — see [Identity](#identity-the-merge-key) below).
   A single `entityId(...)` builder replaces inline id construction. **Position is not in the id.**
3. **Analyzer: capture `container`.** Add `container?: string` to the declaration shape and
   populate it: for methods, the owning class name (already in hand at
   [js.ts:309](../server/src/analyzers/js.ts#L309) — free); for class-field arrows
   (`foo = () => {}`), one guarded parent hop (`node.parent.parent` is the `ClassDeclaration`).
   Top-level functions/consts have no container.
4. **Analyzer: new entity kinds (static only).**
   - `class` — from `ClassDeclaration` (named classes; mirror the existing
     `node.parent?.name`-style guard so unnamed class expressions stay out, matching today's
     coverage boundary).
   - `method` — promoted from the flat declaration list, now carrying `container` and a `declares`
     relation from its class.
   - `variable` / `constant` — **module-level and exported only** (`const` → `constant`, `let`/`var`
     → `variable`). Resist locals: pin to top-of-module / export scope to avoid flooding the graph.
5. **Relations (in-grammar only):** `contains` (file → class/function/var), `declares` (class →
   method), plus the existing `imports` (from `FileIncludeInfo`) and `calls` (from
   `FunctionCallInfo`) reshaped as `Relation`s by the adapter. **No cross-boundary edges** (see Out
   of scope).
6. **Adapter** (`server`): map existing analyzer/projection output → `Entity[]` / `Relation[]`,
   in-memory, on the existing review request path. `FileIncludeInfo` → `imports` relation;
   `FunctionDeclarationInfo` → `function`/`method` entity; `FunctionCallInfo` → `calls` relation;
   `FocusedReviewMap` → a review-lens projection with `changeStatus` set from the (unchanged,
   diff-driven) change-set logic.
7. **Render the richer kinds in the Review lens via elk.** Extend `CodeLayoutNodeKind` with
   `class` / `method` / `variable` / `constant` (and map them through the elk strategy so they
   place by `kind`/`role`). Class nodes visually contain/anchor their methods via the `declares`
   edge. This is the shippable payload of M1 — new structure actually appears on the map.

### Change status stays diff-driven

Per the settled decision: the git diff / PR / commit defines **which** entities are in the change
set and **what kind** of change (`added` / `modified` / `removed`). Ids are for identifying and
merging entities *within* the model, **never** for computing the change (no id-pairing of old↔new).
So `changeStatus` is assigned from the existing change-set/line-range logic, exactly as today —
this story does not touch how change is computed. (LLM-based *semantic* diff is a future extractor
in the same slot; out of scope.)

### Identity (the merge key)

```
id = `${kind}:${file}#${container ? container + '.' : ''}${name}${ordinal > 0 ? '$' + ordinal : ''}`
```

- `function:src/db.ts#getUser` · `method:src/db.ts#Repo.getUser` · `class:src/db.ts#Repo` ·
  `constant:src/config.ts#API_BASE`.
- **`pos` is not in the id** — it lives in `location` and is refreshed on every extraction, so
  edits *above* a declaration update its location but leave its id intact.
- **`kind` prefixes the id** so a `class:file#Foo` and `function:file#Foo` cannot collide.
- **`container` is in the id** when present (free for methods, one parent hop for class-field
  arrows).
- **`ordinal`** disambiguates genuine same-`(kind,file,container,name)` collisions — assigned by
  **source order**, which is deterministic and free because the declaration list is already
  `pos`-sorted ([js.ts:326](../server/src/analyzers/js.ts#L326)). Edits above shift the whole group
  together (ordinals stable); only adding/removing a same-named sibling re-keys, which is
  acceptably rare. Cross-time id stability is **not** load-bearing in the MVP (in-memory, recompute
  per review, diff-driven change status) — it earns its keep at the persistence phase (step 2) and
  the proposed-change overlay (step 7).
- **Rename = delete + add.** No rename identity; the vision's `'renamed'` status stays gated to the
  deferred LLM phase ([vision.md:151](../docs/vision.md#L151)).

### Type contract (if types change)

A minimal subset of [vision.md:148-188](../docs/vision.md#L148) — same field names and shape, so
the deferred fields add without churn. Shared by **`server/src/types.d.ts`** and
**`web/src/types.d.ts`** (single contract; ends the hand-synced drift):

```ts
type EntityKind =
  | 'file' | 'class' | 'function' | 'method' | 'variable' | 'constant';
type RelationKind =
  | 'contains' | 'declares' | 'imports' | 'calls';
type Provenance = 'static';        // only value emitted in M1; widened later
type ChangeStatus = 'added' | 'modified' | 'deleted';  // diff-driven

interface SourceLocation {
  filename: string;
  pos?: number; end?: number;
  startLine?: number; endLine?: number;
}

interface Entity {
  id: string;                 // entityId(...) — the merge key; pos NOT included
  kind: EntityKind;
  name: string;
  container?: string;         // owning class/module; part of the id
  location?: SourceLocation;  // pos lives here, refreshed each extraction
  origin: Provenance;
  traits?: Record<string, unknown>;
  content?: string;           // lazy code slice (reuses Story 1 card rendering)
  changeStatus?: ChangeStatus;
}

interface Relation {
  id: string;
  kind: RelationKind;
  source: string;             // entity id
  target: string;             // entity id
  origin: Provenance;
  changeStatus?: ChangeStatus;
}
```

`description?` (LLM) is intentionally absent — it arrives with M2.

---

## Acceptance criteria

- [x] `Entity` / `Relation` types live in one shared contract used by both `server` and `web`; the
      hand-mirrored `FocusedDeclarationInfo` drift is removed (or the shared types supersede it).
      *(Reconciled duplication per design decision: identical `Entity`/`Relation` blocks added to
      both `types.d.ts` files; the `summary`/`causalReason`/`narrativeRank` drift on
      `FocusedDeclarationInfo` is now matched on both sides — AGENTS.md keep-in-sync convention.)*
- [x] `entityId(...)` builder implements the settled scheme; **no `pos` appears in any id**;
      verified by a unit test that edits lines *above* a declaration and asserts its id is
      unchanged while its `location` updates. *(`server/src/model/entityId.ts` +
      `entityId.test.ts`.)*
- [x] A same-named method in two classes gets two distinct ids via `container`
      (`method:f#A.run` vs `method:f#B.run`), with **no `pos` in either**.
- [x] Two same-named same-container siblings get stable source-order ordinals (`name` vs `name$1`).
- [x] Analyzer emits `class`, `method` (with `container` + `declares` edge), and module-level /
      exported `variable` / `constant` entities; locals are excluded. *(`js.ts` +
      `js.test.ts` "Static entity kinds (M1)"; `declares` edge verified in `project.test.ts`.)*
- [x] The Review lens renders the new kinds via elk: classes anchor their methods, module-level
      constants/variables appear, placed by `kind`/`role` with no bespoke per-kind geometry.
      *(Declaration-review now routes through the elk async path; `declares` edges anchor methods;
      kinds map through the existing `kind` dimension. Implementation complete — recommend the
      manual "How to verify" walkthrough before flipping to Shipped.)*
- [x] Change status is unchanged in mechanism (diff-driven); existing review change marking
      (added/modified/removed) behaves as before. *(Entity `changeStatus` is derived from the
      existing `isChanged`/line-range logic, never from ids.)*
- [x] No regression to the existing review (Story 1 cards, files/declarations toggle) — the legacy
      path still works; the richer model is additive. *(All 63 server + 25 web tests pass; cards
      gain an additive kind badge only.)*
- [x] `server` and `web` both typecheck against the new shared types. *(`tsc --noEmit` clean on
      both; `ts-jest` + `vitest` green.)*

## Out of scope

- **`api-endpoint` / `api-call` entities and any cross-boundary edge** (`consumes` client→server,
  GraphQL, socket.io). The connection problem spans frameworks/languages/dynamic values and is not
  grammar-resolvable — it belongs to M2+ (LLM/heuristic) and the future **user-asserted +
  learned** edges ([vision.md open questions](../docs/vision.md#L547)). M1 emits **only in-grammar
  edges**.
- **Any LLM** — no `server/src/llm/`, no `description`, no arrangement. That is MVP Milestone 2.
- **Persistence / caching** the model across requests — in-memory only (transition-arc step 2).
- **Rename identity**, cross-language identity, ids for LLM-produced entities — deferred (vision
  open question #4).
- **Local variables**, `type`/`enum`/`interface` entities, the Overview/Feature/Impact lenses.

## How to verify

1. Open the Review lens on a commit/branch that adds or modifies a **class with methods** and a
   **module-level exported constant**.
2. Confirm the class renders as a node anchoring its methods (via the `declares` edge), and the
   constant appears as its own node — none of which were visible before this story.
3. Toggle files/declarations and Story 1 cards — confirm no regression.
4. Run the id unit tests (edit-above-stability, container disambiguation, ordinal siblings).
5. `npm run typecheck` (or equivalent) in both `server` and `web`.
