# Story 149 — Suspend work for build and restart

**Status:** Shipped · **Type:** Full-stack · **Depends on:** Story 64, Story 90

## Outcome

Build & restart accepts working sessions. It stops admitting turns and launching queued work,
waits for observed provider response/tool boundaries, and saves unfinished tasks before building.
A failed build keeps tasks suspended while the current release serves the UI. Repairing the
checkout and starting CodeAI again with the same data directory/provider homes continues those
tasks without requiring the original supervisor or a browser.
Accepted waiting requests are saved immediately and also survive ordinary process restarts.

## Contracts and implementation

- `RunRegistry` separates draining from exclusive build access: admission/dispatch stop first,
  while checkpoint finalization and managed-worktree validation can still take read leases.
  The final empty ownership check excludes new helper reads before asking the parent to build.
  Provisional admissions, queue edits, cancellations and provider cleanup settle before release.
- `submitMessage.ts` owns the shared message admission/execution path. HTTP retains device and
  origin authorization; startup uses the server service and the existing canonical user message.
  Session/provider/checkout identities, current provider health, supported modes and model choices
  are checked again. An unresolved suspended message blocks newer ordinary turns in that session.
- `<dataDir>/suspended-turns/<runId>.json` holds the full validated request, including raw image
  and marked-canvas evidence, the executing host/path/provider session, checkpoint and cumulative
  attempt/time/tool budget. Records distinguish `preparing`, `ready` and `resuming`.
  Only `ready` records resume automatically. Claiming precedes launch; completion/cancellation
  removes the record. A completed canonical reply wins over a stale journal. The file contract
  is compact JSON, at most 6,100,000 bytes per record and 1,000 records per directory.
- Continuations include up to 64 KiB of canonical saved activity as quoted JSON data, with 8 KiB
  content fields and explicit omission markers. Approval previews are omitted; decisions remain.
  A real Claude probe showed that native history alone can miss the last completed read result.
  Both Native Claude and Codex probes retain the result when this saved activity is supplied.
- Format 17 adds the public `suspended` turn lifecycle. Ordinary crash recovery restores unclaimed
  waiting requests and fails running/uncertain work conservatively. Startup leaves planned suspensions intact. Attempts retain
  their namespaces and remaining budgets; pending approvals close without approval, with explicit
  denials still binding. Temporary attachment directories are reconstructed from saved evidence.
- Each resumed writing segment captures a fresh Undo baseline, preserving any console repairs.
  The earlier checkpoint stays immutable; normal retention protects the latest segment of each
  live run and prunes finished older segments even when they share the same run id.
- Managed startup holds admission until the supervisor publishes an accepted idle snapshot after
  readiness. Rejected candidates execute no restored tasks. Initial startup now publishes that
  snapshot too. Recovery can reserve the previous eight running plus 32 queued entries before
  releasing dispatch. Unmanaged startup also runs recovery independently of the browser.
- Claude emits root `message_stop` boundaries; Codex observes actual tool items rather than
  partial text or plan items. Observed executing tools settle before deferred interruption.
  Local Linux Claude tracks descendants, then freezes/captures/force-stops its launcher for
  maintenance so a TERM handler cannot create an unobserved replacement. Existing Codex and
  Docker cleanup barriers remain in use. Non-Linux Local Claude finishes its full provider attempt.
- A failed build retains maintenance and shows **Sessions suspended**, with retry and terminal
  repair guidance. Preparation failures do not authorize another build. Suspended tasks are
  exempt from inactivity archiving; explicitly archiving one cancels its pending continuation.

## Limits

Provider notifications observe execution; they do not atomically gate the next tool. This is
deferred interruption and provider-session continuation, not a process-memory snapshot or an
exactly-once guarantee for external effects. Continuation explicitly inspects current files and
earlier outcomes before repeating an action. Provider persistence/login must still be available.
Failed preflight retains the request for a later restart; uncertain preparation/resumption is
retained for manual reconciliation and never automatically replayed. Older rollback releases
cannot read format 17; a continuity-aware release must be started to resume those sessions.

