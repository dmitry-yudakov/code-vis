# Story 36 — Show working-tree changes in a repository sidebar

**Status:** Shipped · **Type:** Full-stack ·
**Depends on:** [Change-focused review view](STORY-20260501-change-focused-review-view.md) ·
**Epic:** [web2 operational collaboration](EPIC-20260806-web2-operational-collaboration.md)

> **Renumbered 2026-08-29.** This story was written as "Story 24" on 2026-08-17 and collided with
> [Story 24](STORY-20260820-promote-next-app-archive-legacy.md), which every other document already
> cites by that number. It takes the next free number instead; nothing referenced this file by its
> old one. Its date, content, and shipped status are unchanged.

---

## Motivation

When opening or switching repositories, the current web2 canvas gives no immediate indication
that the working tree is dirty. A user should be able to answer “what is changed?” without
leaving Cartograph, and should be able to open one of those files to inspect its patch before
continuing a conversation or an agent run.

This is the smallest useful bridge between the conversational canvas and the vision's existing
review/change surface: a local, read-only working-tree sidebar rather than a new graph lens.

## Current behavior (where the code is)

- Application and project selection state live in
  [web2/components/AppShell.tsx](../src/features/shell/AppShell.tsx#L66) (~line 66); the shell has
  right-side conversation/history drawers but no repository surface.
- The selected project id resolves to a server-owned real path through
  [web2/lib/server/projectRegistry.ts](../src/server/projects/projectRegistry.ts#L95) (~line 95).
- Browser/server contracts are shared in
  [web2/lib/shared/types.ts](../src/shared/types.ts#L1) (~line 1).
- The app's shell and drawer layout is defined in
  [web2/app/globals.css](../src/app/globals.css#L26) (~line 26).
- The older change-focused story establishes local Git as the reliable first source and a
  changed-file list as the starting point:
  [change-focused review](STORY-20260501-change-focused-review-view.md#scope-definition).

## Desired behavior

The selected project opens with a left repository sidebar. For a Git working tree it shows the
current branch, clean/dirty summary, staged/unstaged/untracked counts, and all locally changed
files. A file row communicates its Git status and whether the change is staged, unstaged, or
both.

Selecting a changed file expands the surface into a read-only patch inspector. Staged and
unstaged patches remain visibly separated; untracked files render as additions. The user can
close the inspector without closing the repository sidebar, manually refresh after external
changes, or collapse the sidebar from the header.

Projects outside Git show a calm, actionable empty state. Git failures are bounded public
errors, not raw process details.

The sidebar is a repository-level shell rather than a Git-only component. Its shell owns panel
layout and responsive behavior, while the working-tree list and diff inspector are separate
views. This leaves a direct extension point for a future project-file tree without mixing file
navigation, Git fetching, and patch rendering into one component.

### Type contract

```ts
type GitFileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'conflicted' | 'untracked';

interface GitChangedFile {
  path: string;
  previousPath?: string;
  status: GitFileStatus;
  staged: boolean;
  unstaged: boolean;
}

interface GitWorkingTree {
  isRepository: boolean;
  branch?: string;
  files: GitChangedFile[];
}

interface GitFileDiff {
  path: string;
  staged?: string;
  unstaged?: string;
}
```

## Acceptance criteria

- [x] Opening or switching a project loads a left repository sidebar without requiring a
  conversation.
- [x] A Git repository shows branch, clean/dirty state, staged/unstaged/untracked counts, and
  changed file rows with status and stage information.
- [x] Renamed paths and filenames containing spaces are parsed without lossy shell splitting.
- [x] Clicking a changed file opens a bounded, read-only staged/unstaged patch; untracked files
  display as additions.
- [x] Status and diff routes accept only a server-resolved project id and a path present in that
  project's current change set; the browser cannot request arbitrary filesystem paths or Git
  commands.
- [x] Refresh reloads status and preserves the selected file only while it is still changed.
- [x] Non-Git, clean, loading, and failure states are explicit and usable.
- [x] The sidebar can be collapsed and its expanded diff remains usable on narrow screens.
- [x] Parser/API-adjacent unit tests cover clean, staged, unstaged, untracked, renamed, conflicted,
  and branch metadata cases.
- [x] `cd web2 && yarn test`, `yarn lint`, and `yarn build` pass.
- [x] The header trigger and panel identify the surface as `Repository`; the dirty-file badge
  remains visible without making Git changes the identity of the whole sidebar.
- [x] Repository shell, working-tree view, and diff inspector are separate components with
  explicit props; adding another repository view does not require moving Git fetch state into
  the shell or duplicating the responsive panel layout.

## Out of scope

- Staging, unstaging, reverting, committing, editing, or applying patches.
- Branch/PR/commit comparisons and graph-neighborhood review; those remain in the broader
  [change-focused review story](STORY-20260501-change-focused-review-view.md).
- File watching or polling. The first version refreshes on project change and explicit user
  action.
- Syntax-highlighted source editing or side-by-side diff rendering.

## How to verify

1. Run `cd web2 && yarn dev`, open a configured Git repository, and confirm the sidebar opens
   with the current branch and local changes.
2. Make staged, unstaged, and untracked changes (including a rename or a filename with spaces),
   press Refresh, and inspect each file's patch.
3. Select a non-Git project and a clean repository to confirm both empty states.
4. Resize below 850px and confirm the sidebar/diff can be opened and closed without trapping the
   canvas.
5. Run `cd web2 && yarn test && yarn lint && yarn build`.
