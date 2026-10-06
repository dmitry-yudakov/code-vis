# Story 94 — Run Codex sandbox readiness in a disposable directory

**Status:** Shipped · **Type:** Server-only · **Depends on:** [Story 93](STORY-20261006-stable-checkout-discovery.md)

## Motivation

CodeAI checks whether Codex's sandbox starts by running `codex sandbox … -- true` from the
configured repositories root. A model-free probe of the installed Codex reproduced host-visible
empty `.git`, `.agents`, `.codex`, and `.aws` directories while the sandbox ran. The matching
directories appeared together in `/home/dmitry/my_projects`, and its `.git` triggered the checkout
discovery failure repaired by Story 93. Normal disposable probes cleaned up on exit; the exact
process that left the original directories behind is unproven.

This follows the [arena vision's machine readiness](../docs/vision.md#machines-and-devices) and
keeps a capability check from changing the user's repository directory.

## Implementation (where the code is)

- [providerRegistry.ts:53](../src/server/agents/providerRegistry.ts#L53) — Local Codex health
  passes the configured repositories root to preflight.
- [codexPreflight.ts:93](../src/server/agents/codexPreflight.ts#L93) — sandbox readiness creates
  a private disposable directory, preserves executable lookup, force-terminates after three
  seconds and cleans up after process closure.
- [codexInvocation.ts:43](../src/server/agents/codexInvocation.ts#L43) — the probe runs `true`
  under `workspace-write`, without an App Server or a model turn.
- [fake-codex.mjs:10](../test/fixtures/fake-codex.mjs#L10) — the offline fixture records sandbox
  cwd and permissions and leaves placeholders when the dedicated test record is enabled.
- [codexSandboxPreflight.test.ts:25](../test/codexSandboxPreflight.test.ts#L25) — real fixture
  subprocesses cover placeholder containment, cleanup, failures, concurrency and executable lookup.

## Desired behavior

1. Run each sandbox-startup probe in a fresh private directory under the system temporary
   directory. Remove it and any sandbox placeholders after success, failure, or timeout.
2. Keep the three-second process timeout and withhold Auto when the temporary directory cannot
   be created or the sandbox cannot start. Clean up only the probe's own generated directory.
3. Preserve executable resolution: commands from PATH stay commands from PATH, and a relative
   executable path and relative or empty PATH entries remain relative to the original preflight
   working directory.
4. Keep the App Server handshake at the configured repositories root so instructions and
   capability checks retain their existing meaning. Actual turn policies, sandbox arguments,
   credentials, release gates, and selected-mode checks remain unchanged.

## Acceptance criteria

- [x] A fixture that leaves sandbox placeholders changes only a private disposable directory;
      the repositories root stays untouched and the probe directory is removed.
- [x] Nonzero exit, timeout, spawn failure, and temporary-directory creation failure safely
      withhold Auto, with cleanup wherever a probe directory was created.
- [x] Concurrent probes use separate directories; relative executable paths and relative/empty
      PATH entries still work.
- [x] Disabled or unselected Auto starts no sandbox probe; App Server still receives the
      original working directory.
- [x] Focused provider/discovery tests, TypeScript, an installed-Codex model-free check, and
      independent read-only review pass; documentation records the resulting behavior.

## Out of scope

Changing Codex's sandbox implementation or permission profile, attribution of historical
processes, deletion of the user's existing parent-directory placeholders, real model turns,
provider credential reads, deployment and automatic commits.

## How to verify

1. Run `npm test -- test/codexSandboxPreflight.test.ts test/codexProcessRunner.test.ts test/nativeRunners.test.ts test/checkoutRegistry.test.ts`.
2. Run `npm run lint -- --incremental false` and `git diff --check`; obtain a read-only review.
3. Run the unchanged model-free sandbox command in a disposable directory with the installed
   Codex. Confirm its host-side placeholders stay there and cleanup leaves no probe directory.

## Verification results — October 6, 2026

- Five initial regressions failed before implementation: placeholder containment on success,
  nonzero exit and timeout, unique concurrent probe directories, and temporary-directory failure.
- Review found that a bare command could lose executable lookup through relative PATH entries
  after changing cwd. Both relative-entry and empty-entry tests failed before the correction;
  the probe now anchors them to the original cwd while preserving absolute entries.
- All 56 focused tests passed: nine sandbox-preflight checks, 21 Codex runner/preflight checks,
  20 Native provider checks and six checkout-discovery checks. TypeScript and `git diff --check`
  passed. Independent read-only review reported no remaining actionable findings and reran all
  nine sandbox-preflight checks successfully.
- The updated `checkCodex` passed with installed Codex 0.160.0, a disposable repository directory,
  and a test-scoped temporary parent. It advertised Native Auto; the repository directory stayed
  empty and the temporary parent contained no probe directory on return. Only the normal readiness
  handshake and sandbox `true` ran, without any model turn or provider credential reads by CodeAI.
- Existing parent-directory placeholders and durable records were left untouched. No commit,
  managed-server restart or deployment was performed; use Build & restart to load this fix.
