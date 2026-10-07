# Story 95 — Use managed worktrees with Local and Docker execution

**Status:** Shipped · **Type:** Full-stack · **Depends on:** [Story 92](STORY-20261005-session-worktrees.md), [Story 57](STORY-20260908-local-docker-execution.md)

## Motivation

Provisioning Docker previously disabled managed worktrees even when the user selected Local.
Execution and checkout isolation should be independent choices in the arena described by
[the vision](../docs/vision.md). The user asked to fix both Local worktree availability and Docker
worktree execution.

## Where the code is

- [managedWorktrees.ts:117](../src/server/repository/managedWorktrees.ts#L117) permits Local creation
  after provisioning; `sourceWorktreeCapability` reports Docker source restrictions separately.
  Its `git` inspections use the isolated helper after provisioning, including interrupted creation.
- [managedWorktrees.ts:304](../src/server/repository/managedWorktrees.ts#L304) derives exact metadata
  mounts and inode identities from verified records; `acquireManagedGitRead` protects common metadata.
- [gitRead.ts:81](../src/server/repository/gitRead.ts#L81) retains helper leases until confirmed
  termination; `isolatedGitRead` mounts verified common metadata read-only.
- [dockerProfile.ts:92](../src/server/execution/dockerProfile.ts#L92) validates registered linked
  checkouts and protected origins; [dockerRuntime.ts:330](../src/server/execution/dockerRuntime.ts#L330)
  binds verified metadata, checks it again before start and holds its lease through cleanup.
- [sessionSchema.ts:232](../src/shared/sessionSchema.ts#L232) adds Docker worktree format 11;
  [sessionStore.ts:587](../src/server/storage/sessionStore.ts#L587) preserves creation and continuation
  provenance across both executions. The request schema accepts either execution without host paths.
- [worktreeChoice.ts:12](../src/features/conversation/worktreeChoice.ts#L12) keeps execution and
  checkout choices independent; [AppShell.tsx:353](../src/features/shell/AppShell.tsx#L353) uses the
  source's Docker restriction for continuation.
- [test-docker-worktrees.ts:19](../scripts/test-docker-worktrees.ts#L19) probes real mounts, Git and
  worktree-only Undo against a disposable repository with no provider credentials.

## Desired behavior

1. Local managed creation, resolution, Git reads and recovery remain available after provisioning,
   even with Docker execution disabled. Keep isolated Git reads and Docker recovery after provisioning.
2. Docker can create a managed worktree or continue on an existing one. Check health and protected
   source paths before any creation mutation; preserve retry identity and exact continuation binding.
3. Additional mounts come only from the executing machine's durable managed-worktree journal,
   with the existing canonical-parent, inode and bidirectional Git linkage checks. Unregistered
   worktrees and planted `.git` pointers never grant mounts.
4. Mount the recorded common Git directory read-only at its original absolute path, so Git's
   existing linkage resolves without rewriting host files. Helpers and Ask/Plan have only read-only
   binds. Docker Agent additionally writes its own worktree metadata and the common objects,
   refs and logs directories. The original checkout, its index, HEAD, configuration and hooks stay
   read-only or absent. Branch refs and objects are shared by Git worktree semantics; Undo still
   excludes Git history/index. Repository-wide Git administration stays outside Docker workers.
5. Docker still refuses origins overlapping the running installation, data or provider storage.
   Local worktrees of CodeAI itself remain supported. Reject conflicting container mount targets
   and revalidate every mount immediately before a container starts. Existing worker images work
   without reprovisioning: managed preparation is the existing server-side verified preflight.
6. Docker managed sessions use format 11; Local managed sessions keep format 10. Older builds hide
   format 11 records instead of failing on a newly permitted combination. No wire request contains
   host paths or mount options. Desktop/Arena share the updated choice; continuation keeps provenance.

## Acceptance criteria

- [x] Docker provisioning no longer disables Local managed creation/resolution or isolated Git reads.
- [x] Docker creation, current-checkout sharing and Local/Docker continuation retain exact provenance.
- [x] Only verified managed records authorize extra mounts; tampered links, replaced metadata,
      symlinks and protected sources are refused before start, with complete resource cleanup.
- [x] Ask/Plan/helper metadata binds are read-only; Agent can stage and commit inside its worktree
      while source files/index/configuration and unrelated outside files stay protected.
- [x] Format 11 validates Docker worktrees and preserves format 10 Local compatibility.
- [x] Focused automated checks, TypeScript, production build, real Docker Git/mount checks and an
      independent review pass; documentation reflects the final contract.

## Out of scope

- Arbitrary user-created linked worktrees, external object stores, network/mount-policy expansion,
  automated cleanup, branch integration, changing Local provider permissions or global Git recovery.
- Docker access to CodeAI's running installation or its Git metadata.

## How to verify

Run the worktree, Git-read, Docker runtime/execution and relevant schema/UI tests, `npm run lint`
and `npm run build`. Use a disposable committed repository and an existing pinned Docker image
to create Local/Docker sessions, verify helper status/diff and worktree-only Undo, stage and commit
in Agent, verify Ask/Plan cannot write checkout/metadata, and inspect exact mount read/write flags.
Attempt changed linkage, external-file redirection, changed mount sources and protected origins.
Review the final diff independently. Do not use provider credentials or modify the owner's repos.

`npm run test:docker:worktrees` runs the disposable real-daemon probe using this installation's
existing pinned image. It does not reprovision the installation or sign a provider in.

## Verification

- All 1,167 offline tests in 115 files pass, including the 96 worktree, Git-read and Docker-runtime
  checks. The suite ran with Local/Guarded fixture settings and access to its `/var/tmp` fixtures.
- TypeScript and the final production build pass.
- All five focused production-browser checks pass: independent execution/checkout choices,
  both themes, lost-response retry, fixed bindings and Arena creation.
- The real Docker probe passes Local/Docker creation after provisioning, helper reads, Undo,
  Ask/Plan read-only binds, Agent staging/commit, source and sibling-index protection, disabled-Docker
  Local reads, and tampered linkage/symlink refusal. It ran against the existing worker image.
- Independent read-only review passes after fixes for mount-source identity, common-metadata lease
  lifetime, orphan recovery and failed helper cleanup. The cleanup regression fails before its fix.
- Signed-in provider turns, production attached-executor transport and physical Quest use were not
  rerun for this change; the mount/Git probe does not require provider credentials.
