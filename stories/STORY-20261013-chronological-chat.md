# Story 107 — Keep chat activity in order and approvals within reach

**Status:** Shipped · **Type:** Full-stack · **Depends on:** [Story 106](STORY-20261013-mui-desktop-ui.md), [Story 102](STORY-20261009-codex-subagent-approvals.md), [Story 103](STORY-20261009-codex-subagents.md)

## Motivation

The user, on October 13, 2026:

> I don't like that currently we show the Approve at the top and sometimes it's hidden;
> texts from tool calls are accumulated at one message at the bottom — also weird.
> when sending message — it stays there forever — it should only be in the history.
> The tool calls should be visible, sorted as they come, with their details.

The conversation should tell the story of a turn as it happens: the instruction, the agent's
commentary, individual tool calls and their results, any approval, and the final answer. The next
action must stay reachable while the person reads that history.

This supports [Inside a session](../docs/vision.md#inside-a-session), the
[shared-state surface model](../docs/vision.md#surfaces-web-desktop-vr), and the conversation side of
[the software model's change loop](../docs/software-model.md). It takes the persistent-tool-history
follow-up out of the [workbench shell epic's server backlog](EPIC-20260925-workbench-shell.md#needs-the-server-separate-full-stack-stories-not-scheduled-here).
This is a separate full-stack story; that epic's presentation-only rule still governs its other
stories. Story 76 retains non-conversation pane styling. Domain names follow
[vocabulary.md](../docs/vocabulary.md).

### Evidence from the current UI

The October 13 audit captured the existing production build with a simulated Claude turn in an
isolated local store. These are real UI captures with fixture conversation content, not captures
of the owner's paired live session. Local, Git-ignored artifacts:

- [1440×900, latest activity](../test-results/chat-ui-audit-20261013/02-running-bottom.png).
- [1440×900, beginning of the turn](../test-results/chat-ui-audit-20261013/04-running-top.png).
- [1000×800, approval offscreen](../test-results/chat-ui-audit-20261013/06-running-1000.png).
- [Completed turn, activity gone](../test-results/chat-ui-audit-20261013/07-completed.png).

The narrower capture hides the entire approval card. The sent instruction still fills the
disabled composer; its history entry says `sending` and offers Retry while tools are running.
Completion removes the tool list and intermediate commentary. A large empty canvas leaves the
conversation narrow, and routine checkpoint prose and repeated agent labels consume space.
The fixture described in How to verify must reproduce these states on a fresh checkout; the
local PNGs are supporting evidence, not a required source dependency.

## Before implementation (original audit locations)

- [ConversationDrawer.tsx:96](../src/features/conversation/ConversationDrawer.tsx#L96) — scrolls to
  the end on every text/activity/permission change; renders saved messages, one tool list,
  permission cards, and one accumulated preview in separate sections.
- [runPresentation.ts:106](../src/features/conversation/runPresentation.ts#L106) — retains at most
  100 tool summaries, appends text to one string, and removes resolved permissions.
- [AppShell.tsx:1266](../src/features/shell/AppShell.tsx#L1266) — Retry prefills text and available
  evidence; images require reattachment. The send at
  [:1590](../src/features/shell/AppShell.tsx#L1590) clears text/images/reports/files only after a
  successful final answer; [consumeStream:1307](../src/features/shell/AppShell.tsx#L1307) handles replay.
- [InstructionComposer.tsx:403](../src/features/conversation/InstructionComposer.tsx#L403) — disables
  the textarea while running. [ChatMessage.tsx:53](../src/features/conversation/ChatMessage.tsx#L53)
  exposes Retry whenever a user message is not `sent`.
- [PermissionCard.tsx:10](../src/features/agents/PermissionCard.tsx#L10) and
  [usePermissionDecisions.ts:11](../src/features/shell/usePermissionDecisions.ts#L11) — current card
  and shared decision owner; the latter preserves exact routing and uncertain-decision handling.
- [types.ts:584](../src/shared/types.ts#L584) and
  [types.ts:733](../src/shared/types.ts#L733) — public and process events omit tool identity,
  results, completion, and assistant text-block identity.
- [claudeProcessRunner.ts:55](../src/server/agents/claudeProcessRunner.ts#L55) — short tool/approval
  descriptions; [:313](../src/server/agents/claudeProcessRunner.ts#L313) projects text and tool starts
  without tool results. [codexProcessRunner.ts:460](../src/server/agents/codexProcessRunner.ts#L460)
  similarly reduces provider items to labels, despite receiving item identities and completion.
- [conversationService.ts:78](../src/server/conversation/conversationService.ts#L78) — turn/event
  projection and final answer commit. [message/route.ts:277](../src/app/api/agent/message/route.ts#L277)
  saves the user message before scheduler activation, then returns `X-CodeAI-Run-Id` at
  [:423](../src/app/api/agent/message/route.ts#L423), including for queued work.
- [runRegistry.ts:380](../src/server/runs/runRegistry.ts#L380) — bounded in-memory replay separates
  all text into `deltaText`; subscribe appends that text after the other events. Finished replay
  expires after five minutes and is not durable conversation history.
- [sessionSchema.ts:194](../src/shared/sessionSchema.ts#L194),
  [sessionStore.ts:762](../src/server/storage/sessionStore.ts#L762), and
  [tempAttachments.ts:151](../src/server/storage/tempAttachments.ts#L151) — strict versioned
  messages, atomic final commit, and temporary image evidence. Image history records type/size,
  not reusable bytes.
- [panelLayout.ts:43](../src/features/shell/panelLayout.ts#L43) and
  [usePanelLayout.ts:55](../src/features/shell/usePanelLayout.ts#L55) — device-local layout defaults
  and restoration. [TurnCheckpoint.tsx:7](../src/features/conversation/TurnCheckpoint.tsx#L7) and
  [globals.css:396](../src/app/globals.css#L396) — checkpoint presentation and transcript styling.

## Desired behavior

### 1. One chronological turn

Render user messages and agent work in one scrollable conversation. Within a turn, preserve the
executing server's observed event order; do not sort by completion time or client clock. A typical
turn reads:

```text
You       Improve the chat approval flow.
Claude    I'll inspect the conversation renderer.
  ✓ Read  ConversationDrawer.tsx                 [Details]
Claude    The approval precedes the accumulated text.
  ✓ Run   rg -n 'permission' src                  [Details]
  ? Edit  ConversationDrawer.tsx · needs approval [Review]
```

Each tool appears when first reported and keeps that position as its status and output update.
Show a readable name and command/path summary, with an accessible disclosure for arguments,
output, exit/error information, and proposed/applied diffs when the provider supplies them.
Long output is collapsed; short summaries stay visible. Failures expose a short error by default.
Status names distinguish running, succeeded, failed, denied, cancelled, and unknown outcome.
Only provider evidence can establish success; starting a later tool or ending the parent turn
does not prove it. Elapsed time and exit code appear only when known.

Preserve assistant message/block boundaries, including commentary separated by tools. Stream
Markdown with the same typography as saved text; tolerate incomplete fences without repeatedly
remounting rows or generating artifacts. The canonical parsed final answer, plan, and diagram
cards still use their existing owner. Reconcile the final response by identity/phase so it does
not duplicate streamed final text or replace earlier commentary. Do not expose provider thinking
or hidden reasoning as commentary.

Keep provider and originating agent/subagent attribution where known. Concurrent tools remain
separate rows in first-observed order. Parent links may identify delegated activity without
turning this story into a separate agent tree UI. Reused provider IDs across threads or mode-change
attempts must not merge unrelated calls.

### 2. Approvals above the composer

The active conversation has one bounded approval area outside transcript scrolling, immediately
above the composer. Show the requesting agent, action and scope, **Review**, **Deny**, and
**Allow once**. Review opens the complete reviewable command/arguments or proposed edit; long
details scroll inside the review surface while its decision controls stay reachable. Reuse MUI
controls and the shared permission owner. Do not create a modal for every arriving approval.

An inline marker at the corresponding tool preserves chronology and opens the same review.
There is one decision state for both presentations, not two independently submitted approvals.
Show `1 of N` and navigation for multiple requests instead of stacking cards over the input.
Keep the selected request stable when another arrives. After a decision, retain its outcome in
history and select the next pending request. `Allowed` means permission was granted, not that
execution succeeded.

Approvals remain keyed by executing machine, session, run, and request, including verified
subagents. Resolve external decisions, cancellation, timeout, and mode changes through the existing
broker/discovery owner. A stale historical card cannot authorize an action. During an uncertain
decision, show reconciliation state and prevent duplicate submission. Do not transfer Enter from
the composer to Allow or steal focus when a request arrives. Announce pending counts politely.

Truncation must be explicit. Summaries may shorten a command; Review must not silently present a
shortened value as the complete action. If the full approval payload cannot be supplied within
the review bound, keep Deny and Stop available and disable Allow with a concise reason. An older
executor that provides only a known-truncated summary cannot claim full review support.

That unavailable-review rule applies to the redesigned desktop conversation's Review/Allow
controls. It is a presentation requirement, not a new server-wide authorization gate. Arena/Inbox
and VR retain their existing summary-based decision controls and may resolve that same request;
the conversation must reflect the decision without implying it was blocked on the server.
The shared decision owner keeps routing, submission, and reconciliation semantics unchanged.
Missing completeness metadata from an older peer means review completeness is unknown, not proved.

Existing approval policy, reviewer choice, deadlines, and provider tool access remain unchanged.
This story does not add remembered approvals or depend on blocked Story 101.

### 3. Sending consumes that draft

Snapshot the session's text and per-turn evidence at send time. Clear that submitted draft when
the server acknowledges acceptance, including acceptance into the queue; do not wait for
`run-started`, first provider output, or the final answer. Use the successful message response and
its run identity, or authoritative reconciliation of the same client message ID, as the acceptance
boundary. A non-success response can follow a durable append today: HTTP failure alone is not
proof that nothing was accepted.

- Before acceptance, definite validation/export/rejection failures preserve the draft and evidence.
  An uncertain network outcome reconciles the original message ID before permitting a resend.
- After acceptance, the history entry owns the instruction. Show queued/working/needs-approval
  state from the turn owner; do not leave `sending` or an actionable Retry on a live turn.
- The textarea remains usable for drafting the next instruction while work runs. Keep Stop
  separate and visible; Enter cannot send or queue another turn while this session is busy.
  Mode changes continue to target the active turn as they do today. No implicit steering or queue.
- Acceptance and completion clear only the submitted draft generation and evidence identities.
  A newer draft, including text that happens to equal the old text, and newly added attachments
  survive. Switching sessions, reattaching, Execute plan, Continue, and background setup launches
  must not clear an unrelated draft.
- Post-acceptance errors/cancellation stay on the history entry and preserve completed activity.
  Retry is an explicit prefill action after the live turn has ended or reconciliation establishes
  no live owner; it never silently re-executes work. Keep the existing warning for uncertain
  provider delivery and do not overwrite a newer draft without an explicit replace action.

Reports, pasted images, and text files belong to the submitted draft and leave the composer on
acceptance. Preserve existing reusable canvas selection behavior. This story does not add durable
image storage: Retry restores available text/file/report references and visibly identifies images
that must be attached again. It must not treat unrelated images in a newer draft as recovered
evidence or promise an identical retry. Missing reports likewise need explicit recovery feedback.

### 4. Readable history and stable scrolling

Auto-follow while the reader is at the bottom. Scrolling away or expanding older details preserves
the visible content's position as new output arrives. Show **Jump to latest** with a new-activity
indicator; selecting it resumes following. Submitting a new instruction brings its entry into
view. Switching sessions restores that session's position/follow state for the mounted workspace;
do not carry a scroll anchor from another session. Reconnection alone must not force a jump.

Use restrained message rows, readable assistant text, monospace tool/code details, and one compact
turn status. Normal text meets 4.5:1 contrast in both themes; icons/statuses have text alternatives.
Keep provider/agent selection and Add agent in one compact control near the composer, preserving
primary-agent and handoff actions in its menu. Keep mode/model/execution controls in their existing
roles. Show checkpoint recovery in a turn footer: **Undo this turn** when available, a short
unavailable label with details on demand otherwise, and a visible concise error when recovery
actually fails. Preserve the scope explanation when confirming Undo.

For a session without an explicit saved device layout and without any diagram/sketch, initialize
with `conversationOpen: true` and `canvasOpen: false`. In docked bands this uses the existing
full-width conversation layout and readable text measure. Existing overlay-band (capacity 0)
and focus-mode rules take precedence: they keep the canvas effectively visible without rewriting
that stored preference. In particular, 360px keeps today's overlay behavior. Do not rewrite saved
layouts. Show canvas stays one click away;
selecting a diagram, starting a sketch, or opening an image explicitly reveals it. Arrival of an
artifact alone does not rearrange a chosen layout: its history card offers Open on canvas. Never
hide both conversation and canvas. Keep current responsive bands and canvas fit/inset rules.

### 5. Ordered, durable activity contract

Extend the normalized process events and public events rather than trying to reconstruct order
from the present `preview` and `toolActivity` arrays. Keep the contract side-effect free in
`src/shared`; provider parsing and durable writes remain on the executing server.

The required record fields are:

| Record | Required meaning |
|---|---|
| Turn | Version, run ID, user message ID, participant ID, acceptance time, lifecycle/outcome, ordered activity, explicit incomplete-history state |
| Activity identity | Stable entry ID and first sequence; monotonic update sequence; provider attempt/thread/item identity where available; actor and optional parent tool |
| Assistant block | Block ID, commentary/final phase when supplied, accumulated text, completion; canonical final message reference when reconciled |
| Tool | Call ID, tool name, summary, bounded display input/output/diff, status, known timestamps/exit code, omission metadata |
| Approval | Request ID, associated tool when known, reviewable payload or explicit unavailability, pending/resolved state and decision |
| Gap | Position and reason for omitted/unsaved activity; never fabricated tool results |

Use stable IDs plus server sequences to merge a saved snapshot, replay and new events without
duplicates. Coalesce adjacent deltas only within the same assistant block; a tool or another block
is an ordering boundary. A completion-first provider event may create a completed row. If an
approval arrives before its tool event, preserve its first position and associate it later by
provider identity, never by a matching command string. Mode changes keep the same user turn and
start a distinct provider-attempt namespace.

Persist activity on the session's executing machine through the existing serialized storage
discipline. A bounded optional turn record on the owning user message is the initial design;
prefer that reuse over a new database or general event-log framework. Do not copy this activity
into provider prompts or change canonical transcript/context assembly. Bump the session format
on first use (next after format 12 at drafting time), update strict public/durable schemas and
projections together, and retain older-session reads. Old histories remain readable with no
invented tool details. Newer-format isolation must still hide only the affected session.

Initial budgets for the additional activity are 1,000 entries and 1 MiB serialized UTF-8 per turn,
8 MiB per session, and 16 KiB per tool input/output/diff field. Approval review has a separate
64 KiB payload bound; never use the shorter stored history input as the authoritative live review.
Reserve space for gap/terminal records. Within a turn, discard old completed detail first, then
old completed entries if necessary, with an explicit gap. At the session cap, replace the oldest
completed turns' activity with an omission marker; preserve user/final messages and the active
turn's reserved lifecycle summary. If only unfinished activity remains, omit old unfinished
display detail and then old entries too; the gap states that outcomes were not retained. Bound
an oversized unfinished text block with explicit omitted-byte metadata. Later updates to an
evicted entry contribute to the gap rather than recreating it at the bottom or implying success.
Coalesce gaps and keep the most recent activity that fits. Count reserved markers and identity/
deduplication bookkeeping within the limits; do not grow an unbounded map of evicted entries.
Apply the same display budgets to live client state, server replay, and queued persistence;
coalesce pending snapshots and apply backpressure instead of accumulating unbounded writes.
None of this prunes the provider's authoritative execution/cleanup ownership state. Long completed
histories may be collapsed, not silently claimed to be complete. Pending approvals stay available
from the existing live broker even if activity retention is exhausted; truncating display history
cannot remove an answerable request, cancel its tool, or release its checkout lock.

Batch text persistence without losing boundaries: flush at tool/block completion, before exposing
an approval, and before the normal terminal event; schedule a text flush at least every second
while new text is arriving. This is a scheduling interval under normal storage operation, not a
one-second crash-loss guarantee. Slow/failing storage keeps an explicit unsaved/incomplete state;
a crash can lose text since the last confirmed write. Await queued writes before claiming complete
history. Recovery marks the turn interrupted/incomplete and unresolved tool outcomes unknown. It never
resurrects a permission or reruns work. A history write failure must not discard a canonical answer,
release checkout ownership early, or authorize an action: expose incomplete history, keep current
permission handling usable, and settle the run through its existing lifecycle. Persisted activity
survives the five-minute replay eviction, browser reload, restart, archive and restore.

Project only supported tool fields/results from the provider stream. Do not read credentials,
provider transcript files, or arbitrary filesystem paths to enrich history. Strip terminal control
sequences; render output as inert text or escaped code, never raw HTML. Keep existing path/privacy
exclusions and omit credential/header/token fields; represent omissions explicitly. Binary/image
tool results become metadata, not unbounded embedded data. Large results do not consume the final
answer's independent output allowance. Record precise provider gaps as unknown/unavailable.

Local Claude and Codex, Docker adapters, attached-executor forwarding, session setup launch,
and replay consume the same normalized contract. Keep Arena/Inbox snapshots compact rather than
embedding tool bodies there. Old executors may render their existing summary-only activity with
details marked unavailable; an older stream cannot meet the new durable chronology guarantee.
VR keeps its existing controls and projection, with regression checks against the extended shared
events; a new immersive tool-detail UI is outside this desktop story.

### Implementation stages

| Stage | Scope | Exit evidence |
|---|---|---|
| 1 | Accepted-send clearing, truthful live message status, next-draft preservation, fixed approval area, scroll following | Regression checks fail against current behavior; approval and composer screenshots at desktop/minimum widths |
| 2 | Provider identity/results, ordered projection, durable bounded history, complete approval review, replay/final reconciliation | Claude/Codex fixtures; reconnect/restart/failure/cap tests; Docker and attached routing checks |
| 3 | Compact conversation chrome, turn recovery footer, initial empty-canvas layout, final visual/accessibility pass | Reviewed light/dark screenshots, saved-layout and evidence workflows, end-of-work review |

Stages are implementation slices of this one story; Stage 1 alone does not ship it. No stage
requires deployment or restarting the owner's installation.

## Acceptance criteria

- [x] Commentary, individual tools, approvals, and final answers appear in observed order;
  concurrent tools update in place with stable identity, honest outcome, and known agent attribution.
- [x] Tool disclosures expose supplied arguments/output/diffs and errors with explicit omissions;
  Markdown streams readably, and final prose/plans/diagrams appear exactly once.
- [x] Pending approvals remain reachable above the composer at all tested sizes, with complete
  review or explicit unavailability, multiple-request navigation, keyboard access, and no focus theft.
- [x] Unavailable/unknown complete review disables Allow in the redesigned conversation only;
  Arena/Inbox/VR retain existing decisions, and resolutions there update the conversation correctly.
- [x] Inline and fixed approval views share one routed decision state; external decisions, stale
  requests, duplicate clicks, timeouts, cancellation, mode changes, and verified subagents work.
- [x] Accepted queued and running sends clear their exact draft/evidence promptly; rejection,
  ambiguous acceptance, same-text newer drafts, navigation, and non-composer sends lose no draft.
- [x] A busy session permits drafting without sending/queueing; Stop and live mode changes remain
  available, and live user entries never offer Retry or misleading `sending` state.
- [x] Failed/cancelled turns preserve activity and explicit retry semantics, including uncertain
  delivery, newer drafts, unavailable images/reports, and reusable canvas selections.
- [x] Manual scrolling and expanded details retain position; Jump to latest, sending, session
  switching and reconnect follow the specified scroll rules.
- [x] New empty sessions use the conversation-first default; saved layouts and explicit canvas
  actions, overlay/focus precedence, fit/insets, and the never-both-hidden rule pass.
- [x] Compact agent controls and recovery footer retain all actions, confirmation scope and real
  errors; both themes meet contrast/focus requirements and the idle visible-control count does not rise.
- [x] Ordered activity survives completion, disconnect/replay, five-minute eviction, restart,
  archive/restore, and snapshot/live overlap without duplication or cross-session contamination.
- [x] Versioned storage, byte/count limits, omission markers, one-second text batching,
  interrupted recovery and write failures obey the contract; final answers and live approvals survive.
- [x] Active-only saturation, oversized unfinished text, late results for evicted entries, and
  slow persistence keep live/replay/storage/bookkeeping bounded without altering execution ownership.
- [x] Provider replay/duplicate/completion-first events, mode-attempt ID reuse, interleaved
  subagents and missing results do not produce false order, attribution or success.
- [x] Display data excludes unsupported private fields and hidden reasoning; malicious text,
  terminal escapes, binary/oversized results and unsafe links cannot execute or bypass limits.
- [x] Legacy sessions/older peers degrade explicitly; shared VR, Docker, attached-executor,
  session setup, evidence, plans/artifacts, checkpoint and provider-context behavior retain their contracts.
- [x] Focused failing-first tests, full offline suite, TypeScript, isolated production build,
  production browser checks and reviewed screenshots pass; independent implementation review is resolved.

## Out of scope

- Sending/queueing/steering a second instruction during the active turn; provider policy changes,
  remembered approvals, arbitrary command execution, or a terminal emulator.
- Persisting image bytes for retries, recovering old tool details never recorded, or exposing
  provider thinking/private transcripts.
- New VR layouts/tool-detail views, status-bar/command-palette work, a new agent tree, or a general
  logging/telemetry platform. Physical Quest acceptance is not a gate for this desktop story.
- Deploying, restarting the running installation, or changing the development queue's priority.

## How to verify

1. Add deterministic Claude and Codex fixtures emitting: user acceptance; commentary A; Read;
   commentary B; two concurrent tools finishing in reverse order; a child-agent tool; two pending
   approvals, including one after enough text to overflow the viewport; a denial and an allowed
   tool failure; and a final answer with a diagram/plan. Include tools completed before their
   start is observed, duplicate events, repeated IDs after a mode change, and missing results.
   Include final answers without provider phase/identity, and commentary that repeats final text,
   so text-equality heuristics cannot accidentally delete commentary or duplicate the answer.
   Prove regression assertions fail against the old renderer/event projection.
2. Extend `test/runPresentation.test.ts`, `test/claudeProcessRunner.test.ts`,
   `test/codexProcessRunner.test.ts`, `test/runScheduler.test.ts`, `test/runRoutes.test.ts`,
   `test/sessionStore.test.ts`, and focused composer/layout tests as appropriate. Test exact
   boundary sizes, multibyte text, high-volume output, persistence failure, crash recovery,
   immutable send snapshots and canonical prompt exclusion. Prefer behavior checks over source matching.
   Saturate the entry budget with unfinished tools and the byte budget with unfinished text;
   deliver late results after eviction, hold an approval open, and stall the storage writer.
   Assert bounded buffers/bookkeeping, explicit gaps, and intact permission/checkout ownership.
3. In production Playwright, capture both themes at 1440×900, 1000×800, 360×800, and the 320px
   minimum conversation width. Assert decision controls are inside the visible viewport (mere DOM
   presence is insufficient), long review content is reachable, and the composer/Stop do not
   overlap. Exercise keyboard-only navigation, IME Enter/Shift+Enter, expanded output and manual
   scroll during streaming. Inspect screenshots and diffs; generation alone is not acceptance.
   Verify effective canvas hiding in docked bands and the existing visible-canvas overlay/focus
   behavior at 360px, including resizing between bands without changing saved preferences.
4. Send while queued and while starting; reject before acceptance; drop the connection after
   durable acceptance; type the same text again as a newer draft; add new evidence; switch sessions;
   use Execute plan/Continue/setup launch. Verify one accepted message, clearing at acceptance,
   preserved newer drafts and evidence, and explicit recovery for unknown outcomes or missing images.
5. Reload during commentary, tool output and approval; resolve on another browser; reconnect across
   snapshot/replay/live overlap; switch mode; cancel with tools running; wait beyond replay retention;
   restart only the isolated test server; archive/restore. Compare entry IDs/order and outcomes,
   verify no stale approval works, and confirm final message/artifact identity is unchanged.
6. Exercise old session formats and an older-executor fixture, both providers through Docker
   adapters, and an attached TLS executor fixture. Run existing approval/subagent, evidence,
   session-setup, running-mode, checkpoint, layout and available immersive regression suites.
   For truncated or completeness-unknown review, verify disabled conversation Allow, usable
   Deny/Stop, unchanged Arena/Inbox/VR decisions, and reconciliation after a decision there.
   Probe real Claude/Codex event shapes when available; record exact versions/results or the
   access gap without treating fixture coverage as a real-provider run.
7. Run `npm test`, `npm run lint`, an isolated production build and the focused production-browser
   suites. Record results, reviewed screenshot paths, control counts, any provider/device gaps,
   and the independent implementation review before marking the story Shipped.

## Specification review

Reviewed by an independent subagent on October 13, 2026. Its three P2 findings were resolved:

- Defined active-only retention saturation, late updates, bounded replay/client/write buffers,
  and preservation of authoritative approval and execution ownership.
- Scoped unavailable-review Allow behavior to the redesigned conversation while preserving
  Arena/Inbox/VR decisions and cross-surface reconciliation.
- Made existing overlay/focus behavior take precedence over the new empty-session preference;
  clarified Story 76's remaining styling ownership in the epic.

The rereview found no other blockers and requested one wording clarification: the one-second
flush interval schedules persistence and cannot guarantee durable writes during a storage stall.
That clarification is incorporated above. The suggested missing-phase/identity and repeated-final-
text fixtures are also included. Local link/line-anchor and whitespace checks pass.

## Implementation (where the code is)

- [turnActivity.ts:1](../src/shared/turnActivity.ts#L1) and
  [turnActivitySchema.ts:1](../src/shared/turnActivitySchema.ts#L1) own the side-effect-free format,
  stable sequences, display filtering, and shared turn/session retention. Format 13 is adopted on
  the first accepted turn; older formats remain readable.
- [providerDisplay.ts:1](../src/server/agents/providerDisplay.ts#L1), the Claude/Codex process runners,
  and [conversationService.ts:78](../src/server/conversation/conversationService.ts#L78) normalize
  supported commentary/tools/results and complete live reviews. Provider attempt namespaces keep
  mode changes separate; only authoritative final identity reconciles the canonical answer.
- [turnHistoryWriter.ts:4](../src/server/conversation/turnHistoryWriter.ts#L4) coalesces pending writes;
  [sessionStore.ts:750](../src/server/storage/sessionStore.ts#L750) persists them atomically. Display
  writes advance turn sequences without invalidating canonical edit revisions. Final history and
  its answer commit together. Restart settles unfinished activity without resuming execution.
- [runRegistry.ts](../src/server/runs/runRegistry.ts),
  [eventStream.ts](../src/app/api/agent/eventStream.ts), and browser snapshot merging bound replay,
  slow subscribers, and retained client history. Live broker reviews remain separate from history
  retention; pending requests and checkout ownership survive display omission.
- [ConversationDrawer.tsx:28](../src/features/conversation/ConversationDrawer.tsx#L28),
  [TurnActivity.tsx:18](../src/features/conversation/TurnActivity.tsx#L18), and
  [ApprovalArea.tsx:16](../src/features/conversation/ApprovalArea.tsx#L16) render ordered rows, stable
  scrolling, one approval selector, and an explicitly opened review tied to its request identity.
  Summary-only peers are labeled; incomplete review disables desktop Allow only.
- [draftLifecycle.ts:9](../src/features/conversation/draftLifecycle.ts#L9) and
  [AppShell.tsx:1512](../src/features/shell/AppShell.tsx#L1512) snapshot evidence, consume only accepted
  draft generations, and reconcile uncertain sends. Retry delivery reuses the original message ID
  and frozen body. Ordinary Retry remains an explicit prefill and asks before replacing a draft.
  Pending ink saves finish before the message is posted.
- ParticipantControls, TurnCheckpoint, and usePanelLayout retain their existing owners with compact
  controls, visible recovery errors, and conversation-first empty-session initialization.

## Implementation verification

Implemented October 13, 2026 using failing-first tests and repeated independent subagent review.
Regression failures were observed before fixes for accepted-send clearing, uncertain delivery,
newer drafts, ordered/provider events, atomic final persistence, active-only retention, slow writes,
client session caps, mode-attempt outcomes, approval focus, and drawing persistence across reload.

The full offline suite passes **1,532 tests in 143 files**. Strict TypeScript and the isolated
production build (`CODEAI_DIST_DIR=.next-e2e npm run build`) pass. Production-browser verification
covers the chronological fixture, drafts, images/reports, plans/model artifacts, layouts, agent
controls, checkpoints, mode changes, background setup, attached-executor presentation, archives,
and available immersive shared controls: **81 desktop/workflow cases, 12 draft-lifecycle cases,
and 14 immersive cases pass** (107 distinct cases). The broad run passed 79/81 before correcting
one stale canvas-visibility assertion and waiting for intercepted polling responses during test
teardown; both pass on rerun. A final nine-case run also recaptured both themes and retested
sequential approvals and attached-executor presentation against the final bundle.

Reviewed light/dark screenshots are under `test-results/chronological-chat/`: each theme has
`1440-approval`, `1000-approval`, `360-approval`, `320-approval`, `review`, and `completed` PNGs.
Controls remain within the viewport, long review content reaches its final line, and keyboard-only
Review/decision navigation does not transfer focus when later approvals arrive. Idle visible
controls decrease from **9 to 8**, including the textarea. Measured normal-text contrast is at
least **4.57:1 light** and **5.53:1 dark**; the original idle light status was 4.33:1 and now uses the
existing darker token. Measurements are in the adjacent idle/activity-contrast JSON files.

Real read-only provider probes passed with **Claude 2.1.292** and **Codex 0.162.1**, including tool
start/result identity, text boundaries and final identity. Evidence is
`test-results/chronological-chat/provider-probe.json`. Complete approval payloads, Docker adapters,
and attached TLS forwarding are covered by fixtures; this story did not run signed-in Docker turns,
production attached transport, or real-provider approval actions. Headless Chrome successfully
rendered the XR fixture; immersive evidence is in `test-results/chronological-chat/immersive/`.
Physical Quest acceptance is outside this desktop story.

Independent provider, lifecycle/storage, and send/UI reviews were repeated after corrections.
Findings fixed include missing final phase, incomplete rename/edit reviews, stale review focus,
ambiguous POST races, stalled approval publication, non-atomic final references, client retention,
mode-change outcomes, pending-ink revision conflicts, and visible Retry before ownership settled.
No P0/P1/P2 findings remain in those rereviews. The owner's running application was not restarted;
no deployment, commit, or staging was performed.

### October 14 validation follow-up

- [x] A scheduler rejection with an active-run descriptor and an absent canonical message preserves
  the draft without entering uncertain delivery; cancelling the blocker permits an edited send.
- [x] Disconnected turns retain usable Cancel in both VR surfaces. VR Refresh reconciles the
  captured session/run, including completion, without authorizing a stale cancellation.
- [x] XR fixtures respect the empty-session conversation-first layout and explicitly identify a
  finished replay. Focused regressions, TypeScript, build, and independent review pass.

The three new browser regressions failed against the pre-fix bundle and pass after the changes.
The full offline suite passes **1,539 tests in 144 files**; TypeScript and the isolated production
build pass. The broader production-browser run passes 156 of 157 cases; its remaining toast
assertion expected the obsolete uncertain-delivery label for a confirmed rejection. The corrected
assertion passes on a focused rerun, validating all **157 distinct desktop/XR cases**. Both newly
added VR cancellation paths and the corrected empty-session and archive fixtures pass in the broad
run. Independent review found no further actionable defects. Real-provider and physical-headset
probes were not rerun, and the owner's running application was not restarted.
