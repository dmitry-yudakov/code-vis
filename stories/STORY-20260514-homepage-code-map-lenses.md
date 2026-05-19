# Homepage Code Map Lenses

**Created:** May 14, 2026  
**Status:** Implemented (Phases 1-4 baseline)
**Updated:** May 19, 2026

## Overview

This story proposes replacing the homepage's file-hierarchy-first experience with a task-oriented code map.

The current homepage makes the project structure visible, but large projects quickly become too dense to understand. A directory tree is still useful as navigation, but it should not be the primary answer to "what is going on in this codebase?"

The homepage should instead start with lenses that show the right slice of the project for the user's current goal:

1. Understand the larger architecture.
2. Review current changes or a pull request.
3. Explore a feature or workflow.
4. Investigate the impact of a file or function.

The first high-value lens should be review-focused: changed code appears prominently, with its place in the codebase and the related files/functions around it.

## Implementation Snapshot (May 14, 2026)

Implemented in the web client homepage workbench (`IncludesHierarchy`) with updated homepage styling, focused review server projections, and docs.

Delivered:

1. Homepage now opens to a code map workbench with:
   1. Top bar for context.
   2. Left panel for lens and scope controls.
   3. Central graph canvas.
   4. Right panel for node details.
   5. Lower summary panel for lens-specific context.
2. Lens shell is visible and task-oriented:
   1. `Overview` and `Review current changes` are active.
   2. `Feature focus` and `Impact investigation` are shown as `Coming soon`.
3. Default homepage no longer starts with full file hierarchy:
   1. `Overview` defaults to module/directory scale.
   2. Full file hierarchy remains available via `Overview -> All files`.
   3. Overview can expand a selected file into analyzer-visible declarations.
4. Review lens is integrated as first-class homepage mode:
   1. Uses `Diff` and `Branch / PR` scopes.
   2. Supports `Changed only` and `+ Context`.
   3. Keeps loading, empty, and error states.
5. Explainability is surfaced in UI:
   1. Changed/context styling remains distinct.
   2. Node details show explicit inclusion reasons.
6. Initial declaration-level review focus is available:
   1. Git diff hunks are parsed into changed line ranges.
   2. Changed hunks are mapped to analyzer-visible function/method/arrow declaration ranges.
   3. Review mode can switch between `Files` and `Declarations`.
   4. Declaration context includes direct caller/callee relationships with heuristic reason labels.
   5. Short directed bridge paths between changed declarations are included when the path is explainable.
7. Review test context is available:
   1. Review requests accept an `includeTests` option, defaulting to enabled.
   2. Related test files are detected from import edges and common test filename conventions.
   3. Test files carry `isTest` metadata and explicit `related-test` reasons.
   4. The review workbench exposes a `Related tests` control and styles test nodes/chips distinctly.

Not yet delivered in this story:

1. Passing focused scopes into edit/agent commands.

## Problem

The existing file hierarchy view is accurate but not explanatory.

For small projects, showing the full file tree can be enough. For large projects, it creates several problems:

1. The homepage is visually dominated by project size instead of project meaning.
2. Users must already know where to look before the tool helps them.
3. Important relationships between changed functions are hidden inside unrelated structure.
4. Review workflows require users to mentally combine git diff, file location, imports, and call relationships.
5. Future AI-assisted changes need a focused working context, not the whole project at once.

The homepage should help users choose and understand a meaningful scope.

## Goals

1. Replace the default homepage graph with a task-oriented code map experience.
2. Keep the full file hierarchy available as navigation, but not as the default main view.
3. Introduce top-level lenses for different investigation modes.
4. Make the review/change lens the first concrete implementation target.
5. Show changed code together with its architectural location and relevant relationships.
6. Keep every visible node explainable with a reason for why it is shown.
7. Lay groundwork for future editing and AI-agent workflows.

## Non-Goals

1. Do not remove existing full-project and file-hierarchy views.
2. Do not require GitHub API integration for the first version.
3. Do not attempt complete semantic impact analysis in the first release.
4. Do not make AI-driven code editing part of this story.
5. Do not redesign the analyzer around type-checker precision before a useful graph lens exists.

---

## Proposed Experience

### Homepage Structure

The homepage should open to a code map workbench:

1. A top bar for project context and active lens selection.
2. A left panel for lenses, saved scopes, or lightweight navigation.
3. A central graph showing the selected scope.
4. A right panel showing details for the selected node.
5. A lower or side summary for changed items, related paths, and warnings when relevant.

The first screen should answer:

> What part of the codebase are you trying to understand right now?

### Primary Lenses

#### Project Overview

Shows the larger picture of the project without exploding immediately into every file.

Initial shape:

