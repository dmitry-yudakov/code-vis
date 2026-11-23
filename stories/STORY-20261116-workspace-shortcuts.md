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

## November 21 follow-up — Jump to Arena

- [x] From a flat session, Ctrl+J or Cmd+J opens the same Arena page as the navigation link.
  Browser Back returns to the conversation with its draft intact.
- [x] The Arena link advertises the shortcut in the session. Dialogs, menus, IME composition,
  modified combinations and workspaces without an open session keep their keyboard handling.

The shortcut activates the existing header link in `src/features/shell/WorkspaceShortcuts.tsx:37`.
The regression failed on the previous build. All 13 workspace shortcut browser tests and 34
focused unit tests pass, as do the isolated production build, TypeScript check and independent
review. In desktop Chrome on Linux, an OS-level Ctrl+J opened Arena from a draft and opened
Downloads when pressed again on Arena. Playwright exercised Meta+J on Linux. Native macOS
keyboard handling was not exercised.

## November 22 follow-up — Open Projects

- [x] Ctrl/Cmd+K opens the project picker in the flat workspace and on all Arena views. The
  workspace picker keeps its existing project-switch behavior. Arena's **Projects** control lists
  projects on online machines and opens the selected project workspace on its owning machine.
- [x] The shortcut focuses the selected or first available option. Arrow keys move between
  projects, Enter selects one, and Escape returns focus to the picker trigger.
- [x] Open dialogs and other pickers, IME composition, and modified key combinations retain their
  keyboard handling. Browser Back preserves the original conversation draft.

The shared shortcut lives in `src/features/shell/DesktopPopover.tsx:58`. Arena's picker in
`src/features/projects/ProjectPicker.tsx:83` passes the project and machine to the existing
workspace navigation.

Verification covers 87 focused unit checks, 61 browser cases across workspace shortcuts, Arena
headers, project workspaces and project management, TypeScript, an isolated production build,
light and dark Arena screenshots at desktop and phone widths, and independent review. Desktop
Chrome on Linux received a native Ctrl+K in both entry points. Browser automation exercised Meta+K
and an attached-executor fixture. Two existing 390px session overflow assertions in the logo suite
also fail on the pre-change build.

## November 23 follow-up — Search projects and open session setup

- [x] Ctrl/Cmd+K focuses **Search projects** in the workspace and Arena pickers. A
  case-insensitive subsequence finds project names, and arrow keys and Enter open a result.
- [x] Escape restores focus to the picker trigger. Reopening starts with an empty query.
  Project creation, logo, rename and delete controls stay available in the workspace picker.
- [x] Ctrl/Cmd+Shift+Enter opens **New session** for the active project. The form uses the
  current project and its owning machine, and the conversation draft survives opening or cancelling it.
- [x] Other open overlays, IME composition and held shortcut keys retain their keyboard handling.

### Where the code is

- [ProjectPicker.tsx](../src/features/projects/ProjectPicker.tsx#L27) renders and filters both project pickers.
- [DesktopPopover.tsx](../src/features/shell/DesktopPopover.tsx#L61) owns shortcut dispatch and focus.
- [SessionPicker.tsx](../src/features/conversation/SessionPicker.tsx#L151) binds the new shortcut to the existing setup form.

### How to verify

Run the workspace shortcut and Arena header Playwright suites against the isolated production
build. Check fuzzy matching, focus, draft retention, attached-machine navigation and successful
session creation in the chosen project.

The search focus regression failed on the previous build. All 63 focused unit checks and 76
distinct production-browser cases passed across workspace shortcuts, Arena headers, project
management, project workspaces and new chat. TypeScript, the isolated build, light and dark Arena
picker screenshots at desktop and phone widths, and independent review passed. The wider visual
language suite still has its existing Google Fonts assertion failure. Chrome exercised Control
and Meta events. Native macOS keystrokes remain unverified.
