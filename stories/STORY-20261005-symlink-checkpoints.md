# Story 89 — Save and restore symbolic links in turn checkpoints

**Status:** Shipped · **Type:** Server-only · **Depends on:** [Story 83](STORY-20261001-turn-checkpoints.md)

## Motivation

Writing turns in `trevor-web-frodo` cannot start because its tracked `.agents/skills`,
`CLAUDE.md` and iOS configuration paths are symbolic links. Recovery should preserve the links
themselves. This extends the [security levels epic's recovery contract](EPIC-20261001-security-levels.md#catching-mistakes-without-asking)
and the vision's local repository change loop without reading through links.

## Implementation (where the code is)

- [turnCheckpoints.ts:32](../src/server/repository/turnCheckpoints.ts#L32) — version 2 file/link entries,
  legacy defaults and bounded target validation.
- [turnCheckpoints.ts:107](../src/server/repository/turnCheckpoints.ts#L107) — pinned-parent link reads,
  exact target checks and metadata-only terminal entries.
- [turnCheckpoints.ts:377](../src/server/repository/turnCheckpoints.ts#L377) — validates and restores
  changed entries through pinned parents, with a final recheck before deleting new entries.
- [message/route.ts:297](../src/app/api/agent/message/route.ts#L297) — capture failure stops execution.
- [turnCheckpoints.test.ts:217](../test/turnCheckpoints.test.ts#L217) — real-checkout symlink recovery,
  capture/restore races, old records and the 7,000-link storage boundary.
- [turnCheckpointRoutes.test.ts:103](../test/turnCheckpointRoutes.test.ts#L103) — a writing turn and Undo
  with a `CLAUDE.md` link.

## Desired behavior

1. Save each eligible symbolic link's exact target text, SHA-256 checksum and metadata. Relative,
   absolute, dangling and directory links are accepted without resolving or traversing targets.
   Targets must round-trip as UTF-8, contain no NUL and fit within 4 KiB; their bytes count toward
   the existing total budget. Target text is kept only in the original backup; terminal snapshots
   contain hashes and metadata, avoiding duplicate target storage. Excluded and ignored paths
   retain their existing treatment.
2. Pin and verify the link's canonical parent before reading, read through the pinned handle,
   and compare link metadata before/after reading. Capture and verification never create parents.
   Ancestor links, hard links, nested repositories and special files remain refused.
3. Compare entry kind as well as contents/target and mode. Undo recreates deleted/retargeted links,
   removes newly created links and restores file/link replacements using a temporary entry and
   rename in the pinned parent. No linked target is read, chmodded, deleted or restored.
4. Later link changes, ancestor replacements and invalid saved targets/checksums refuse Undo.
   Existing concurrency, Git, retention and partial-restore rules still apply. Replacing a populated
   real directory with a link makes recovery unavailable; recursive directory restoration is outside
   this change. Changes to an external target are outside recovery.
5. New private records use version 2 with explicit file/symlink kinds. Version 1 regular-file
   records remain recoverable after consistent normalization. No session or wire schema changes.

## Acceptance criteria

- [x] Capture supports tracked/untracked and non-Git links, including the reported repository layout,
      and saves no private/external target contents.
- [x] Undo handles retarget/delete/create and file/link replacements, including identical hashes/modes.
- [x] Later link changes, unsafe ancestors and corrupted backups refuse recovery without target writes.
- [x] Version 1 regular-file checkpoints remain recoverable; hardlink/nested-repository checks pass.
- [x] Thousands of long targets remain within the existing record budget after the terminal scan.
- [x] Focused checkpoint, route and VR tests, TypeScript and independent review pass; README documents
      link recovery and its remaining directory limitation.

## Out of scope

Following targets, restoring external effects, traversing ancestor links, recursive directory recovery,
provider permissions, deployment and changes to `trevor-web-frodo`.

## How to verify

1. Run `npm test -- test/turnCheckpoints.test.ts test/turnCheckpointRoutes.test.ts test/turnCheckpointVr.test.ts`.
2. Run `npm run lint -- --incremental false` and obtain a read-only review of the checkpoint extension.
3. Fixtures reproduce `.agents/skills`, `CLAUDE.md` and the iOS configuration link, perform a writing
   turn and Undo, and assert that external target bytes remain untouched. No real provider invocation
   or writes to the affected repository are required.

## Verification results

- The feature tests failed before implementation; the deletion-race and record-size regressions
  also failed before their respective fixes.
- All 69 focused checks are included in the passing full offline suite: 109 files, 1,083 tests.
  Run with `CODEAI_REMOTE_ACCESS=local CODEAI_SECURITY_LEVEL=guarded` when launched from a paired,
  Native app process; these child-test settings keep unrelated route fixtures isolated.
- TypeScript and `git diff --check` passed. Independent read-only review found no remaining blockers.
