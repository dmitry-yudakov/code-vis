# Story 37 — Run independent turns concurrently on one machine

**Status:** Draft · **Type:** Full-stack ·
**Depends on:** [Story 36](STORY-20260830-multi-session-workspace.md) (several open session views,
shipped) and [Story 27](STORY-20260826-session-keyed-host-bound-runs.md) (run-id addressing and
host-wide discovery, shipped)

**Vision context:** step 5, “Concurrent turns,” in [vision.md](../docs/vision.md#sequence), and the
independent-run-registry delivery slice in
[multi-project-session-environment.md](../docs/multi-project-session-environment.md#possible-delivery-slices).

---

## Motivation

Story 36 lets several sessions remain open and usable while one turn runs, but the machine still has
one global execution slot. A long Ask turn, a build waiting for approval, or an unattended background
session prevents every other session from starting. The open views look independent while execution
still behaves like one shared modal operation.

The next slice makes that independence real without turning the local application into an
unbounded process launcher. The machine admits a small number of independent turns, queues excess
work visibly, and keeps every run's stream, approval, cancellation, and completion attached to its
own session view. This gives the later Arena meaningful Running, Needs you, and Queued states; it
does not build the Arena itself.

---

## Current behavior (where the code is)

- The [run registry](../src/server/runs/runRegistry.ts#L8) fixes `MAX_CONCURRENT_RUNS = 1` and
  [`start`](../src/server/runs/runRegistry.ts#L39) refuses the next run instead of queueing it. Its
  maps are already keyed by `runId`, but a live record has no queue or lifecycle state.
- The [message route](../src/app/api/agent/message/route.ts#L122) asks the registry for the one slot
  before it appends the canonical user message. Refusal is a 409 naming the first active run; an
  accepted route owns one response stream until that run finishes.
- [`RunDescriptor`](../src/shared/types.ts#L335) carries ownership and timestamps only.
  `RunDiscovery.active` can represent an array, but the browser consumes only its first entry.
- [AppShell run state](../src/features/shell/AppShell.tsx#L84) is one group of scalar fields and
  refs (`running`, `runningSessionId`, `runIdRef`, preview, activity, permissions, and cancel
  controller). [`send`](../src/features/shell/AppShell.tsx#L794) exits whenever any session is
  running, and [`consumeStream`](../src/features/shell/AppShell.tsx#L674) writes every event into
  that one group.
- [Reload recovery](../src/features/shell/AppShell.tsx#L1002) adopts `active[0]`, switches to its
  project, and attaches one stream. [`reconcileSessionRun`](../src/features/conversation/runRecovery.ts#L11)
  reconciles one descriptor at a time.
- [`WorkspaceTabs`](../src/features/conversation/WorkspaceTabs.tsx#L6) accepts one
  `runningSessionId` and one approval count, so only one tab can present live state. Story 36's
  device record already keeps unread state per view; live run state deliberately is not persisted
  there.
- [`AppConfig`](../src/server/config.ts#L7) has timeout and output bounds but no machine concurrency
  setting. [`.env.example`](../.env.example#L5) documents the local-agent settings.
- [Run route tests](../test/runRoutes.test.ts#L14),
  [recovery tests](../test/runRecovery.test.ts#L12), and
  [multi-view browser coverage](../e2e/canvas.spec.ts#L238) prove run-id routing and navigation
  around one live turn, not simultaneous execution or queue promotion.

---

## Desired behavior

### A. One bounded scheduler owns machine capacity

1. Replace the registry's constant single-slot refusal with a process-wide scheduler, still pinned
   through `globalThis` because Next.js route handlers are separate bundles. It owns live records by
   `runId`, a queue, recent retained records, and the indexes needed to decide whether a turn is
   independent.
2. `CODEAI_MAX_CONCURRENT_RUNS` sets this machine's limit. It defaults to **2** and accepts integers
   from **1 through 8**; invalid values fail through the existing configuration validation. Its
   former `CODEAI_WEB2_MAX_CONCURRENT_RUNS` spelling works through the standard compatibility rule.
   The setting is read when the server starts and changing it requires a restart.
3. At most 32 turns may wait in memory. A request beyond that bound receives 429 before its user
   message is appended. The queue is intentionally bounded even on trusted localhost so a stuck
   provider or unattended approval cannot accumulate arbitrary work.
4. A validated request reserves a `runId` before the canonical user message is appended. Once that
   append succeeds, the record becomes runnable: it starts immediately when an eligible slot exists
   or enters the queue. Any failure between reservation and append releases the reservation and
   leaves no runnable record. An accepted queued request is not reported as a busy failure.
5. Queue order is oldest eligible first. A turn waiting on its checkout execution lock does not
   leave a machine slot idle when a later independent turn can run; eligible turns retain their
   relative FIFO order. Session and provider-session conflicts are rejected at admission rather
   than added to the queue.
6. Finishing or cancelling a running turn releases its slot and immediately promotes queued work.
   Cancelling a queued turn removes it without spawning a provider process, marks its canonical user
   message `cancelled` with `delivery: 'not-sent'`, emits the normal cancelled error/done terminal
   sequence, and then recomputes queue positions.
7. A run waiting for a permission **continues to occupy its concurrency slot**. The provider process,
   timeout pause, permission broker, and any checkout lock are still live; lending that slot to
   another run would make configured capacity misleading. Denying, timing out, or cancelling the
   permission lets that same run continue or finish under the existing policy.

### B. “Independent” has conservative, server-owned meaning

8. A session may have at most one queued or executing turn. A second send to the same session is a
   409 naming the existing run, even if it addresses another participant. This preserves one ordered
   transcript/cursor and fulfills the uniqueness rule deferred by Story 27.
9. A concrete provider session may have at most one queued or executing turn. The scheduler keys a
   started provider session by host, provider, and provider-session id; an unstarted participant is
   keyed by its CodeAI participant id. Browser selection never asserts or bypasses this key.
10. Ask and Plan remain read-only and may share a checkout. An Agent turn takes an exclusive lock on
    its primary checkout: it waits for running readers or another writer, and no new reader starts on
    that checkout until the queued writer has run. This prevents one approved working-tree mutation
    from racing another turn's context capture without introducing worktree isolation.
11. Mode, executable, tool policy, host ownership, provider health, session participant, primary
    repository, and checkout identity continue to be resolved on the server. Concurrency changes
    admission and timing only; it cannot widen a mode's capabilities or run a provider session on a
    different machine.
12. Repository context and per-run temporary attachments are created only when a queued turn starts,
    so they reflect the checkout at execution time and queued requests do not hold temp directories.
    The accepted user message and immutable attachment payload remain the instruction that was
    queued.

### C. Discovery and streams expose lifecycle, not a singleton slot

13. Every accepted record has one scheduler state: `queued`, `running`, `needs-you`, or `finished`.
    Permission requests move a running record to `needs-you`; resolving the last pending request
    moves it back to `running`. Terminal error/done processing moves it to retained `finished` only
    after the existing canonical completion/failure write has settled.
14. `GET /api/agent/runs` continues to return host-wide `active` and `recent` arrays. `active`
    includes queued, running, and needs-you records; `recent` contains finished records. The optional
    `sessionId` filter keeps working. Descriptors include state, queue position, and pending approval
    count so a reloading client does not have to infer them from an incomplete replay.
15. Add `queued` to `AgentPhase`. A queued stream replays a status event carrying its current
    one-based position; position changes emit another droppable status event. `run-started` remains
    the boundary at which a provider execution actually begins, so tests can prove a queued turn did
    not spawn early.
16. Stream replay, subscription, cancellation, permission decisions, recording, finishing, and
    retention remain addressed only by `runId`. One run's permission broker and subscriber cannot
    receive another run's events. A detached browser never cancels queued or running work.
17. Queue and live records are process-memory execution state, as live runs are today. Browser reload
    recovers them; a Next.js server restart terminates provider processes and abandons the in-memory
    queue. The canonical transcript remains authoritative and any accepted-but-unfinished user
    message follows the existing interrupted-delivery recovery behavior.

### Wire contract

```ts
export type RunState = 'queued' | 'running' | 'needs-you' | 'finished';

export interface RunDescriptor {
  runId: string;
  sessionId: string;
  participantId: string;
  state: RunState;
  enqueuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  /** One-based and present only while queued. */
  queuePosition?: number;
  pendingPermissionCount: number;
}

export type AgentPhase =
  | 'queued'
  // ...the existing phases
  | 'completed';
```

`RunDiscovery` keeps its existing `{ active, recent }` envelope. Queue position is advisory and may
change immediately after discovery; `runId`, ownership, and lifecycle state are authoritative. The
machine's limit and the 32-item queue bound are server policy, never fields the browser may
submit.

### D. The shell owns one presentation per run

18. Replace AppShell's singleton run fields and refs with ephemeral per-run state plus a
    session-to-live-run index. Each entry owns its descriptor, status, preview, tool activity,
    permissions, failure/continuation state, stream controller, and cancellation handle. Durable
    session snapshots and device workspace storage do not absorb this execution state.
19. Sending is disabled only when the focused session already has a queued/running/needs-you turn,
    lacks a primary repository, or fails the existing provider/mode checks. A turn in another open
    session does not disable the composer. Server admission remains authoritative when two clients
    race.
20. Event consumption is keyed by `runId` and its owning session. Interleaved deltas, tool activity,
    permission requests, errors, and completions from two streams update only their own view.
    Permission and cancel actions take an explicit `runId`; no shared “current run” ref remains.
21. The open-view strip presents every session independently:

    - queued — a quiet queued state and its current position;
    - running — the existing working treatment and current status;
    - needs-you — the approval treatment and pending count;
    - completed or failed in the background — the existing unread treatment, incremented once for
      the terminal result rather than once per replayed event.

22. Focusing a live view shows only that run's preview, ribbon, activity, permission cards, status,
    and cancel action. A queued turn can be cancelled before it starts. A queued, running, or
    needs-you view cannot be closed; unrelated views remain focusable, editable, sendable, and
    closable.
23. Background permission requests are visible on their owning tab and become answerable after the
    user focuses that view. This story does not add a cross-project Inbox or answer permissions from
    outside the owning session; that is the Arena slice.

### E. Reload recovers every relevant run

24. Recovery reconciles every active descriptor belonging to the selected project's open sessions,
    not `active[0]`. It ensures a missing owning view is open, attaches queued/running/needs-you
    streams independently, and refreshes each canonical session after that run ends.
25. Discovery and attachment races are isolated per run. A local send supersedes recovery only for
    the same session/run; it does not suppress attachment to other active runs. One missing or
    already-finished stream cannot clear or overwrite another run's state.
26. Reloading with two running turns and one queued turn restores all three tab states and queue
    position, without replay-derived duplicate messages, permissions, or unread increments. When a
    slot opens, the queued stream transitions to running and completes without another user action.
27. Project navigation remains as Story 36 shipped it. The selected project may contain several
    concurrent turns, while the next Arena story owns a host-wide cross-project activity surface,
    cross-session permission answering outside an open view, and deliberate navigation among
    projects with background work.

---

## Acceptance criteria

- [ ] `CODEAI_MAX_CONCURRENT_RUNS` defaults to 2, validates the range 1–8, honors the legacy-prefix
      fallback, is documented, and controls the process-wide scheduler without becoming a client
      request field.
- [ ] The scheduler runs no more than the configured number of eligible turns, keeps at most 32
      queued turns, promotes the oldest eligible turn when capacity opens, and never leaves a slot
      idle solely because an older queued turn is lock-blocked.
- [ ] Accepted queued turns have canonical user messages and discoverable `runId`s; queue overflow
      fails with 429 before append, and every reservation/append/start failure leaves neither a
      stranded queue record nor a falsely live message.
- [ ] A session and a provider session each have at most one queued/executing turn, enforced on the
      server under racing requests; a conflict returns 409 with the existing run descriptor.
- [ ] Ask/Plan turns may read one checkout concurrently, while an Agent turn has exclusive checkout
      execution and queued writers are not starved by later readers.
- [ ] A permission wait reports `needs-you`, preserves its slot and checkout lock, routes decisions
      only to its `runId`, and returns to running or finishes without changing another run.
- [ ] Cancelling a queued turn starts no provider process, records cancelled/not-sent canonically,
      emits its terminal stream events, removes it from the queue, and promotes/repositions the
      remaining work. Running cancellation retains its existing delivery semantics.
- [ ] Run discovery reports all queued/running/needs-you records with accurate ownership, lifecycle,
      start/enqueue timestamps, queue position, and approval count; recent replay remains isolated by
      `runId` and expires by the existing retention policy.
- [ ] Two simultaneous streams can interleave every `AgentEvent` variant without leaking preview,
      tool activity, permissions, failure, continuation, cancellation, or completion into the other
      session's presentation.
- [ ] A session with no run remains sendable while other sessions run. A session with its own live
      or queued turn cannot send another, and route-level admission remains correct across browser
      contexts.
- [ ] Tabs independently and accessibly expose queued, running, needs-you, failed/unread, and idle
      presentation; every focused view exposes only its own controls, and only queued/live views are
      protected from closing.
- [ ] Reload with several active and queued turns attaches each relevant run, preserves canonical
      messages and per-view device state, survives per-run discovery/attachment/completion races,
      and lets queued work start later without the original request stream.
- [ ] Provider health, host ownership, repository resolution, Ask/Plan/Agent tool boundaries,
      explicit Agent approvals, timeouts, replay bounds, and temporary-attachment cleanup retain
      their existing behavior under concurrency.
- [ ] Unit tests cover config bounds, capacity, the queue bound, eligible FIFO promotion, session and
      provider uniqueness, checkout reader/writer exclusion, permission-held capacity, queued/running
      cancellation, retention, and route-bundle `globalThis` sharing.
- [ ] Client and route tests force concurrent stream interleavings and recovery races rather than
      relying on timing; Playwright covers two running turns, a third queued turn, background
      approval, promotion, cancellation, navigation, and reload.
- [ ] `npm run lint`, `npm test`, and `npm run test:e2e` pass.

## Out of scope

- The Arena, Inbox, cross-project activity aggregation, answering a permission outside its owning
  open view, or user-facing notifications beyond the existing tabs and unread treatment.
- Authenticated devices, a second machine, remote execution/routing, machine selection, or a
  coordinator. This scheduler owns one local Next.js process and its machine only.
- Durable queue or live-process recovery across a server restart. Canonical session recovery stays
  durable; execution scheduling stays in memory.
- Two simultaneous turns in one session, concurrent use of one provider session, or conversation
  branching/merging.
- Worktree isolation, automatic worktree creation, or concurrent Agent writers on one checkout.
- Adaptive limits based on CPU/RAM/provider load, per-provider quotas, priorities, pause/resume,
  reorder controls, estimates, or changing limits without restarting.
- Team authorization and multi-writer policy. The existing trusted-localhost boundary remains until
  the authenticated-device/team stories.

## How to verify

1. Set `CODEAI_MAX_CONCURRENT_RUNS=2`, run the fake-provider app, open three sessions in one project,
   and send a delayed turn in each. The first two tabs become Running; the third becomes Queued with
   position 1. Completing either running turn starts the queued turn without another click.
2. Repeat with limit 1 and then 8, and start with 0, 9, and non-integer values. Valid settings enforce
   their exact bounds; invalid settings fail configuration with the setting's name.
3. While two turns run, move between all open views. Each preview, activity list, cancel action,
   completion, and unread badge stays with its own session; every idle session remains sendable.
4. Make one Agent turn request permission while another independent turn runs. The owning tab shows
   Needs you and can answer by its `runId`; the waiting run still counts toward capacity and its
   decision never reaches the other broker.
5. Fill both slots, queue two more turns, and cancel the first queued run. No fake-provider spawn is
   observed for it, its canonical user message is cancelled/not-sent, the next item becomes position
   1, and it starts when a slot opens.
6. Race two requests against the same session and against the same provider session. Exactly one is
   accepted. Then run two read-only turns on one checkout, queue an Agent writer, and confirm later
   readers do not pass the waiting writer; no writer overlaps another turn on that checkout.
7. Reload with two turns running and a third queued, including one background approval. All owning
   views and states return, each stream reattaches by `runId`, no transcript or unread item duplicates,
   and promotion still occurs after reload.
8. Force one discovered run to finish before attachment and another attachment to 404 while a third
   keeps streaming. Each owning session ends from its canonical snapshot and the surviving stream is
   not cleared.
9. Set the queue at its test bound and submit one more request. It receives 429, no canonical user
   message is appended, and existing queued/running work is unchanged.
10. Run `npm run lint`, `npm test`, and `npm run test:e2e`.
