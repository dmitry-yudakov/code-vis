# Story 135 — Queue a new session after current repository work

**Status:** Shipped · **Type:** Full-stack · **Depends on:** [Story 130](STORY-20261106-compact-session-setup.md)

## Motivation

Add another task to a busy project without creating a worktree or remembering to send it later.
This extends the Arena's work orchestration in [the vision](../docs/vision.md#the-arena).
A session remains an ongoing conversation. Since the November 9 follow-up, queued ideas wait until
earlier conversations are archived, allowing additional work after each reply.
The November 18 durable-queue follow-up in [Story 149](STORY-20261118-restart-session-continuity.md#durable-waiting-turns-follow-up--november-18-2026)
supersedes the original server-lifetime limit: waiting requests now survive process restart and
Build & restart.

## Current behavior (where the code is)

- `src/features/session-launch/SessionSetupDialog.tsx:113` — compact project/provider/mode setup.
- `src/features/session-launch/sessionLaunch.ts:115` — creates a durable session, then submits its
  first message with stable creation and message identities; detaches without cancelling.
- `src/app/api/agent/message/route.ts:238` — reserves before appending the canonical user message;
  builds context and checkpoints only once the queued turn starts.
- `src/server/runs/runRegistry.ts:598` — checkout scheduling serializes writers; Ask/Plan can share
  reads, and later readers cannot starve a waiting writer.
- `src/features/shell/AppShell.tsx:2142` — announces background launches and offers Open session.

## Original desired behavior and contracts (archive policy revised below)

New-session setup offers a secondary **Queue session** button beside the normal start action for the
current checkout. Queue requires a first message and submits it immediately to the existing
machine scheduler. Worktree creation keeps its current behavior. The choice belongs to this launch,
not future sessions or subsequent turns. Desktop and phone expose it; shared launch state remains
usable in immersive setup.

An optional strict boolean `waitForCheckout` in the message request asks for exclusive checkout
scheduling even in Ask/Plan. It changes admission only, never the provider's mode or permissions.
Queued mode changes retain that scheduling choice. Overlapping checkout paths share the same
exclusion, independent checkouts remain usable, and later readers cannot overtake queued exclusive
work. Multiple queued tasks execute in acceptance order for the same checkout.

The existing scheduler owns the queue: at most 32 waiting turns per machine, overflow rejected
before message append. Session/provider identity, maintenance/worktree creation, cancellation
persistence and retry contracts remain as established by the scheduler, Stories 97/98 and Story 90.
Messages/evidence are saved before activation; no provider/checkpoint starts early. Canonical retry
keeps the same message and session. Browser detachment/reload preserves execution. Queued work does
not automatically resume after a server restart; the queue button's tooltip says to keep CodeAI running. No new durable
queue, task entity, session-format migration or explicit session-completion state.

The acceptance response includes the current run state alongside its existing run id so a queued
launch is announced as queued. Arena and conversation run discovery/cancellation remain the owners
of ongoing feedback and recovery.

## Acceptance criteria

- [x] Desktop/phone setup can submit a first message with **Queue session**, preserving project,
      mode, evidence, retry identity and the current checkout. Empty submissions cannot queue.
- [x] Read-only queued starts wait behind running reads/writes and approval waits; later turns on
      that checkout wait behind them. Multiple tasks progress in order; unrelated work can run.
- [x] Mode changes preserve exclusive scheduling without granting writing permission to Ask/Plan.
- [x] Cancellation records not-sent before promotion; browser detachment does not cancel; overflow
      and failed delivery preserve the draft and created session.
- [x] Queue feedback is accurate, and the server-restart limitation is visible before submission.
- [x] Focused unit/route/browser checks, TypeScript, isolated production build and independent review pass.

## How to verify

Run scheduler, message scheduler route, protocol, session launch and running-mode unit checks.
In a production-browser fixture, hold a turn on a project, launch queued Ask/Plan tasks from its
project shortcut, verify Queued in Arena across reload, then finish/cancel preceding work and
verify promotion. Check setup in light/dark on desktop/phone, plus existing launch/retry flows.

## Verification results — November 7, 2026

The six initial queue regressions failed before implementation: protocol acceptance, launch wire
fields/feedback, scheduler ordering and mode changes, plus route promotion/cancellation. After
implementation, all 135 focused unit checks pass across `runScheduler`, `messageSchedulerRoutes`,
`protocol`, `sessionLaunch`, `runningMode`, `machineGateway`, `runRoutes`, `sessionRoutes`,
`turnCheckpointRoutes` and `autoMode`. Run with `CODEAI_REMOTE_ACCESS=local
CODEAI_SECURITY_LEVEL=guarded` so inherited installation settings do not require paired HTTPS
for local test requests. An initial run without those overrides failed authorization in the
unmocked route suites; the correctly isolated run passes all cases.

`npm run lint` and `CODEAI_DIST_DIR=.next-e2e npm run build` pass. All 13 distinct production-browser
checks in `queued-session-setup` and `compact-session-setup` pass. The actual browser journey starts
a delayed Ask turn, submits a Plan task with a text attachment to the same project/checkout, reloads
Arena, observes Queued, and verifies automatic completion with its start timestamp at or after the
first turn's finish. Light/dark desktop/phone screenshots were inspected. A read-only subagent
review identified an empty-draft timing-control trap; the fix and its browser regression pass,
including a final rerun of all five queue browser checks against the rebuilt production bundle.
Follow-up review found no remaining issue.

Checks use fixture providers. Real signed-in providers, Docker, production attached-machine TLS
and physical phone/Quest use were not rerun. Attached-machine header forwarding has unit coverage;
the immersive setup displays an existing queued launch choice but has no new timing control.
The running application has not been rebuilt or restarted. Queued turns still require the
executing server to stay running; server-restart queue recovery remains outside this change.

## Secondary action follow-up — November 8, 2026

Replace the timing dropdown with an outlined **Queue session** button beside the contained normal
start action. Queue is a one-click submission choice for the current checkout with a first message;
the usual button and Enter keep their ordinary start behavior. Explain the wait and server-lifetime
limit in the queue button's accessible tooltip. Closing setup keeps the draft without selecting a
queue policy. Worktree creation has no queue action.

Capture scheduling synchronously with the submitted attempt. Retry keeps the original choice,
message id and created session through rejection or uncertain delivery; do not allow another
submission action to alter an uncertain attempt. After editing a definitively rejected draft, the
normal button/Enter starts normally and clears the previous queue choice.

- [x] Desktop/phone expose queue as a secondary action, with empty/worktree states and a concise
      tooltip; remove the timing dropdown and retain primary-button/Enter behavior.
- [x] Queue submission and both definitive/uncertain retries preserve scheduling and request
      identity; an edited retry can use the normal action without a stale queue choice.
- [x] Focused checks, TypeScript, isolated build, both-theme desktop/phone screenshot inspection
      and independent review pass.

The button regression failed against the preceding production build before implementation. All
26 focused unit checks (`sessionLaunch`, `devicePreferences`), TypeScript and the isolated
`.next-e2e` production build pass. All 16 distinct production-browser cases in `queued-session-setup`
and `compact-session-setup` pass, including four theme/viewport button checks, direct queue submission,
rejection and uncertain-delivery retries with identical request bodies, and an edited rejected draft
sent normally with Enter. Both-theme desktop/phone screenshots were inspected.

Independent review identified a stale queue hint after editing a rejected task. That hint now appears
only during captured error/frozen recovery in desktop and immersive setup. The new regression and
all eight queue browser cases pass against the rebuilt final bundle; follow-up review found no
remaining issue. Server scheduling is unchanged. Fixture-only and physical-device limitations from
the initial verification still apply; the running application has not been rebuilt or restarted.

## Editable ideas and archive-gated execution — November 9, 2026

This follow-up replaces the original turn-completion policy. The queue holds ideas until earlier
work is finished as a conversation. A queued session waits for earlier active sessions with saved
messages on the same or overlapping primary checkout to be archived, including idle sessions.
Empty session shells and unrelated checkouts do not block it. With no predecessor it can start
immediately. Each queued idea then holds later ideas until it is archived. A normal follow-up in
an earlier session remains runnable. Turn completion, failure and cancellation do not complete a
conversation; successful manual or existing inactivity archiving releases its successors.

The existing machine scheduler and server-lifetime limitation remain. No new orchestrator or
automatic conversation-completion decision is introduced. An accepted queued user message can be
edited in its conversation until execution begins. Save preserves message/run identity, order,
mode and evidence. Compare the original text to prevent overwriting another device's edit. Hold
promotion while saving; failures retain the draft, cancellation waits for the save, and stale or
already-started edits are refused. Only message text is edited.

Where the code is: `src/server/runs/runRegistry.ts:207` owns admission/promotion;
`src/app/api/agent/message/route.ts:238` owns accepted requests;
`src/server/storage/sessionStore.ts:778` owns canonical user messages;
`src/app/api/sessions/[sessionId]/archive/route.ts:15` and
`src/server/storage/autoArchiveSessions.ts:24` own archive completion;
`src/features/conversation/ChatMessage.tsx:32` renders the message action.

How to verify this follow-up: run `runScheduler`, `sessionQueue`, `messageSchedulerRoutes`,
`autoArchiveSessions`, protocol, session launch, running-mode and existing recovery unit suites.
Run `queued-session-setup` and `compact-session-setup` against an isolated production bundle;
the queue journey must remain parked after a reply and a follow-up, then start after archive.
Editor checks must cover save failure, retry, reload and a conflicting device edit on both themes
at desktop and phone widths. Inspect the resulting `queued-edit.png` screenshots.

- [x] Idle earlier conversations block queued ideas; archive advances them in order, while normal
      follow-ups and unrelated work stay usable. Existing mode/access/cancellation contracts hold.
- [x] Edit and save queued text with stable identity and evidence; reject conflicting, oversized,
      cancelled or started edits; saving races and failures preserve execution and recovery.
- [x] Reload displays saved edits; queue feedback explains archiving, including setup and launch.
- [x] Focused scheduler/storage/route/browser checks, TypeScript, isolated build, desktop/phone
      both-theme inspection and independent review pass.

All 274 focused unit checks pass across 16 suites: scheduler, queue storage/scope, message routes,
inactivity archive, protocol, session launch, run routes, mode scheduler, running mode, session
routes, checkpoints, Git push, machine gateway, Auto mode, session store and workspace feed. Run with
`CODEAI_REMOTE_ACCESS=local CODEAI_SECURITY_LEVEL=guarded CODEAI_MAX_CONCURRENT_RUNS=2` to isolate
fixture admission from installation settings. The three initial scheduler regressions failed before
implementation. Coverage includes idle predecessors without retained runs, two queued ideas needing
separate archives, overlapping repositories, failed appends/archives/saves, stale edits, evidence,
ambiguous committed saves, concurrent cancellation during an edit, and helpers yielding while parked.

Source TypeScript, `git diff --check`, and the isolated `.next-e2e/queue-ideas` webpack
`compile`/`generate` production build pass. Font downloads required network access; only this task's
generated failed output/cache was removed after an intermediate disk-full build. All 20 distinct
production-browser checks in `queued-session-setup` and `compact-session-setup` pass. Both-theme
1280px desktop/390px phone editor screenshots were inspected. The archive journey verifies that
completion and a normal follow-up leave the idea queued, then archive starts it. Editor journeys
verify failed save retention, retry, reload, another device's conflicting save and Cancel edit.

Independent review identified and verified fixes for simultaneous cancellation during an edit,
checkout resolution entering store recovery while holding the store writer queue, ambiguous-save
text ownership and stale provisional queue status. Browser verification also caught missing queued
message identity on reconnection; recovery now links the accepted saved message before replay.
Final review found no remaining concrete issue. Real signed-in providers, Docker, attached-machine
TLS and physical phone/Quest use were not rerun. Queue survival across server restart remains outside
scope; the running installation has not been rebuilt or restarted.

## Keyboard shortcut and project activity hint — November 9, 2026

In the first-message field, **Ctrl+Enter** and **Cmd+Enter** submit **Queue session** with the same
eligibility as its button. Empty drafts, new-worktree launches, blocked setup and recovery states
cannot queue through the shortcut or fall through to a normal start. Plain Enter keeps normal
start/retry behavior; Shift+Enter, input composition and repeated keydown events remain unchanged.
The queue tooltip advertises the shortcut and its existing archive/server-lifetime requirements.

A compact count beside the launch actions shows unarchived sessions in the selected project on
the selected machine. It follows workspace updates and project selection, excludes the session
created by a pending recovery, and hides without a project, with no sessions, or when the machine
is offline or its snapshot is stale. The tooltip distinguishes unarchived conversations from
currently running turns and explains the repository-specific queue wait. On phones the count wraps
above the buttons.

Where the code is: `src/features/session-launch/SessionSetupDialog.tsx:66` owns shortcut eligibility
and the live project count; `e2e/queued-session-setup.spec.ts:4` covers keyboard and activity feedback.

- [x] Ctrl/Cmd+Enter queues only when the button is available, preserving ordinary Enter and retries.
- [x] Show a live, compact project activity count beside launch actions on desktop and phone.
- [x] Focused unit/browser checks, source TypeScript, isolated build, screenshot inspection and review pass.

All 30 focused unit checks (`sessionLaunch`, `devicePreferences`, `sessionQueue`) and 26 distinct
production-browser cases (`queued-session-setup`, `compact-session-setup`) pass. The shortcut
regression failed before implementation by creating an empty session. Browser coverage includes
both modifiers, empty/worktree/error states, Shift+Enter, composition, repeated keys, exact retry
identity, project switching, archive exclusion and live count/offline updates. Both-theme desktop
and phone screenshots were inspected. Independent review found no blocking issue.

Source TypeScript and the isolated `.next-e2e/queue-shortcut` webpack compile/generate build pass.
The standard lint command remains blocked by the previously recorded generated route checks for
optional `Request` parameters in Arena, checkouts and projects. The new tooltip tests use actual
keyboard navigation and wait for MUI transitions. Verification uses fixture providers; physical
devices and real-provider turns were not rerun. The running installation has not been restarted.

## Open-project queue action — November 16, 2026

The header's **New** menu now offers **Queue session…** inside an open project, including while
reading a conversation. It opens the existing message setup for that project's executing machine.
The existing empty-session form stays available. Closing setup keeps its draft and restores focus
to New; submitting a queued idea leaves the source conversation and its composer draft in place.
Shared launch handling retains attachment, archive-gating and exact retry behavior.

Verified with **32 focused unit checks** (`sessionLaunch`, `devicePreferences`, `sessionQueue`),
**33 production-browser cases** (`queued-session-setup`, `project-workspace`), TypeScript, the isolated
`.next-e2e/project-workspace` production build, both-theme desktop/phone screenshot inspection and
independent read-only review. The new menu regression fails on the preceding build. Browser coverage
includes attached-machine targeting, retained setup/source drafts, rejected and uncertain retries,
and a queued task starting after archive. Providers and attached-machine routing use fixtures;
physical devices and real provider/remote transport were not exercised. The running installation
was not rebuilt or restarted.
