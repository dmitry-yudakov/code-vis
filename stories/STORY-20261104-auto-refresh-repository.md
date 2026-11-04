# Story 126 — Refresh the selected repository on activation and turn completion

**Status:** Shipped · **Type:** Frontend-only · **Depends on:** Stories 107, 124, 125

## Motivation

Changes made by an agent or another editor remain invisible until manual refresh. Keep repository
review current at natural interaction boundaries without a persistent watcher or polling. This
supports the repository review slice of the workbench shell and the change loop in the vision.

## Where the code is

- `src/features/shell/AppShell.tsx:1403` consumes both new and reattached agent streams.
- `src/features/repository/useRepositoryAutoRefresh.ts:6` handles visible desktop activation.
- `src/features/repository/useRepositoryChanges.ts:7` owns selected-checkout status and refresh.
- `src/features/repository/useRepositoryDiff.ts:7` reloads selected-file content on revision changes.
- `src/features/repository/useRepositoryHistory.ts:6` loads visible Git history lazily.
- `src/features/repository/RepositoryPanel.tsx:25` composes Changes, History and file review.

## Desired behavior and contracts

Refresh when Repository becomes visible and when the browser window/tab becomes active with
Repository visible. Debounce browser activation signals for 150 ms; hidden panels/tabs have no automatic
activation reads. Read only the selected machine/checkout, with no timer polling or filesystem
watcher. Preserve initial status loading and explicit Refresh, Push and Restore triggers.

Refresh after a final reply, error or cancellation completes its stream, including reattachment.
The server closes the stream after checkpoint cleanup and checkout release; use that boundary,
not intermediate text/tool events. A background session may refresh a selected checkout it binds,
but another machine or unrelated checkout must not. Abandoned/incomplete streams are not completion.

Serialize status refreshes per selected checkout. Requests during a read coalesce into one pending
follow-up. Checkout/machine changes abort and ignore old responses. Completed status attempts
invalidate the selected diff and visible history even if changed-file metadata is identical.
Retain selection, wrapping, preview and scroll while refreshing; remove selection if the file is
no longer changed. Status failures retain the last snapshot and inspector, show the error and hide
stale push offers. Independent history/diff retries remain available even if status keeps failing.
Failures recover through existing manual Retry/Refresh.
Preserve Story 107 stream delivery/replay, Story 124 review state and Story 125 lazy history.

## Acceptance criteria

- [x] Opening Repository and returning to the app refresh the selected checkout; duplicate
      activation signals coalesce and hidden views do no activation work.
- [x] Completed new/reconnected turns refresh after cleanup, with machine/checkout scope checked;
      intermediate activity and unrelated turns do not refresh the selected checkout.
- [x] Reads serialize with at most one pending follow-up; switching checkout ignores stale results.
- [x] Open diff and visible history update even with identical changed-file metadata, preserving
      review state and supporting failure/retry and files becoming clean.
- [x] Focused browser regressions, relevant unit checks, TypeScript, isolated build and independent
      review pass.

## How to verify

Run focused repository-panel and chronological-drafts browser cases plus relevant review/push and
machine regressions, focused offline tests, `npm run lint`, and an isolated production build.
Record actual results, pre-fix failures and unverified environments here. Do not restart or deploy
the running application.

Verified November 4, 2026:

- All 40 focused unit checks pass across `workbenchFrame`, `runPresentation`, `gitRepository`,
  `gitHistory` and `ndjson`. `npm run lint`, `git diff --check` and
  `CODEAI_DIST_DIR=.next-e2e npm run build` pass.
- All 61 distinct production-browser cases pass across `repository-panel`, `chronological-drafts`,
  `machines`, `git-push` and `file-review`. The final broad run passed 60 cases; its new unrelated
  checkout fixture reused a repository binding id, so setup was rejected. Giving the new binding
  its own id fixes setup, and both background-completion cases pass on rerun. No application code
  changed after the final build or for that fixture correction.
- Coverage includes new/reconnected success and failure, delayed stream closure, no refresh on
  intermediate activity/disconnection, same/unrelated background checkouts, attached-machine
  URLs, opening/focus/visibility, hidden tabs, duplicate signals, serialized/pending reads,
  late checkout responses, unchanged file metadata, files becoming clean, retained diff/history
  content and scroll, wrapping, failed-status recovery and independent history retry.
- Successful and failed completion cases failed before implementation because status stayed stale.
  Review identified lost inspector state and blocked independent retries on status failure; the
  added regression failed on that implementation and passes after both fixes. Final independent
  review reports no remaining blocking findings.
- Desktop dark and phone light file-review screenshots were inspected. Browser cases also cover
  both themes at desktop/phone widths. Provider output and attached transport are fixtures; real
  providers, production attached transport, Docker and physical phone/Quest checks were not rerun.
  The running app was not restarted or deployed. Nothing was staged or committed.

## Out of scope

Continuous watching/polling, refreshing every project, repository discovery and server API changes.