1. Modules, folders, or packages as high-level nodes.
2. Dependency strength between modules.
3. Expand a module into files.
4. Expand a file into exported declarations or important functions.
5. Collapse back up to reduce noise.

This lens replaces the file hierarchy as the default broad exploration view.

#### Review Current Changes

Shows local changes, branch changes, or PR changes as the center of the graph.

Initial shape:

1. Changed files and functions are highlighted.
2. Their containing folders/modules are visible for architectural context.
3. Directly related files/functions are included with lower visual weight.
4. Bridge functions or files between changed areas are visible when useful.
5. Every context item has an inclusion reason.

This lens should build on the existing [Change-Focused Review View](STORY-20260501-change-focused-review-view.md) story.

#### Feature Focus

Lets a user seed the graph from one or more entry points, search results, files, or functions.

Initial shape:

1. User selects seed nodes.
2. The graph shows the selected nodes plus direct callers/callees and import neighbors.
3. Optional depth controls expand or collapse the neighborhood.
4. Related tests and config files can be included when detected.

This lens can come after review mode, but the homepage design should leave room for it.

#### Impact Investigation

Starts from a file, function, or exported symbol and asks what might be affected.

Initial shape:

1. Show callers, callees, importers, and imports.
2. Separate exact file relationships from heuristic function relationships.
3. Provide reason labels such as `calls`, `called by`, `imports`, and `imported by`.
4. Allow expansion by direction and depth.

This is useful for future "make a change safely" workflows.

---

## Review Lens Detail

The review lens should make changed code the seed of the view.

### Seed Nodes

The first version can start with changed files. Later versions should map changed hunks to declarations.

Possible seed types:

1. Changed files.
2. Changed functions or class methods.
3. Added exported symbols.
4. Deleted files or deleted declarations, represented as lightweight ghost nodes.

### Visible Context

The review graph should include:

1. Seed nodes.
2. Containing folders/modules.
3. Files imported by changed files.
4. Files that import changed files.
5. Changed functions that call each other.
6. Direct callers and callees of changed functions when available.
7. Shortest bridge paths between changed functions when the path is short and explainable.

The guiding rule:

```text
visible graph = changed seeds
              + containing structure
              + direct neighbors
              + short explainable paths between seeds
```

### Visual Treatment

Suggested visual language:

1. Changed nodes are the most prominent.
2. Direct neighbors are visible but quieter.
3. Bridge nodes use a distinct style from direct neighbors.
4. Tests use a separate style when detected.
5. Unrelated project structure is hidden by default.

Possible reason categories:

```typescript
type CodeMapReason =
  | 'changed'
  | 'contains-changed'
  | 'imports-changed'
  | 'imported-by-changed'
  | 'calls-changed'
  | 'called-by-changed'
  | 'bridge-between-changes'
  | 'related-test'
  | 'selected-seed';
```

The exact colors can be decided in the web implementation, but the important behavior is that the graph explains itself.

---

## Data Model Direction

This story does not require a new graph engine immediately. It needs a projection layer over existing analyzer data.

### Code Map Node

```typescript
interface CodeMapNode {
  id: string;
  kind: 'project' | 'module' | 'folder' | 'file' | 'function' | 'class' | 'method' | 'test' | 'deleted';
  label: string;
  filename?: string;
  pos?: number;
  end?: number;
  isChanged?: boolean;
  reasons: CodeMapReason[];
}
```

### Code Map Edge

```typescript
interface CodeMapEdge {
  id: string;
  source: string;
  target: string;
  kind: 'contains' | 'imports' | 'calls' | 'tests' | 'bridge';
  reasons: CodeMapReason[];
  weight?: number;
  isHeuristic?: boolean;
}
```

### Code Map Scope

```typescript
interface CodeMapScope {
  lens: 'overview' | 'review' | 'feature' | 'impact';
  seeds: string[];
  depth?: number;
  includeTests?: boolean;
  includeBridgePaths?: boolean;
}
```

These interfaces are directional rather than final. The key contract is that UI nodes and edges carry both identity and explanation.

## Relationship To Existing Stories

This story is broader than `STORY-20260501-change-focused-review-view.md`.

The change-focused story describes the first review implementation in detail:

1. Local diff and branch/PR controls.
2. Changed files plus immediate file neighbors.
3. Reason metadata for focused review nodes.
4. Later hunk and declaration-level focus.

This homepage story describes how that view becomes part of the default product experience:

1. The homepage becomes a lens picker and code map workbench.
2. Review mode becomes one of several focused graph lenses.
3. The file hierarchy becomes supporting navigation instead of the default main graph.

---

## Implementation Plan

### Phase Status (May 14, 2026)

