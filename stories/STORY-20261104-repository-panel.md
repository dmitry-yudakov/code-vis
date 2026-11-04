# Story 125 — Simplify the repository panel and show Git history

**Status:** Shipped · **Type:** Full-stack · **Depends on:** Stories 121, 124

## Motivation

Repository management takes most of the Changes panel even for the usual single-repository
session. The branch card repeats labels and touches the pane edges. This serves the repository
review slice of the vision and the workbench shell.

## Where the code is

- `src/features/repository/RepositoryManager.tsx:16` owns repository bindings and selection.
- `src/features/repository/RepositoryPanel.tsx:24` composes the tabs, branch row and file review.
- `src/features/repository/RepositorySidebar.tsx:17` owns the side panel header and split.
- `src/features/repository/RepositoryChangesView.tsx:60` shows changed files and status.
- `src/features/repository/useRepositoryHistory.ts:6` owns lazy, checkout/machine-scoped reads.
- `src/features/repository/RepositoryHistoryView.tsx:6` shows recent commits and recovery states.
- `src/server/repository/gitHistory.ts:5` reads bounded history through the hardened Git reader.
- `src/app/api/repository/history/route.ts:10` authorizes devices and resolves checkout ids;
  `src/server/machines/machineRoutePolicy.ts:8` allows attached-machine history reads.
- `src/features/shell/AppShell.tsx:2708` connects machine routing and session bindings.

## Desired behavior and contracts

Name the panel and its navigation control Repository. Show the current repository in one compact
row; offer a selector only for multiple bindings. A small Manage repositories button reveals the existing add,
remove, reorder and primary controls on demand. With no bindings, show the add form directly.
Preserve disabled controls during runs and fixed Docker/managed-worktree bindings.

Put Changes and History tabs below a compact, consistently inset branch row. History shows
the latest 100 commits reachable from HEAD, newest first, with subject, author, date and hash.
State explicitly when older commits are omitted. Canvas history remains a separate view.
Selection, wrapping, preview choice and scroll in file review survive a tab round trip;
only Changes opens its file inspector.

History loads only when requested. A device-authorized route resolves an opaque checkout id
and uses the existing credential-free Git reader and its ownership/timeout rules, including
Docker and attached-machine routing. Limit output to 2 MiB; overflow fails explicitly rather
than displaying partial records. Empty branches and non-Git folders have explicit states.
Failed loads support Retry/Refresh. Checkout/machine changes abort and hide stale history.
Preserve Story 121's push offers and Story 124's file-review behavior.

## Acceptance criteria

- [x] Single-repository sessions show no persistent management panel; a small control opens it.
- [x] Empty and multiple-repository sessions support adding, selecting, removing, reordering and
      primary selection, preserving saved bindings and run/worktree restrictions.
- [x] Repository has keyboard-accessible Changes/History tabs and an inset, compact branch row.
- [x] History reads real recent commits with metadata, bounded output and explicit omission.
- [x] Empty/non-Git, failures/retry, checkout switching and attached routing are covered.
- [x] Push and file review remain usable, including phone layouts and tab round trips.
- [x] Focused unit/browser checks, TypeScript, isolated build, both-theme screenshots and review pass.

## How to verify

Run focused Git/history/auth and workbench unit checks, `npm run lint`, an isolated production
build, and repository-panel, git-push, file-review and mobile browser checks. Inspect both
themes at desktop/phone sizes. Record actual results below. Do not restart the running app.

Verified November 4, 2026:

- All 179 focused unit checks pass across `gitHistory`, `gitHistoryRoute`, `deviceAuthRoutes`,
  `workbenchFrame`, `gitRepository`, `gitRead`, `panelLayout`, `gitPush`, `gitPushGate` and
  `gitPushRoute`. Real disposable Git repositories verify HEAD-only history, Unicode subjects,
  unborn/detached HEAD, the 100-commit limit, whole-output overflow refusal and recovery.
  Initial history tests failed before the implementation.
- `npm run lint`, `git diff --check`, and `CODEAI_DIST_DIR=.next-e2e npm run build` pass.
- 77 distinct production-browser cases pass across the repository-panel, git-push, file-review,
  mobile-panes, machines, desktop-workspace, session-worktrees and title-bar-tabs suites and
  six affected canvas cases. Coverage includes keyboard tabs, first/additional repositories,
  saved order/primary/removal, retry/refresh, late responses, attached-machine URLs, phone
  scrolling through 100 commits, managed bindings, and retained review wrapping/scroll.
  Existing session-tab queries now scope to their own tablist. Worktree checks use the current
  Allow once label and permit draft editing during a run.
- A wider phone tab-archive case remains failing: after background title generation, archive
  reports expected revision 3 / current revision 4. That case never opens Repository; title,
  archive and revision handling are unchanged. This is recorded as an unrelated wider-check
  failure, not a baseline-confirmed regression result.
- Both-theme desktop/phone screenshots were inspected, including the management popover,
  compact branch and history. Independent review found the remembered-Reports fallback issue;
  its regression was observed failing on the earlier build and passes after using the effective
  displayed view. Final review has no blocking findings.
- Git history uses real host Git in unit checks and a real managed-worktree browser server;
  attached-machine browser transport is intercepted. Real Docker helpers, production attached
  transport and physical phones/Quest were not rerun. The running app was not restarted or
  deployed. Nothing was staged or committed.

## Out of scope

Staging, committing, branch switching, historical commit diffs, fetch/pull and changes to VR.
