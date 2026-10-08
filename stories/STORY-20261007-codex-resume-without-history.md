# Story 97 — Resume Codex conversations without returning their history

**Status:** Shipped · **Type:** Server-only · **Depends on:** [Story 20](STORY-20260817-web2-codex-provider.md)

**Vision slice:** [Inside a session](../docs/vision.md#inside-a-session): a session stays useful when
the user returns to its conversation after earlier agent work.

## Motivation

On October 7, 2026, the owner tried to continue an older BookingGood session and received
`Codex emitted an oversized App Server event.` The message failed during provider-session resume,
before the new user message reached a Codex turn.

The issue is reproducible without inference or changes to the owner's session. Using the installed
Codex CLI 0.160.1 against a disposable copy of that session's rollout, `thread/resume` returned a
1,467,611-byte JSON-RPC response containing four earlier turns. CodeAI permits at most 1,048,576
bytes per event. Sending `excludeTurns: true` reduced the response to 5,165 bytes. The field is
present in this CLI's generated stable `ThreadResumeParams` schema and omits returned history;
it does not discard Codex's stored conversation or its context for the next turn.

The failed BookingGood process exited and its checkpoint reported no eligible file changes.
The separate failure to create a CodeAI worktree was caused by another active turn, addressed by
[Story 98](STORY-20261007-worktree-creation-admission.md).

## Implementation (where the code is)

- [codexProcessRunner.ts:37](../src/server/agents/codexProcessRunner.ts#L37) bounds every complete
  and unfinished App Server event to 1 MiB, separately from the assistant-answer limit.
- [codexProcessRunner.ts:587](../src/server/agents/codexProcessRunner.ts#L587) resumes the stored
  thread with `excludeTurns: true` and its existing security/model configuration.
- [codexProcessRunner.ts:622](../src/server/agents/codexProcessRunner.ts#L622) sends the new input
  only after resume, thread identity and policy validation finish.
- [codexProcessRunner.ts:38](../src/server/agents/codexProcessRunner.ts#L38) classifies oversized
  events from the attempt's actual send state and explains failed resume before execution.
  [codexProcessRunner.ts:122](../src/server/agents/codexProcessRunner.ts#L122) recognizes unsupported
  protocol codes before matching authentication or missing-session text.
- [conversationService.ts:70](../src/server/conversation/conversationService.ts#L70) tracks input
  delivery across mode-interrupted attempts;
  [conversationService.ts:265](../src/server/conversation/conversationService.ts#L265) preserves
  `possibly-sent` for the logical saved message after any earlier potentially delivered attempt.
- [message/route.ts:311](../src/app/api/agent/message/route.ts#L311) brackets execution with saved
  message failure and checkpoint finalization;
  [runRegistry.ts:482](../src/server/runs/runRegistry.ts#L482) releases the completed run.
- [codexProcessRunner.test.ts:138](../test/codexProcessRunner.test.ts#L138) covers oversized history
  in Guarded/Native Local and Docker transports, ignored flags and protocol rejection;
  [runningMode.test.ts:104](../test/runningMode.test.ts#L104) verifies durable aggregate delivery
  before/after acknowledgement and failed-resume checkpoint/scheduler cleanup.

## Desired behavior

### Concrete changes

1. Send `excludeTurns: true` on every `thread/resume` issued by `CodexProcessRunner`, including
   Local, Docker, Guarded, Native, and a resumed attempt after an in-flight mode change. Keep the
   stored thread id, configuration overrides, policy echo checks, and the subsequent `turn/start`.
   New `thread/start` requests retain their current contract.
2. Use the existing stable API surface. Do not enable experimental capabilities, request earlier
   turns through another method, copy old turns into the prompt, compact the conversation, or
   start a replacement provider session automatically. CodeAI already owns its saved transcript.
3. Retain the 1 MiB event bound and configured assistant-answer bound. A server that ignores the
   field and emits a larger reply must still fail promptly, including for an unfinished event.
   An incompatible CLI that rejects the parameter must produce the existing unsupported-protocol
   error before execution; do not fall back to an unbounded full-history request. Describe the
   resume-stage size failure so the user can identify the failed operation.
4. At the runner boundary, construct resume-stage oversized-event errors with delivery `not-sent`.
   Once that attempt's new `turn/start` has been sent, preserve conservative `possibly-sent`
   delivery. Base this distinction on the attempt's actual request state, rather than the existence
   of an older provider thread. Do not rewrite unrelated runner error classifications.
   At the conversation boundary, delivery describes the whole saved user message across all mode
   attempts. Track whether an earlier attempt sent or may have sent its input, and promote a later
   attempt's `not-sent` failure to `possibly-sent` for that logical message when necessary. Do not
   infer delivery solely from a `turn-started` acknowledgement: input may have been sent before an
   acknowledgement arrived. A first-attempt resume failure still persists `not-sent`.
5. Preserve termination, pending-request rejection, permission cancellation, message persistence,
   checkpoint finalization and scheduler cleanup. A failed resume must not keep a machine busy.
   No session-format or browser/server wire change is needed.

## Acceptance criteria

- [x] A fixture whose resume history exceeds 1 MiB fails against the former implementation and
      succeeds with this change. The fixture omits history only when the request carries
      `excludeTurns: true`; the stored thread id remains the same and the new turn is sent once.
- [x] Local Guarded/Native, Docker transport, and mode-change resume coverage exercise the same
      flag while retaining their existing policy, model, effort and attachment contracts.
- [x] A server that ignores the flag and emits an oversized complete or unfinished resume reply
      fails promptly with delivery `not-sent`; no `turn/start` is recorded. A parameter rejection
      fails as unsupported protocol without an automatic fallback or replacement session.
- [x] A genuinely oversized event after `turn/start` remains bounded and conservatively marked
      `possibly-sent`; long streams made of individually bounded events still complete.
- [x] If a first attempt sent or may have sent input, a mode-interrupted resume failure before
      the next attempt's `turn/start` still durably marks the logical user message `possibly-sent`.
      Cover interruption before acknowledgement and after `turn-started`, while retaining the
      existing logical run, checkpoint, evidence and remaining budgets. When every attempt is known
      to be `not-sent`, the logical message also persists `not-sent`; preserve conservative unknown
      delivery rather than changing unrelated cancellation classification.
- [x] A failed resume durably fails the message, finalizes its checkpoint and releases the run.
      With no other operation active, existing maintenance/worktree admission can proceed.
- [x] A disposable real-CLI probe confirms small resume replies, unchanged provider identity and
      retained history when the same copy is subsequently resumed with history requested.
      No real user prompt, credentials, inference, or owner-session modification is required.
- [x] Focused regression tests, the offline suite, TypeScript, production build and independent
      review pass; verification records the CLI version and any unverified provider combinations.

## Out of scope

- Increasing protocol or answer limits; accepting oversized live tool output; paginating the
  browser transcript; automatic retry, compaction, or provider-session replacement.
- Changing security levels, approval routing, Docker mounts or worktree admission.
- Editing the owner's persisted session, reading provider credentials, or restarting their server.

## How to verify

1. Extend the fake Codex resume response and first run its regression against the former runner.
   Confirm it fails because the reply is oversized, not because of an unrelated setup error.
2. Run `npm test -- test/codexProcessRunner.test.ts test/runScheduler.test.ts` and the existing
   message-route, checkpoint and mode-change tests that exercise a runner failure/resume. Verify
   persisted delivery and resource release, not just the thrown error's text.
3. In a private temporary `CODEX_HOME`, use a disposable rollout fixture with more than 1 MiB of
   returned turns. Generate the installed CLI's schema, initialize an App Server, and resume the
   copy with and without `excludeTurns: true`. Record only response sizes, turn counts and thread
   identity checks. Resume with history again to confirm history was retained. Send no `turn/start`.
4. Run the offline suite with fixture settings, `npm run lint`, and a production build into an
   unused scratch build directory. Review the implementation independently. Deployment remains
   a separate owner action.

## Specification review

Independent read-only subagent review passed on October 7, 2026, after clarifying delivery across
mode-interrupted attempts: an earlier sent or possibly sent input must keep the saved message
`possibly-sent` even when its later resume fails before sending. The spec includes before- and
after-acknowledgement regressions and retains conservative unknown cancellation delivery.

The final implementation review also passed after correcting protocol-code precedence and adding
Native/Docker transport coverage. No critical or high-severity findings remain.

## Verification record

- The history/ignored-flag/unfinished-event regressions failed against the former runner before
  implementation. The final fixtures confirm unchanged thread identity, exactly one new input,
  retained bounds and no automatic fallback. Mode-change tests cover before/after acknowledgement,
  durable delivery, checkpoint finalization and released maintenance admission.
- Codex CLI 0.160.1, stable initialization and an isolated disposable copy of the older rollout:
  history requested returned 1,467,647 bytes/four turns; `excludeTurns: true` returned 5,201 bytes/
  zero turns; requesting history again returned 1,467,647 bytes/four turns. All three responses
  kept the same thread id. No credentials, inference, real prompt or owner-session writes.
- The complete offline suite, TypeScript and scratch production build passed alongside Story 98.
  See its verification record for the shared final counts and browser/Docker checks.
- Signed-in Docker inference and a new real-provider mode-change journey were not rerun. Transport
  and mode-change fixtures cover these paths; the real probe verifies resume semantics without
  inference. The owner's live application was not rebuilt or restarted.
