# Story 50 — Explore diagrams as real spatial nodes and edges

**Status:** In progress · **Type:** Frontend-only · **Depends on:**
[Story 46](STORY-20260905-vr-workspace-panels.md), [Story 49](STORY-20260905-vr-review-and-annotations.md).

**Vision slice:** the first release of the [immersive workspace epic](EPIC-20260905-immersive-workspace.md)
and [Mermaid across 2D and 3D](../docs/multi-project-session-environment.md#mermaid-across-2d-and-3d).
This derived diagram graph does not claim to be the persistent software model in reserved roadmap
Story 12; that renderer can later consume model/lens/arrangement records through the same shell.

## Motivation

The user wants both movable work panels and real 3D diagrams in the first useful release. A flat SVG
on a plane has spatial placement but does not let the user select and explore nodes and edges in depth.

## Current behavior (where the code is)

- [spatialDiagramModel.ts:119](../src/features/diagram/spatial/spatialDiagramModel.ts#L119) copies the
  official Mermaid flowchart database into a bounded disposable graph; its paging and deterministic
  placement start at [line 211](../src/features/diagram/spatial/spatialDiagramModel.ts#L211).
- [SpatialDiagram.tsx:30](../src/features/shell/immersive/SpatialDiagram.tsx#L30) renders individually
  selectable nodes, edges, labels, and groups with depth and controller tools.
- [CanvasReviewTools.tsx:392](../src/features/shell/immersive/CanvasReviewTools.tsx#L392) switches the
  immutable artifact between spatial geometry and its existing marked 2D projection. Unsupported
  content keeps that complete projection and receives a visible reason at
  [line 411](../src/features/shell/immersive/CanvasReviewTools.tsx#L411).
- [mermaidRenderer.ts:68](../src/features/diagram/mermaid/mermaidRenderer.ts#L68) serializes parser
  database reads with SVG rendering because Mermaid owns process-global mutable state.

## Desired behavior

1. Derive a disposable graph from policy-accepted Mermaid flowcharts: explicit node IDs, plain
   labels, directed labelled edges, and subgraph groups. Specify the exact parser-supported syntax
   and fixtures before implementation; never use regex guesses that silently omit graph content.
   Unsupported syntax/types retain a labelled 2D artifact panel within VR.
2. Render nodes, edges, labels, and groups as individually addressable world-space objects with
   actual depth. A deterministic initial layout uses depth for groups/layers, keeps labels readable,
   and requires neither walking nor floating an entire graph behind the viewer.
3. Controller actions select/focus a node or edge, show its full label and connected neighborhood,
   expand/collapse a group, rotate/scale the diagram as a whole, and reset. Keep diagram manipulation
   distinct from moving its enclosing view and from Story 49's annotation mode.
4. Stable selection keys combine immutable artifact identity with explicit Mermaid element identity.
   A new revision is a new artifact: do not claim selections or code anchors survive arbitrary edits.
   Parsed diagram nodes are not asserted to be code entities or proven static facts.
5. Let the user switch the same artifact between spatial geometry and its canonical 2D projection
   while staying in VR, keeping conversation/diff tools in place. Show existing marks and create
   corrections on the 2D projection; do not discard them or pretend they have 3D anchors.
6. Bound visible geometry/text across the scene. Initial acceptance fixtures include a readable
   30-node/45-edge grouped graph and a 100-node/150-edge graph using explicit collapse/detail controls.
   Display omitted/collapsed counts and keep all content reachable. Update final caps from Quest 3S
   measurements; over-budget content falls back honestly instead of dropping entities silently.

## Supported spatial subset

The spatial projection consumes Mermaid 11's parsed flowchart database; it does not re-parse source
text. It accepts `flowchart` and `graph` diagrams in `TB`, `TD`, `BT`, `LR`, or `RL` direction with:

- explicit node identifiers and plain text labels using rectangle, circle, ellipse, or diamond
  shapes;
- solid, directed `-->` edges, with optional plain text labels and Mermaid's stable parsed edge ID;
- non-nested `subgraph` groups whose plain title and member IDs are available from the parser.

Markdown labels, links/callbacks, images/icons, animation, styled/dotted/invisible/open, self-loop,
parallel, or bidirectional edges, nested/overlapping groups, missing endpoints, duplicate element IDs, and other Mermaid diagram
types retain the complete canonical 2D projection with an explanation. Spatial graphs are capped at
100 nodes, 150 edges, and 20 groups. A detail page exposes at most 30 nodes and 45 edges; pages are
built from complete parsed edges so every accepted node and edge is reachable and hidden totals are
shown. These are implementation limits pending Story 51's Quest 3S measurements, not final device
claims.

## Acceptance criteria

- [x] Supported flowcharts contain selectable 3D nodes, edges, and groups with visible depth, while
  conversation and review panels remain usable in the same immersive session.
- [x] Every supported source node/edge appears or is explicitly counted in a reachable collapsed
  group; unsupported syntax preserves the complete 2D artifact with an explanation.
- [x] Controllers select, inspect, focus, expand/collapse, scale/rotate, and reset without accidental
  panel movement; all primary actions have visible labels.
- [x] Geometry/2D switching preserves the canonical Mermaid, marks, and artifact identity and does
  not restart XR; revisions do not acquire invented persistent element identity.
- [ ] The 30/45 and 100/150 fixtures pass Quest 3S readability and aggregate frame/resource checks
  with the chosen visibility limits recorded; no inference is made from a Quest 3-only run.
- [x] `npm run lint`, `npm test`, `npm run build`, and `npm run test:e2e` pass, including parser
  coverage, unsupported fallback, stable selection within an artifact, and resource disposal.

## Out of scope

Every Mermaid grammar, editing source by dragging a node, code-entity provenance, model lenses,
change overlays, cross-revision graph identity, and free-floating 3D annotations. These need their
own model/parser contracts; none blocks the supported real-3D subset required here.

## How to verify

1. Compare canonical source against the derived graph for every supported fixture, malformed source,
   unsupported Mermaid types, labels needing escaping, and graph limits. Assert no silent omissions.
2. In the headset, explore both sized fixtures beside the live conversation and diff, inspect a
   node/edge/group, switch to 2D to annotate, and return to 3D without losing the work context.
3. Stream new artifacts, replace the selection, collapse/expand repeatedly, and exit/re-enter.
   Record readable sizing, geometry/text counts, frame distribution, and resource return to baseline;
   run the four repository checks.

## Verification record

Automated implementation verified September 19, 2026:

- `npm run lint` passed.
- `npm test` passed: 65 files, 410 tests. Parser-database extraction, complete fallback, stable
  artifact-scoped keys, collapse counts, deterministic placement, and 100/150 paging are covered in
  [spatialDiagramModel.test.ts](../test/spatialDiagramModel.test.ts).
- `npm run build` passed as part of the production E2E command.
- `npm run test:e2e` passed: 73 Chrome tests. The real Mermaid/browser path selects nodes, edges,
  and groups; focuses neighborhoods; rotates, collapses/expands, resets, switches projections,
  retains selection, explains unsupported sequence syntax, returns resources, and exercises the
  parser-backed 30/45 and 100/150 fixtures at
  [immersive.spec.ts:1802](../e2e/immersive.spec.ts#L1802) and
  [immersive.spec.ts:1871](../e2e/immersive.spec.ts#L1871).

Quest 3S readability, controller comfort, frame distribution, and the final measured visibility
limits remain pending. The browser resource assertion only proves the implementation cap and does
not substitute for that physical acceptance.
