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
  pane state reset together when the machine/project changes, including A → B → A navigation.
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
