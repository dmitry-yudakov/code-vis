# Vision & North Star

**Status:** Direction-setting. Aspirational — describes where the product is going, not what
exists today. Reference docs ([architecture](architecture.md), [server](server.md),
[web](web.md), [analyzer](analyzer.md)) describe current reality; this document describes the
target and the transition toward it.
**Updated:** June 3, 2026

---

## Thesis

Today the product is a **read-only static visualizer**: it parses JS/TS, extracts files,
function declarations, and calls, and draws them as graphs.

The north star is a **model-centric, bidirectional, multi-modal, agentic development
environment** built around one persistent semantic model of the software. It is not only a
view *of* code; it is a surface for *understanding* code and *acting on* it.

The core purpose:

> Coding agents generate large amounts of code quickly, but humans struggle to understand and
> verify it. Combining a **visual scheme of how the software fits together** with **details
> from the code** should make what is implemented clear, make what needs to change obvious, and
> let people request or make those changes through the same surface.

This can complement an editor + agent setup (VS Code + Claude Code), or eventually stand on its
own. It should be reachable from web on desktop, phone/tablet, and — further out — VR/AR or
voice. The *model and API are surface-agnostic*; surfaces are pluggable front-ends.

---

## Where we are today

Honest snapshot, so the gap is explicit:

- **Extraction** is static only, JS/TS only ([analyzer.md](analyzer.md)). The analyzer registry
  is a single analyzer (`getAnalyzer(ext)`) covering js/ts/jsx/tsx — one implementation, no
  per-language extensibility.
- **Entities** are narrow: files, function declarations, function calls. No classes as
  first-class items, no variables/globals, no DB tables, no config reads, no API endpoints, no
  GraphQL.
- **No persistent model.** Each lens recomputes a bespoke projection per request
  (`buildFocusedReviewMap → FocusedReviewMap`, overview expansion client-side,
  `CodeMapScope`). There is no single "model of the software" to query, cache, or enrich.
- **Lenses** exist but are partial: `Overview` and `Review changes` (working tree / branch /
  commit) are real; `Feature focus` and `Impact investigation` are placeholders.
- **No LLM yet — specified, not built.**
  [Story 2](../stories/STORY-20260602-llm-review-annotation.md) *proposes* the first integration
  (a provider-agnostic, opt-in, fail-safe client to annotate ≤25 changed declarations in review),
  but it is unimplemented: there is no `server/src/llm/`, its acceptance criteria are unchecked,
  and no `CODEAI_LLM_*` wiring exists. The shipped
  [Story 1](../stories/STORY-20260602-review-card-declutter.md) (card declutter +
  `summary`/`causalReason` rendering) means the UI can already *display* descriptions it cannot
  yet *produce*. The split is already visible as type drift: `web/src/types.d.ts` carries
  `summary` / `causalReason` / `narrativeRank` while `server/src/types.d.ts` does not — and
  `narrativeRank` is a declared-but-dead field nothing yet produces or consumes (step 1 closes
  this).
- **Read-only.** Editing exists (`saveFile` + file watch), but the map does not yet drive
  change. `CodeMapScope` handoff is the seed of "act on this scope," nothing more.

The pieces are pointing the right way; they are just narrow and scattered, and no document
holds the whole picture.

---

## The center: one software model

Everything hangs off a single idea the product does not yet have: **a persistent, typed
entity/relation graph of the software**, extracted from multiple sources, cached per project,
queried by lenses, carrying content and descriptions, and able to hold a change overlay.

Vocabulary:

- The **software model** = all entities + relations (the source of truth).
- A **code map** = a rendered *slice* of the model produced by a lens (what the user sees).

Today's `FileMapping`, `FocusedReviewMap`, and `CodeMapScope` become *projections* of this
model rather than independent shapes.

### Entities (items)

An entity is a part of the software with a kind, an identity, an optional source location, and
kind-specific traits. Target kinds (directional, not final):

- **Structural:** `module`, `directory`, `file`, `class`, `function`, `method`, `variable`,
  `constant`, `type`, `enum`
- **Resources:** `db-connection`, `db-table`, `config-key`, `env-var`, `queue`, `cache`,
  `external-service`
- **Interfaces:** `api-endpoint` (server), `api-call` (client), `graphql-operation`,
  `graphql-type`, `route`, `event`
