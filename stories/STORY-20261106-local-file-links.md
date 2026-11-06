# Story 131 — Open repository files from chat

**Status:** Shipped · **Type:** Full-stack · **Depends on:** Stories 124, 125, 128

## Motivation

Agent replies often refer to local source files and documents, but the conversation deliberately
disabled those links. Repository review only exposed changed files. Open referenced files without
leaving the conversation and provide a simple way to browse the rest of the attached checkout.

## Behavior and contracts

- Local Markdown links in saved replies, streamed replies and saved turn commentary open a
  read-only, full-screen file viewer. Relative paths resolve from the conversation's primary
  repository, independently of the repository selected in the side panel. Absolute paths and
  `file:` URLs can name files in any repository attached to the conversation. Docker's
  `/workspace/` paths resolve against its bound checkout.
- `path:line`, `path:line-endLine`, `path:line:column`, `path#Lline` and `path#Lline-LendLine`
  references open source and highlight the requested lines. An out-of-range line is explained.
  Markdown opens in Preview unless a line was requested; Source, Wrap, Refresh, Close and Escape
  remain available. Document-relative links use the viewed document's directory and checkout;
  heading fragments scroll to matching headings.
- Files has its own activity-bar view beside Repository, which retains its Changes/History
  tabs. It shows a nested tree with expandable/collapsible folders, loading only the root and
  expanded folders. Directories come first, including dot files and ignored files. Disclosure
  buttons support keyboard activation and expose their expanded state; siblings stay visible.
  Expansion survives refresh and side-view changes. Both views share the repository selector;
  checkout/machine changes reset the tree and cancel obsolete reads. Refresh files reloads the
  tree independently of Git. Opening a file uses the same viewer; browsing retains the selected
  Git diff, and Files does not reserve an inspector column.
- File reads and directory listings require device authorization and an opaque checkout id
  resolved on the executing machine. Attached-machine GET routing allows both operations.
  Paths remain inside that exact canonical checkout; `.git` metadata and symbolic links are
  excluded. Linux open-handle proof prevents a path swap from granting access outside it.
  Reads take the existing checkout-read lease and release it after success or failure.
- Files are whole UTF-8 text of at most 512 KiB, never truncated. Empty files work; binary,
  oversized, missing, busy and unreadable files show a concise error and Retry. Directories
  with more than 2,000 entries fail explicitly; chat links can still open their files directly.
- Markdown does not execute raw HTML or request images. External links retain their separate
  browser destination. Local links are accessible MUI link buttons, so browser link menus
  cannot navigate to an application route or a machine-local `file:` URL.
- Following document links retains one dialog and its original focus return target. Replacing
  its content keeps keyboard focus inside it. Close preserves the draft, conversation URL and
  underlying layout. Session/machine/binding changes close the viewer and cancel its reads;
  returning to an earlier conversation does not reopen its old dialog.

## Where the code is

- `src/features/repository/localFileLinks.ts` parses references without allowing arbitrary URL schemes.
- `src/features/repository/RepositoryFilesProvider.tsx` owns bound-repository file actions, the
  viewer, safe Markdown navigation and focus lifecycle.
- `src/features/repository/RepositoryFilesView.tsx` owns lazy tree expansion and directory recovery.
- `src/features/repository/RepositoryPanel.tsx` and `RepositorySidebar.tsx` share repository
  selection while composing independent Files and Git views.
- `src/features/shell/ActivityBar.tsx` and `panelLayout.ts` expose and persist the Files view.
- `src/features/conversation/ChatMessage.tsx` and `TurnActivity.tsx` share local link handling.
- `src/features/shell/AppShell.tsx` supplies primary-first bindings, machine API and Docker context.
- `src/server/repository/repositoryFiles.ts` owns bounded filesystem reads and path proofs.
- `src/app/api/repository/file/route.ts` and `files/route.ts` authorize reads and resolve checkout ids.

## Verification

Verified November 6, 2026:

- All 125 focused unit checks pass across `localFileLinks`, `repositoryFiles`,
  `repositoryFilesRoute`, `gitRepository`, `gitHistoryRoute`, `gitRead`, `workbenchFrame`,
  `deviceAuthRoutes`, `machineGateway` and `chronologicalUi`. Real temporary folders exercise
  unchanged files, dot files, containment, symbolic links, replacement roots, missing/binary/
  oversized files, directory overflow, recovery ownership and lease release after failures.
  Paired-device checks use the real authorization boundary for both new routes. The new
  parser/read suites were first run without implementations and failed.
- TypeScript (`npm run lint`), `git diff --check` and the isolated production build
  (`CODEAI_DIST_DIR=.next-e2e npm run build`) pass.
- All 58 distinct production-browser checks pass across `local-file-links`, `file-review`,
  `repository-panel`, `message-navigation` and `chronological-chat`. The nine new cases cover
  relative/absolute/file-URL references, line ranges, safe Markdown and document-relative links,
  focus/Escape after following a document link, wrapping, retained drafts/URLs, lazy browsing,
  missing/outside files, retry, stale cancellation, multiple bindings, scope-switch/return,
  Docker path translation and directory recovery. File reads use the real routes and fixture
  checkout; the long source, read failures and late delivery use intercepted responses.
- All twelve source, Markdown and Files screenshots were inspected across light/dark themes
  at 1440px and 390px. Independent review found the retained-selection issue and prompted the
  nested-link focus check; that browser regression failed before the focus correction. Final
  review has no material findings.

November 6 follow-up, before the first commit:

- All 153 focused unit checks pass, adding `panelLayout` and independent Files navigation/chrome
  regressions to the original set. The new Files selection, persisted layout and sidebar tests
  failed before the change and pass afterward. TypeScript and the isolated production build pass.
- The revised local-file browser cases cover nested expansion/collapse, retained siblings,
  keyboard activation, lazy directory reads, independent refresh, retained expansion across
  view changes, saved Files selection, collapsed-folder late responses, nested Retry, checkout
  switching and returning to the selected Git diff. Existing phone/history scroll checks now
  scope their locators to the active Git tab because both views retain their mounted lists.
- All 63 distinct production-browser cases pass across `local-file-links`, `file-review`,
  `repository-panel`, `desktop-workspace` and `mobile-panes`, including the twelve revised
  local-file cases. The three existing scroll checks passed after their selector correction.
  Files-tree screenshots were reviewed in light/dark desktop/phone layouts. Independent review
  reports no material findings. No dependencies or server filesystem contracts changed in
  this follow-up.

The running application has not been rebuilt or restarted.

## Limits

This is a text-file viewer on desktop and phone layouts. File editing, image/PDF previews,
directory-link navigation from chat, arbitrary host-file access, OS/editor integration and VR
file presentation are outside this change. Linux is currently required. Real attached-executor
TLS transport, signed-in Docker/provider turns and physical phones/headsets are not exercised
by the focused checks.
