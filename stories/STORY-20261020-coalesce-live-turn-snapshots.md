# Story 111 — Keep large turns observable through activity bursts

**Status:** Shipped · **Type:** Server-only · **Depends on:** [Story 107](STORY-20261013-chronological-chat.md)

## Motivation

On October 20, a completed Codex turn lost both its original UI stream and its reconnect stream
with “The event reader fell behind.” Its saved history was about 740 KiB. Fourteen snapshots of
that history emitted synchronously reproduce the error even with a continuously consuming reader;
the same snapshots delivered with event-loop yields succeed.

This supports [the conversation change loop](../docs/software-model.md) and the
[architecture principles](../docs/architecture.md#development-principles). A bounded transport must
also deliver supported activity and the final result.

## Original behavior (where the code was)

- [conversationService.ts:85](../src/server/conversation/conversationService.ts#L85) publishes the
  full history after each activity update; persistence coalesces separately.
- [runRegistry.ts:384](../src/server/runs/runRegistry.ts#L384) retains the latest history but forwards
  every live event. It owns execution, permissions, and replay independently of browser attachments.
- [eventStream.ts:31](../src/app/api/agent/eventStream.ts#L31) serializes and enqueues each event,
  disconnecting once the 8 MiB pending-byte queue fills.
- [turnHistoryStream.test.ts:8](../test/turnHistoryStream.test.ts#L8) proves safe detachment but
  currently expects snapshot bursts to disconnect.
- [ndjson.ts:1](../src/features/conversation/ndjson.ts#L1) is the real browser event decoder;
  [stream/route.ts:31](../src/app/api/agent/stream/route.ts#L31) reports the exact replay-event count.

## Desired behavior

Coalesce superseded live history snapshots before serialization and deliver pending events when
the stream consumer pulls. Retain required events in order and drain pending output on completion.
Preserve the exact replay prefix so the browser can distinguish historical attention from new work.

### Affected invariants and failure paths

The path is provider → conversation → registry → stream → decoder → reconnect. The registry remains
the owner of execution, permissions, and checkout access; transport cancellation/overflow only
detaches its subscriber. The stream owns bounded pending delivery: at most one pending live history
snapshot (already bounded by the 1 MiB turn contract), plus an 8 MiB queue of required serialized
events. Unrecoverable required-event overflow may detach for registry replay; replaceable history
bursts alone must not force detachment. Final events must drain even after provider completion.

Commit `cef1764` removed the provider's cumulative-output limit. This fix must not reintroduce a
lifetime-output cap or rely on raising the 8 MiB required-event queue limit. The separately bounded
pending snapshot is part of the explicit attachment memory contract above.

## Acceptance criteria

- [x] A continuously consuming decoder receives the latest large history, approval events, and
      final result through a burst whose uncoalesced snapshots exceed 8 MiB.
- [x] A paused reader retains only the latest pending live snapshot; resuming yields current
      activity without losing approval semantics or releasing checkout ownership.
- [x] Pending output drains after completion; replay prefix counts and required-event order remain
      correct, including finished-run replay.
- [x] Required-event overflow and reader cancellation detach safely; replay still recovers current
      activity and permissions. Producer rejection closes the attachment without an unhandled error.
- [x] Regression tests fail before the fix; focused checks, TypeScript, an isolated production
      build, appropriate browser checks, and independent review pass.

## Out of scope

Provider policies, execution budgets, session formats, persistence retention, UI redesign, and
deployment/restarting the owner's running application.

## How to verify

Run the real registry/stream/browser decoder regressions in `test/turnHistoryStream.test.ts` and
conversation persistence integration coverage. Exercise the conversation/reconnect browser checks
against an isolated production build. Record results and remaining environment gaps below.

## Implementation (where the code is)

- [eventStream.ts:25](../src/app/api/agent/eventStream.ts#L25) owns the bounded pending delivery
  queue, one replaceable live snapshot, read demand, and drain/cancel/error lifecycle. Replay is
  encoded separately so its advertised count stays exact.
- [turnHistoryStream.test.ts:17](../test/turnHistoryStream.test.ts#L17) covers paused and continuously
  consuming readers, large bursts, required-event ordering, approval/checkout ownership, reliable
  overflow/recovery, cancellation, and producer failure through the real NDJSON decoder.
- [runRoutes.test.ts:103](../test/runRoutes.test.ts#L103) preserves the replay prefix before live
  activity and drains finished-run replay through the actual route.
- [turnHistoryConversation.test.ts:38](../test/turnHistoryConversation.test.ts#L38) feeds a large
  provider burst through conversation orchestration, registry, stream, decoder, and durable final
  storage, verifying the same final answer after session reload.
- [chronological-chat.spec.ts:58](../e2e/chronological-chat.spec.ts#L58) sends a fake provider's
  large tool-history burst through an isolated production server and Chrome, approves its request,
  completes without reattachment, checks saved history exceeds 700 KiB, and reloads the final answer.

## Verification — October 20, 2026

- Before implementation, the new large-history burst and paused-reader regressions failed with
  the reported disconnect. Replay coalescing and producer failure checks also failed (five total).
- All 26 focused offline checks pass across `turnHistoryStream`, `runRoutes`,
  `turnHistoryConversation`, `turnHistoryStore`, `turnHistoryWriter`, and `ndjson`.
- TypeScript and the isolated production build pass:
  `CODEAI_DIST_DIR=.next-e2e/ui-design npm run build`.
- Eleven production-browser checks pass across the chronological chat cases and targeted session
  launch/reconnect cases. The new burst case passes with realistic collapsed tool output,
  retaining actionable approval and saved completion without a second stream attachment.
- The full offline suite passes 1,548 of 1,549 checks. Its sole failure is the untouched
  `composerMenus` assertion expecting `MuiOutlinedInput-root` after the earlier composer redesign.
  Running that file against an isolated `git archive HEAD` reproduces the same failure. Initial
  sandbox-only fixture/subprocess failures disappear with normal test filesystem/process access.
- Astra reviewed both the design and implementation without blockers. Its additional event-order
  assertion is included; waiting-reader finish/reject/finish-after-read probes also pass.

An initial browser fixture used three enormous unbroken visible paragraphs and exposed a separate
Chrome layout stall; the actual HTTP stream still delivered approval and completion. That rendering
case remains a separate follow-up. The accepted transport fixture uses large accumulated tool
outputs, matching the reported turn. Real signed-in providers, Docker/attached transport, and Quest
were not rerun. The owner's running application was not restarted.
