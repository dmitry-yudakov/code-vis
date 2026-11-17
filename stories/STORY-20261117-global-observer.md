# Story 147 — Manage sessions through a global text and voice observer

**Status:** In progress · **Type:** Full-stack · **Depends on:** Stories 47, 129 and 134

## Motivation

> I want to have a global observer that I could use in text or voice mode that would observe
> all sessions and help me manage them … when I'm on the way and cannot type but can speak.

Start with one conversation that answers “What needs me?” across projects and machines, and
can relay an instruction to an existing session. This advances the breadth/orchestration goal
in [the Arena vision](../docs/vision.md#thesis). The user agreed to this first slice on November 17.

## Implementation (where the code is)

- [workspaceFeed.ts:159](../src/server/workspace/workspaceFeed.ts#L159) aggregates the home and
  directly attached executors into one shared live Arena feed. Offline peers retain cached summaries.
- [types.ts:580](../src/shared/types.ts#L580) defines session summaries with identity, revision,
  latest-message excerpt and completion metadata. These are not complete conversations.
- [arenaModel.ts:123](../src/features/arena/arenaModel.ts#L123) derives session state;
  [arenaModel.ts:248](../src/features/arena/arenaModel.ts#L248) derives attention items.
- [useArenaReplies.ts:80](../src/features/arena/useArenaReplies.ts#L80) delivers background replies
  to a specific machine/session, with frozen delivery identities and acceptance reconciliation.
  [sessionLaunch.ts:55](../src/features/session-launch/sessionLaunch.ts#L55) owns the delivery transport.
- [AppShell.tsx:2194](../src/features/shell/AppShell.tsx#L2194) resolves Arena reply mode/model from
  a saved device view or device preferences, filtered against the executing provider's capabilities.
- [observerService.ts:74](../src/server/observer/observerService.ts#L74) owns shared snapshot reads,
  restricted inference, one optional bounded session read, admission and cancellation.
- [observer.ts:1](../src/shared/observer.ts#L1) validates requests and structured output;
  [observerModel.ts:4](../src/features/observer/observerModel.ts#L4) counts every active session,
  prioritizes named matches and attention, and bounds each context page and permission excerpt.
- [ObserverDialog.tsx:23](../src/features/observer/ObserverDialog.tsx#L23) is the global MUI surface;
  [useObserver.ts:15](../src/features/observer/useObserver.ts#L15) retains independent drafts and
  pending requests. [observerDelivery.ts:58](../src/features/observer/observerDelivery.ts#L58)
  validates previews and reuses background delivery with canonical acceptance reconciliation.
- [observerVoice.ts:61](../src/features/observer/observerVoice.ts#L61) owns conversational input,
  local transcription, spoken output and half-duplex turn-taking.
  [voiceCapture.ts:8](../src/features/conversation/voiceCapture.ts#L8) adds a reusable input lease;
  [voice/route.ts:19](../src/app/api/voice/route.ts#L19) transcribes through local Whisper.
  [useVoiceDraft.ts:7](../src/features/conversation/useVoiceDraft.ts#L7) is a session-scoped,
  explicitly reviewed dictation flow, independently of the Observer.
- [ActivityBar.tsx:23](../src/features/shell/ActivityBar.tsx#L23) exposes global navigation and More.

## Desired behavior

### One small surface

Add **Observer** to the existing More menu on desktop and phone. Open a text conversation with
an input, **Voice** / **Stop voice**, and links to the sessions it mentions. Use ordinary MUI
controls and a full-width presentation on phones. No canvas or separate dashboard is needed.

The Observer belongs to the workspace, independent of the selected project or conversation.
Navigation keeps its conversation and draft within the current browser tab. For this MVP, a
reload starts a fresh Observer conversation; durable cross-device Observer history is deferred.
Existing session histories and delivery records keep their existing owners.

### Observe broadly, answer briefly

Observe all active sessions on the home machine and its directly attached executors through the
existing shared snapshot owner. Show exact state counts and answer questions such as:

- “What's running, and what needs me?”
- “What did the login session finish?”
- “Which session should I look at next?”

Generate a short briefing on request, prioritizing pending user attention, failures, then recent
completions. Distinguish saved facts from suggested next steps; Idle is not evidence of completion
or a stuck agent. Identify sessions by project and title, adding the machine when needed.
For a question about one session, read bounded recent saved conversation text through its existing
authorized session route. Say when excerpts omit context or work is still running.

Live observation updates counts without invoking a model on every snapshot. Each user question
uses current observations. A changed snapshot during inference does not make an earlier answer
current: retain its observation time and recheck before acting. Offline data is explicitly described
as last seen, with its timestamp; it cannot authorize actions.

### One management action: send a follow-up

Example journey:

1. User: “What needs me?”
2. Observer: “The login session in Shop is waiting for your choice of authentication library.
   The test session is still running.”
3. User: “Tell the login session to use the existing library and continue.”
4. Observer reads/shows the exact target and proposed message: “Shop, login: ‘Use the existing
   authentication library and continue.’ Send it?”
5. User says “Send it” or presses **Send**. Observer reports **Sent** only after canonical acceptance.

The model can propose one plain-text follow-up at a time; it cannot execute actions. Resolve the
proposal to a machine/session/main-agent identity and validate it against current canonical state.
Ambiguous names produce a brief choice, with voice answers supported. Confirmation applies only
to the current preview; changing its target or message requires a new preview. “Cancel” discards it.

Reuse the existing background delivery transport and acceptance reconciliation, with a separate
Observer draft and pending-delivery record. Preserve the user's ordinary conversation and Arena
reply drafts. Reuse Arena's mode/model resolution: the device's saved target-session view when
present, otherwise its inherited device preferences, filtered against current execution/provider
capabilities. Show the resolved choices in the preview. This must work on a phone that has never
opened the target session. Unsupported choices retain the draft and offer **Open session**;
the Observer cannot request more access than the previewed mode.
Busy, queued, archived, offline, unavailable-provider or repository-less targets give a concise
reason and retain the proposed message. Do not silently queue a new follow-up or restore a session.

### Voice is a conversation

One tap starts voice mode and obtains microphone permission. After that, the user can ask a
question, hear its answer, disambiguate a target, confirm a send, and ask another question without
typing or tapping between turns. End an utterance after a short silence; retain the existing
60-second clip bound. After 15 seconds without initial speech, pause listening with a visible
Resume action. Silence and empty transcription never submit a request or confirm an action.

Reuse the local Whisper endpoint for input. Add browser speech synthesis for output, selecting an
available device voice; check whether it is local rather than promising all voices run locally.
The [SpeechSynthesis API](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis)
provides voice discovery, playback and cancellation. Remote microphone use requires a trusted
secure origin and permission, as described by
[getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).

Keep the visible transcript in both modes. Suspend capture during transcription, inference and
playback so the Observer cannot hear its own response. Resume listening after playback completes.
Support **Stop voice** throughout and spoken “Stop listening” during listening. Close/navigation
away from the Observer, hidden-page transitions, revocation and microphone loss release capture
and stop playback. Resuming requires an explicit gesture; voice does not restart itself on reload.
Keep ordinary navigation usable; abandoning audio cannot abandon an accepted target-session run.

The separate Observer voice owner reuses one audio context and microphone stream across clips,
while the capture primitive's single-clip VR defaults and dictation/review behavior are preserved.
Repeated cycles pass automated checks; physical phone verification remains pending.
If microphone, Whisper or speech output is
unavailable, keep text usable and show one concise recovery action. Full voice acceptance requires a real foreground
phone run; a mocked speech API is insufficient. Background/locked-phone operation is deferred.

### Ownership, limits and recovery

- Add a home-only, device-authorized Observer inference route. It obtains authoritative snapshot
  context server-side, routes optional session reads through existing machine authorization, and
  validates bounded request/output schemas. Browser-supplied history and observed session text
  are untrusted data. Do not give the model shell, repository, permission or mutation tools.
- Resolve names using snapshot context. A strict model response can request one session read by
  machine/session id; validate membership, read its bounded recent text, then make one final
  tool-free answer/proposal inference. Allow at most this one read-and-answer step per question,
  within the same admission/deadline; ambiguity returns choices. This avoids both arbitrary model
  tools and pretending a 600-character summary is the full reply. Model-produced follow-up
  proposals are structured data with validated target ids and bounded plain text; only the existing
  delivery owner can send them after user confirmation.
- Reuse the restricted provider invocation pattern with a distinct Observer purpose, a fresh
  provider session and private scratch directory; leave title/archive-check limits unchanged.
  Run with an available home Local provider using the device's existing provider/model choices.
  Disclose that supplied session excerpts go to that provider, including excerpts from other machines.
- The inference owner admits one Observer request per home process, with no pending inference
  queue, a 60-second deadline and an 8 KiB UTF-8 output limit. Busy/timeout/invalid output preserves
  the question and enables Retry; ordinary session scheduling and automatic checks stay independent.
- Bound supplied context to 64 KiB UTF-8 per inference, plus the current question (at most the
  existing 8,000-character voice/draft limit) and fixed instructions. Include at most six recent
  Observer exchanges and at most 16 KiB of selected-session text within that context budget.
  Compute counts over every active session before selecting detail rows. Page rows deterministically
  by attention priority and machine/session identity; report included/total counts and support
  “more” or naming a session. Never describe a partial briefing as an exhaustive transcript review.
- Keep the latest 100 transcript messages only in tab memory. Preserve the current question and frozen pending
  delivery in bounded tab storage using the existing draft/delivery conventions. A restored
  delivery record supplies its own preview and identity; it does not depend on restored chat history.
  Raw audio stays in memory and is discarded after transcription or cancellation.
- A follow-up has one stable message UUID and immutable target/content/recipient/mode/model.
  Persist that record before sending. On uncertain delivery or reload, reconcile the original UUID
  before offering retransmission; never create a fresh send automatically. Revalidate availability
  for a new POST. Changed targets or settings invalidate an unsent preview, while an uncertain
  attempt retains its original identity, including after an absent history snapshot: a hidden
  pre-activation reservation may still be appending. Briefings remain usable while another action
  waits for delivery reconciliation. Keep **Check delivery** and **Open session** available.
- Preserve Stories 129/134's stale/offline action restrictions and exact-send recovery, Story 138's
  archive ownership, and Story 47's microphone cleanup and explicit dictation review. The existing
  permission owner remains authoritative; an Observer “yes” confirms only its follow-up preview.
  Observing or reading a briefing does not acknowledge Inbox items.

## Acceptance criteria

- [x] One global Observer is reachable on desktop/phone and retains its draft during navigation.
- [x] Briefings cover all active-machine/session counts, identify sources and incomplete context,
      and correctly prioritize attention without confusing Idle, completed and Offline.
- [x] A user can ask about a named session and receive an answer grounded in recent saved text.
- [x] A confirmed single-session follow-up arrives once with the previewed identity, text and
      execution choices; ordinary drafts remain intact and ambiguous targets require a choice.
- [ ] After starting voice mode, the briefing → instruction → readback → confirmation → next
      question journey works without typing or intermediate taps in a foreground phone browser.
- [x] Busy targets, provider/Whisper/speech failures, stale observations, cancellation, hidden pages,
      reload and uncertain sends preserve drafts, release audio resources and prevent duplicate work.
- [x] Restricted inference, input/output limits, overload and authorization/revocation are verified;
      no Observer answer can itself decide a tool approval or mutate a session.
- [ ] Focused unit and production-browser checks, TypeScript, isolated build, both-theme
      desktop/phone visual inspection, real-phone voice acceptance and independent review pass.

## Out of scope

Autonomous follow-ups, scheduled model scans, proactive spoken announcements, rules, session
creation/archive/cancel controls, bulk actions, permission approvals, direct repository edits,
durable Observer history, archived-history search, wake words, background/locked-phone audio,
and VR Observer UI. Existing session queuing and opt-in automatic archiving remain the available
automation; a later story can add one observer-driven action after real use establishes its value.

## Implementation order

1. Reusable capture lifetime and three automatic listen/transcribe/reply/listen cycles pass mocked
   unit and production-browser checks. The intended physical phone/Whisper run remains pending.
2. The text surface, bounded briefings and selected-session reads use shared snapshots.
3. One previewed follow-up reuses delivery/reconciliation, and voice uses those same text intents.

## How to verify

1. Seed two projects, duplicate session titles, a running turn, a pending approval, a failed turn,
   an idle session and a recent completion across the home and an attached executor. Ask for a
   briefing, a target-session explanation and more detail beyond the context page. Check exact
   counts, source identities, timestamps, text omissions and unchanged Inbox read state.
2. Send a follow-up in text and voice. Assert the target's canonical user message and its run
   acceptance, with unchanged drafts elsewhere. Test duplicate confirmations, changed main agents,
   modes and revisions, an archived/busy target, disconnect after acceptance, reload, and retry.
3. With fake provider/voice adapters, exercise successful replies as well as malformed output,
   tool attempts, context overflow, admission rejection, timeout, revocation and out-of-order
   responses after navigation. Confirm neither injected transcript instructions nor stale previews
   can send a message. Preserve existing Arena/queue/archive and VR voice regressions.
4. On the actual paired phone over trusted HTTPS, run the complete voice journey with local
   Whisper and a real provider. Verify silence handling, speech playback/capture separation,
   spoken cancel/stop, microphone denial, page hiding and resumption. Record browser/device,
   language, voice availability and whether the selected output voice is local. Inspect desktop
   and phone UI in both themes. Run TypeScript, an isolated production build and independent review.

## Verification — November 17, 2026

The initial contract tests failed before implementation. All **40 focused unit checks** in Observer
model/service/delivery/voice/routes and machineClient pass, including bounded UTF-8 pages, a named
session beyond the first page, oversized approval rows, forbidden model actions, one-read inference,
admission, exact delivery/reconciliation, changed choices, storage failures, three automatic voice
turns, silence, microphone loss and abandonment. Both provider adapters also test the Observer's
restricted invocation alongside the existing title/archive-check purposes.

With inherited application settings removed from the test child environment and localhost/IPC
enabled, the full suite passes **2,257 of 2,258 checks**. The sole failure is the existing
`visualLanguage` assertion requiring `next/font/google`; Story 139 intentionally uses local fonts.
Neither that test nor `src/app/layout.tsx` changed. The additional response-cancellation regression
passes in the focused run after that full-suite pass. Earlier sandbox/inherited-environment failures
were resolved by enabling test sockets and isolating runtime settings, without changing app settings.

**Eight new production-browser journeys** pass: both themes at desktop/phone sizes, independent
conversation drafts, confirmed canonical sends, invalid output recovery, frozen reload/retry,
microphone denial, three automatic voice turns and navigation during voice inference. Four
desktop/phone light/dark screenshots were visually inspected. Six existing production-browser
regressions pass: four Arena reply/uncertain-delivery cases and both VR reviewed-voice setup cases.

TypeScript, the normal isolated production build at `.next-e2e/observer`, whitespace checks and
independent review pass. Review findings were fixed with coverage: device fallback choices,
named-session lookup, large permission rows, microphone loss between clips, aging Ready counts,
uncertain UUID retention with usable read-only queries, and navigation resetting audio controls.

A real Codex inference against a synthetic session in a temporary store returned a valid idle
briefing with no action. It used the production restricted runner and did not read real session data.
Real phone microphone/Whisper quality, device speech playback and foreground turn-taking still
require the intended paired phone; mocked APIs do not close that acceptance gate. Live attached
executor transport and a real Claude Observer inference were not rerun. Status remains In progress
for the physical-phone gate. The running application has not been rebuilt or restarted.
