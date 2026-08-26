# Story 27 — Key live runs by session and reattach by run id

**Status:** Draft · **Type:** Full-stack (run lifecycle + streaming protocol) ·
**Depends on:** [Story 26](STORY-20260826-loosen-project-host-bindings.md) (host-owned conversations)

**Epic context:** [web2 operational collaboration](EPIC-20260806-web2-operational-collaboration.md) ·
Slice 3 of [the environment memo](../docs/multi-project-session-environment.md#possible-delivery-slices)

---

## Motivation

The current run registry correctly survives browser detachment, but represents the whole process as
one optional active record and discovers reattachment by thread id. A later concurrency increase
would make that ambiguous, while requiring a browser-selected participant id today can orphan a
perfectly live run when tabs disagree about the selected addressee.

This story gives each live/retained run explicit thread and participant identity, adds server-side
run discovery, and makes `runId` the handle for replay, permission decisions, cancellation, and
reattachment. The concurrency policy deliberately remains one live run per host.

---

## Current behavior (where the code is)

- [`RunRegistry.active`](../src/server/runs/runRegistry.ts#L37) is one optional `RunRecord`, while
  retained results are keyed only by thread.
- [`start()`](../src/server/runs/runRegistry.ts#L41) takes no participant id and rejects whenever the
  single active field is occupied.
- `attachPermissions`, `record`, `decide`, `cancel`, and `finish` special-case that one active field
  ([runRegistry.ts](../src/server/runs/runRegistry.ts#L48)).
- [`subscribe(threadId)`](../src/server/runs/runRegistry.ts#L70) chooses the thread's active or recent
  run, and [GET `/api/agent/stream`](../src/app/api/agent/stream/route.ts#L13) accepts only a thread id.
- [AppShell reattachment](../src/features/shell/AppShell.tsx#L710) knows only the selected thread
  after reload. Browser participant selection is not reliable run identity across tabs.
- The process-wide `globalThis` pin in [runRegistry.ts](../src/server/runs/runRegistry.ts#L123) is
  intentional and load-bearing because Next compiles route handlers into separate bundles.

---

## Desired behavior

### A. Live and retained records carry session identity

1. `RunRecord` requires `runId`, `threadId`, and `participantId`. A structured session key derived
   from `(threadId, participantId)` indexes live runs; retained runs preserve the same identity and
   remain independently addressable by `runId` during the existing retention window.
2. `start()` takes `participantId` and refuses when that session already has a live run or when
   admitting it would exceed `MAX_CONCURRENT_RUNS = 1`. Starting a new run removes only that
   session's retained predecessor. The user-visible 409 remains "Another agent turn is already
   running."
3. Keep the process-wide registry pinned on `globalThis`. The rule is "no singleton active slot
   standing in for keyed run state," not "no process-wide registry service."
4. Remove the unused `current` getter. If diagnostics need visibility, expose a read-only
   `currentRuns` list containing `runId`, `threadId`, and `participantId`.

### B. Every run operation resolves by run id

5. `attachPermissions`, `record`, `unsubscribe`, `decide`, `cancel`, and `finish` all locate the
   same active record by `runId`. `finish` removes both live indexes and retains the completed record
   without overwriting a different participant's result.
6. Permission brokers remain attached only to their owning run. An unknown run/request keeps the
   existing explicit outcome; increasing the number of records cannot route one participant's
   approval to another.
7. The message route passes `participantId` to `start`, attaches the initial response stream by
   `runId`, and updates every changed registry call site—including `attachPermissions`. No call site
   relies on a former single `active` field or the old `subscribe(threadId)` signature.

### C. Discover by thread, reattach by run id

8. Add `GET /api/agent/runs?threadId=<uuid>` returning separate `active` and `recent` descriptor
   arrays for that thread. Each descriptor carries `{ runId, threadId, participantId, startedAt,
   finishedAt? }`. With the limit at one, hydration sees at most one active run globally; retained
   results may include several participant sessions without becoming ambiguous.
9. `GET /api/agent/stream` accepts `runId`, not browser-selected participant identity. The registry
   subscribes directly to that record and returns the existing replay/finished contract. A replayed
   `run-started` event remains authoritative for participant and message attribution.
10. On reload, the browser first hydrates the canonical conversation from Story 26, then discovers
    runs for the thread. It adopts an active run's `participantId` and attaches by `runId`; if there
    is no active run, the durable conversation is already authoritative and no retained stream must
    be guessed. A stale `addressedAgentId` cannot turn a live run into a 404, hide its cancel handle,
    or leave every subsequent send blocked until timeout.
11. Recent descriptors preserve direct replay/debuggability but are never mistaken for the live run.
    More than one active result for a thread is representable by the protocol even though the current
    UI and concurrency policy only consume one; the environment/concurrency story owns presenting
    several.

### D. Host-bound sessions remain enforced

12. Story 26 validates a provider session's `hostId` before resume. This story preserves that check
    on every start path and includes it in run-route regression coverage: a foreign-host session
    returns 409 before registry admission or provider spawn.

---

## Acceptance criteria

- [ ] Live runs are indexed by `(threadId, participantId)`, retained runs preserve participant
  identity, and at most one run is admitted globally.
- [ ] `start` rejects a duplicate session and a different second session, then admits a new run after
  the first finishes.
- [ ] `attachPermissions`, record/replay, unsubscribe, decide, cancel, and finish resolve by `runId`
  across the keyed registry.
- [ ] Run discovery separates active from recent records and returns authoritative run/participant
  ids; stream reattachment uses `runId` and never depends on `addressedAgentId` matching the live
  participant.
- [ ] Reload, cross-tab addressee divergence, permission delivery, explicit cancellation, and
  finished-run replay behave without orphaning the run.
- [ ] The registry remains process-wide through `globalThis`; route-bundle isolation does not break
  permissions, cancellation, discovery, or replay.
- [ ] A foreign-host provider session is rejected before run admission and process spawn.
- [ ] Tests cover keyed start/finish, duplicate- and second-session refusal, independent retention,
  every run-id operation, permission routing, discovery, stale browser addressee reattachment,
  cancel after reload, route-bundle sharing, and host mismatch.
- [ ] `npm run lint`, `npm test`, and `npm run test:e2e` pass.
- [ ] The current single-run product behavior and visible busy error remain unchanged.

## Out of scope

- Raising `MAX_CONCURRENT_RUNS` above one, queuing, per-host configuration, or concurrent-run UI.
- Live activity across several workspaces, background permission surfaces, and completion alerts.
- Remote execution/routing, multi-host run coordination, or transferring provider sessions.
- Authentication or authorization for run discovery, stream attachment, cancellation, or approvals;
  the server remains inside the trusted localhost boundary until the remote-client story.

## How to verify

1. `npm run lint && npm test && npm run test:e2e` — all green.
2. Start a turn, change the selected addressee in another browser context, reload the sending
   context, and confirm discovery finds the live run, the UI adopts its participant, and cancel works.
3. Exercise one Agent-mode permission after reattachment and confirm only that run's broker receives
   the decision.
4. Finish a run and reload: confirm the completed message comes from the canonical conversation
   without auto-attaching a recent run. Separately use the recent descriptor's `runId` to verify
   direct stream replay. Start another participant's run and confirm it does not erase the first
   session's retained identity.
5. Attempt a second live run from the same and then a different participant; both receive the
   existing busy response until the first finishes.