- **Meta:** `test`, `deleted` (ghost node for change views)

### Relations (connections)

A typed, directed link between two entities with its own traits:

`contains` · `declares` · `imports` · `exports` · `calls` · `reads` · `writes` ·
`connects-to` · `exposes` · `consumes` · `queries` · `tests` · `depends-on` ·
`bridge` (a cross-boundary semantic link — e.g. a client `api-call` to the server
`api-endpoint` it hits — that no single language grammar can resolve, hence typically
`origin: 'llm'`)

### Cross-cutting properties

Every entity and relation carries, beyond kind and identity:

- **`origin`: `'static' | 'llm' | 'derived' | 'user'`** — provenance of the entity's *identity
  and location*. (`static` = read from the grammar; `llm` = inferred by a model; `derived` =
  computed deterministically from other facts, e.g. a transitive `depends-on` rolled up from
  `imports`, trusted like `static` but not directly observed; `user` = hand-asserted.) This is
  the homogenized "reliability boundary" (exact vs heuristic) and it is
  load-bearing: the same map will later render agent-*proposed* changes, and the user must always
  be able to tell trusted structure from a suggestion. Provenance is **per-facet, not just
  per-entity:** a statically-identified function can carry an LLM-written `description` and
  LLM-inferred `traits`. `description` is LLM/`derived` by nature; relations are separate objects
  with their own `origin`; only mixed-origin `traits` need explicit per-trait tagging
  (`traitOrigins?`). Render each facet by its own provenance, never the entity's alone.
- **`confidence?`** — for non-static origins.
- **`traits?`** — a kind-specific bag (e.g. `{ method, path }` for `api-endpoint`,
  `{ columns }` for a `db-table` usage).
- **`content?`** (lazy) — the code, diff, or file slice, fetched on demand for display.
- **`description?`** (lazy) — a brief LLM summary, fetched on demand. Generalizes Story 1's
  per-card `summary` / `causalReason`.
