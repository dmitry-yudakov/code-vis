# Code Map Layout Strategies

**Created:** May 20, 2026  
**Status:** In Progress - first implementation slice complete

## Overview

This story proposes a dedicated layout system for code maps.

The current graph views use a mix of generic Dagre layout and hand-placed columns. That is workable for simple dependency graphs, but code diagrams need placement to carry meaning: changed code should feel central in review, callers and callees should occupy predictable directions, modules should read as architectural regions, and declarations from the same file should stay visually related.

The goal is not only prettier graphs. The goal is to make graph position encode code semantics so users can understand a codebase faster.

## Implementation Update - May 20, 2026

The first implementation slice is complete in the web app.

Implemented:

1. Added `web/src/graphLayout/` with shared layout types, stable sorting, Dagre fallback, and semantic strategies for overview, review files, review declarations, file maps, and logic maps.
2. Migrated `IncludesHierarchy`, `FilesMapping`, and `LogicMap` to call `layoutCodeGraph()` instead of calling `applyGraphLayout()` or computing layout inline.
3. Added `Reset layout` controls to the workbench, file map, and logic map.
4. Preserved manual node movement across refreshes while resetting computed placement when the projection key changes or the user clicks `Reset layout`.
5. Added initial review-file lanes: changed files in the center, importers on the left, imports on the right, and related tests below the central lane.
6. Added initial review-declaration lanes: changed and bridge declarations in the center, callers on the left, and callees on the right.
7. Moved file-map lane computation into `fileMapLayout.ts` and made it container-aware instead of based directly on `window.innerWidth`.
8. Grouped logic-map declarations by file and source order, with call rank influencing horizontal placement.
9. Added density-aware edge labels and selected-node edge emphasis in the workbench.
10. Added unit tests for deterministic sorting, review-file lane direction, and logic-map grouping/ranking.
11. Fixed the web test environment by adding `jsdom` and updating the jest-dom setup import.
12. Improved review-declaration layout so bridge declarations are ordered between the changed declarations they connect, with focused tests for caller/callee lanes and bridge placement.
13. Anchored review-declaration side lanes to center-lane file bands so same-file callers and callees stay near their changed or bridge declaration group.
14. Improved overview expansion layout so expanded module files form a central local region with context lanes, and expanded file declarations sit next to their parent file in source order.
15. Passed overview dependency counts into layout edge weights and used those weights when placing mixed expanded-scope context.
16. Added subtle non-interactive background bands for expanded overview modules and expanded file declaration regions.
17. Added density-aware call edge labels and selected-neighborhood edge emphasis to file maps and logic maps.
18. Tuned logic-map spacing for editor-backed declaration nodes by estimating declaration height from source lines and capping expanded editor height.
19. Added layout-layer regression tests for invalid-edge filtering and preserving previous positions.

Verification:

1. `cd web && yarn test --run` passes.
2. `cd web && yarn lint` passes.
3. `cd web && yarn build` passes.

Known implementation limitation:

1. The dev server was not left running because sandbox approval to bind the local Vite port was declined.
2. `applyGraphLayout()` still exists in `web/src/utils.ts` for compatibility, but the migrated graph surfaces no longer call it.
3. React Flow rendered node dimensions are still estimated; real measured dimensions remain future work.

## Problem

The product now has richer code-map lenses, especially `Overview` and `Review current changes`, but graph placement is still mostly generic.

Current issues:

1. The same layout approach is used for very different questions: architecture overview, change review, declaration calls, and file-local maps.
2. Nodes are placed by graph topology more than by code meaning.
3. Changed nodes, context nodes, bridge nodes, and tests are visually styled differently, but they are not spatially organized by role.
4. Declarations from the same file can be scattered when call edges dominate the layout.
5. Full-project and dense file graphs become hard to scan because edge labels and node positions compete for attention.
6. React Flow node dimensions are approximated with fixed values, so layout spacing does not always match the rendered UI.
7. Manual node movement is preserved only in a limited way, and there is no explicit layout reset or layout mode control.

## Goals

1. Introduce a layout abstraction that understands code-map semantics.
2. Use separate layout strategies for overview, review, declaration, and file-local maps.
3. Make review graphs seed-centered and directionally meaningful.
4. Keep related declarations and files grouped by source file or directory where useful.
5. Improve readability by reducing edge clutter and showing labels selectively.
6. Preserve stable placement across refreshes when the visible scope has not materially changed.
7. Keep React Flow as the rendering layer while making the layout engine swappable.
8. Allow Dagre to remain as a fallback while evaluating `elkjs` for compound and layered layouts.

## Non-Goals