## Verification

The isolated production build and TypeScript pass. The full unit suite has 2,297 passing checks
and one unchanged failure: `visualLanguage.test.ts:15` still expects `next/font/google` although
Story 139 ships bundled fonts. All 15 production-browser checks and light/dark desktop/phone
screenshot inspection pass. Real Native Claude and Codex read-only suspend/resume probes pass:
the resumed inference recovers the previous random file token without reading the file again.
Independent review passes after fixing persistence, cleanup, capacity and Undo edge cases.
The running application has not been rebuilt or restarted; a complete managed restart with
mutating signed-in providers and physical Quest acceptance remain unverified.

## Queue release and completion-check follow-up — November 18, 2026

**Status:** Shipped.

Two restored queued ideas can each acquire the other as an archive blocker: recovery repeats
admission against a snapshot that now contains later accepted messages. Archiving the original
working session then releases neither idea. Separately, a successfully completed reply can skip
autoclose because its bounded activity history was shortened; history completeness does not describe
whether the task finished. This follow-up preserves the Arena orchestration contract in
[the vision](../docs/vision.md#the-arena).

Where the code is: `src/server/lifecycle/resumeSuspendedTurns.ts:24` restores in accepted order;
`src/server/conversation/submitMessage.ts:288` rebuilds archive blockers from canonical sessions;
`src/server/runs/sessionQueue.ts:22` excludes conversations first accepted after a recovered idea;
`src/server/storage/sessionStore.ts:84` decides whether a delivered reply can receive a completion
check. `test/restartRecovery.test.ts:53` exercises real suspension, storage and provider dispatch.

Recovery must exclude later conversations from an earlier entry's archive blockers, including
restored queue entries whose preflight fails and later ordinary sessions already idle. Derive
first acceptance from the first user message's turn, falling back to its creation time for legacy
records; keep this metadata server-only. Equal-time ordinary sessions remain blockers conservatively,
since legacy storage cannot establish their order; journal order distinguishes restored queued ties.
Keep earlier idle conversations and normal follow-ups as blockers; retain exclusive checkout
scheduling, evidence, edits, identity and conservative handling
of uncertain journals. Completed canonical question/reply pairs remain eligible for the existing
tool-free completion decision when activity detail was omitted. Interrupted, failed, cancelled,
pending and plan-only replies stay ineligible. No live session data is edited for this repair.

- [x] After a working turn and two queued ideas survive restart, archiving the working conversation
      starts only the first idea. Its reply alone does not release the second; its archive does.
- [x] Recovery also advances when the predecessor was archived while offline, and a later queue
      entry that cannot resume does not block earlier work. Saved edits/evidence and message/run
      identities survive; earlier idle conversations and normal follow-ups still block. Later ordinary
      conversations, including old empty shells first used later, do not become predecessors.
- [x] Autoclose checks a fully delivered completed reply with shortened activity history, while
      unfinished, stale, declined and plan-only cases retain their existing guards.
- [x] Regressions fail before the fix; focused tests, TypeScript, isolated build and independent
      review pass. Record any wider verification limits.

How to verify: run `restartRecovery`, `restartStartup`, `sessionQueue`, `runScheduler`,
`messageSchedulerRoutes`, `agentSessionArchive`, `sessionStore`, `localExecutorSnapshot`,
`workspaceFeed` and `turnHistoryConversation` tests;
typecheck and build into an isolated output directory. Use fixture providers and temporary stores
for recovery tests, and run the existing queue/autoclose production-browser journeys.

Verification: all **213 focused unit checks** across 17 suites pass, as do `npm run lint`,
`git diff --check` and the isolated `.next-e2e/restart-queue-fix` production build. Five existing
production-browser journeys pass against the final bundle: archive releases a queued idea,
reload/follow-up archive gating, KEEP_OPEN, enabling permission during execution, and checking a
newer completed follow-up. The new queue-cycle, later-idle/shell and shortened-history regressions
failed before their respective fixes. Independent read-only review found the later-idle case;
its regression now passes and final review has no remaining findings.

The checks use fake providers and temporary session data. No UI was changed; physical devices,
real-provider completion decisions and a managed restart of this installation were not rerun.
The running application and the user's queued messages were not modified or restarted.

## Durable waiting turns follow-up — November 18, 2026

**Status:** Shipped.

Queued sessions must survive an ordinary process restart as well as Build & restart, without
waiting for their predecessors to finish. This extends the Arena orchestration contract in
[the vision](../docs/vision.md#the-arena). Reuse the private restart journal: persist the full
validated request before acknowledging acceptance, leave waiting requests replayable, and claim
them durably before execution. Canonical session text remains authoritative for queued edits.
Running or uncertain deliveries keep conservative crash recovery.

Where the code is: `src/server/conversation/submitMessage.ts:346` persists requests before acceptance;
`src/server/storage/sessionStore.ts:1510` reconciles interrupted work;
`src/server/lifecycle/resumeSuspendedTurns.ts:20` restores journal entries;
`src/server/runs/runRegistry.ts:297` drains work before maintenance.

- [x] Accepted waiting requests and original evidence exist on disk before a successful response;
      persistence failure admits no executable work.
- [x] Ordinary process restarts restore waiting turns with original identities, edits, mode and
      evidence, including a second restart while they still wait. Earlier-session archive gating
      and checkout scheduling remain intact.
- [x] A queued-only Build & restart proceeds without running waiting requests; failed builds
      retain them. Completed and cancelled requests are never resurrected.
- [x] A durable claim precedes execution; interrupted or uncertain running work is not replayed.
- [x] Focused regressions, TypeScript, isolated build and independent review pass.

How to verify: run restart recovery/startup, suspended journal, scheduler, message scheduler,
session store and lifecycle tests, then TypeScript and an isolated production build. Use temporary
stores and fake providers; do not restart the running installation.

Implementation reuses `<dataDir>/suspended-turns/` and its existing bounds and request schema.
Ready requests remain ready during queue restoration and maintenance; execution first claims them
as `resuming`. Startup converts matching unclaimed queued messages into recoverable suspensions,
then restores all scheduler ownership before dispatch, including unmanaged startup with a full
32-entry waiting queue. Durable queued mode changes settle before promotion or cancellation.
Canonical saved text supplies edits; original evidence is reconstructed only at execution time.
Shared atomic-write helpers moved to `storage/atomicWrite.ts` so store startup can inspect the
journal without a circular module dependency. Setup no longer tells users to keep CodeAI running.

Verification: **209 focused unit checks** across 15 suites, **34 production-browser cases**
(`queued-session-setup`, `lifecycle`), TypeScript, `git diff --check`, the isolated
`.next-e2e/durable-queue` production build and independent review pass. Desktop/phone setup
screenshots were inspected in light and dark themes. Regression tests exercise two fresh server
processes without a managed parent, a full queue, edits/evidence/mode retention, failed builds,
interrupted maintenance preparation, cancellation and durable mode-save races. Acceptance and
maintenance-preparation regressions failed before their respective fixes.

The full clean-environment run passes **2,317 of 2,319 checks**. The unchanged Google-font assertion
in `visualLanguage.test.ts:15` also fails on archived HEAD. One Codex approval-event ordering
assertion failed in the full run; all **117 `codexProcessRunner` checks pass** on isolated rerun.
The attachment cleanup test now waits for the independent background title task to remove its
temporary directory, instead of assuming foreground completion means title cleanup has finished.
Initial sandbox/deployment-environment failures were resolved by running offline checks with
deployment variables cleared and the required local fixture/server permissions.

All checks use temporary data and fixture providers. Physical devices, real-provider turns and a
managed restart of this installation were not rerun. The running application and the user's
queued messages were not modified or restarted.
