# Story 149 — Suspend work for build and restart

**Status:** Shipped · **Type:** Full-stack · **Depends on:** Story 64, Story 90

## Outcome

Build & restart accepts working sessions. It stops admitting turns and launching queued work,
waits for observed provider response/tool boundaries, and saves unfinished tasks before building.
A failed build keeps tasks suspended while the current release serves the UI. Repairing the
checkout and starting CodeAI again with the same data directory/provider homes continues those
tasks without requiring the original supervisor or a browser.

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
- Format 17 adds the public `suspended` turn lifecycle. Ordinary crash recovery continues to fail
  queued/running work conservatively. Startup leaves planned suspensions intact. Attempts retain
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
