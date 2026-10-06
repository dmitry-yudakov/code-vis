# Story 93 — Keep nested checkouts visible when the repositories root gains a marker

**Status:** Shipped · **Type:** Server-only · **Depends on:** [Story 92](STORY-20261005-session-worktrees.md)

## Motivation

A running Trevor conversation reports “Unknown checkout” even though `trevor-web` has not moved
and its saved checkout id still matches its real path. An empty `.git` directory appeared in
`/home/dmitry/my_projects`, the configured repositories root. Discovery immediately offers only
that root, hiding every nested checkout on the next request without any server restart.

This repairs the [arena vision's repository checkout continuity](../docs/vision.md#projects-repositories-and-repository-free-work):
a marker on the enclosing directory must not invalidate an existing contained checkout.

## Current behavior (where the code is)

- [checkoutRegistry.ts:47](../src/server/repository/checkoutRegistry.ts#L47) — `refresh` includes
  a marked root and independently performs bounded child discovery, preserving nested checkouts.
- [checkoutRegistry.ts:110](../src/server/repository/checkoutRegistry.ts#L110) — `resolveMany`
  resolves saved ids against a fresh discovery snapshot and rechecks canonical containment.
- [message/route.ts:97](../src/app/api/agent/message/route.ts#L97) — a missing checkout rejects
  the next message before provider execution with the reported error.
- [checkoutRegistry.test.ts:37](../test/checkoutRegistry.test.ts#L37) — the regression checks
  stable saved ids after a new root marker, and depth/exclusion checks cover marked roots.

## Desired behavior

1. Offer a marked root as a checkout and independently discover marked descendants within the
   configured depth. Adding a marker to the root preserves existing descendant checkout ids,
   listing and resolution, including after constructing a fresh registry.
2. Preserve canonical-path ids, depth limits, hidden/generated-directory exclusions, symlink
   containment checks, immediate-child fallback when no repositories are found, and managed
   worktree registration and resolution. No session migration or reattachment is required.
3. Document that a repository root can also have discoverable nested checkouts. Inspect the
   affected host's paths and saved bindings read-only; do not remove its `.git`, edit sessions,
   restart the managed server, or deploy the fix.

## Acceptance criteria

- [x] A depth-two checkout remains listed with the same id and resolves after an empty `.git`
      appears at the root, both in the original registry and a fresh registry.
- [x] Marked roots still appear as `.`; nested discovery obeys the configured depth and exclusions
      and cannot admit an outside symlink.
- [x] Existing checkout, managed-worktree and affected route checks pass; TypeScript and independent
      read-only review pass.
- [x] README and this story describe the shipped behavior and verification accurately.

## Out of scope

Determining which process created the empty parent `.git`, Git repository validity checks,
changes to marker removal or fallback semantics, persisted checkout catalogs, session format
changes, moving repositories, deployment and automatic commits.

## How to verify

1. Run `npm test -- test/checkoutRegistry.test.ts test/sessionWorktrees.test.ts test/sessionRoutes.test.ts test/projectRoutes.test.ts`.
2. Run `npm run lint -- --incremental false` and `git diff --check`; obtain a read-only review.
3. With the new registry, list `/home/dmitry/my_projects` at depth two and resolve the saved Trevor
   checkout id. Print only its checkout metadata, without provider execution or session writes.

## Verification results — October 6, 2026

- Both new regression checks failed before implementation because only `.` was discovered.
- All 66 focused checkout, managed-worktree, session-route and project-route tests passed with
  `CODEAI_REMOTE_ACCESS=local`; TypeScript and `git diff --check` passed.
- An independent read-only review found no actionable correctness issues and also ran all 42
  checkout and managed-worktree checks successfully.
- Read-only host verification discovered 127 checkouts at the configured depth two and resolved
  the saved Trevor id `MUp8StbJ47cIXlLc6tX9ag` to
  `/home/dmitry/my_projects/trevor/trevor-web`. Its saved session and project bindings match.
- The parent `.git` is empty and its filesystem birth time is October 6 at 17:45:23 Sofia time.
  No affected repository, parent marker or durable session record was changed. The managed server
  was not restarted or deployed; it must load the new code to use this fix.