1. Do not replace React Flow as part of this story.
2. Do not redesign the analyzer or change `FunctionCallInfo.name` semantics.
3. Do not attempt perfect semantic call resolution before improving layout.
4. Do not remove manual node dragging.
5. Do not require a server-side layout service in the first version.
6. Do not make large visual redesigns unrelated to graph readability.

---

## Original State Before This Story

### Shared Dagre Helper

`web/src/utils.ts` exposes `applyGraphLayout()`.

Current behavior:

1. Builds a Dagre directed graph.
2. Uses fixed node width and height inputs.
3. Defaults to top-to-bottom layout.
4. Uses `ranker: 'longest-path'`.
5. Uses very tight `nodesep` and `ranksep` values.
6. Returns positions through a callback.

This helper knows nothing about node kind, file, directory, source order, changed status, test status, bridge role, or edge kind.

### Homepage Workbench

`IncludesHierarchy` builds several graph projections:

1. Overview module/file graph.
2. Overview file declaration expansion.
3. Review file graph.
4. Review declaration graph.

Most of these projections eventually pass through `applyGraphLayout()`, with only minor differences such as left-to-right direction for declaration review.

### File Map

`FilesMapping` uses a hard-coded three-column structure:

1. Referencing files on the left.
2. Selected file in the center.
3. Imported files on the right.

This is directionally useful, but it depends on `window.innerWidth`, fixed offsets, and simple index-based vertical spacing.

### Logic Map

`LogicMap` lays out declarations left-to-right using Dagre, but it does not preserve source order or group declarations by file beyond what the graph topology happens to produce.

---

## Layout Principles

### Placement Should Explain The Scope

The layout should answer the same question as the active lens.

Examples:

1. Review: what changed, what touches it, what does it touch, and what bridges the changes?
2. Overview: what are the major modules, and how do they depend on each other?
3. Declaration map: what calls what, and where do those declarations live?
4. File map: what imports this file, and what does this file import?

### Semantic Roles Beat Raw Topology

Graph topology matters, but code-map role should win when they conflict.

Examples:

1. Changed nodes should remain central in review even if many edges pull them outward.
2. Tests should occupy a consistent region, usually below or to the side.
3. Bridge nodes should sit between changed clusters when they explain a path.
4. Files or declarations from the same source file should remain visually near each other.

### Stable Layout Matters

Users build a mental map while exploring. Layout should not jump unnecessarily.

Rules:

1. Preserve manual positions when the projection key is unchanged.
2. Recompute layout when lens, mode, granularity, expanded module, or expanded file changes.
3. Add a visible `Reset layout` action for returning to computed placement.
4. Prefer deterministic sorting by file path, directory, source line, and role.

### Edges Should Be Useful, Not Exhaustive Noise

Dense graphs should not render every edge label at full emphasis.

Rules:

1. Show edge labels on hover, selection, or low-density graphs.
2. Bundle or summarize repeated module/file edges when possible.
3. De-emphasize context edges until the user selects a node.
4. Highlight the selected node's immediate incoming and outgoing neighborhood.

---

## Proposed Architecture

Create a graph layout module under `web/src/graphLayout/`.

Proposed files:

```text
web/src/graphLayout/
  index.ts
  types.ts
  dagreLayout.ts
  reviewLayout.ts
  overviewLayout.ts
  declarationLayout.ts
  fileMapLayout.ts
  stableSort.ts
  graphLayout.test.ts
```

`IncludesHierarchy`, `FilesMapping`, and `LogicMap` should call the new layout layer instead of directly calling `applyGraphLayout()` or hand-computing positions.

Current implementation also includes `overviewLayout.ts`.

### Core Types

```typescript
export type CodeLayoutNodeKind =
  | 'module'
  | 'directory'
  | 'file'
  | 'test'
  | 'declaration';

export type CodeLayoutNodeRole =
  | 'seed'
  | 'changed'
  | 'context'
  | 'bridge'
  | 'test'
  | 'expanded'
  | 'overview';

export type CodeLayoutEdgeKind =
  | 'imports'
  | 'imported-by'
  | 'calls'
  | 'called-by'
  | 'declares'
  | 'contains'
  | 'bridge'
  | 'heuristic';

export type CodeLayoutStrategy =
  | 'overview'
  | 'review-files'
  | 'review-declarations'
  | 'file-map'
  | 'logic-map'
  | 'fallback';

export interface CodeLayoutNode {
  id: string;
  label: string;
  kind: CodeLayoutNodeKind;
  role: CodeLayoutNodeRole;
  filename?: string;
  directory?: string;
  startLine?: number;
  endLine?: number;
  width?: number;
  height?: number;
  sortKey?: string;
  pinned?: boolean;
}

export interface CodeLayoutEdge {
  id: string;
  source: string;
  target: string;
  kind: CodeLayoutEdgeKind;
  label?: string;
  weight?: number;
  isHeuristic?: boolean;
}

export interface CodeLayoutResult {
  positions: Record<string, { x: number; y: number }>;
  bounds?: {
    width: number;
    height: number;
  };
}
```

