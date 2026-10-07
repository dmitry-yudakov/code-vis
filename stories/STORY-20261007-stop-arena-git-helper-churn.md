# Story 96 — Stop Arena polling from spawning Git helpers

**Status:** Shipped · **Type:** Server-only · **Depends on:** [Story 95](STORY-20261007-docker-worktrees.md)

**Vision slice:** the [Arena](../docs/vision.md): observing sessions must leave an idle machine
idle and let the user rebuild CodeAI through the existing change loop.

## Motivation

The owner saw dozens of `codeai-git-*` Docker containers continually appearing and disappearing,
and could not reliably start Build & restart. Inspection found 82 helpers belonging to the live
server, rather than test leftovers. Arena polling repeated full source-worktree preflight for
every discovered checkout, retaining checkout read leases throughout each Docker helper's lifetime.

## Implementation (where the code is)

- `src/features/arena/useArena.ts:11` — every mounted shell polls the Arena every two seconds.
- `src/server/machines/localExecutorSnapshot.ts:19` — snapshots list this machine's checkouts.
- `src/server/repository/checkoutRegistry.ts:106` — listing evaluates every source's worktree choice.
- `src/server/repository/managedWorktrees.ts:140` — the shared structural check verifies an ordinary
  source and a normal contained `.git` directory without walking its contents.
- `src/server/repository/managedWorktrees.ts:183` — advisory source eligibility reads bounded HEAD
  text and checks separate Docker restrictions without Git commands or checkout leases.
- `src/server/repository/managedWorktrees.ts:444` — actual creation independently repeats full
  source validation under the machine's maintenance lease before recording an intent or mutating Git.
- `src/server/runs/runRegistry.ts:192` — active checkout read leases correctly exclude maintenance.

## Desired behavior

Checkout listing reports advisory worktree eligibility without Git commands, Docker helpers,
recursive metadata scans, or checkout read leases for ordinary sources. It checks the canonical
source location, a normal contained `.git` directory, and a bounded regular HEAD file, and keeps
the optional source branch label and separate Docker source restrictions.

This clarifies Story 92's source-eligibility contract: a list is a lightweight offer, not proof of
object completeness or safe Git configuration. Full, fresh validation on submission remains the
authority. Unsupported filters, partial clones, external objects, submodules, missing objects,
and changed metadata are refused before any worktree, branch, session, or creation intent is made.
No cached eligibility may authorize a mutation.

Maintenance continues to exclude actual helper reads, writing turns, Undo, and other maintenance.
Removing the polling probes supplies an idle window; it does not bypass those exclusions.

## Acceptance criteria

- [x] Repeated and concurrent ordinary checkout listings on a Docker-provisioned machine execute
  no Git helper commands and acquire no checkout read leases, even while maintenance is held.
- [x] Source branch labels remain current, including detached HEAD and SHA-256 HEAD, without Git.
  Missing, oversized, malformed, non-regular, or redirected HEAD files grant no eligibility.
- [x] Local and Docker source restrictions stay separate; managed or non-Git sources remain
  unavailable for creation of another worktree.
- [x] Full creation preflight still refuses unsupported or newly changed sources before mutation,
  even after a preceding listing offered the worktree choice. Real helper reads still block restart.
- [x] Focused regression tests, the offline suite, TypeScript, production build, and independent
  review pass.

## Out of scope

Changing Docker isolation, deleting live helpers or provider homes, restarting the owner's server,
introducing a capability cache, changing polling cadence, or relaxing managed-worktree resolution.

## How to verify

1. Run `npm test -- test/sessionWorktrees.test.ts test/checkoutRegistry.test.ts test/codeAiLifecycle.test.ts test/gitRead.test.ts test/runScheduler.test.ts`.
   The polling regression must fail with the former full-preflight listing implementation.
2. Run `npm test` with local test settings, `npm run lint`, and a production build into an unused
   scratch build directory. Fixtures that write outside the checkout require the corresponding
   filesystem permissions.
3. After the owner rebuilds the running app, leave its Arena open with Docker provisioned. Its
   ordinary source listing should spawn no `codeai-git-*` helpers; actual Git views and worktree
   creation still use helpers. With no turn, helper, or Undo live, Build & restart can be admitted.
   This owner-server follow-up is observational and is not required to restart it during this change.

## Verification record

On October 7, 2026, the new polling regression failed against the former full-preflight listing.
After implementation, all 88 focused checks passed, followed by all 1,177 tests across 115 files
with `env CODEAI_REMOTE_ACCESS=local CODEAI_DOCKER_ENABLED=false CODEAI_DATA_DIR=/tmp/codeai-arena-polling-test-default npm test`.
TypeScript, the production build into `.next-e2e/arena-polling-build`, and independent subagent
review passed. The build's generated type files were restored, and the running server was not
restarted or changed. Observation of the rebuilt owner server remains a follow-up.
