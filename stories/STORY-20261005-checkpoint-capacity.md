# Story 91 — Recover writing turns in repositories with larger assets

**Status:** Shipped · **Type:** Server-only · **Depends on:** [Story 83](STORY-20261001-turn-checkpoints.md), [Story 89](STORY-20261005-symlink-checkpoints.md)

## Motivation

After symlink support, writing turns in `trevor-web-frodo` fail on tracked splash images.
Eight included PNGs are 6.1–6.4 MiB each and the eligible checkout totals about 94.3 MiB.
The 4 MiB file limit and 32 MiB tree limit reject legitimate repository assets. This extends the
[security levels epic's recovery contract](EPIC-20261001-security-levels.md#catching-mistakes-without-asking)
and the vision's local repository change loop while keeping recovery bounded.

## Implementation (where the code is)

- [turnCheckpoints.ts:12](../src/server/repository/turnCheckpoints.ts#L12) — fixed file/tree/record limits.
- [turnCheckpoints.ts:148](../src/server/repository/turnCheckpoints.ts#L148) — oversized-file rejection
  safely quotes the repository-relative filename and states the limit.
- [turnCheckpoints.ts:229](../src/server/repository/turnCheckpoints.ts#L229) — total eligible-byte limit.
- [turnCheckpoints.ts:350](../src/server/repository/turnCheckpoints.ts#L350) — active-first storage retention.
- [turnCheckpoints.test.ts:427](../test/turnCheckpoints.test.ts#L427) — near-100 MiB tracked-asset recovery
  and file/tree limits.
- [turnCheckpoints.test.ts:551](../test/turnCheckpoints.test.ts#L551) — byte-budget pruning with an
  older active checkpoint.
- [turnCheckpointRoutes.test.ts:116](../test/turnCheckpointRoutes.test.ts#L116) — large tracked assets
  permit a writing turn and oversized files prevent execution.

## Desired behavior

1. Cover regular files up to 8 MiB and eligible checkout contents up to 128 MiB. The durable record
   bound becomes 192 MiB, accounting for base64 expansion and metadata. Existing records remain
   readable; no private checkpoint, session or wire format changes are required.
2. Keep the aggregate durable storage budget at 512 MiB, the maximum record count at ten and expiry
   at seven days. Larger records reduce the retained count when the storage budget binds. Active
   records reserve their capacity before completed records, so an older active turn does not block
   a new capture when pruning a completed record would fit. All existing exclusions, concurrency
   and Undo checks hold.
3. An oversized-file error names its repository-relative path, safely quoting control characters,
   and states the 8 MiB limit. It does not label tracked source assets as generated.
4. Both capture and Undo handle a checkout near 100 MiB containing tracked files above the former
   per-file limit. Oversized files and trees still fail before provider execution or record writes.

## Acceptance criteria

- [x] A tracked asset checkout near 100 MiB captures, finalizes and restores exact bytes.
- [x] The new 8 MiB file and 128 MiB tree bounds remain enforced; a file error identifies the path.
- [x] A writing route starts with a large tracked asset and stops before execution for an oversized file.
- [x] Retention, old checkpoints, symlinks, safety and failure tests pass with the new record bound.
- [x] Byte-budget pruning keeps an older active checkpoint and the newest completed checkpoint,
      removing the older completed checkpoint to admit another writing turn.
- [x] Focused checks, TypeScript and independent review pass; documentation matches the new limits.

## Out of scope

Ignoring or changing `trevor-web-frodo` assets, skipping recovery, unlimited/configurable storage,
compression, streaming backup formats, deployment and automatic commits.

## How to verify

1. Run `npm test -- test/turnCheckpoints.test.ts test/turnCheckpointRoutes.test.ts test/turnCheckpointVr.test.ts`.
2. Run `npm run lint -- --incremental false` and obtain a read-only review.
3. Use disposable binary fixtures with the reported size characteristics; the affected checkout is
   inspected by metadata only and is never edited or copied into test artifacts.

## Verification results — October 6, 2026

- The byte-budget regression failed before the retention fix with the reported active-storage
  rejection. After the fix, it retains the older active checkpoint, the newest completed checkpoint
  and the new checkpoint within 512 MiB, and removes the oldest completed record and its summary.
- All 72 focused checkpoint, route and VR tests passed with
  `CODEAI_REMOTE_ACCESS=local CODEAI_SECURITY_LEVEL=guarded`. Fixtures cover a 98 MiB tracked-asset
  capture, finalization and exact-byte Undo, plus a writing route with a tracked 7 MiB image.
- TypeScript (`npm run lint -- --incremental false`) and `git diff --check` passed.
- Independent read-only review confirmed the fix and found no remaining correctness issues.
