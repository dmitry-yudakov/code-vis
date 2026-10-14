# Story 108 — Request one-command approval for sandboxed Git writes

**Status:** Shipped · **Type:** Server-only · **Depends on:** [Story 82](STORY-20261001-native-security-level.md)

## Motivation

A Local Native Auto conversation began in Ask mode, then received an explicit request to unstage,
stage and commit. Codex ran `git restore --staged .` inside its workspace sandbox, received
`index.lock: Read-only file system`, and stopped without requesting escalation. Both existing sets
of checkout changes and the index remained intact. This repairs the conversation's change loop
from [the arena vision](../docs/vision.md) without changing its permission boundary.

## Current behavior (where the code is)

- [prompt.ts](../src/server/conversation/prompt.ts#L51) — Native Auto describes the user's provider
  setup and denials but omits recovery from a sandbox permission failure.
- [codexInvocation.ts](../src/server/agents/codexInvocation.ts#L94) — Native Auto uses
  `workspace-write` and `on-request`, inheriting the user's approval reviewer.
- [codexProcessRunner.ts](../src/server/agents/codexProcessRunner.ts#L1084) — start/resume and turn
  requests already apply that policy; ordinary sandbox failures do not automatically request approval.

## Desired behavior

Every Native Auto turn explains that Codex's protected Git metadata can require one-command
approval for staging, unstaging and committing. An authorized action blocked by sandbox
permissions uses the provider's escalation mechanism and leaves its decision to the configured
reviewer. A sandbox failure alone is not an approval denial. Approval for one action does not
change the configured sandbox policy, including in threads carrying earlier Ask instructions.

An actual denial stays binding. Preserve unrelated staged and unstaged work, and do not infer
authorization to commit from an investigation request.

## Acceptance criteria

- [x] Native Auto's per-turn prompt describes Git metadata protection and one-command escalation,
      distinguishing a sandbox failure from a denied approval.
- [x] Guarded, Ask/Plan, Full access and Docker contracts and Native reviewer/sandbox settings are
      unchanged; Native Auto still respects actual denials.
- [x] Focused tests fail before implementation and pass afterward; TypeScript passes.
- [x] A real installed-Codex scratch-repository probe resumes an Ask thread in Native Auto,
      completes explicitly authorized Git writes through approval, and preserves unrelated work.
- [x] An independent review finds no unresolved defects; the application's checkout index and all
      pre-existing changes remain intact.

## Out of scope

Changing sandbox roots, changing the user's reviewer, automatic host Git execution, committing the
application's existing changes, and rebuilding or restarting the running installation.

## How to verify

Run `npx vitest run test/nativeGitApprovals.test.ts test/nativeSecurity.test.ts test/nativeRunners.test.ts`
and `npx tsc --noEmit --incremental false`. In a disposable repository, start an Ask thread and
resume it in Native Auto with an explicitly authorized stage/unstage/commit task. Verify the Git
result and approval events, including unrelated staged and working changes. Compare the real
checkout's staged patch and original file contents with the investigation baseline.

### Verification — October 14, 2026

The two new positive tests failed against the old prompt; all 50 focused tests and TypeScript
passed with the correction. A read-only subagent review found no actionable defects.

Installed Codex 0.162.1 started in Ask and resumed the same provider thread in Native Auto with
the owner's `auto_review` setting. It requested one-command escalation for `git restore --staged`,
`git add`, and `git commit --only`; all three were approved. The new commit contained only
`task.txt`, and the unrelated file retained both its original staged version and its different
working version. The application's staged patch, existing unstaged patch and index hash matched
the pre-investigation baseline. The running application was not rebuilt or restarted.