1. Phase 1: Complete.
2. Phase 2: Complete (file-level review lens behavior).
3. Phase 3: Complete (module overview, module-to-file expansion, and file-to-declaration expansion delivered).
4. Phase 4: Complete (changed declaration mapping, direct caller/callee context, and bridge paths delivered).
5. Phase 5: Not started. Test-specific review context controls are complete as a prerequisite.

### Phase 1: Homepage Lens Shell

**Objective:** Introduce the new homepage shape without removing existing capabilities.

1. Add top-level lens controls: `Overview`, `Review`, `Feature`, `Impact`.
2. Keep unsupported lenses disabled or marked as future if necessary.
3. Move full file hierarchy into a navigation/sidebar role.
4. Make the central graph read from an explicit active lens state.
5. Preserve the existing project graph as a fallback.

Success criteria:

1. The homepage no longer defaults to a large file hierarchy.
2. The user can see that the tool is organized around investigation goals.
3. Existing graph views remain reachable.

### Phase 2: Review Lens As First Real Lens

**Objective:** Make current changes or branch changes the first useful focused homepage experience.

Build from `STORY-20260501-change-focused-review-view.md`:

1. Add `Diff` or `Review current changes`.
2. Add `Branch / PR` when branch comparison is available.
3. Show changed files plus direct import neighbors.
4. Highlight changed nodes and reason labels.
5. Add empty states for no changes.

Success criteria:

1. A user can open the app and immediately review what changed.
2. The graph shows changed code in context rather than the whole project.
3. Every visible node has a reason.

### Phase 3: Overview Lens

**Objective:** Provide a larger architectural picture without overwhelming the user.

1. Group files by folder, package, or module.
2. Show dependency edges between groups.
3. Allow progressive expansion from group to file to declaration.
4. Add collapse controls to return to a high-level map.

Success criteria:

1. Large projects open to a readable overview.
2. Users can expand detail only where needed.
3. The hierarchy is useful without dominating the screen.

### Phase 4: Function-Level Review Focus

**Objective:** Make PR review useful at the function relationship level.

1. Map changed hunks to function/class/method ranges.
2. Highlight changed declarations.
3. Show calls between changed declarations.
4. Include direct callers/callees of changed declarations.
5. Include short bridge paths between changed declarations when explainable.

Success criteria:

1. A user can see how changed functions relate to each other.
2. The graph distinguishes changed declarations from surrounding context.
3. The view remains small enough to understand.

### Phase 5: Editing And AI Readiness

**Objective:** Prepare graph scopes for future code editing and AI-assisted workflows.

1. Ensure each node resolves to a file and source range when possible.
2. Preserve stable function identifiers for matching.
3. Record why a node was included in the current working context.
4. Allow a focused scope to be passed to future edit or agent commands.

Success criteria:

1. The selected graph scope can become an edit context.
2. AI-assisted changes can start from review, feature, or impact scopes.
3. The system can explain which files/functions are in context and why.

---

## Acceptance Criteria

1. The homepage exposes task-oriented lenses instead of defaulting to the full file hierarchy.
2. The file hierarchy remains available as navigation or an alternate view.
3. The review lens is represented as a first-class homepage mode.
4. Changed files/functions are visually distinct from context nodes in review mode.
5. Context nodes and edges include explicit reason metadata.
6. Large projects can be viewed at a higher-level module/folder/package scale.
7. Users can expand from overview nodes into lower-level detail.
8. Existing full-project, file, and graph behavior remains available.
9. The design supports future edit and AI-agent workflows by preserving stable source locations.

### Acceptance Criteria Status (May 14, 2026)

1. Complete.
2. Complete.
3. Complete.
4. Complete for file-level and declaration-level review nodes.
5. Complete for currently visible review and overview nodes.
6. Complete at module/folder scale.
7. Complete for module-to-file and file-to-declaration expansion.
8. Complete.
9. Partial: file-level location/navigation is preserved; edit/agent scope handoff is future work.

## Decisions In This Implementation

1. Default homepage lens is `Overview`.
2. File hierarchy remains available as an alternate scope via `Overview -> All files`.
3. The first overview grouping rule is folder/directory-based modules.
4. Review mode defaults to showing changed files with one-hop context (`+ Context`).
5. Review declaration bridge paths are included automatically when they are short directed call chains.

## Open Questions

1. Should the default lens auto-switch to `Review current changes` when local changes exist?
2. How many graph expansion depths should be available before the UI becomes noisy?
3. Should bridge paths get a user-facing off switch when the declaration graph becomes noisy?
4. How should deleted declarations appear before function-level diff mapping exists?
5. Decided May 19, 2026: review mode includes related tests by default and exposes a `Related tests` toggle to hide unchanged test context.

## Recommendation

Continue this story with the next value-focused sequence:

1. Implement Phase 5 focused-scope handoff for editing and AI workflows.

This moves the product from "browse every file" toward "understand the relevant part of the codebase."