- **`changeStatus?` / `changePhase?`** — the change overlay (see
  [the change loop](#the-bidirectional-change-loop)). `changePhase` distinguishes an
  `applied` diff (today's review) from a `proposed`, not-yet-applied change.

### Identity

Stable entity ids are the **merge key** — static and LLM extractors, caching, change overlays,
and persistence all depend on two extractions of the same thing producing the same id. This is a
Phase 1 design problem, not an afterthought, and there is already a precedent: `project.ts`
builds stable declaration ids today (`decl:${filename}->${name}:${pos}` via
`focusedDeclarationId`). Generalize that — `kind + file + name` for located entities (e.g.
`function:src/db.ts#getUser`), `kind + canonical name` for location-less ones (e.g.
`db-table:users`). Note the tradeoff the current `pos`-based id makes explicit: include byte
offset and the id breaks on any edit *above* the declaration; drop it (as the generalized scheme
does) and same-named siblings — overloads, two `getUser`s in one file, anonymous functions —
collide. The id key has to pick its poison; this is part of the Phase 1 design, not a detail. The
genuinely hard cases — ids for LLM-produced entities, stability across renames/moves, and
cross-language identity — stay [open](#open-questions).

### Illustrative shape

Directional, like the sketches in the existing stories — **not** a contract to build yet:

```typescript
type Provenance = 'static' | 'llm' | 'derived' | 'user';
type ChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed';
// 'renamed' presupposes rename identity (linking old id → new id) — itself an open
// question (see Open questions #4); not emitted until that is solved.
type ChangePhase = 'applied' | 'proposed';

interface SourceLocation {
  filename: string;
  pos?: number; end?: number;
  startLine?: number; endLine?: number;
}

interface Entity {
  id: string;                       // stable across extractions — the merge key (see Identity)
  kind: EntityKind;
  name: string;
  location?: SourceLocation;        // some entities (db-table, external-service) have none
  origin: Provenance;               // provenance of identity / location
  confidence?: number;
  traits?: Record<string, unknown>;
  traitOrigins?: Record<string, Provenance>;  // per-facet provenance for mixed-origin traits
  content?: string;                 // lazy
  description?: string;             // lazy; LLM / derived by nature
  changeStatus?: ChangeStatus;
  changePhase?: ChangePhase;
}

interface Relation {
  id: string;
  kind: RelationKind;
  source: string;                   // entity id
  target: string;                   // entity id
  traits?: Record<string, unknown>;
  origin: Provenance;
  confidence?: number;
  description?: string;
  changeStatus?: ChangeStatus;
  changePhase?: ChangePhase;
}
```

Mapping from today: `FileIncludeInfo` → an `imports` relation; `FunctionDeclarationInfo` → a
`function` entity; `FunctionCallInfo` → a `calls` relation; `FocusedReviewMap` → a review-lens
projection with `changeStatus` set; `CodeMapScope` → a serialized handoff slice.

---

## Extraction: static + LLM, composed

The model is filled by a **pipeline of extractors**, not a single analyzer. Each extractor
contributes partial entities/relations into the shared model, merged by stable `id`.

- **Static extractors** (today's TS analyzer, future per-language) produce high-confidence
  structural facts (`origin: 'static'`). Fast, exact, but limited to what the language grammar
  reveals and to languages we have an analyzer for.
- **LLM extractors** (reusing the provider-agnostic client Story 2 specifies) produce the
  **cross-cutting, semantic** entities/relations that static analysis misses or that span
  languages — DB usage, config reads, API/GraphQL surfaces — and descriptions. Marked
  `origin: 'llm'` with a `confidence`. This is the "more costly but easiest" path the vision
  calls for, and it is how we reach languages without a static analyzer.
- **Merge by id:** a function entity may be created by the static extractor (exact
  `file:line`) and *enriched* by the LLM extractor (`queries db-table users`, `exposes GET
  /users/:id`). Same id, combined traits (with per-facet `traitOrigins`), the attached relations
  each carrying their own origin.

**Discipline (the posture Story 2 specifies, made global):** LLM extraction is incremental,
cached, opt-in, scoped to the current slice, and fail-safe. The structural view must never block
on it. Re-extract only changed files (the chokidar watch already signals these); amortize cost in
the persisted model rather than recomputing per request.

### Worked example — client ↔ server API (first vertical)

The first cross-cutting vertical to prove the pipeline end-to-end:

- **Server:** `app.get('/users/:id', getUser)` →
  `Entity{ kind: 'api-endpoint', name: 'GET /users/:id', traits: { method: 'GET', path: '/users/:id' } }`
  plus `Relation{ kind: 'exposes', source: <handler fn>, target: <endpoint> }`.
- **Client:** `` fetch(`/users/${id}`) `` →
  `Entity{ kind: 'api-call', traits: { method: 'GET', path: '/users/:id' } }`
  plus `Relation{ kind: 'consumes', source: <call site>, target: <endpoint> }`.

Why it is a strong showcase: static analysis can find the call sites and route registrations
per framework, but **matching a client call to a server endpoint** (dynamic URLs, base paths,
path params) is exactly where it falls down — so the `consumes` edge is `origin: 'llm'` with a
confidence, demonstrating the static+LLM merge and the provenance model in one visually
compelling cross-boundary edge.

---

## Lenses: slicing the model

Showing the whole model is too noisy. A lens is a **query/projection** over the model that
answers one question. Today's lenses generalize cleanly, and the richer model unlocks new ones:

- **Overview** — cluster by module / kind; weighted dependency edges. (Exists.)
- **Review changes** — filter to changed entities + neighborhood + change overlay, from a
  diff / branch-PR / commit. Carries added/modified/deleted status. (Exists, narrow.)
- **Feature focus** — seed entities + their semantic neighborhood. The richer relations make
  this real; an LLM can map a feature *description* to seed entities. (Placeholder today.)
- **Impact investigation** — directional reachability from a seed. (Placeholder today.)
- **Relation-kind filters (new dimension):** "show only the data/DB layer", "show only
  client↔server API", "show config dependencies". Only possible once relations are typed beyond
  imports/calls.

---

## Arrangement: organizing the slice

A lens decides *which* elements are in play. **Arrangement** decides *how they are organized* —
grouped, placed, and, crucially, **what is shown versus hidden or collapsed initially**. This is
a separate layer from both extraction and geometric layout, and it is where much of the
"make it comprehensible" work actually happens.

The pipeline: **extract → model → lens (select) → arrange (organize) → render.**

Geometric layout (dagre/elk) answers "given these nodes and edges, minimize crossings." It does
not answer "out of 60 shortlisted elements, which 12 should be visible first, how do they group
into regions, and in what reading order?" That is editorial, and it should be pluggable by
**source** — mirroring extraction provenance:

- **Algorithmic** — dagre / elk / the semantic strategies in the
  [layout strategies](../stories/STORY-20260520-code-map-layout-strategies.md) story. Fast,
  deterministic; the always-available default and fallback. *(Exists.)*
- **User-defined** — manual drag / pin / collapse / hide, preserved across refreshes with an
  explicit reset. *(Partly exists — manual-position preservation and `Reset layout` are built.)*
- **LLM (editorial director)** — decides grouping into labeled regions, narrative/reading
  order, emphasis, and **initial visibility** (progressive disclosure). *(New.)*

So two of the three sources already exist; the new one is the LLM as a composition director.

**Division of labor.** An LLM is strong at editorial and structural decisions — grouping,
visibility, ordering, emphasis, lane/anchor assignment — and weak at precise coordinates and
crossing-minimization. The robust pattern is therefore: **the LLM emits an arrangement *spec*
(regions, visibility, ordering, constraints); a geometry engine realizes it within those
constraints.** It may emit explicit positions for small graphs or as a starting point, but it
should never be *required* to do pixel layout. The three sources compose — e.g. the LLM picks
the regions and what to reveal, elk places nodes inside each region, the user then drags.

An arrangement is a **structured spec, not raw coordinates**:

```typescript
interface Arrangement {
  origin: 'algorithmic' | 'llm' | 'user';
  regions?: Array<{
    id: string; label?: string; entityIds: string[];
    origin: 'algorithmic' | 'llm' | 'user'; confidence?: number;  // a region carries its own provenance
  }>;
  visibility?: Record<string, 'shown' | 'collapsed' | 'hidden'>;  // by entity / region id
  order?: string[];                      // reading / narrative order
  emphasis?: string[];                   // entities to lead with
  placement?: Record<string, { lane?: string; anchor?: string; x?: number; y?: number }>;
}
```

**Discipline carries over.** Arrangements have an origin, are **cached** per `(lens, scope)` key
so the LLM is not re-asked on every render (in-memory / per-session for now; a durable store
comes with model persistence, not before), and are validated against the lens's shortlist
(reference only entities that exist, the way the layout entry point already rejects edges to
absent nodes). User edits layer on top as `origin: 'user'`. The deterministic algorithmic engine
is always the fast default; LLM arrangement is opt-in and fail-safe, exactly like LLM extraction.
Arrangement provenance is itself visible: an LLM-suggested region renders as an editorial
grouping (a soft band, say), distinct from a verified relation edge — **grouping ≠ link.**

[Story 2](../stories/STORY-20260602-llm-review-annotation.md)'s `narrativeRank` is the **first,
narrowest instance of LLM arrangement** — though still *planned*, not built: the model would emit
one ordering signal that reorders one axis of one lens. This layer is where that idea graduates —
from a single ordering number to full editorial composition (regions, visibility, emphasis),
still with the algorithmic engine as the fallback.

This is also where multi-modal arrangement lives: drawing to rearrange the diagram is *editing
the arrangement* (`origin: 'user'`), and an LLM generating a diagram for a not-yet-built feature
is *producing an arrangement* over a described slice of the model.

---

## Content + description

Each entity can show two complementary things, both lazy-loaded on selection:

- **Content** — the actual code, diff, or file slice. The editors already exist (CodeMirror,
  Monaco).
- **Description** — a brief LLM summary of what the item is / does / why it matters.
  Story 1 already renders this for review declaration cards; the target is the same treatment
  for every kind.

Some items are best understood by their content, some by a one-line description, many by both.
The card leads with meaning (description), with content one click away.

---

## The bidirectional change loop

The map is not only for reading. It is where change is **expressed, previewed, verified, and
applied** — the half that turns a visualizer into a development environment, and the half that
directly serves the "help humans verify agent code" purpose.

Concepts:

- **Intent** — a desired change, attached to entities/relations or to a region of the diagram.
  Sources: editing a code item directly, text, voice, or **drawing/pointing over the diagram**
  — often combined (e.g. draw an arrow to a new endpoint + the text "add caching here").
- **Proposed change / plan** — an agent turns intent (+ the scoped model + relevant content)
  into a concrete plan and/or diff, rendered **on the same map** as a change overlay
  (`changePhase: 'proposed'`): new/modified/deleted entities and relations.
- **Verification** — the human reviews the proposal *visually* (new nodes/edges with summaries)
  and drills into the code/diff for detail. This is the point: make agent output legible.
- **Apply** — accept → write files (`saveFile` + watch exist), or hand the scoped context to an
  external agent. `CodeMapScope` handoff is the seed of this.

Key insight: **reviewing an existing diff and previewing a proposed change are the same
rendering** over the same model — only `changePhase` (`applied` vs `proposed`) differs. The
review visualization we already have is reused for agent proposals.

LLM can also run the other direction: generate a **diagram for a feature that does not exist
yet**, which the user draws over to refine or to ask clarifying questions.

> **Open strategic question (deliberately unresolved):** should the change loop be
> *complementary* — hand structured scope/context to an external agent (Claude Code) and render
> its diff back — or *self-sufficient* — own the intent→plan→diff→apply loop natively? Both stay
> open until the model exists; see [open questions](#open-questions).

---

## Multi-modal & surface-agnostic

The model and its API are the durable core; surfaces plug into them.

- **Input:** selection (exists), text (via agent), voice (transcribe → intent), draw/point over
  the diagram (sketch nodes/edges + brief text → structured intent).
- **Output:** the diagram (exists), LLM-generated diagrams (model → map for a not-yet-built
  feature), descriptions (Story 1/2 seed this).
- **Surfaces:** web desktop (exists), phone/tablet (touch-draw is a natural fit), and — far out
  — VR/AR or voice-first. None of these should require changing the model; protecting that
  boundary now is what makes them possible later.

---

## Principles

1. **Provenance honesty is the credibility anchor.** Static = trusted, LLM = suggested,
   proposed = unapplied — always visually distinct. This applies to **arrangement too**, not
   just the model: an LLM-grouped region is a *suggested* grouping and must never read as a
   verified relation. The verify-agent-code thesis dies if the map overstates certainty.
2. **LLM discipline is global:** incremental, cached, opt-in, scoped, fail-safe. The structural
   view never blocks on the model.
3. **One shared contract.** The entity/relation model is the single source of truth, replacing
   the hand-synced narrow projection types that drift between `web` and `server`. (For the
   concrete drift that exists today — and that step 1 closes — see [Where we are
   today](#where-we-are-today).)
4. **Layout keys off general `kind`/`role`,** so new entity kinds get placement for free
   instead of calcifying the [layout strategies](../stories/STORY-20260520-code-map-layout-strategies.md).
5. **Surface-agnostic core.** Keep the model and API clean of front-end assumptions.
6. **Arrangement is editorial and pluggable.** Organizing a slice — grouping, ordering, and
   what to reveal first — is separate from geometric layout and from extraction. It comes from
   algorithmic, user, or LLM sources that compose; the LLM constrains, the engine places, and a
   deterministic engine is always available.

---

## Transition arc

Durable phases, each shippable on its own. Read-only steps (1–6) make *understanding*
excellent; 7–8 add *acting*. Status reflects June 3, 2026.

0. **Name the north star.** This document. Reframe existing stories/README as steps toward it.
   *In progress.*
1. **Unify the model (additive).** Shared `Entity` / `Relation` types — kind breadth, per-facet
   `origin`, `confidence`, `traits`, lazy `content`/`description` — **including the entity
   identity scheme** (the merge key everything downstream depends on). Existing
   analyzers/projections produce *into* it via adapters; nothing replaced yet. Fixes the
   type-sync drift.
2. **Persist & cache the model** per project, invalidated by the existing file watch.
   Prerequisite for amortizing LLM cost and for relations that span files.
3. **Multi-source extraction.** Turn the single analyzer into an extractor pipeline; add the LLM
   extractor (Story 2's client). Prove it on **one vertical end-to-end: client ↔ server API.**
4. **Richer lenses** — relation-kind filters; implement the real **Feature focus** lens.
5. **Arrangement layer.** Formalize arrangement as a pluggable layer. The algorithmic and
   user-defined sources largely exist; add the **LLM composition director** (generalizing
   Story 2's `narrativeRank`) that emits a validated, cached arrangement spec — grouping,
   initial visibility, ordering — which a geometry engine realizes.
6. **Content + description everywhere** — generalize Story 1's card to all kinds; lazy-load
   content and descriptions.
7. **The change loop (bidirectional).** Model proposed changes as `changePhase: 'proposed'`
   overlays rendered with the existing review visualization. Intent (text first) → plan/diff →
   verify on map → apply or export.
8. **Multi-modal intent.** Voice, draw-over-diagram, and LLM→diagram generation.

---

## MVP

The first thin vertical through the arc, chosen to test the two claims the whole vision rests on
while deferring its most expensive and uncertain part. It validates:

1. *A richer typed model beats files + functions + calls* — proven with static analysis, low risk.
2. *An LLM can make a map more comprehensible than a geometry engine alone* — the real bet,
   isolated by spending the LLM **only on arrangement**, not extraction.

**Surface:** the **Review** lens (diff / commit). Lowest-risk, highest-reuse — the slice is
already built server-side, the lens is the most developed, and shipped Story 1 already renders
richer cards. **Prerequisite:** the arrangement pass needs an LLM client, so standing up
`server/src/llm/` (Story 2's client) is the MVP's first build step — Story 2 is not optional
background, it is a dependency. The arrangement pass then sits beside the annotate pass Story 2
describes.

**Scope:**

- **Model — minimal, in-memory.** Introduce the `Entity` / `Relation` shape as the internal
  representation. **In-memory only — no durable persistence store yet** (arrangements may still
  be cached in-memory per session; that is caching, not the persistence phase). Populated from
  static analysis only.
- **New structures — static, pinned small** (resist scope creep): `class` + `method`,
  module-level / exported `variable` + `constant`, and statically-detected `api-endpoint`
  (route registrations) and `api-call` (`fetch` / axios) entities — **left unlinked** (the
  cross-boundary `consumes` edge is the part that needs LLM/heuristics; defer it).
- **Arrangement — one LLM pass.** Input: the review slice (entity names / kinds / paths).
  Output: an `Arrangement` spec (regions, initial visibility, order, emphasis) that **elk
  realizes within constraints**. This is Story 2's `narrativeRank` generalized from one axis to
  grouping + visibility + order — same client, same opt-in / cached / fail-safe posture, elk as
  the always-on fallback.
- **Cross-boundary comprehension comes from arrangement, not extraction.** The LLM editorially
  groups a matching `api-call` and `api-endpoint` into one region (e.g. "User API"), so the
  client↔server vertical shows up without a hard extracted edge.
  *Be honest about what this does and does not avoid:* grouping the two into one region **still
  requires the model to recognize that the call hits that endpoint** — the same dynamic-URL /
  base-path / path-param matching that makes the `consumes` edge hard. The MVP does not escape
  that matching; it relocates it from a typed, confidence-scored `consumes` *edge* into an
  editorial *region*. The deliberate bet is that an unaudited "these belong together" grouping is
  an acceptable MVP stand-in for a first-class verified edge — cheaper to ship, and honestly
  weaker (no confidence number, no edge to inspect). That bet is only acceptable because **the
  region renders as a *suggested* grouping (visibly editorial, carrying its `llm` origin), never
  as a verified call→endpoint edge** — otherwise it quietly violates provenance honesty. The
  first-class `consumes` edge is what the deferred LLM-extraction phase (step 3) later adds; the
  MVP approximates it editorially. Best demoed on a commit that touches both a client call and the
  server route it hits.
- **Content + description — pure reuse** of Story 1/2 cards.

**Intermediate shippable:** the richer static model renders (via elk) before the arrangement
pass exists — a richer diagram is value on its own; arrangement layers on top.

**Deferred:** LLM extraction / matching, the persistence store, the change loop, multi-modal,
and the Feature / Impact lenses.

**Threads the arc:** step 1 (model, minimal) · step 3 (extraction, static only) · step 5
(arrangement, the LLM pass) · step 6 (content + description, reuse), all on the already-built
Review lens. Persistence (step 2) is deferred; the holistic Overview showcase is a fast follow
once the machinery is proven.

**Success criteria** (how we'll know it worked):

1. On a demo commit that touches a client call and its server route, the two render in one
   visibly-*suggested* region, with cards showing `summary` / `causalReason`.
2. With no LLM configured, or on LLM error / timeout, the review still renders via elk, unchanged
   — the arrangement pass is pure enhancement, never a dependency for a working review.
3. Provenance is visually distinguishable: static structure vs. suggested grouping vs. (later)
   proposed change.
4. Side-by-side, the arranged map reads as clearer than elk-only on the same commit. This is the
   core bet, so back the qualitative read with at least one cheap objective signal — e.g. *N of M
   reviewers prefer the arranged map*, or *fewer expand/scroll actions to locate the changed
   endpoint*. Rigor isn't required for the MVP; a number beyond "it looks better" is, since this
   is the hypothesis the whole vision rests on.
5. No regression to existing review behavior (Story 1 cards, files / declarations toggle) when
   arrangement is off.
6. `server` and `web` both typecheck against the new shared types.

---

## Near-term non-goals

The vision is broad; these keep the near-term roadmap honest and bounded:

1. **Not replacing the editor / IDE.** The tool stays complementary to VS Code + an agent for now.
2. **No autonomous apply.** Changes are previewed and verified on the map before any write —
   never applied unreviewed.
3. **LLM output is suggestive unless verified.** Descriptions, extracted semantic relations, and
   arrangement regions are suggestions, visibly marked, never rendered as verified structure.
4. **JS/TS stays the first-class static path.** Other languages rely on the LLM extractor later;
   we do not commit to per-language static analyzers now.
5. **No durable model persistence in the MVP.** In-memory only until the persistence phase.

---

## Relationship to existing artifacts

How today's docs and stories map onto the arc — they are steps toward this picture, not
alternatives to it:

| Artifact | Role in the north star |
|---|---|
| [architecture.md](architecture.md) / [server.md](server.md) / [web.md](web.md) / [analyzer.md](analyzer.md) | Current-reality reference. Accurate for the read-only visualizer; this doc is the direction beyond them. |
| [homepage-code-map-lenses](../stories/STORY-20260514-homepage-code-map-lenses.md) | The lens shell and "editing/AI readiness" groundwork. Closest existing sketch of the model (`CodeMapNode`, reasons, `CodeMapScope`). |
| [change-focused-review-view](../stories/STORY-20260501-change-focused-review-view.md) | The diff/PR/commit slice and the "reliability boundary" — direct ancestor of `origin`/provenance. |
| [code-map-layout-strategies](../stories/STORY-20260520-code-map-layout-strategies.md) | The **algorithmic** arrangement source (geometry engines) and the built-in **user-defined** source (manual placement, `Reset layout`) — both under the arrangement layer. Keys off general `kind`/`role` so new kinds place automatically. |
| [llm-review-annotation](../stories/STORY-20260602-llm-review-annotation.md) (Story 2) | **Specifies (not yet built)** the first LLM integration — the foundation the multi-source extractor will reuse. Its `narrativeRank` is also the first (planned) narrow **LLM-arrangement** signal, generalized by the arrangement layer. |
| [review-card-declutter](../stories/STORY-20260602-review-card-declutter.md) (Story 1) | **Shipped.** Per-item content + description UI — the seed of step 6. |

---

## Open questions

1. **Self-sufficient vs. complementary** change loop (see above) — the biggest strategic fork;
   pick once the model exists.
2. **Model store** — in-memory first, then on-disk under `~/.code-ai/projects/{...}/`? What
   invalidation granularity (file, entity)?
3. **Extraction trigger** — eager on project open, lazy per lens, or background? How much LLM
   extraction is opt-in vs automatic?
4. **Hard identity cases** — ids for LLM-produced entities (no exact location), stability across
   renames/moves, and cross-language identity. The basic `kind + location/name` scheme (step 1)
   does not cover these; how are merges and conflicts resolved?
5. **Language breadth** — which languages get a static analyzer vs. rely entirely on the LLM
   extractor, and how is the confidence difference surfaced?
6. **How much of the model to persist vs. recompute** as projects and history grow.
7. **LLM arrangement invocation & caching** — on demand or automatic? Cache key and
   invalidation, and how much geometry the LLM specifies vs. delegates to the engine.
8. **Merging arrangements** — how do user edits compose with algorithmic and LLM arrangements
   (precedence, partial overrides, what a reset reverts to)?
