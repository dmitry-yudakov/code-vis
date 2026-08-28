# Story 27 — Address runs by run id and discover them host-wide

**Status:** Shipped 2026-08-28 · **Type:** Full-stack (run lifetime + streaming protocol) ·
**Depends on:** [Story 26](STORY-20260826-loosen-project-host-bindings.md) (host-owned conversations,
shipped 2026-08-26)

**Epic context:** [web2 operational collaboration](EPIC-20260806-web2-operational-collaboration.md) ·
Slice 3 of [the environment memo](../docs/multi-project-session-environment.md#possible-delivery-slices)

The file keeps its original `session-keyed-host-bound-runs` name; the design changed after review and
no longer introduces a session index. See *Retired premises* below.

---

## Motivation

Story 26 made the host record canonical: the assistant message, the user turn's delivery state, and
the participant cursor are committed as one store revision *before* the completion event is emitted
([conversationService.ts](../src/server/conversation/conversationService.ts#L31)). The run registry
still behaves as if the stream were how a browser learns a result, and that mismatch is now visible.

1. **A finished run is still advertised as live.**
   [`subscribe(threadId)`](../src/server/runs/runRegistry.ts#L71) falls back to the thread's retained
   record, so reloading inside the five-minute retention window after a completed turn announces
   "Reconnected to the turn that was still running", replays `run-started` — which rewrites the
   selected addressee ([AppShell.tsx](../src/features/shell/AppShell.tsx#L483)) — rebuilds the
   streamed preview, and increments the unread badge for a message the canonical snapshot already
   contains. The durable record is authoritative; nothing about a finished run should be guessed
   from a stream.
2. **Retention is keyed by thread, so one participant erases another.**
   [`start()`](../src/server/runs/runRegistry.ts#L43) deletes the thread's retained record, and
   `recent` is a `Map<threadId, RunRecord>`. Addressing a second agent in the same conversation
   destroys the first run's replayable record even though the two runs share nothing but a thread.
3. **Capacity is global but ownership is only discoverable per thread.** One run may exist per host,
   while Story 26 made several browser contexts over one host store ordinary. A busy 409 in thread B
   can be caused by a run in thread A, and the blocked client has no run id, no name for it, and no
   cancel handle.

This story makes `runId` the handle for replay, permission decisions, cancellation, and
reattachment; adds host-wide run discovery; and fixes the reload path so the canonical conversation —
not a retained stream — is what a reloading browser trusts. Concurrency deliberately remains one.

### Retired premises

An earlier draft claimed that a browser-selected participant id could orphan a live run when tabs
disagreed about the addressee. That is not true of the shipped code and never was: the stream route
accepts only a thread id ([stream/route.ts](../src/app/api/agent/stream/route.ts#L14)), the registry
keys by thread, and no reattachment path reads `addressedAgentId`. The premise is retired rather
than fixed, and this story keeps browser participant selection off run addressing entirely.

---

## Current behavior (where the code is)

- [`RunRegistry.active`](../src/server/runs/runRegistry.ts#L37) is one optional `RunRecord`;
  [`recent`](../src/server/runs/runRegistry.ts#L38) is keyed by thread id.
- [`start()`](../src/server/runs/runRegistry.ts#L41) takes no participant id, refuses whenever the
  single active field is occupied, and deletes the thread's retained record.
- `attachPermissions`, `record`, `decide`, `cancel`, and `finish` special-case that one active field
  ([runRegistry.ts](../src/server/runs/runRegistry.ts#L48)).
- [`subscribe(threadId)`](../src/server/runs/runRegistry.ts#L70) prefers the thread's active run and
  otherwise returns its retained one; [GET `/api/agent/stream`](../src/app/api/agent/stream/route.ts#L13)
  accepts only a thread id and 404s when neither exists.
- The [message route](../src/app/api/agent/message/route.ts#L121) starts without a participant id and
  attaches its own response stream by thread id
  ([message/route.ts](../src/app/api/agent/message/route.ts#L168)).
- The [reattachment effect](../src/features/shell/AppShell.tsx#L722) hydrates the canonical
  conversation and then attaches by thread id, adopting whatever run the server offers.
- [`current`](../src/server/runs/runRegistry.ts#L106) is unused.
- The process-wide `globalThis` pin ([runRegistry.ts](../src/server/runs/runRegistry.ts#L127)) is
  intentional and load-bearing because Next compiles route handlers into separate bundles.
- Host-bound provider sessions are already rejected before registry admission and process spawn
  ([message/route.ts](../src/app/api/agent/message/route.ts#L61)) and are covered by tests.

---

## Desired behavior

### A. Every run is addressed by its run id

1. `RunRecord` carries `runId`, `threadId`, `participantId`, and `startedAt`, plus `finishedAt` once
   it ends. The registry holds two indexes — `liveByRunId` and `recentByRunId` — and no thread-keyed
   map. Retained records expire only by the existing retention window.
2. `start()` takes `participantId` and admits a run while `liveByRunId.size < MAX_CONCURRENT_RUNS`,
   which stays `1`. Admission never deletes another run's retained record. The user-visible message
   remains "Another agent turn is already running."
3. A live `(threadId, participantId)` uniqueness index is deliberately **not** added. At a limit of
   one it is indistinguishable from capacity refusal — same code path, same 409 — so it would be
   structure without observable behavior. The rule is recorded here and enforced when concurrency
   actually rises (memo slice 6): a session may not hold two live runs even when capacity allows.
4. Keep the process-wide registry pinned on `globalThis`. The rule is "no singleton active slot
   standing in for keyed run state," not "no process-wide registry service."
5. Remove the unused `current` getter. If diagnostics need visibility, expose a read-only
   `currentRuns` list of descriptors.

### B. Every run operation resolves by run id

6. `attachPermissions`, `record`, `subscribe`, `unsubscribe`, `decide`, `cancel`, and `finish` all
   locate their record by `runId`. `finish` moves one record from `liveByRunId` to `recentByRunId`
   and cannot touch, overwrite, or evict another participant's result.
7. Permission brokers remain attached only to their owning run. An unknown run or request keeps the
   existing explicit outcome; more records cannot route one participant's approval to another.
8. The message route passes `participantId` to `start`, attaches its own response stream by `runId`,
   and updates every changed call site — including `attachPermissions`. No call site relies on a
   former single `active` field or on `subscribe(threadId)`.

### C. Discovery is host-wide; attachment is by run id

9. Add `GET /api/agent/runs` returning separate `active` and `recent` descriptor arrays, where a
   descriptor is `{ runId, threadId, participantId, startedAt, finishedAt? }`. `threadId` is an
   optional filter, not a required scope: a global capacity limit needs globally discoverable
   ownership. There is no participant filter.
10. The busy 409 from `POST /api/agent/message` carries the active run's descriptor so a blocked
    client can name the conversation that is busy and, if the user chooses, cancel it by `runId`.
    The UI never auto-cancels a run belonging to another thread.
11. `GET /api/agent/stream` accepts `runId` — never a thread id standing in for one, and never
    browser-selected participant identity. The registry subscribes directly to that record and
    returns the existing replay/finished contract. A replayed `run-started` event remains
    authoritative for participant and message attribution.
12. Retained descriptors keep direct replay and debuggability by `runId`, are never auto-attached,
    and never re-announce a live turn. The protocol can represent several active runs even though
    the current policy admits one; the concurrency story owns presenting them.

### D. Reload trusts the canonical record, and completion races end canonical

13. On reload the browser discovers runs for the thread first, then:

    - **an active run exists** — adopt its `participantId`, attach by `runId`, and hydrate the
      canonical conversation;
    - **no active run** — hydrate the canonical conversation and attach nothing. A finished run is
      never used to reconstruct a result, a preview, an unread count, or an addressee.

14. Discovery, hydration, and completion interleave, and the browser must not assume they agree.
    Story 26 commits the assistant message before emitting its event, so a snapshot fetched a moment
    earlier is already stale the instant the run finishes. Three interleavings must all end with the
    canonical snapshot:

    - hydrate → run completes → discovery reports no active run (the stale-snapshot case the
      hydrate-then-discover order would leave uncorrected);
    - discovery reports an active run → the run finishes before attachment, so the stream is gone or
      already finished;
    - attachment succeeds → completion arrives on the stream.

    Whenever attachment races with completion — a discovered run that is missing, already finished,
    or finishes while attached — the browser refetches the canonical conversation before clearing
    its running state. The interleavings are covered by an explicit test, not left to timing.
15. A discovered active run drives the cancel handle from its descriptor, so cancellation works
    before any event has been replayed.

### E. Host-bound sessions: regression coverage only

16. Story 26 already validates a provider session's `hostId` before registry admission and provider
    spawn, and covers it in route tests. This story adds no new behavior here; it keeps the check
   covered on the run paths so rekeying admission cannot quietly move it: a foreign-host session
   returns 409 before admission and before any process starts.

---

## Implementation (where the code is)

- [`RunRegistry`](../src/server/runs/runRegistry.ts#L35) owns `liveByRunId` and `recentByRunId`,
  applies the one-run capacity policy, resolves every operation by run id, exposes descriptors, and
  remains pinned through `globalThis`.
- [`GET /api/agent/runs`](../src/app/api/agent/runs/route.ts#L8) provides host-wide and thread-filtered
  discovery. The [message route](../src/app/api/agent/message/route.ts#L121) supplies participant
  identity, returns the busy descriptor, and attaches its response by run id.
- [`GET /api/agent/stream`](../src/app/api/agent/stream/route.ts#L13) accepts only `runId`; its finished
  response header lets automatic recovery avoid consuming retained replay while keeping direct
  replay available.
- [`reconcileThreadRun`](../src/features/conversation/runRecovery.ts#L11) makes the canonical refetch
  mandatory for no-active, completion-before-attachment, and attached-completion paths.
  [AppShell recovery](../src/features/shell/AppShell.tsx#L751) adopts live run identity before replay,
  exposes cancellation immediately, avoids replacing a local send that starts during discovery,
  and never auto-attaches a recent run.
- [Registry/route tests](../test/runRoutes.test.ts#L14), [forced interleaving tests](../test/runRecovery.test.ts#L12),
  and [Playwright reload coverage](../e2e/canvas.spec.ts#L135) cover discovery, replay, permissions,
  cancellation, completed reload, and live reload.

---

## Acceptance criteria

- [x] Live and retained runs are indexed by `runId`, each record carries `threadId`, `participantId`,
  and `startedAt`, and the thread-keyed retention map and its erase-on-start are gone.
- [x] `start` admits at most `MAX_CONCURRENT_RUNS = 1`, refuses further runs with the unchanged
  visible error, leaves every other retained record intact, and admits a new run once the live one
  finishes; retained records expire only by time.
- [x] `attachPermissions`, record/replay, `subscribe`, `unsubscribe`, `decide`, `cancel`, and
  `finish` resolve by `runId`, and `finish` never overwrites another record.
- [x] `GET /api/agent/runs` lists host-wide active and recent descriptors with an optional `threadId`
  filter, and the busy 409 carries the active descriptor.
- [x] Stream attachment uses `runId` and never depends on `addressedAgentId`, browser participant
  selection, or a thread id.
- [x] After a completed run, reloading inside the retention window shows the canonical conversation
  only: no reconnection notice, no replayed preview, no unread increment, no rewritten addressee.
- [x] Reloading during a live run discovers it, adopts its participant, attaches by `runId`, and can
  cancel it before any replayed event arrives.
- [x] All three discovery/hydration/completion interleavings end with the canonical snapshot, proven
  by a test that forces completion between the calls rather than by timing.
- [x] The registry remains process-wide through `globalThis`; route-bundle isolation does not break
  permissions, cancellation, discovery, or replay.
- [x] A foreign-host provider session is still rejected before run admission and process spawn.
- [x] Tests cover run-id start/finish, capacity refusal, independent retention across participants,
  every run-id operation, permission routing, host-wide and filtered discovery, busy-descriptor
  reporting, live reattachment after reload, no attachment after completion, the three race
  interleavings, cancel after reload, route-bundle sharing, and host mismatch.
- [x] `npm run lint`, `npm test`, and `npm run test:e2e` pass.
- [x] The current single-run product behavior and visible busy error remain unchanged.

## Out of scope

- Raising `MAX_CONCURRENT_RUNS` above one, queuing, per-host configuration, or concurrent-run UI.
- The live `(threadId, participantId)` uniqueness index, which belongs with real concurrency.
- Auto-cancelling or auto-navigating to a run that belongs to another thread.
- Live activity across several workspaces, background permission surfaces, and completion alerts.
- Remote execution/routing, multi-host run coordination, or transferring provider sessions.
- Authentication or authorization for run discovery, stream attachment, cancellation, or approvals;
  the server remains inside the trusted localhost boundary until the remote-client story.

## How to verify

1. `npm run lint && npm test && npm run test:e2e` — all green.
2. Start a turn and reload the sending context: discovery finds the live run, the UI adopts its
   participant, and cancel works immediately. Change the selected addressee in a second browser
   context first and confirm it changes nothing about attachment.
3. Exercise one Agent-mode permission after reattachment and confirm only that run's broker receives
   the decision.
4. Finish a run and reload within the retention window: the conversation comes from the canonical
   record, with no reconnection notice, no preview flash, and no unread bump. Then attach the recent
   descriptor's `runId` directly and confirm the finished stream still replays for debugging.
5. Start a turn addressed to one agent, finish it, start another addressed to a second agent, and
   confirm the first run's retained record is still discoverable and replayable.
6. Start a turn in thread A and send in thread B: the 409 names the busy conversation and its run,
   and nothing is cancelled automatically.
7. Reload as a turn completes — and, in a test, force the run to finish between discovery and
   attachment — and confirm the transcript ends in the canonical state in every interleaving.
8. Use a foreign-host session fixture and confirm 409 before admission and before any provider
   process starts.

Verified 2026-08-28: strict TypeScript passed; Vitest passed 139 tests across 22 files; the
production build passed; and Playwright passed all 4 scenarios in installed Chrome.