### Layout Entry Point

```typescript
export function layoutCodeGraph(input: {
  strategy: CodeLayoutStrategy;
  nodes: CodeLayoutNode[];
  edges: CodeLayoutEdge[];
  previousPositions?: Record<string, { x: number; y: number }>;
  preservePrevious?: boolean;
  viewport?: { width: number; height: number };
}): CodeLayoutResult;
```

The entry point should:

1. Validate that all edges refer to visible nodes.
2. Fill missing dimensions with strategy-specific defaults.
3. Apply deterministic sort keys.
4. Dispatch to the selected strategy.
5. Return positions only; rendering remains in the existing components.

---

## Strategy Details

### Overview Layout

Purpose: show project architecture without exploding into every file.

Initial behavior:

1. Modules/directories are primary nodes.
2. Edge weight reflects dependency count when available.
3. Stronger dependency edges may influence placement more than weak edges.
4. Expanded module files appear in a local region near the module they came from.
5. Expanded file declarations appear near the expanded file, ordered by source line.

Layout shape:

1. Default to layered top-to-bottom or left-to-right depending on graph aspect ratio.
2. Keep sibling directories sorted alphabetically.
3. Keep files inside an expanded directory sorted by path.
4. Keep declarations inside an expanded file sorted by `startLine`.

Future enhancement:

1. Use compound groups when using an engine that supports them.
2. Draw a subtle region or background band for expanded modules/files.

### Review File Layout

Purpose: make a change set readable as an investigation map.

Lanes:

```text
importers / callers     changed seeds     imports / callees
        related tests below or side-aligned
        bridge/context nodes between changed clusters
```

Initial behavior:

1. Changed files are placed in the central lane.
2. Files that import changed files are placed to the left.
3. Files imported by changed files are placed to the right.
4. Related tests are placed below the changed file they relate to when possible.
5. Files with both incoming and outgoing context roles are placed near the changed node with the strongest relation.
6. Deleted files remain central as lightweight ghost nodes.
7. Multiple changed files are grouped by directory and then sorted by path.

Placement rules:

1. Horizontal lane is determined by role.
2. Vertical order is deterministic: directory, changed status, file path.
3. Context nodes with `via` metadata should align near the seed they reference.
4. Dense context should be vertically compacted into readable columns with sufficient row gaps.

### Review Declaration Layout

Purpose: explain changed functions/methods plus direct callers, callees, and bridges.

Lanes:

```text
called-by context     changed declarations     calls context
                  bridge declarations between changed declarations
```

Initial behavior:

1. Changed declarations are central.
2. Direct callers are left of the changed declaration.
3. Direct callees are right of the changed declaration.
4. Bridge declarations are placed between changed declarations when they explain a path.
5. Declarations from the same file stay vertically near each other.
6. Within a file group, declarations sort by source line.

Important rule:

If file/source grouping and call topology conflict, source grouping should be preserved enough that users can still understand which file owns the declaration.

### File Map Layout

Purpose: inspect one file and its immediate file-level neighborhood.

Lanes:

```text
files importing selected file     selected file     files selected file imports
```

Initial behavior:

1. Selected file is fixed in the center lane.
2. Importers are left lane.
3. Imports are right lane.
4. Related files are sorted by directory and path.
5. If a related file is not loaded, show the hidden/placeholder node in the same lane.
6. Column widths should be based on container size, not `window.innerWidth`.

### Logic Map Layout

Purpose: inspect declarations and call connections inside a scoped set of files.

Initial behavior:

1. Default to left-to-right call flow.
2. Group declarations by file.
3. Sort declarations by source line within each file.
4. Use call edges to influence horizontal placement inside the group constraints.
5. Preserve enough spacing for larger editor-backed declaration nodes.

---

## Engine Direction

### Phase 1 Engine

Keep Dagre as the fallback engine while building the semantic layout layer.

This keeps the first implementation low risk:

1. Existing behavior can be preserved for graphs not yet migrated.
2. Strategy code can be introduced incrementally.
3. Tests can focus on deterministic lane assignment and ordering.

### Candidate Phase 2 Engine: `elkjs`

Evaluate `elkjs` for layouts that need:

