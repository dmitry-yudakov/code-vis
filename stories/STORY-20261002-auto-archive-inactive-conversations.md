# Story 85 — Automatically archive conversations after 48 hours of inactivity

**Status:** Shipped · **Type:** Full-stack · **Depends on:** [Story 39](STORY-20260903-archive-sessions.md)

**Vision context:** step 6, the Arena, in [vision.md](../docs/vision.md#sequence): keep current
work visible while retaining older conversations intact.

---

## Motivation

The user requested automatic archiving for conversations older than 48 hours, with a possible
setting later. Old, idle conversations accumulate in the Arena and session picker. They should
move to the existing recoverable archive without requiring manual housekeeping.

## Implementation (where the code is)

- [src/server/storage/sessionStore.ts:480](../src/server/storage/sessionStore.ts#L480) —
  revision-checked, crash-safe archive; restore at line 502 resets `updatedAt`.
- [src/server/storage/sessionStore.ts:983](../src/server/storage/sessionStore.ts#L983) —
  saved changes advance the session's `updatedAt`; reading it does not.
- [src/server/storage/autoArchiveSessions.ts:10](../src/server/storage/autoArchiveSessions.ts#L10) —
  fixed inactivity policy, process-wide shared sweeps, Docker recovery, and revision-safe moves.
- [src/server/runs/runRegistry.ts:194](../src/server/runs/runRegistry.ts#L194) —
  synchronous archive leases exclude live reservations and stop new turns during the move.
- [src/server/machines/localExecutorSnapshot.ts:13](../src/server/machines/localExecutorSnapshot.ts#L13)
  and [src/app/api/sessions/route.ts:29](../src/app/api/sessions/route.ts#L29) — apply the sweep
  before owner-machine Arena snapshots and conversation lists.
- [src/features/shell/AppShell.tsx:559](../src/features/shell/AppShell.tsx#L559) — online archive
  confirmations close device tabs and remove loaded sessions, protecting newer restored revisions.
- [test/autoArchiveSessions.test.ts:1](../test/autoArchiveSessions.test.ts#L1) and
  [e2e/autoArchive.spec.ts:50](../e2e/autoArchive.spec.ts#L50) — policy, failure/concurrency coverage,
  and a production archive/restore journey with offline and stale snapshots.

## Desired behavior

1. On an authorized owner-machine Arena/snapshot or session-list request, archive sessions whose
   last saved activity (`updatedAt`) is **more than 48 hours** old. This covers Local and Docker,
   project-bound and No project conversations. No background daemon or additional timer is needed:
   existing Arena polling checks while the app is open, and the next load catches up after downtime.
2. Saved conversation/canvas/participant/repository changes reset the age; merely reading,
   selecting, polling, or keeping a tab open does not. Restore starts a fresh 48-hour window.
3. Reserved, queued, executing, and permission-blocked turns are excluded. A short per-session
   archive lease also prevents a turn being admitted during the move; unrelated sessions continue.
   A changed revision wins over a stale sweep candidate. Concurrent sweeps remain safe.
4. Reuse existing full-record archive/restore, file permissions, crash recovery, and summaries.
   Newer-format records remain untouched. If Docker recovery cannot finish, leave Docker sessions
   active and continue housekeeping for Local conversations.
5. Confirmed archive records from an online owning machine close matching device tabs and remove
   loaded conversations on desktop and VR. Offline cached snapshots do not close tabs. Archived
   conversations remain recoverable through Arena → Archived → Restore.
6. Keep 48 hours fixed for this story; no settings UI, schema bump, or permanent deletion.

## Acceptance criteria

- [x] Owner-machine snapshots and conversation lists automatically archive sessions past the
      48-hour inactivity threshold; recent and exactly-48-hour sessions remain active.
- [x] Archive/restore preserves content and format; saved changes and restoration reset the
      inactivity window, while reads do not; newer-format files remain untouched.
- [x] Live turns and archive transitions cannot overlap; concurrent sweeps and newer mutations
      are safe, and archive failures release admission protection.
- [x] Unresolved Docker recovery prevents automatic Docker archiving without hiding Local work.
- [x] Online archive confirmation removes stale loaded conversations and device tabs; offline
      snapshots retain them. Existing Archived Restore remains usable.
- [x] Focused tests, TypeScript, production browser checks, and independent review pass.

## Out of scope

- A configurable threshold, disable switch, purge, reading as activity, changes to provider history,
  or moving/deleting offline peers' records from the home machine.

## How to verify

1. Run focused archive, scheduler, store, and route tests, then `npm run lint` and `npm test`.
2. With a production fixture server, open a conversation, age its saved `updatedAt` past 48 hours,
   and let Arena polling run. Confirm the tab closes and Archived offers Restore.
3. Restore and reopen it; verify content survives and the next poll leaves it active. Reload with
   an old saved conversation and confirm the session picker omits it.
4. Complete an independent review and resolve findings before marking this story shipped.

## Verification evidence — October 2, 2026

- TDD: the initial no-op policy failed six behavioral tests; the implemented policy passes all
  nine focused tests, including a held archive lease, concurrent requests, and a real file move
  during a directory scan. Scheduler, store, and route checks pass (75 tests across four files).
- `npm run lint` and `CODEAI_DIST_DIR=.next-e2e npm run build` pass.
- `npm test`: **105 files / 981 tests pass**. The existing provider-home tests require writable
  `/var/tmp`; the full suite ran outside the filesystem sandbox with approval.
- `npx playwright test e2e/autoArchive.spec.ts --project=chrome`: **1 production browser journey
  passes** against an isolated temporary fixture server. It covers real aged-session storage,
  open-tab/device reconciliation, offline cached snapshots, Restore with content/format intact,
  delayed online archive snapshots, and reload exclusion. An initial test-only restored-card
  selector mismatch was corrected before the passing run. Browser/server startup needed approval
  outside the sandbox.
- Independent review reported no blocking defects in the inactivity rule, owner-machine scope,
  live-turn and revision guards, Docker recovery, newer formats, or stale/offline UI handling.

The production application was not deployed or restarted; the checks use fixture data only.

## Follow-up — November 6, 2026: expensive idle polling

The personal-device server was reported at about 87% CPU. Host process counters showed roughly
350 MiB read and 5.45 CPU seconds over five seconds; open-file sampling found repeated active
and archived conversation reads. The Arena's two-second poll validated every complete transcript,
and its inactivity sweep scanned active transcripts again. Multiple connected pages repeated that
work even with no saved changes. No recursive browser request loop was identified, and this path
predates the latest URL changes.

`SessionStore.listSessionSummaries` now retains compact card metadata and server-local repository
bindings, sharing concurrent reads of the same file version. Each listing still checks the combined
1,000-session file bound and stats files. Device/inode, size, and nanosecond modification/change
timestamps identify changed files, including same-size atomic replacements with preserved mtime.
Changed files use the existing full validator; removed entries are pruned and transient read errors
remain retryable. Callers receive isolated copies. Executor responses omit the private bindings.
Auto-archive and recent-checkout listing reuse this path; canonical full-session reads and
revision-checked mutations keep their existing behavior.

On a private copy of the live store with 133 sessions (19 active, 114 archived, about 51 MiB), the
old sweep-plus-listing workload averaged **818.4 ms wall / 923.6 ms CPU per poll** over four polls.
The first compact-summary pass cost 543.7 ms wall / 599.9 ms CPU; eight unchanged passes averaged
**1.4 ms wall / 2.5 ms CPU**. This measures session collection work, excluding HTTP, provider health,
and checkout discovery. The live server has not been rebuilt or restarted, so its post-fix CPU has
not been measured.

Seven new storage/snapshot regressions cover unchanged and concurrent polls, compact public
delivery and subsequent edits, caller isolation, archive/restore and project removal, external
replacement/deletion, newer formats, corruption, transient failure, a file moving during its read,
and the combined store bound. Restoring the original snapshot/sweep path makes the integration
regression fail on its redundant transcript read. Existing archive regressions retain stale-revision
and live-run protection.

All **1,867 offline tests across 156 files**, TypeScript, the isolated `.next-e2e` production build,
all 14 production-browser checks across `autoArchive`, `arena-projects`, and `conversation-titles`,
and independent review pass. Offline checks need a clean deployment environment and host access
for local IPC and `/var/tmp` fixtures. The first clean four-worker run passed 1,866/1,867; its
queue-ordering failure passed alone, then the complete suite passed with two workers.
