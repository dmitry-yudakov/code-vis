# Change-Focused Review View

**Created:** May 1, 2026  
**Status:** Proposed

## Overview

This story proposes a review-oriented mode for code-vis that shows mostly the contents of a pull request or local uncommitted changes, plus the files and symbols immediately related to those changes.

The current product is strong at whole-project and file-local exploration, but it does not yet offer a focused answer to a common review question: what changed, and what does it directly touch?

The new feature should introduce explicit controls for change-driven exploration, with separate buttons for `Diff` and `Branch / PR` views.

## Problem

The existing graph views make sense when exploring a codebase broadly, but they are noisy for review and impact analysis.

When a user wants to inspect a branch, a pull request, or a dirty working tree, they typically want:

1. Changed files to be the primary visual focus.
2. Immediate context around those files, not the whole repository.
3. A quick way to switch between local uncommitted changes and branch-level or PR-level changes.
4. A way to understand why neighboring files are included.

Without a change-focused mode, the user must mentally reconstruct the review scope from the full file graph.

## Goals

1. Add a focused review mode that starts from a change set instead of the full project map.
2. Add top-level controls for `Diff` and `Branch / PR` views.
3. Show changed files prominently and related files as secondary context.
4. Support both file-level and function-level exploration within the focused scope.
5. Keep the first version explainable and reliable by building primarily on local git state and existing analyzer data.

## Non-Goals

1. Do not require GitHub API integration in the first version.
2. Do not attempt full semantic impact analysis across the entire repository.
3. Do not claim that all shown function relationships are type-accurate or exhaustive.
4. Do not replace the existing full project and entry-point views.

---

## User Experience

### Top-level View Controls

Add change-oriented controls near the existing graph mode controls.

Proposed buttons:

1. `All files` - current behavior.
2. `Diff` - local uncommitted changes and their immediate neighborhood.
3. `Branch / PR` - changes between the current branch and a selected base ref, plus immediate neighborhood.

### Diff View

The `Diff` button should activate a view based on the local working tree.

Scope:

1. Tracked modified files.
2. Added files.
3. Deleted files, represented in a lightweight way when possible.
4. Optionally unstaged and staged changes together in the first version.

Presentation:

1. Changed files are emphasized visually.
2. Directly related files are shown with lower visual weight.
3. Unrelated files are hidden.
4. Each visible file should have a reason label such as `changed`, `imports changed file`, or `imported by changed file`.

### Branch / PR View

The `Branch / PR` button should activate a branch-level review scope.

For the first version, `Branch / PR` should be implemented using local git refs rather than GitHub PR metadata.

Initial meaning:

1. Compare the current branch against a chosen base ref.
2. Default the base ref to the repository default branch when available.
3. Allow changing the base ref later without redesigning the API.

This mode should be named `Branch / PR` in the UI because it matches the user intent even when the underlying implementation is branch diff based.

Later, the same view can optionally be fed by actual GitHub PR file lists if editor integration is added.

---

## Scope Definition

### Core Change Set

The feature starts with a list of changed files.

There are two sources:

1. `Diff` mode: local uncommitted changes.
2. `Branch / PR` mode: files changed between `HEAD` and a selected base ref.

### Immediate Neighborhood

The first implementation should define immediate relations conservatively at the file level:

1. Files imported by a changed file.
2. Files that import a changed file.

This is already aligned with the existing project graph model and avoids overpromising on semantic precision.

### Function-Level Focus

Within the focused file set, the fine-grained view should show:

1. Declarations located in changed files.
2. Changed declarations, when a changed hunk can be mapped into declaration ranges.
3. Neighbor declarations that appear directly connected through the existing call/import matching heuristics.

This should be treated as an enhancement layer on top of the file-focused experience, not as the initial source of truth.

---

## Why This Fits the Current Architecture

The current code already has pieces that make this feasible:

1. The server can build project-relative file maps and direct related-file payloads.
2. The web already has filtered and alternate graph modes.
3. The analyzer already extracts imports, declarations, and call-like nodes.

That means the feature can be added as a focused projection over existing data rather than as a separate graph engine.

## Proposed Data Model Additions

### Change Source

Add a server-side concept of a change source:

```typescript
type ChangeSource =
  | { mode: 'diff' }
  | { mode: 'branch'; baseRef: string }
```
```

### Change Set Result

Add a result shape for changed files and their line ranges:

```typescript
interface ChangedFileInfo {
  filename: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  addedLines?: Array<{ start: number; end: number }>;
  removedLines?: Array<{ start: number; end: number }>;
}

interface ChangeSet {
  source: ChangeSource;
  files: ChangedFileInfo[];
}
```

The first version may omit precise hunk ranges if that slows delivery. File-level scope is more important than exact diff rendering.

### Focused Graph Result

Add a focused payload for review mode:

```typescript
interface RelatedReason {
  type: 'changed' | 'imports-changed' | 'imported-by-changed' | 'function-neighbor';
  via?: string;
}

