# Story 129 — Push workspace updates instead of polling Arena

**Status:** Shipped · **Type:** Full-stack

## Problem and outcome

Arena rebuilt and fetched its overview every two seconds per browser tab. Story 85's November 6
cache fix removed repeated transcript reads, but the application still made idle requests and
repeated discovery work. Existing agent NDJSON streams follow individual known runs; they do not
discover sessions, approvals, titles or attached-machine changes across the workspace.

Keep one workspace subscription per browser tab, with an initial snapshot and updates from the
state owners. Idle work is limited to transport/authentication heartbeats. Keep current-session
agent streaming, canonical mutations, and command approval authority unchanged.

## Implementation and contracts

- `src/server/workspace/snapshotFeed.ts` shares source subscriptions and snapshot construction,
  coalesces bursts for 50 ms, reconciles invalidation during a load, suppresses equal snapshots,
  and discards work from an abandoned generation.
- `workspaceFeed.ts` owns a local executor feed and a home aggregate. Browser tabs share one
  upstream stream per attached executor. Topology compares identity/origin/credential/expiry;
  persisting an observation cannot create a repeated fetch loop.
- `workspaceChanges.ts`, committed `SessionStore` writes, `MachineRegistry` attachment changes,
  and `RunRegistry.subscribeChanges` provide notifications. Token deltas and transcript history
  do not rebuild Arena. Narrow filesystem watches cover external canonical-file changes and
  directory replacements; they exclude writer heartbeats, temporary writes and repository trees.
- `snapshotStream.ts` keeps only the latest pending snapshot per reader. Five-second heartbeats
  recheck device/peer authorization but do not load snapshots. EOF, request abort, revocation,
  malformed/oversized data, or twenty seconds without frames trigger teardown/recovery.
- `GET /api/arena` and `/api/machine/snapshot` negotiate NDJSON with `Accept: application/x-ndjson`.
  Ordinary JSON GETs remain for explicit refresh. Per-frame bounds are 8,001,024 bytes for executor
  streams and 72,001,024 bytes for the browser's local-plus-eight-peer aggregate; there is no
  cumulative stream output or duration limit. Peer frames also validate schema and machine id.
- `arenaSubscription.ts` reconnects with one-to-thirty-second backoff, retains cached cards as
  stale on failure, and waits for a snapshot before restoring freshness after reconnect. A
  heartbeat alone cannot make old actions current. Explicit Refresh and browser activation also
  recheck discovery/provider readiness. Other progress/authentication pollers are unchanged.
- `browserStreamBudget.ts` reserves the previously available HTTP/1 command slot against the
  new long-lived workspace response. Actual run responses (including home-origin proxies) and
  workspace bodies share a five-response budget; a run evicts excess workspace bodies by graceful
  EOF and new workspace admission returns 429. It never cancels or refuses provider execution.
  Cached overview cards become stale until reconnect succeeds. Paired requests group by personal
  credential digest plus host/data directory; Local requests use a conservative UA digest, which
  may group separate identical-UA profiles. There is no new cookie/bootstrap race, authority or
  provider quota. The existing six-run-response HTTP/1 limit remains outside this change.
- The local feed schedules the nearest 48-hour archive deadline while observed. Overdue live
  sessions wake on run completion instead of spinning; failed housekeeping retries after thirty
  seconds. Recent run discovery schedules its own five-minute retention expiry. Last-subscriber
  teardown releases watches, timers, registry listeners and remote transports, including late I/O.

Home and attached executors need this subscription implementation for pushed peer updates.
An incompatible or unavailable executor remains Offline and retries with bounded backoff; the
subscription does not silently fall back to healthy two-second polling.

## Acceptance and verification

- [x] One idle browser connection survives heartbeats without repeated Arena requests or snapshots.
- [x] Multiple tabs receive project creation and session archive/restore through server pushes.
- [x] Shared upstream ownership, offline cached cards, reconnect and detach cleanup are exercised.
- [x] Cross-session approvals, saved changes, external file edits, archive deadlines and run expiry
      reach subscribers; token bursts do not trigger overview builds.
- [x] Initial-load races, slow readers, malformed/oversized frames, abandoned loads, explicit refresh,
      stalled connections, and device/peer revocation have regressions.
- [x] Five real open run responses leave an approval POST usable; overview updates resume after
      the response count drops. Accounting is released on EOF, error, cancellation and abort.
- [x] Final TypeScript, production build, offline/browser checks and independent review complete.

Browser tests that intercept Arena now use explicit controlled subscription updates in
`e2e/arena-stream.ts`; the new `workspace-subscriptions.spec.ts` uses real production streams.
The reconnect journey interrupts and restarts only its private fixture server and adds a canonical
project while it is down. The two-tab journey verifies that pushes do not cause another snapshot
request. The five-response journey includes queued work and sends the approval through the real
browser connection pool. Existing archive/title/session/permission behaviors remain acceptance
requirements. Navigation tests wait for rendered state rather than network idle, which a healthy
subscription deliberately never reaches; generated titles are identified by session id.

Independent review found a heartbeat-before-first-snapshot freshness defect. Its regression failed
before the correction and now passes. JSON and streaming routes also share their remote projection
to prevent representation drift.

An additional transport review identified command starvation from the extra HTTP/1 connection.
Disabling response accounting makes its new regression fail. The budget preserves command
progress at that boundary, with an explicit stale-overview overload state. Another regression
bounds freshness of an explicit JSON refresh to twenty seconds if the replacement stream supplies
only heartbeats. The five-response browser check and the corrected navigation/title/focus checks
pass.

Final verification on November 6, 2026:

- All **1,897 offline tests in 161 files** pass, including thirty new subscription and transport
  regressions. The full suite runs with deployment settings removed and two workers.
- **128 distinct production-browser cases** pass across Arena/Inbox, machine settings, projects,
  session setup, conversation URLs/titles, tabs, Canvas, MUI controls and six immersive journeys.
  One deliberate visual-comparator case is skipped when the opt-in visual flag is disabled.
  The combined run passed 124 cases; focused reruns pass its four remaining Canvas cases after
  fixing their loading race and ambiguous New session selectors. No product change was needed.
- `npm run lint`, the isolated `.next-e2e` production build and `git diff --check` pass.
- Independent source and transport review has no remaining blocking findings.

The running application has not been rebuilt or restarted. Real attached-executor TLS streaming
and physical headset acceptance are not claimed by these automated fixture checks.
