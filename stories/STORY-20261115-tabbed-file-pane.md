# Story 140 — Keep repository files and diffs in tabs

**Status:** Shipped · **Type:** Frontend-only · **Depends on:** Stories 120, 124, 131

## Motivation

Open several repository files from Files or conversation links and keep them alongside the
conversation, like a traditional editor. Changed files should use the same tabbed surface.
This extends the repository review and workbench slices of the vision.

## Where the code is

- `src/features/repository/RepositoryFilesProvider.tsx:35` owns scoped local-file navigation.
- `src/features/repository/RepositoryFilePane.tsx:23` owns tab chrome and mounted file/diff views.
- `src/features/repository/repositoryFileTabs.ts:9` owns tab identity, alias merging and neighbour selection.
- `src/features/repository/RepositoryPanel.tsx:25` composes Files and Changes navigation.
- `src/features/repository/RepositoryDiffInspector.tsx:34` renders patches and Markdown review.
- `src/features/shell/panelLayout.ts:32` and `usePanelLayout.ts:60` own device pane layout.
- `src/features/shell/AppShell.tsx:2719` composes the desktop/phone workspace.

## Desired behavior and contracts

The widest layout is navigation, repository browser, file view, canvas, conversation. Each
content pane can be hidden; desktop navigation stays available during maximize. Phones retain
their bottom navigation, including during maximize. Narrower windows prioritize the requested
surface without rewriting the saved desktop arrangement.

Files and diffs have distinct closable tabs, identified by checkout/path/kind. Reopening a file
selects its tab and honors a new line or heading reference. Tabs retain view choices and scroll
while switching; close selects a neighbour. Keyboard tab navigation and Delete work. Closing or
hiding the pane leaves the conversation draft and URL intact. Maximize/Restore and Escape retain
the tab and underlying arrangement.

The provider owns tab metadata separately for each project/conversation, machine and repository
binding set. Workspace changes cancel reads; returning restores its tabs and re-reads contents, as
specified in Story 141's November 16 follow-up. Contents are fetched through the existing authorized routes;
no new filesystem access or durable session format. Retry, safe Markdown, source/preview, wrapping,
Docker path mapping and primary-repository resolution preserve Story 131's contracts. Refreshing
repository state refreshes open diffs, including a clear unavailable state for vanished changes.

## Acceptance criteria

- [x] Files tree, chat links and Changes open independent tabs in one file pane, with deduplication,
      line targeting, keyboard selection/close, neighbour selection and retained view/scroll state.
- [x] Browser, file pane, canvas and conversation fit together when space permits, with independent
      toggles, resizing, responsive navigation and maximize/restore that preserve drafts and tabs.
- [x] Positive delivery, stale-read cancellation, retry, scope isolation and safe Markdown remain
      covered through the actual browser and authorized route paths.
- [x] Focused unit/browser checks, TypeScript, isolated production build, both-theme desktop/phone
      screenshot inspection and independent review pass.

## Out of scope

Source editing/saving, binary previews, arbitrary host-file access, persisted file contents/tabs,
VR file tabs and deployment.

## How to verify

Run focused panel-layout/local-file/repository checks, `npm run lint`, an isolated production build,
and Playwright file-pane/local-file/repository review checks. Inspect light/dark desktop and phone
screenshots. Do not rebuild or restart the running application.

Verified November 15, 2026:

- All 120 focused unit checks pass across `panelLayout`, `repositoryFileTabs`, `localFileLinks`,
  `repositoryFiles`, `repositoryFilesRoute`, `workbenchFrame`, `gitRepository` and `chronologicalUi`.
  Tab-state checks first failed with no implementation. Layout checks cover pane minimums over
  responsive widths, stored-layout compatibility, explicit phone Canvas navigation and maximize.
- `npm run lint`, `git diff --check` and `CODEAI_DIST_DIR=.next-e2e npm run build` pass.
- All 67 distinct production-browser cases pass across `local-file-links`, `file-review`,
  `repository-panel`, `mobile-panes` and `desktop-workspace`: 65 cases in the wider run, then the
  corrected notification assertion and new alias-position case pass alongside the repeated
  four-pane responsive case on the final build. The notification fixture deliberately returns
  an ambiguous delivery error; its expected message follows the existing recovery contract.
- Browser checks cover real authorized source reads and lazy tree traversal, separate source/diff
  tabs, canonical alias merging, independent scroll/view state, keyboard close/neighbour focus,
  wrap, safe Markdown, retry, stale reads after close/scope changes, hidden-pane line targeting,
  Docker path translation, repository refresh, vanished-change recovery, pointer/keyboard resizing,
  all four content panes, responsive return, navigation during maximize and numeric toast placement.
  Diff content and long/error/late source responses use browser fixtures.
- Six source, Markdown, diff and full-workspace screenshots were inspected across light/dark
  themes and desktop/phone sizes. Independent review found phone Canvas selection, hidden-read
  targeting, alias reading-position retention and the toast/grid-variable collision; all were
  fixed with focused regressions. Final review reports no material findings.

File contents/tabs remain transient and read only. Physical phone/headset use, real attached-machine
transport and real provider turns were not rerun. No server filesystem contracts or dependencies
changed. Nothing was staged, committed, deployed, or rebuilt/restarted in the running application.