interface FocusedFileInfo {
  filename: string;
  reasons: RelatedReason[];
  isChanged: boolean;
}

interface FocusedReviewMap {
  changeSet: ChangeSet;
  files: FocusedFileInfo[];
  includes: FileIncludeInfo[];
}
```

This keeps the view explainable. Every file shown in the focused view should have a recorded reason.

---

## UI Proposal

### Graph View

In change-focused modes:

1. Changed files appear larger, brighter, or more central.
2. Neighbor files appear smaller or muted.
3. Edge labels and badges explain why a file is included.
4. The canvas contains only the focused subgraph.

### File View

When opening a changed file from a change-focused graph:

1. Prioritize changed regions.
2. Keep unchanged code collapsed where possible.
3. Show related files only if they are part of the focused neighborhood.
4. Preserve current edit and save capabilities.

### Function View

In fine-grained mode:

1. Prefer changed declarations first.
2. Dim unrelated declarations inside changed files.
3. Show neighboring declarations only when they are connected to the focused declarations.

This keeps the view review-oriented rather than turning it back into a full logic map.

---

## Implementation Plan

### Phase 1: File-Level Review Scope

**Objective:** Deliver a useful review view with minimal semantic risk.

Server:

1. Add a git-backed change-set query.
2. Support `diff` mode and branch-vs-base mode.
3. Produce the one-hop focused file neighborhood.
4. Return reason metadata for every file in the focused result.

Web:

1. Add `Diff` and `Branch / PR` buttons.
2. Add a focused graph mode using the focused payload.
3. Visually distinguish changed files from context files.
4. Add basic empty states such as `No local changes`.

Success criteria:

1. A user can switch from the whole project graph to a diff-focused graph in one click.
2. The graph includes changed files plus direct import neighbors only.
3. Each visible file has an explainable inclusion reason.

### Phase 2: Changed Hunk Awareness

**Objective:** Improve review usefulness inside file cards and file views.

1. Add changed line ranges to the server payload.
2. Highlight or prioritize changed ranges in file views.
3. Collapse unchanged sections when reasonable.
4. Represent deleted files in a lightweight review panel if full file rendering is not possible.

### Phase 3: Declaration-Level Review Focus

**Objective:** Make fine-grained mode useful for code review, not just exploration.

1. Map changed hunks to function declaration ranges when possible.
2. Promote changed declarations in the logic view.
3. Limit neighbor declarations to directly connected items.
4. Mark function-level reason chains such as `called by changed declaration`.

### Phase 4: Optional GitHub PR Integration

**Objective:** Allow the `Branch / PR` view to use an active PR directly when available.

1. Detect the active PR from editor context or GitHub tooling when available.
2. Use the PR file list as the primary change set.
3. Fall back to branch-vs-base behavior when GitHub data is unavailable.

This phase should remain optional. The feature should already be useful without it.

---

## Technical Notes

### Git Strategy

Preferred first implementation:

1. `Diff` mode uses local git status and diff.
2. `Branch / PR` mode uses merge-base against a base ref.

This approach is consistent with the current local-server architecture and avoids making review mode depend on remote APIs.

### Reliability Boundary

The UI should be explicit about what is exact and what is heuristic.

Exact enough in v1:

1. Which files changed.
2. Which files directly import or are imported by changed files.

Heuristic in later phases:

1. Which functions are truly impacted across files.
2. Which calls represent the most relevant semantic neighborhood.

The implementation should avoid visually implying stronger certainty than the underlying data supports.

---

## Acceptance Criteria

1. The main graph UI exposes `Diff` and `Branch / PR` buttons.
2. `Diff` mode shows local uncommitted changes plus direct file neighbors.
3. `Branch / PR` mode shows files changed between the current branch and a base ref, plus direct file neighbors.
4. Changed files are visually distinct from context files.
5. Every file shown in a focused view has at least one explicit inclusion reason.
6. If there are no changes for the selected mode, the UI shows a clear empty state.
7. Existing `All files`, entry-point, and directory views continue to work.
8. The first shipped version does not require GitHub API access.

## Open Questions

1. Should `Diff` include both staged and unstaged changes by default, or should those be separate toggles?
2. Should `Branch / PR` default to the repository default branch, or to a user-selected base remembered per project?
3. How should renamed files be rendered in the graph and file views?
4. Should deleted files appear as ghost nodes, side-panel entries, or be omitted from the graph?
5. How much diff content should appear inline before performance becomes a problem on large files?

## Recommendation

Ship this in the following order:

1. `Diff` and `Branch / PR` buttons with file-level focused graphs.
2. Reason badges and empty states.
3. Changed hunk highlighting.
4. Declaration-level focus.
5. Optional GitHub PR integration.

That sequence gets a review-friendly workflow into the product quickly while keeping the implementation honest, incremental, and aligned with the existing architecture.