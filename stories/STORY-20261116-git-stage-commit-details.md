# Story 142 — Stage changes, commit and inspect Git history

**Status:** Shipped

## Outcome

Repository → Changes offers Stage/Unstage beside each file, Stage all/Unstage all and a
multiline Commit message with Commit staged. Committing leaves unstaged edits and untracked
files intact. Failed operations retain the message, and switching Changes/History retains it.
Repository → History expands a commit into its full message, hash, author/email, timestamp,
parents and changed files. Selecting a file shows its committed patch, including deleted,
renamed and binary files. Merge changes compare with the first parent; root commits compare
with the empty tree. Empty commits remain inspectable.

## Contracts and implementation

- [gitIndex.ts](../src/server/repository/gitIndex.ts) reads one porcelain-v2 status result for
  both the displayed files and an opaque HEAD/branch/staged-index token. The token includes staged
  paths, modes and blobs, excludes later working edits, and is rechecked under exclusive ownership
  before every mutation. A separate status/token race cannot authorize an unseen staged file.
  Output scales with changed paths, preserving large clean repositories.
- [gitChanges.ts](../src/server/repository/gitChanges.ts) stages exact changed-file membership,
  handles rename source paths while unstaging and supports unborn branches. Unstage only changes
  the index. Commits use the local Git identity or the machine owner's global user.name/user.email.
  Missing identity, stale state, detached HEAD, unresolved conflicts and unfinished merge/rebase/
  cherry-pick operations produce actionable errors without discarding work. No amend, implicit
  staging, force, stash or push is performed.
- [gitMutation.ts](../src/server/repository/gitMutation.ts) reuses Story 137's checkout-family
  leases, contained metadata and local-configuration proof. Branch switching uses this same owner.
  Source/sibling agents cannot write shared metadata during a mutation. Host mutations disable
  hooks, filters, credentials, network, submodule recursion and signing. A commit-button tooltip
  identifies the hooks/signing behavior. Terminal workflows remain necessary for unsupported local
  configuration or unmanaged linked worktrees. Independent terminal operations retain Git's own
  locking; CodeAI's scheduler ownership only coordinates CodeAI operations.
- The device-authorized, exact-origin `POST /api/repository/index` and
  `POST /api/repository/commit` accept opaque checkout IDs and strict bounded bodies. Index requests
  allow 1–1,000 paths, each at most 4,096 characters, and 256 KiB total request bytes; commit messages
  allow 16,000 characters and 96 KiB request bytes. Invalid or stale requests fail explicitly.
  Quiet Git mutations prevent per-file success summaries from overflowing the 64 KiB process-output
  limit; host operations time out after 30 seconds and retain leases until the process exits.
- `GET /api/repository/commit` takes a full SHA-1/SHA-256 hash and optionally an exact file from
  that commit. Details and each patch have a 2 MiB output limit, with visible retry/terminal recovery.
  Reads retain the credential-free helper path after Docker provisioning; no host read fallback.
  Attached machines can read details and patches, but cannot request staging or commits.
- [useRepositoryChanges.ts](../src/features/repository/useRepositoryChanges.ts) owns mutation
  serialization, scoped drafts and refreshes. Completion/failure refreshes status, open file diffs
  and visible history through the existing revision. Repository/machine changes isolate drafts and
  late responses. Details/patch reads cancel when their selected commit or scope changes.
- MUI controls reuse the shared theme; ordinary file review and branch/Push flows remain available.
  No dependency or session-persistence changes.

## Acceptance and verification

- [x] Real disposable repositories cover chosen-file staging, bulk operations, partial staged/working
  edits, renames/deletions, initial commits, missing/global identity and managed-worktree ownership.
- [x] Stale snapshots, malformed/cross-origin/unauthorized requests, unsafe local configuration,
  conflicts and unfinished operations preserve recovery. Mutation output remains bounded for a real
  400-long-filename batch. Single-snapshot/token regressions protect review consistency.
- [x] Root, empty, merge, rename, deletion, binary and multiline-message commit details are covered.
- [x] All 256 focused unit checks (15 files), TypeScript, isolated production build and 53 distinct
  production-browser cases pass. Browser coverage includes real disposable-repository mutations,
  failure/retry/draft retention, branch/Push regressions, project workspaces and attached-machine
  detail/patch routing in Guarded and Native sessions.
- [x] Independent review; reported output overflow and separate snapshot/large-index findings fixed.
- [x] Light/dark desktop (1440px) and phone (390px) screenshots inspected.

The application running for the user has not been rebuilt or restarted. Production verification
uses `.next-e2e/git-flow` and a separate local test server. Tests stage and commit only disposable
repositories; the implementation checkout remains unstaged and uncommitted.

Verification commands:

```sh
npx vitest run test/gitIndex.test.ts test/gitChanges.test.ts test/gitChangesRoute.test.ts test/gitPush*.test.ts test/gitBranches*.test.ts test/gitHistory*.test.ts test/gitRead.test.ts test/gitRepository.test.ts test/repositoryFiles*.test.ts test/deviceAuthRoutes.test.ts
npx tsc --noEmit
CODEAI_DIST_DIR=.next-e2e/git-flow npm run build
CODEAI_DIST_DIR=.next-e2e/git-flow npx playwright test e2e/git-flow.spec.ts e2e/git-branches.spec.ts e2e/repository-panel.spec.ts e2e/git-push.spec.ts e2e/project-workspace.spec.ts e2e/machines.spec.ts
git diff --check
```

Screenshots: `test-results/git-flow-*/git-staging.png` and `git-commit-details.png`.
No live Docker-daemon acceptance was run for this change; helper isolation/fail-closed regressions
and host mutations were checked separately. No provider login or network access is needed by the
new local Git operations.
