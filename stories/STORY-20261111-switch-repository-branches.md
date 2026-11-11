# Story 137 — Switch repository branches

**Status:** Shipped · **Type:** Full-stack · **Depends on:** Stories 121, 125, 126

## Motivation

Switch the selected repository's branch directly from the workbench's Repository panel, supporting
the repository review/change loop in `docs/vision.md`.

## Where the code is

- `src/features/repository/RepositoryPanel.tsx:25` owns the branch row and Changes/History views.
- `src/features/repository/useRepositoryChanges.ts:7` owns status refresh and review invalidation.
- `src/server/repository/gitBranches.ts:52` gates branch switching and excludes competing writers.
- `src/server/repository/gitRead.ts:63` owns credential-free reads, including provisioned helpers.
- `src/server/runs/runRegistry.ts:196` admits exclusive checkout mutations.

## Desired behavior and contracts

Click the current branch to open a searchable picker of existing local branches. Mark the current
branch and branches checked out in another worktree. Selecting another available branch switches
the selected checkout, then refreshes status, diffs, history and files through the existing revision
owner. Listing loads on demand, retries visibly, and stale checkout responses never change another
repository's picker. The dialog names the repository and notes that all sessions sharing this
checkout see the switch. Failed switches retain the picker and offer recovery.

The server resolves checkout IDs, checks exact browser origin and device authorization, validates
an explicit local branch and compares the expected HEAD under an exclusive checkout lease.
No force, merge, stash, fetching, hooks, filters, credentials or submodule recursion. Git preserves
compatible local changes and refuses overwritten tracked, untracked and ignored files. Existing
worktree branch ownership remains enforced. A stale request or busy checkout fails with recovery
guidance. Detached HEAD can switch to an existing branch; unborn repositories show no branches.

Reuse the push configuration allowlist and contained-metadata proof before host Git, keeping source
and managed siblings free of writers while switching. Revalidate managed linkage under the owned lease;
reject unverified linked worktrees and exclude discovered ordinary writers whose metadata cannot be
proved independent. Nested/enclosing project markers reuse the held scope. Provisioned installations keep inspection in
the isolated helper. Hold leases through process exit and failed helper cleanup. Local controls also
work through paired personal devices; attached-executor mutation is outside this story and has no
switch control. Read and write output is bounded; listing supports up to 1,000 branches and reports
overflow explicitly instead of silently hiding branches.

## Acceptance criteria

- [x] Searchable, accessible branch picker works in both themes on desktop and phone.
- [x] A real Git switch updates HEAD/files and the UI refreshes status, review and history.
- [x] Compatible edits survive; conflicting tracked/untracked/ignored files, occupied worktrees,
      unsafe configuration, stale HEAD and busy checkouts refuse safely and can be retried.
- [x] Requests authorize, bound input, resolve checkout IDs and reject unexpected fields; attached
      machines cannot request the mutation.
- [x] Focused unit/browser checks, source TypeScript, isolated build and independent review pass.

## Out of scope

Branch creation/deletion, remote fetch/tracking creation, merging, stashing, attached-executor
switching and VR controls. No rebuild/restart of the running application.

## How to verify

Run real disposable-repository tests for switching and its refusal paths, route authorization tests,
the existing push tests, focused production-browser journeys and TypeScript. Build in an isolated
directory and inspect both-theme desktop/phone screenshots. Record results below before shipping.


Verified November 11, 2026:

- All **258 focused unit checks** pass across `gitBranches`, `gitBranchesRoute`, `gitPush`,
  `gitPushGate`, `gitPushRoute`, `gitRead`, `gitRepository`, `gitHistory`, `sessionWorktrees`,
  `checkoutRegistry`, `machineRoutes` and `deviceAuthRoutes`.
- All **37 production-browser cases** pass across `git-branches`, `git-push` and `repository-panel`.
  The real route/UI journey switches a disposable repository, verifies changed file content, then
  refuses conflicting edits without losing them. Other cases cover both themes at desktop/phone
  widths, filtering, keyboard/focus behavior, History refresh, list/switch failure recovery and
  duplicate-click exclusion. Existing repository/push/refresh/review cases remain green; the old
  push absence assertion now names Push/Publish rather than assuming the row has no buttons.
- `npm run lint` and `git diff --check` pass. The isolated production bundle was built with
  `env -u TURBOPACK CODEAI_DIST_DIR=.next-e2e/branch-switch npx next build --webpack
  --experimental-build-mode compile`, then `generate`, using the existing documented build fallback.
  Compilation needed network access for existing Google fonts; Chrome/test-server startup needed
  local process/network permission. No build configuration or production server settings changed.
- Light/dark desktop/phone picker screenshots were inspected after transition completion; long
  branch names wrap in the picker and truncate in the branch row. Controls remain in reach.
- Tests were introduced before the implementation and initially failed because the new Git module
  did not exist. Independent review reproduced unsafe admission through ordinary linked worktrees,
  moved managed worktrees and redirected metadata, then a nested-marker self-conflict. Each has a
  regression, and the final review reports no remaining blocking findings. The reviewer also
  independently verified redirected-writer rejection followed by successful retry.
- Git behavior uses real disposable repositories. Docker helper routing/failure is mocked; a live
  Docker daemon, physical phone/Quest and real paired-device transport were not rerun. Branch
  switching on attached executors is intentionally unavailable. The running application was not
  rebuilt, restarted or deployed.
