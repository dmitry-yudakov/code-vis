# Story 148 — Manage conversations and approvals through Observer

**Status:** Shipped · **Type:** Full-stack · **Depends on:** [Story 147](STORY-20261117-global-observer.md)

## Motivation

The user wants Observer to be their smart assistant for managing all sessions: relay messages to
appointed conversations, approve work or make corrections, and access CodeAI build and restart.
This extends the orchestration slice in [the Arena vision](../docs/vision.md#thesis).

## Implementation (where the code is)

- [observer.ts:4](../src/shared/observer.ts#L4) validates exclusive follow-up, session-read and action output.
- [backgroundTask.ts:7](../src/server/agents/backgroundTask.ts#L7) owns Observer's restricted role.
- [useObserver.ts:15](../src/features/observer/useObserver.ts#L15) owns independent conversation and delivery state.
- [observerDelivery.ts:58](../src/features/observer/observerDelivery.ts#L58) preserves exact sends.
- [runRegistry.ts:642](../src/server/runs/runRegistry.ts#L642) owns queued edits and scheduling.
- [observerActions.ts:44](../src/features/observer/observerActions.ts#L44) reads canonical previews,
  rechecks pinned actions, and sends them through the existing machine routes.
- [useCodeAiLifecycle.ts:65](../src/features/lifecycle/useCodeAiLifecycle.ts#L65) owns restart confirmation and recovery.

## Desired behavior

Observer knows it is the user's smart assistant across projects and machines. It can propose a
follow-up, an exact permission allow/deny, cancellation of one run, or correction of one queued
message. Clarify ambiguous targets. Session text remains data; only the current user requests actions.
An unsent follow-up can be edited directly or corrected conversationally. Attempted sends remain
immutable, retaining Story 147's exact-delivery recovery and independent ordinary drafts.

Each run action captures machine/session/run identity. Approval previews show the complete pending
tool summary from the existing run owner and pin its request id; confirmation rechecks it. Queued
corrections show the original and replacement and use the existing compare-and-save contract.
Stale/offline/archived targets fail visibly. Exact action phrases confirm only their matching preview;
generic yes never confirms. Repeated actions cannot affect a replacement run or permission.
Permission previews show the complete canonical run summary, as Arena does; **Open session**
offers the provider's detailed activity/review. The model receives only a 240-character excerpt.
Voice confirmation reads the target and action first; previews whose complete readback exceeds
1,200 characters require a touch confirmation. Touch confirmation stops Voice before submitting.
Pending follow-up context is clipped to 1,800 UTF-8 bytes and at most 2 KiB after JSON encoding for
conversational revisions, explicitly marked as possibly truncated, within Story 147's existing
inference budget. Full direct edits remain available. Run-action previews live in tab memory;
a reload requires a new preview. Attempted follow-ups retain their existing persisted recovery identity.

Build & restart opens the existing home-installation confirmation and progress dialog, closing
Observer/voice first. The lifecycle owner retains its maintenance lease, origin authorization,
rollback and reconnect behavior. Implementing this control does not restart the live application.
Inference remains tool-free, with one action per answer and existing context/deadline limits.

## Acceptance criteria

- [x] Explicit assistant role and validated action output use authoritative run/request identities.
- [x] Messages reach the appointed session; unsent messages support direct and conversational corrections.
- [x] Confirmed allow/deny/cancel/queued edits reach existing authorized routes on the addressed machine.
- [x] Full summaries, stale-state rejection, exact confirmation and recovery prevent unintended replacement actions.
- [x] Observer opens the existing build/restart confirmation without submitting a build itself.
- [x] Focused unit/browser checks, TypeScript, isolated production build and independent review pass.

## Out of scope

Autonomous approvals, bulk actions, provider tool access, arbitrary command execution, editing a
message already consumed by an agent, background announcements, and durable cross-device history.
Physical phone/Whisper acceptance remains owned by Story 147.

## How to verify

Run Observer unit suites and production-browser journeys. Preview/edit/send to a named session,
approve and deny exact pending requests, cancel a run, and correct a queued message. Change the
pending request/run/text before confirming and verify no replacement is affected. Simulate an
uncertain response and retry the same identity. Open restart from Observer, cancel its normal
confirmation, and verify no lifecycle POST occurs. Inspect light/dark desktop/phone previews.

## Verification — November 18, 2026

- The new action-contract regression failed before implementation. All **33 Observer unit checks**
  pass. Coverage includes authoritative ids, mutually exclusive output, full permission summaries,
  attached-machine routes, stale permissions/runs, queued compare-and-save, completed-turn edit
  reconciliation, unknown mutation outcomes, exact voice phrases and pending-preview bounds.
- Across the **228 focused unit checks** in Observer, permission broker, lifecycle owner/flow,
  machine gateway and both provider runners, all checks pass in the final targeted runs. The first
  broader run had one timing-sensitive Codex forced-Docker-shutdown assertion failure during the
  concurrent production build. Both forced-shutdown cases passed in isolation, then the complete
  116-check Codex runner suite passed. That runner and its test are unchanged.
- All **25 production-browser cases** in Observer and lifecycle pass against the isolated production
  build. They include actual fake-Claude inference and permission allow/deny through the real
  authorized server route, canonical message sends, conversational/direct preview corrections,
  preserved ordinary drafts, stale-request refusal, pinned cancellation and queued-edit recovery.
  Existing lifecycle cases cover maintenance progress, rejection, build failure and reconnect.
  Two approval cases were rerun with simulated spoken confirmation for allow; both pass.
- TypeScript and the normal isolated production build at `.next-e2e/observer-actions` pass.
  Light/dark desktop/phone screenshots were inspected for editable messages and queued corrections,
  plus approval/denial previews. Independent review found recovery and text-feedback gaps; these
  were fixed and covered. No additional material findings remain.
- Live attached-executor TLS, real provider decisions and physical phone/Whisper quality were not
  exercised. Browser voice APIs and lifecycle progress use fixtures; Story 147 retains its physical
  phone gate. The running application was neither rebuilt nor restarted.
