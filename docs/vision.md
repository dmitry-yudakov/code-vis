# Vision & North Star

**Status:** Direction-setting. Aspirational — describes where the product is going, not what
exists today. Reference docs ([architecture](architecture.md), [server](server.md),
[web](web.md), [analyzer](analyzer.md)) describe current reality; this document describes the
target and the transition toward it.
**Updated:** July 7, 2026

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
voice. It is a personal instrument first, but the same map is a natural **team surface** — a
shared thing to brainstorm over and hand to an agent to try (see
[The team surface](#the-team-surface)). The *model and API are surface-agnostic*; surfaces are
pluggable front-ends.

---

## Where we are today

Honest snapshot, so the gap is explicit:

- **Extraction** is static only, JS/TS only ([analyzer.md](analyzer.md)). The analyzer registry
  is a single analyzer (`getAnalyzer(ext)`) covering js/ts/jsx/tsx — one implementation, no
  per-language extensibility.
- **Entities** now span the M1 static kinds — `file`, `class`, `function`, `method`, `variable`,
  `constant` — as first-class items in a typed `Entity`/`Relation` model (relations: `contains` /
  `declares` / `imports` / `calls`). Still missing the cross-cutting kinds: no DB tables, no config
  reads, no API endpoints, no GraphQL.
- **No persistent model.** A typed `Entity`/`Relation` model now exists, but **in-memory only** —
  built per request from static analysis (`buildReviewEntityModel`) alongside the older bespoke
  projections (`buildFocusedReviewMap → FocusedReviewMap`, overview expansion client-side,
  `CodeMapScope`). There is still no single persisted "model of the software" to query, cache, or
  enrich across requests.
- **Lenses** exist but are partial: `Overview` and `Review changes` (working tree / branch /
  commit) are real; `Feature focus` and `Impact investigation` are placeholders.
- **LLM is now built — arrangement, not extraction.** The provider-agnostic, opt-in, fail-safe
  client is shipped ([Story 4](../stories/STORY-20260604-provider-agnostic-llm-client.md), Stage 1
  HTTP + Stage 2 CLI subscription, *complete & verified*) under `server/src/llm/`, with the full
  `CODEAI_LLM_*` env wiring. The **arrangement pass** that consumes it
  ([Story 5](../stories/STORY-20260605-llm-arrangement-pass.md)) is *in progress — core landed &
  green* (on-demand visibility + emphasis + editorial region bands); only the empirical
  side-by-side signal is still open. The LLM is spent **only on arrangement, not extraction** — the
  model has no `origin: 'llm'` entities/relations yet (`Provenance` emits `'static'` only), and
  Story 1's per-card `summary` / `causalReason` remain display-only (rendered, not yet produced).
- **Type drift closed.** Step 1 did what it promised: `Entity` / `Relation` / `Arrangement` and the
  `summary` / `causalReason` fields are now symmetric across `server/src/types.d.ts` and
  `web/src/types.d.ts`. One loose end remains — `narrativeRank` is still declared on both sides and
  still dead (nothing produces or consumes it); superseded by the `Arrangement` spec, pending
  removal.
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

[Story 2](../stories/STORY-20260602-llm-review-annotation.md)'s `narrativeRank` was the **first,
narrowest instance of LLM arrangement** — one ordering signal reordering one axis of one lens; it
was never built, superseded before it shipped. This layer is where that idea graduated — from a
single ordering number to full editorial composition (regions, visibility, emphasis), now realized
([Story 5](../stories/STORY-20260605-llm-arrangement-pass.md), core landed) with the algorithmic
engine still the fallback.

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
yet**, which the user draws over to refine or to ask clarifying questions. The nearest concrete
form: render an existing **spec / story / plan document** as a proposed overlay anchored to the
current model — the plan verified on the map before any code is generated. Needs only the
completion contract plus the rendering this section already defines, which is why it is
sequenced early ([epic](../stories/EPIC-20260705-north-star-roadmap.md), Story 17) rather than
waiting for the full change loop.

### User drawings as anchors

The inverse is stronger still: the user draws the target structure *first* — boxes and arrows of
the system as they intend it — and generation treats those marks as **anchors**. This needs no
new machinery: a sketched box is an `Entity` with `origin: 'user'` and
`changePhase: 'proposed'`; a sketched arrow is a `Relation` with the same. Hand-asserted,
trusted, unbuilt. When an agent then plans or generates, the user-drawn entities are fixed
points: the plan attaches to them, keeps their names and boundaries, and fills the space
*between* them with `origin: 'llm'` material — so the finished overlay shows, through ordinary
provenance rendering, exactly which parts of the design were the user's and which the agent
supplied. How hard an anchor binds is itself part of the intent — a rough sketch is inspiration,
a precise one is a constraint, and ambiguity should surface as a clarifying question rather than
a silent guess ([open](#open-questions)).

> **Strategic fork — now reframed** (see [Plan and diff source](#plan-and-diff-source-a-pluggable-backend)
> below). It looked binary: *complementary* — hand structured scope/context to an external agent
> (Claude Code) and render its diff back — vs. *self-sufficient* — own the intent→plan→diff→apply
> loop natively. It is not. The two are pluggable *sources* of the same proposed-change overlay
> behind one agent interface, sequenced complementary-first per the [non-goals](#near-term-non-goals).

### Plan and diff source: a pluggable backend

The fork above is not a binary; it is a **pluggable plan/diff source**, mirroring the
provenance-source pattern the model already uses for extraction (`static | llm | derived | user`)
and arrangement (`algorithmic | llm | user`). "Complementary" and "self-sufficient" are two
*sources* of the same `changePhase: 'proposed'` overlay, behind one agent interface — call it
`CodeAgent` — not two products to choose between. The insight above makes this safe: **reviewing a
diff and previewing a proposal are the same rendering**, so the render/verify surface (the actual
value) is backend-agnostic. What produced the diff never touches what the user sees or how they
verify it.

**Two contracts, not one.** Driving a model splits in two:

- **Completion** — one structured question, code-ai supplies the context (the provider-agnostic
  `LlmClient` in `server/src/llm/`, run tools-*off*). This is what **extraction** (step 3) and
  **arrangement** (step 5) need, and what they use today; the tools-off CLI adapter is correct
  here, not a placeholder.
- **Delegation** — hand a *task* to an agent that runs *in the repo* with its own tools, MCP
  servers, and `AGENT.md`, gathering its own context. This is what the **change loop** (step 7)
  needs — a new contract beside the completion one, never a replacement for it.

**The source ladder** (the `CodeAgent` backends, best-available first):

1. **External delegation (complementary).** Drive an installed, authenticated `claude` / `codex`
   in agent mode; it explores and returns a diff. The hand-off mechanism is the one this doc
   already seeds — **`CodeMapScope` as structured scope + code-ai exposed as an MCP server** (its
   analyzer and scoped model as tools), so the external agent inherits code-ai's exact
   dependency/call graph instead of re-deriving it by grep. Near-term primary, because it matches
   the [non-goals](#near-term-non-goals): stay complementary to VS Code + an agent; no autonomous
   apply.
2. **Minimal native generator (the API-key-only floor).** No external agent present, only an API
   key or local model: the analyzer pre-scopes, a single/few-shot `LlmClient` call emits a
   plan/diff. No autonomous tool loop — weaker, but it keeps the loop working everywhere.
3. **Full native agent loop (self-sufficient).** Own intent→plan→diff→apply with code-ai's own
   tool loop — the "stand on its own" ambition. Deferred; kept open by the abstraction rather than
   committed to now.

**Carries the existing discipline.**

- **Provenance is orthogonal to backend.** External or native, output is `changePhase: 'proposed'`
  with `origin: 'llm'` (or `'user'` for asserted edges). The credibility anchor is untouched by the
  backend choice — which is exactly why the choice can stay pluggable.
- **Scoping is the edge.** Delegation is slow and costly; "send only relevant changes" + the
  focused review map are the antidote — pre-narrow deterministically, delegate only the slice.
- **Caching is where delegation diverges.** The arrangement cache keys on `sliceSignature` assuming
  determinism; agent runs are non-deterministic, so plan/diff results do not cache the way
  arrangements do. Decide this explicitly rather than inheriting the assumption.

---

## Multi-modal & surface-agnostic

The model and its API are the durable core; surfaces plug into them.

- **Input:** selection (exists), text (via agent), voice (transcribe → intent), draw/point over
  the diagram (sketch nodes/edges + brief text → structured intent).
- **Output:** the diagram (exists), LLM-generated diagrams (model → map for a not-yet-built
  feature), descriptions (Story 1/2 seed this).
- **Surfaces:** web desktop (exists), phone/tablet (touch-draw is a natural fit), an
  **immersive 3D/VR surface** (react-three-fiber → WebXR on Quest-class headsets, in the
  headset browser — no store app), and — further out — voice-first. The VR surface is
  deliberately more than a curiosity: none of the adjacent tools (editor + agent CLIs, classic
  diagram tools) have a credible spatial surface, so it is a **differentiator**, staged as its
  own parallel track in the [roadmap epic](../stories/EPIC-20260705-north-star-roadmap.md).
  None of these should require changing the model; protecting that boundary now is what makes
  them possible later — and is exactly why the VR track can run in parallel: it consumes the
  same model / lens / arrangement JSON as the 2D map.

---

## The agent as a first-class user

The map must be as legible — and as *cheap* — for an agent as for a human. An agent that burns
half its context re-deriving what code-ai already knows is the failure mode to design against.
Three commitments:

- **Agents read the model, not the repo.** For an external agent (Claude Code, codex),
  rebuilding structure by grep is the slow, token-hungry path. Expose the model as tools — the
  MCP-server idea from the [source ladder](#plan-and-diff-source-a-pluggable-backend), promoted
  from a hand-off mechanism to a first-class goal: *who calls this*, *what does this file
  expose*, *give me the slice around X*, answered in hundreds of tokens instead of thousands of
  lines of file dumps. The persistent model is, among other things, a **token-efficient
  compressed representation of the repo**, amortized across every agent session.
- **Agents draw by spec, and read drawings as structure.** An agent never paints pixels: it
  emits entities / relations / arrangement specs and the geometry engine renders — the
  [division of labor](#arrangement-organizing-the-slice) already established, restated here as
  *the drawing API for any agent*. Symmetrically, a user's sketch reaches the agent not as a
  screenshot but as structured intent — typed proposed entities/relations plus a line of text —
  so "reading a drawing" is cheap for every model, not a vision-model luxury.
- **Agents enrich the model as a side effect.** Every delegated session *discovers* facts —
  this handler serves that route, this config key gates that path — and today those discoveries
  evaporate when the session ends. Captured back into the persisted model as `origin: 'llm'`
  relations with confidence, each agent session leaves the map smarter than it found it, at zero
  marginal cost.

---

## Workspace memory: saved views and notes

Understanding is expensive to build and cheap to lose; the tool should hold it for you. Two
small primitives, both falling out of machinery the vision already has:

- A **saved view** = (lens + scope + arrangement + viewport + notes), serialized. Cheap
  precisely because the arrangement layer made "how this slice is organized" a **spec rather
  than pixels** — the same property that made it cacheable makes it bookmarkable. Name it, come
  back Monday morning, reopen it: the plan is where you left it, arranged the way you left it.
- A **note** = a user-origin annotation attached to an entity, relation, region, or view
  ("this module is legacy — extend the new one instead", "refactor blocked on #142").
  Rendered by provenance like everything else.

Two consequences worth designing for from the start:

- **A restored view is a context pack — for the human *and* the agent.** Notes are exactly the
  user-asserted knowledge no extractor can derive, so when a scoped slice is handed to an agent
  (`CodeMapScope`, the MCP tools), the view's notes ride along. Restoring your own context and
  priming an agent's context become the same operation.
- **Views reference entity ids while the code moves underneath.** Graceful degradation —
  ghost the missing, re-resolve the moved — is the [identity problem](#open-questions)
  surfacing again in the UI, one more reason the merge key is a Phase 1 design problem.

---

## The team surface

The same model, more than one person. Near term this costs nothing but discipline: saved views
and notes are already serializable artifacts, which makes them **shareable** artifacts — an
annotated review view or a sketched design passed around asynchronously, a design review where
the artifact is the live map rather than a stale whiteboard photo. Further out: shared
brainstorming — the team sketches [anchors](#user-drawings-as-anchors) over the map together,
hands them to an agent, and reviews the proposed overlay in place. Real-time multiplayer is
explicitly deferred ([non-goals](#near-term-non-goals)); the near-term duty is only to keep
views, notes, and assertions serializable and id-stable so that sharing composes later instead
of requiring a rebuild.

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
7. **The agent is a user too.** The model and its tools are designed for agent legibility and
   token economy as deliberately as the map is designed for human legibility. Agents read the
   model instead of re-deriving it, and draw via specs, never pixels.
8. **User marks are durable.** Sketched anchors, notes, pins, asserted edges — hand-made
   structure is the highest-precedence source and is never silently discarded or reorganized by
   an algorithmic or LLM pass.

---

## Transition arc

Durable phases, each shippable on its own. Read-only steps (1–6) make *understanding*
excellent; 7–8 add *acting*. The concrete story-level sequencing lives in the
[roadmap epic](../stories/EPIC-20260705-north-star-roadmap.md). Status reflects June 30, 2026.

0. **Name the north star.** This document. Reframe existing stories/README as steps toward it.
   *Largely done.*
1. **Unify the model (additive).** Shared `Entity` / `Relation` types — kind breadth, per-facet
   `origin`, `confidence`, `traits`, lazy `content`/`description` — **including the entity
   identity scheme** (the merge key everything downstream depends on). Existing
   analyzers/projections produce *into* it via adapters; nothing replaced yet. Fixes the
   type-sync drift. *Partially done (MVP M1): unified types, kinds, and the identity scheme
   landed; richer facets (per-facet `origin`, `traits`, lazy `content`) still ahead.*
2. **Persist & cache the model** per project, invalidated by the existing file watch.
   Prerequisite for amortizing LLM cost and for relations that span files.
3. **Multi-source extraction.** Turn the single analyzer into an extractor pipeline; add the LLM
   extractor (the [Story 4](../stories/STORY-20260604-provider-agnostic-llm-client.md) client). Prove
   it on **one vertical end-to-end: client ↔ server API.**
4. **Richer lenses** — relation-kind filters; implement the real **Feature focus** lens.
5. **Arrangement layer.** Formalize arrangement as a pluggable layer. The algorithmic and
   user-defined sources largely exist; add the **LLM composition director** (generalizing
   Story 2's `narrativeRank`) that emits a validated, cached arrangement spec — grouping,
   initial visibility, ordering — which a geometry engine realizes. *Core landed (MVP M2);
   empirical side-by-side signal open ([Story 5](../stories/STORY-20260605-llm-arrangement-pass.md)).*
6. **Content + description everywhere** — generalize Story 1's card to all kinds; lazy-load
   content and descriptions.
7. **The change loop (bidirectional).** Model proposed changes as `changePhase: 'proposed'`
   overlays rendered with the existing review visualization. Intent (text first) → plan/diff →
   verify on map → apply or export.
8. **Multi-modal intent.** Voice, draw-over-diagram (including
   [drawings as anchors](#user-drawings-as-anchors)), and LLM→diagram generation.
9. **Workspace memory.** Saved views + notes. Cheap once the arrangement spec exists (step 5 —
   the spec *is* the serialization unit), so it can land opportunistically earlier than its
   number suggests; it needs step 2's persistence to survive restarts.
10. **The team surface.** Shared views/notes asynchronously first; live collaboration far out.

---

## MVP

The first thin vertical through the arc, chosen to test the two claims the whole vision rests on
while deferring its most expensive and uncertain part. It validates:

1. *A richer typed model beats files + functions + calls* — proven with static analysis, low risk.
2. *An LLM can make a map more comprehensible than a geometry engine alone* — the real bet,
   isolated by spending the LLM **only on arrangement**, not extraction.

These are **two independent bets**, and the MVP ships them as **two milestones**, each shippable on
its own. M1 has no LLM at all, so it is unblocked by — and proves out the model under — the
LLM work in M2.

- **Milestone 1 — richer static model, rendered via elk** (proves bet #1; zero LLM). *Status: in
  progress — core landed.* The `Entity`/`Relation` model, the entity identity scheme, and the new
  static kinds (`class` / `method` / `variable` / `constant`) are built and rendered in the Review
  lens via elk. This is the "intermediate shippable" below, promoted to its own milestone. Owned by
  [Story 3](../stories/STORY-20260603-static-entity-relation-model.md).
- **Milestone 2 — LLM client + arrangement pass** (proves bet #2; the real bet). *Status: client
  complete & verified ([Story 4](../stories/STORY-20260604-provider-agnostic-llm-client.md));
  arrangement pass in progress — core landed & green
  ([Story 5](../stories/STORY-20260605-llm-arrangement-pass.md)), empirical side-by-side signal
  open.* Stands up `server/src/llm/` and adds the LLM arrangement pass on top of M1's model.

**Surface (both milestones):** the **Review** lens (diff / commit). Lowest-risk, highest-reuse —
the slice is already built server-side, the lens is the most developed, and shipped Story 1 already
renders richer cards. **M2 prerequisite (now met):** the arrangement pass needs an LLM client —
that client is built and verified as
[Story 4](../stories/STORY-20260604-provider-agnostic-llm-client.md) (it grew from "Story 2's
client" into its own story), so M2's first build step is done and the arrangement pass
([Story 5](../stories/STORY-20260605-llm-arrangement-pass.md)) now sits on top of it.

**Note on Story 2's fate:** Story 2 split into three parts with three fates, now mostly resolved.
Its **LLM client** became [Story 4](../stories/STORY-20260604-provider-agnostic-llm-client.md)
(*built & verified*). Its **annotation pass** (`summary`/`causalReason`) is still pending —
generalized into the M2 cards (step 6) but not yet producing text (the fields render, the producer
is unbuilt). Its **`narrativeRank` + horizontal-spine rerank** is **superseded** by the
`Arrangement` spec (regions + visibility + order + emphasis) realized in
[Story 5](../stories/STORY-20260605-llm-arrangement-pass.md); the spine-rerank was not built, and
`narrativeRank` is now a dead field on both sides, pending removal.

**Scope:**

- **Model — minimal, in-memory.** Introduce the `Entity` / `Relation` shape as the internal
  representation. **In-memory only — no durable persistence store yet** (arrangements may still
  be cached in-memory per session; that is caching, not the persistence phase). Populated from
  static analysis only.
- **New structures — static, pinned small** (resist scope creep). **M1:** `class` + `method`
  (methods carry their owning `container`), module-level / exported `variable` + `constant`, with
  in-grammar relations only (`contains` / `declares` / `imports` / `calls`). **M2 (deferred):**
  statically-detected `api-endpoint` (route registrations) and `api-call` (`fetch` / axios)
  entities. These were pulled out of M1 deliberately: rendered *unlinked* they are just two more
  floating node kinds (the interesting part is matching a call to its endpoint, which no grammar
  resolves — see below), and they are the largest net-new analyzer effort, so they land in M2 right
  where the arrangement demo needs them.
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

**Intermediate shippable = Milestone 1:** the richer static model renders (via elk) before the
arrangement pass exists — a richer diagram is value on its own; arrangement layers on top. This is
no longer just an "intermediate" — it is M1, owned by
[Story 3](../stories/STORY-20260603-static-entity-relation-model.md).

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
6. **No real-time collaboration yet.** The team surface starts as shareable serialized
   views/notes; live multiplayer editing waits until the single-user loop is proven.

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
| [static-entity-relation-model](../stories/STORY-20260603-static-entity-relation-model.md) (Story 3) | **MVP Milestone 1 — in progress, core landed.** The `Entity`/`Relation` model, the entity identity / merge-key scheme, and the new static kinds (`class`/`method`/`variable`/`constant`), rendered via elk. Proves bet #1; zero LLM. The concrete first build step. |
| [provider-agnostic-llm-client](../stories/STORY-20260604-provider-agnostic-llm-client.md) (Story 4) | **MVP Milestone 2 — the LLM client (built & verified).** Stage 1 OpenAI-compatible HTTP + Stage 2 `claude`/`codex` CLI-subscription adapters behind one `LlmClient`, `CODEAI_LLM_*`-configured, opt-in and fail-safe. The completion-contract foundation under both arrangement and (future) LLM extraction. |
| [llm-arrangement-pass](../stories/STORY-20260605-llm-arrangement-pass.md) (Story 5) | **MVP Milestone 2 — the arrangement pass (in progress, core landed).** The LLM composition director (step 5): on-demand visibility + emphasis + editorial region bands over the review slice, validated and cached, elk as the always-on fallback. Graduates Story 2's `narrativeRank` to a full `Arrangement` spec; empirical side-by-side signal still open. |
| [llm-review-annotation](../stories/STORY-20260602-llm-review-annotation.md) (Story 2) | **Split three ways (see [MVP](#mvp)).** Its **LLM client** became [Story 4](../stories/STORY-20260604-provider-agnostic-llm-client.md) (built & verified); its **annotation pass** is still pending (generalized into M2 cards, step 6); its **`narrativeRank`/spine-rerank is superseded** by the arrangement layer ([Story 5](../stories/STORY-20260605-llm-arrangement-pass.md)) and not built as written. |
| [review-card-declutter](../stories/STORY-20260602-review-card-declutter.md) (Story 1) | **Shipped.** Per-item content + description UI — the seed of step 6. |

---

## Open questions

1. **Self-sufficient vs. complementary** change loop — **reframed, no longer a binary pick:** a
   pluggable plan/diff source behind one agent interface, complementary-first (see
   [Plan and diff source](#plan-and-diff-source-a-pluggable-backend)). Still open: *when* (if ever)
   to build the self-sufficient backend, and the cache story for non-deterministic agent runs.
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
9. **User-asserted & learned cross-boundary connections.** The hard edges — `consumes`
   (client↔server), GraphQL operation→resolver, socket.io `emit`→listener — span frameworks,
   languages, and dynamic values (templated URLs, base paths, event-name strings), so no single
   grammar resolves them and even static heuristics become per-pairing whack-a-mole. Beyond the
   `llm`-inferred edge (step 3), a strong answer is **`origin: 'user'`**: the user asserts the
   non-obvious edge once (a trusted, no-confidence-discount link), and those assertions become
   **generalization signal** — either a learned static pattern ("in *this* repo, `api.get(x)` from
   `client/api.ts` maps to `server/routes/*`") or **LLM memory** (assertions as project-convention
   few-shot the extractor consults). This turns "match any client to any server" (intractable) into
   "the user resolves the few non-obvious ones, the system generalizes the rest," and it fits both
   provenance honesty (user edges trusted, learned edges confidence-scored) and the change-loop's
   `intent` concept. Not MVP; the long-term answer to the connection problem. Open: where assertions
   are stored, how they generalize (static rule vs LLM memory), and how a learned edge's confidence
   is surfaced.
10. **Anchor strength.** When generation runs against
    [user-drawn anchors](#user-drawings-as-anchors), what binds hard (names, boundaries,
    presence) versus soft (placement, inspiration) — and how does the agent surface ambiguity
    as a clarifying question instead of silently guessing?
11. **Saved views against a moving model.** A view references entity ids while the code changes
    underneath. What degrades gracefully (ghost the missing, re-resolve the moved, flag the
    stale note) — and does a note follow its entity across a rename? Identity (#4) again, now
    user-visible.
