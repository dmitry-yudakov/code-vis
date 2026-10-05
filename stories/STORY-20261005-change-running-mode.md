# Story 90 — Change mode during a running turn

**Status:** Shipped · **Type:** Full-stack · **Depends on:** [Story 82](STORY-20261001-native-security-level.md), [Story 83](STORY-20261001-turn-checkpoints.md)

## Motivation

The mode picker is disabled while an agent works. A user who wants fewer approval interruptions,
or wants the agent to stop writing and return to planning, must wait for the whole turn to finish.
This extends the security-level epic's user control over a machine's supported permissions.

## Implementation (where the code is)

- `src/features/conversation/InstructionComposer.tsx:469` keeps the mode picker enabled.
- `src/features/shell/AppShell.tsx:1096` sends live changes to the executing machine; its picker
  follows the live run's mode (`:364`), including discovery and event replay.
- `src/features/shell/immersive/ConversationTools.tsx:122` offers supported modes during work.
- `src/app/api/agent/mode/route.ts:8` authorizes and validates a run-addressed mode request.
- `src/app/api/agent/message/route.ts:227` validates provider/isolation/Auto capability; `:314`
  acquires writing access and captures the turn's checkpoint before a writing continuation.
- `src/server/runs/runRegistry.ts:273` serializes changes; `:298` requeues a read-to-write upgrade
  while retaining the original execution promise. `:396` makes cancellation idempotent and keeps
  started turns on live-execution cleanup, even while requeued for writing access.
- `src/server/runs/turnMode.ts:4` interrupts provider attempts independently of turn cancellation.
- `src/server/conversation/conversationService.ts:107` resumes the provider session with a fresh
  contract and broker, original evidence, and the remaining time/Claude turn budget.
- `src/server/agents/claudeProcessRunner.ts:173` counts distinct main assistant turns, including
  streaming starts and excluding forwarded subagent messages.

## Desired behavior

Keep supported modes selectable on desktop and in VR during a queued, running, or approval-blocked
turn. Send the change to the executing machine for the exact live run. Check the same provider,
isolation, and Auto restrictions as a new turn before accepting it.

Interrupt the current provider process, await termination, then resume its private provider session
with a fresh mode contract and permissions. Continue the original task without another user message;
preserve edits already made. Clear pending approval cards without approving them. An interrupted
action may be reconsidered under the explicitly selected new mode; explicit user denials still hold.

An Ask/Plan turn entering a writing mode waits for exclusive checkout access and saves a checkpoint
before resuming. Once a turn has writing access, retain it through final checkpoint fingerprinting,
even if the new provider policy is read-only. Keep one canonical user message and one final answer;
record the original mode on the user message and the final applied mode on the answer. Broadcast
accepted mode changes to attached devices and retain the chosen mode in live-run discovery/replay.
Reject changes after response publication has started. Cancellation wins over resumption.
Repeated cancellation of a turn waiting to upgrade checkout access must retain its session/provider
reservation until the original execution has completed cleanup. Use queued-message cancellation
only for turns whose execution has never started; failed queued cancellation remains retryable.

## Acceptance criteria

- [x] Desktop and VR allow supported mode changes while working and waiting for approval.
- [x] Changes apply to the current task automatically, preserving provider session identity and
      original attachments, with no duplicated canonical user message.
- [x] Pending cards close without approval; unsupported/isolation/Auto-invalid changes leave the
      current turn untouched and display an error.
- [x] Checkout access, checkpoint capture/finalization, and cancellation remain correct when
      upgrading a shared read or changing a queued turn; repeated changes are serialized.
- [x] Discovery/replay and the final answer report the selected mode accurately.
- [x] Repeated Cancel while waiting for writing access aborts the live execution once, never
      invokes queued-message cancellation, and keeps its reservation until cleanup completes.
- [x] Focused regression tests, TypeScript, production build, browser verification, and independent
      review pass.

## Out of scope

Live model/effort changes, reversing completed side effects, changing machine security levels,
or granting unavailable provider modes.

## How to verify

Run focused mode, scheduler, conversation, and route tests, `npm run lint`, and `npm run build`.
In a production browser, start Agent, wait for its approval card, choose Plan, and verify that the
card closes and the same task completes as a plan. Start a slow Ask task, choose Agent, and verify
it resumes with approval controls; reload while switching and verify the selected mode survives.
Exercise both themes. Review the implementation independently before marking this story shipped.

### Verification recorded October 5, 2026

- Full offline suite: 1,100 tests passed; the final accounting/delivery/snapshot/serialization fixes
  passed 38 focused tests, including two additional regressions. VR mode controls passed in both
  themes; existing Claude and Codex runner tests passed.
- TypeScript and production build into `.next-e2e` passed. The build retains the existing
  provider-folder tracing warning.
- All three production Chrome checks passed: approval-blocked Agent → Plan in both themes,
  and Ask → Agent with a browser reload before approval. They use offline provider fixtures.
- Independent review passed after fixing hidden VR buttons, recovered mode presentation, and
  cumulative Claude turn accounting; forwarded subagent output is excluded.
- A further review found that repeated Cancel during a checkout-access upgrade could finish the
  run before cleanup. Its regression failed against the old implementation and passes with
  idempotent cancellation and persistent execution-started detection. All 56 focused tests and
  TypeScript passed, including retry after a failed cancellation of a never-started queued turn.
  The review subagent confirmed the correction with no remaining findings in the focused fix.

To reproduce the browser checks from a managed CodeAI process, explicitly select the test build:
`CODEAI_DIST_DIR=.next-e2e CODEAI_E2E_PORT=3037 npx playwright test e2e/running-mode.spec.ts`.
The inherited `CODEAI_DIST_DIR` otherwise selects the running managed release. The offline full
suite needs writable scratch space in `/var/tmp`; select `CODEAI_REMOTE_ACCESS=local` when the
launching process uses paired access.

Live switches with signed-in providers, a real Docker daemon, and physical Quest hardware have
not been exercised for this story. The running CodeAI release was not rebuilt or restarted.
