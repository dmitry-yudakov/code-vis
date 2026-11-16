# Story 143 — Workspace keyboard shortcuts

**Status:** Shipped · **Type:** Full stack · **Depends on:** Stories 120, 131, 140, 141

## Outcome

Shift+Esc maximizes/restores the last clicked or keyboard-focused workspace pane: Conversation,
File view, Canvas or the repository side panel. Only visible, mounted panes are eligible; the
current maximized pane always restores. Existing pane navigation, plain Escape, drafts, reading
positions, tabs and layout ownership are preserved. Dialogs, menus, composition and held-key
repeats retain their own handling.

Ctrl/Cmd+P opens a fresh fuzzy file picker for the current workspace's bound repositories, including
projects without sessions and attached executors. File names and paths match case-insensitive
subsequences; exact names, prefixes and contiguous matches rank first. Up/Down selects, Enter opens
the existing file tab/viewer, Escape cancels and restores focus. Cancelling does not leave maximize.
Failures are shown per repository with retry; available repositories remain searchable. Retry
retains the query. Navigation cancels reads and closes the picker; late responses are ignored.

## Implementation and contracts

- `src/features/shell/WorkspaceShortcuts.tsx` scopes shortcuts and active-pane tracking to the flat
  workspace. `AppShell` mounts it only for a loaded session/project, keyed by workspace and machine.
- `src/features/repository/QuickFilePicker.tsx` uses MUI dialog/autocomplete and the existing file
  provider. `fuzzyFiles.ts` ranks all collected paths and renders at most 50 results.
- `GET /api/repository/file-search?checkoutId=…` authorizes the device and resolves the checkout
  through the existing registry. The attached-machine gateway permits only GET.
- `listRepositoryFiles` uses the shared bounded Git reader/helper, with tracked/untracked files,
  standard and personal ignore rules. Plain folders reuse verified directory reads, omit symlinks
  and common generated folders, and never enter `.git`.
- Each repository permits 50,000 file paths and 5 MiB of UTF-8 path names. Git reads have a ten-second
  process timeout; plain-folder traversal checks a ten-second deadline between directory reads,
  with at most 2,000 directories and the existing 2,000-entry directory limit. Exceeding a limit
  fails explicitly and leaves Files browsing available, instead of silently searching a prefix.
- Collection reads require Linux path verification and retain existing checkout recovery ownership.
  Opening a result independently enforces the existing viewer's bounded, verified file read.

## Verification

Focused unit regressions cover fuzzy ranking and full-collection searching, real Git/untracked/
personal-ignore reads, plain folders, symlinks, count/byte limits, busy/root-replacement recovery,
authorization and the read-only gateway. Fuzzy tests first failed before implementation.

Production-browser coverage includes both shortcuts with desktop/phone light/dark screenshots,
pointer versus retained DOM focus, side-pane/project fallback, tab deduplication, arrow selection,
cancel/focus/maximize, retained drafts, partial failure/retry/query retention, late reads, dialogs,
menus, composition and attached project search. Existing file/link/pane/project suites are rerun.

Verified November 16, 2026:

- All 112 focused unit checks pass across fuzzy files, repository search/files/routes, panel layout,
  file tabs, local links and workbench frame.
- All 48 distinct production-browser cases pass across `workspace-shortcuts`, `local-file-links`,
  `mobile-panes` and `project-workspace`. The final build passes all 18 shortcut/maximize cases;
  the wider run passed the other 30 cases. One new arrow-selection fixture assertion was corrected
  to exclude image results before the final run.
- TypeScript, isolated production build (`CODEAI_DIST_DIR=.next-e2e npm run build`),
  `git diff --check`, light/dark desktop/phone screenshot inspection and independent review pass.
  Review's plain-folder byte-limit finding is fixed and regression-tested. Browser checks found
  and fixed lost retry queries, clipped field labels and menu/composing Escape interactions.

Real attached-executor transport, physical phone keyboards and native macOS browser accelerators
were not exercised; browser tests cover the gateway URL and both Control and Meta modifiers.

No dependencies, persistent formats, staging, commits, deployment or running-application restart.