1. Compound/grouped nodes.
2. Better layered layout spacing.
3. Orthogonal or cleaner edge routing.
4. Ports or side-specific edges.
5. More control over edge/node separation.

`elkjs` should be adopted only if it materially improves readability for real project graphs.

### `elkjs` Documentation Notes

Checked against the current Context7 entry for `/kieler/elkjs` on May 20, 2026.

Relevant implementation details:

1. `elkjs` is a layout engine, not a renderer. It computes node coordinates and edge sections that can be rendered by React Flow.
2. Usage is asynchronous: create an `ELK` instance and call `elk.layout(graph)`, which returns a `Promise` resolving to the laid-out graph.
3. Graph input uses ELK JSON:
   1. Root graph object with `id`.
   2. Nodes under `children`.
   3. Edges under `edges`.
   4. Edges use `sources: string[]` and `targets: string[]`.
   5. Nodes need explicit `width` and `height`.
4. Layout options can be supplied on the constructor, the `layout()` call, or individual graph elements. Element-level options take precedence.
5. Prefer full option keys such as `elk.algorithm` and `elk.direction` instead of unprefixed suffixes.
6. Layered layout uses options such as:
   1. `elk.algorithm: 'layered'`.
   2. `elk.direction: 'RIGHT'` or `elk.direction: 'DOWN'`.
   3. `elk.spacing.nodeNode`.
   4. `org.eclipse.elk.layered.spacing.nodeNodeBetweenLayers`.
7. Hierarchical graphs can be represented with nested `children`; `elk.hierarchyHandling: 'INCLUDE_CHILDREN'` is relevant for module/file/declaration grouping.
8. Ports are supported and can be constrained with options such as `elk.portConstraints: 'FIXED_SIDE'`. This may be useful later for left/right caller/callee edges, but it is not required for the first adapter.
9. Web Worker support is available through `workerUrl` and should be considered if layout work blocks the UI.

---

## UI Behavior

### Layout Controls

Add lightweight controls near the graph canvas:

1. `Reset layout` - recompute positions from the active strategy.
2. `Fit view` - fit visible graph without recomputing positions.
3. Optional future mode selector: `Semantic`, `Compact`, `Flow`.

The first version only needs `Reset layout`.

### Selection Emphasis

When a node is selected:

1. Selected node is visually prominent.
2. Direct incoming and outgoing edges are emphasized.
3. Unrelated edges are muted.
4. Related nodes retain normal opacity.
5. Unrelated context can be dimmed in dense graphs.

### Edge Labels

Edge labels should be density-aware:

1. Show labels normally for small graphs.
2. Hide or shorten labels for dense graphs.
3. Show full edge information in hover/selection details.
4. Keep reason metadata in the details panel as the authoritative explanation.

---

## Implementation Plan

### Phase 1: Extract Layout Layer

Status: Done.

1. Create `web/src/graphLayout/`.
2. Add shared layout input/output types.
3. Move Dagre wrapping into `dagreLayout.ts`.
4. Keep existing behavior available as `fallback`.
5. Add unit tests for deterministic sorting and fallback positioning.

Acceptance:

1. `IncludesHierarchy`, `FilesMapping`, and `LogicMap` can still render with unchanged behavior.
2. Existing build and tests pass.

Notes:

1. The new layer is implemented behind `layoutCodeGraph()`.
2. Dagre remains available as `fallback`.
3. The migrated components now call the layout layer directly.
4. Build, lint, and tests pass.

### Phase 2: Review File Semantic Layout

Status: Mostly done, needs visual tuning against real projects.

1. Map focused review file metadata to layout roles.
2. Implement lane assignment for changed, importer, imported, test, deleted, and mixed-context nodes.
3. Sort nodes deterministically inside lanes.
4. Add `Reset layout`.
5. Preserve manual placements until the projection changes or reset is clicked.

Acceptance:

1. Changed files appear centrally in review file mode.
2. Importers and imported files occupy predictable sides.
3. Related tests occupy a consistent secondary region.
4. Re-rendering the same review scope does not reshuffle nodes.

Remaining:

1. Align context nodes more precisely to the strongest related changed seed.
2. Tune vertical compaction for dense review scopes.
3. Confirm deleted-file ghost nodes visually in a real deleted-file review.

### Phase 3: Review Declaration Semantic Layout

Status: Partial - semantic lanes, bridge placement, and file-band anchoring improved.

1. Map declaration reasons to caller, callee, changed, bridge, and context roles.
2. Group declarations by file.
3. Sort declarations by source line within file groups.
4. Place bridge declarations between changed declarations when bridge metadata exists.

Acceptance:

1. Changed declarations are central.
2. Direct callers and callees are placed directionally.
3. Bridge declarations are visibly between changed declarations or changed clusters.
4. Declarations from the same file are not scattered randomly.

