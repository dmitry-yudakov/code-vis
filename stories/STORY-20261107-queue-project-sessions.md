# Story 135 — Queue a new session after current repository work

**Status:** Shipped · **Type:** Full-stack · **Depends on:** [Story 130](STORY-20261106-compact-session-setup.md)

## Motivation

Add another task to a busy project without creating a worktree or remembering to send it later.
This extends the Arena's work orchestration in [the vision](../docs/vision.md#the-arena).
A session remains an ongoing conversation; "after current work" means after its active turn,
including any approval wait, rather than after archiving the conversation.

## Current behavior (where the code is)

- `src/features/session-launch/SessionSetupDialog.tsx:113` — compact project/provider/mode setup.
- `src/features/session-launch/sessionLaunch.ts:115` — creates a durable session, then submits its
  first message with stable creation and message identities; detaches without cancelling.
- `src/app/api/agent/message/route.ts:238` — reserves before appending the canonical user message;
  builds context and checkpoints only once the queued turn starts.
- `src/server/runs/runRegistry.ts:598` — checkout scheduling serializes writers; Ask/Plan can share
  reads, and later readers cannot starve a waiting writer.
- `src/features/shell/AppShell.tsx:2142` — announces background launches and offers Open session.

## Desired behavior and contracts

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
