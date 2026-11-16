# Story 141 — Open a project without a conversation

**Status:** Shipped

## Outcome

Arena's project title opens its project URL, whether it has sessions or not. Files and
Repository remain available for browsing bound repositories, Git changes/history, source files,
Markdown and diffs. New session remains available in the header and on the desktop welcome surface.
Multiple repositories have a selector. Browsing creates no session. Clicking the logo or placeholder
opens its editor, with no duplicate action on the right. The project header aligns its title,
session count and repository names centrally.
Opening a file gives its contents the remaining workspace width; closing it restores the welcome
surface. The project header's actions stay grouped at the right edge in List and Tiles.

## Contracts

- Reuse existing project URLs, machine routing, repository APIs, viewers and session creation.
  No server API, persistence format or dependency changes.
- A project URL stays session-free after reload even when conversations exist; All sessions can
  explicitly reopen them. Session drafts and layouts stay independent of project browsing.
- Repository selection is limited to the project's bindings on its machine. File tabs and transient
  pane state stay isolated per workspace; returning through Arena restores that workspace's files.
- Offline Arena projects disable opening and session creation. Repository-free projects remain
  openable and can create their first conversation. File/status failures retain Retry and navigation.
- No rebuild or restart of the running application or deployment. Commit only when requested.

## Verification

Verified November 15, 2026:

- **106 focused unit checks** pass across workspace URLs, Arena grouping, panel layouts, file tabs,
  local file links and session launch. The new empty-project browser regression fails against the
  preceding build because the project link is absent.
- **67 distinct production-browser cases** pass across project workspaces, Arena projects/headers,
  project logos, conversation URLs and desktop layouts. The final **29-case** rerun covers the last
  header-spacing/file-width changes. New coverage checks both themes on desktop/phone, project
  title navigation, session-free reloads with and without existing sessions, multiple repositories,
  file/diff reading, first-session creation, retry recovery, attached-machine routing, offline
  controls and client navigation A → B → A after maximizing a file.
- Source TypeScript, the isolated production build in `.next-e2e/project-workspace`,
  `git diff --check`, light/dark desktop/phone screenshot inspection and independent read-only
  review pass. Review findings about stale project pane state were fixed and covered by regression.
- Two existing `project-logo` phone assertions still fail because the session bottom toolbar
  extends to **396px** in a **390px** viewport. A disposable browser probe independently reproduces
  the same overflow on the preceding production build; project-only views fit at 360px and 390px.
  The diagnostic probe was removed after comparison.
- The normal build generated its isolated type-directory entries in `tsconfig.json`. No dependency
  or server configuration changed. The running installation was not rebuilt or restarted.
  Real attached-executor transport and physical devices were not exercised; routing used fixtures.

November 16 logo-control follow-up:

- The project title opens its workspace; the logo/placeholder itself opens the logo editor. The
  duplicate right-side logo action is removed. Editor cancellation retains the Arena and restores
  focus to the logo. New session remains at the right edge.
- The new duplicate-control regression fails on the preceding build with two right-side buttons
  instead of one. All **23 focused production-browser cases** pass after the change; the same two
  previously recorded phone-toolbar overflow assertions remain. Source TypeScript, isolated build,
  **106 focused unit checks**, both-theme desktop/phone header screenshot inspection,
  `git diff --check` and independent read-only review pass.
- The user requested committing the complete Story 141 change. The running app was not restarted.

## November 16 file restoration follow-up

**Status:** Shipped

Returning from Arena after visiting another project must restore the original workspace's open
document and full-screen file view. The file provider currently discards tabs on scope changes,
while conversation layouts can retain a maximized file pane. Project-only layouts also discard
their previous arrangement. Retain tab metadata and project layouts in the mounted shell, scoped
by workspace, executing machine and repository bindings. Re-read file contents when returning;
leave file contents, reading positions across workspace changes and reload persistence out of scope.

Where the code is:

- `src/features/repository/RepositoryFilesProvider.tsx:35` owns scoped tabs and cancellable reads.
- `src/features/shell/usePanelLayout.ts:60` owns project and conversation pane arrangements.
- `e2e/project-workspace.spec.ts:132` covers project navigation through Arena.
- `e2e/local-file-links.spec.ts:182` covers conversation scope changes and stale reads.

Acceptance criteria:

- [x] Project A → Arena → project B → Arena → A restores A's tabs, active document and maximize
      state on desktop and phones; B retains its own independent file view.
- [x] Conversation documents and drafts survive the same journey; project-only browsing stays
      separate from conversations, including when repositories overlap.
- [x] Leaving still cancels pending reads. Returning re-reads the file; unavailable files retain
      their tab and Retry, and stale content cannot appear in another workspace.
- [x] Focused unit/browser checks, TypeScript, isolated build, both-theme desktop/phone screenshot
      inspection and independent read-only review pass. Do not restart the running application.

How to verify: run focused file-tab, panel-layout, local-link and workspace URL unit tests; build
into `.next-e2e/project-workspace`; run the project-workspace and local-file-links browser suites.

Verified November 16, 2026:

- All **85 focused unit checks**, **30 production-browser cases**, source TypeScript and the
  isolated production build pass. The updated conversation-return regression fails on the preceding
  `.next-e2e` build because the file tabs disappear, then passes with retained workspace metadata.
- Browser coverage includes independent project tabs and active selection, conversation full-screen
  return and drafts, project/conversation isolation with overlapping repositories, fresh reads,
  late-read cancellation and removed-document Retry. Both-theme desktop/phone restored-document
  screenshots were inspected. The existing responsive-return assertion now waits for ResizeObserver
  through Playwright's retrying attribute check.
- Independent read-only review and `git diff --check` pass. File contents and inactive readers are
  not cached; only tab metadata and project layouts remain in shell memory. Reload persistence,
  physical devices and real attached-executor transport were not exercised. No dependency or server
  contract changes. The user requested committing this follow-up; the running application was not
  rebuilt or restarted.