Remaining:

1. Visually tune bridge and file-band placement against real multi-file review graphs.

### Phase 4: Overview And Expansion Layout

Status: Mostly done - expanded local regions, edge weights, and background bands improved.

1. Use weighted module edges in overview.
2. Keep expanded module files near their parent module.
3. Keep expanded file declarations near the expanded file and sorted by source line.
4. Reduce full label noise for dense overview graphs.

Acceptance:

1. Module overview remains readable for medium-size projects.
2. Expanding a module or file creates a predictable local region.
3. Collapsing returns to a stable module graph.

Remaining:

1. Visually tune expanded regions against real medium-size projects.

### Phase 5: File Map And Logic Map Cleanup

Status: Mostly done - edge label density and editor-backed spacing improved.

1. Replace `window.innerWidth`-based file map columns with container-aware layout.
2. Move file map lane computation into `fileMapLayout.ts`.
3. Group logic-map declarations by file and source order.
4. Add density-aware edge label behavior where useful.

Acceptance:

1. File maps are readable across desktop viewport sizes.
2. The selected file remains centered.
3. Logic maps preserve source ownership better than the current generic Dagre layout.

Remaining:

1. Visually test file maps across narrow and wide desktop sizes.

### Phase 6: Evaluate `elkjs`

Status: Not started.

1. Add a small adapter behind the same layout interface.
2. Test with real overview and declaration graphs.
3. Compare readability, performance, bundle impact, and implementation complexity.
4. Keep or remove based on results.

Acceptance:

1. A decision is recorded in this story or follow-up docs.
2. If adopted, Dagre remains available as fallback until confidence is high.

---

## Testing

Current automated coverage:

1. Deterministic sorting by file and source line.
2. Review-file lane direction for importer/imported context.
3. Overview expansion placement for module-file regions, file declarations, and weighted context direction.
4. Logic-map grouping by file with call-rank horizontal movement.

Current manual/build coverage:

1. `yarn test --run`.
2. `yarn lint`.
3. `yarn build`.

### Unit Tests

Add tests for:

1. Lane assignment for review file graphs. Done for basic importer/imported direction.
2. Lane assignment for review declaration graphs. Done for basic caller/callee direction.
3. Deterministic sorting by role, directory, path, and source line. Partial, with review-declaration file-band anchoring covered.
4. Filtering invalid edges from layout input. Done.
5. Preservation of previous positions when `preservePrevious` is enabled. Done.

### Visual/Interaction Checks

Manual or Playwright checks should cover:

1. Overview module graph.
2. Overview expanded directory.
3. Overview expanded file declarations.
4. Review files with changed-only and context modes.
5. Review declarations with bridges.
6. Related tests enabled and disabled.
7. File map at narrow and wide desktop sizes.
8. Logic map with multiple files.

### Performance Checks

Measure:

1. Layout time for small, medium, and large visible graphs.
2. Re-layout frequency during common interactions.
3. Whether layout work causes visible UI stalls.

If large graph layout becomes expensive, defer layout execution with idle callbacks or add a worker in a later story.

---

## Acceptance Criteria

1. Layout code is separated from graph rendering components. Done.
2. Review file mode places changed code centrally with context in predictable lanes. Done for initial lanes; tuning remains.
3. Review declaration mode preserves changed/context/bridge semantics spatially. Partial.
4. File and declaration grouping reduces scattering. Partial.
5. Re-rendering the same graph scope is stable. Done for migrated graph surfaces.
6. Users can reset computed layout after dragging nodes. Done.
7. Dense graphs show less edge-label noise than today. Done in the workbench; other graph surfaces remain.
8. Existing graph functionality remains available. Build and tests pass.
9. Docs mention the new layout layer after implementation. This story is updated; broader docs remain.

## Risks

1. Semantic layout may feel too rigid for unusual graphs.
2. Grouping by file can conflict with pure call-flow readability.
3. `elkjs` may add complexity or bundle weight without enough benefit.
4. Measuring real node sizes can introduce render/layout timing complexity.
5. Dense graphs may still need filtering/projection improvements beyond layout.

## Open Questions

1. Should layout preferences be stored per project config?
2. Should users be able to pin individual nodes across projection changes?
3. Should selected-node neighborhood highlighting expand from edges to unrelated node dimming?
4. What graph size should trigger compact labels or label-on-hover behavior beyond the initial workbench threshold?
5. Should edge bundling be implemented before or after `elkjs` evaluation?
6. Should the layout layer eventually measure rendered React Flow node dimensions, or should components continue to provide conservative estimates?
