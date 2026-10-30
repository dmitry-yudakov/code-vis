# Story 119 — Show Codex's turn error in the client

**Status:** Shipped · **Type:** Server-only · **Depends on:** [Story 20](STORY-20260817-web2-codex-provider.md)

**Vision slice:** [Inside a session](../docs/vision.md#inside-a-session): actionable feedback when an agent cannot finish.

## Motivation

Codex reported `serverOverloaded: Selected model is at capacity. Please try a different model.`
in the server console, while the client displayed an unrecoverable turn error. Show the reason
the provider supplied so the user can choose a different model and continue.

## Implementation (where the code is)

- [codexProcessRunner.ts:693](../src/server/agents/codexProcessRunner.ts#L693) creates a bounded,
  sanitized `AgentRunError` from the provider's details, shared by terminal `error` notifications
  at line 853 and failed `turn/completed` events at line 872.
- [message/route.ts:371](../src/app/api/agent/message/route.ts#L371) streams an `AgentRunError`'s
  message with its delivery and retry contract, after recording the failed user message.
- [runPresentation.ts:66](../src/features/conversation/runPresentation.ts#L66) retains that
  message for client error presentation; no wire or UI change is required.
- [codexProcessRunner.test.ts:821](../test/codexProcessRunner.test.ts#L821) covers both event
  forms, capacity errors, invalid details, sanitization, authentication and provider retries.
- [runningMode.test.ts:106](../test/runningMode.test.ts#L106) exercises the fixture process,
  message route, client outcome, durable failure, checkpoint cleanup and successful continuation.

## Desired behavior and invariants

Use the same failure handling for non-retrying `error` notifications and failed `turn/completed`
events. Show `Codex: <provider message>`, using the existing 160-character sanitized detail
bound, whitespace/control normalization and checkout/attachment path redaction. Missing, invalid
or blank messages fall back to `Codex turn failed.` Keep the existing authentication guidance
for `unauthorized`, including structured error kinds.

Preserve provider retries (`willRetry: true`), process/approval cleanup, conservative
`possibly-sent` delivery, checkpoint finalization, scheduler release and explicit user retry.
The lifecycle contracts from Stories 97, 102 and 103 remain intact. Do not expose raw stderr
or change RPC/startup error classification, automatically retry, or restart the running app.

## Acceptance criteria

- [x] Capacity messages survive both terminal event forms with their actionable text.
- [x] Invalid/blank messages have a useful fallback; long messages are bounded, control characters
      normalized and run paths redacted. Authentication guidance remains intact.
- [x] A transient provider error can still recover and deliver a completed answer.
- [x] A real fixture runner through the message route delivers the error to the client presentation,
      durably fails the message, finalizes recovery and releases admission; a subsequent turn succeeds.
- [x] Focused tests, TypeScript and an independent review pass. Changes are scoped for the requested
      separate commit.

## How to verify

Run the new runner regressions before implementation and confirm they fail on lost provider text.
Then run `npm test -- test/codexProcessRunner.test.ts test/runningMode.test.ts test/runPresentation.test.ts`
and `npm run lint`. Record actual results and any environments not exercised below.

## Verification record

- Before implementation, all eight selected capacity runner/route cases failed because provider
  details were replaced with generic errors.
- All 131 focused checks pass with
  `npm test -- test/codexProcessRunner.test.ts test/runningMode.test.ts test/runPresentation.test.ts --maxWorkers=1 --reporter=dot`.
  The first parallel run failed the existing forced-local-shutdown assertion once; its isolated
  rerun and the final complete focused rerun passed. Shutdown behavior was not changed.
- `npm run lint` and `git diff --check` pass. Independent read-only review found no blocking issues
  and independently reran the eight capacity runner/route cases successfully.
- Local Guarded/Native and a fixture Docker transport are covered. A real capacity incident,
  real Docker daemon, production browser/build and headset were not exercised. The running app
  was not restarted.
