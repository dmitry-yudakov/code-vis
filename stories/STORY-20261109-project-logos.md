# Story 136 — Choose a repository image as a project logo

**Status:** Shipped

## Outcome

Click the logo beside a project name in Arena, the project picker, or the open project/session
header. An image placeholder occupies the same clickable position before a logo is chosen.
Browse repository folders and select an image to preview it before saving. A relative image
path, such as `public/logo.svg`, can also be entered directly. Change or remove the logo through
the same dialog.

The dialog names the source repository, supports several project repositories, retains input
on errors, and refreshes conflicting settings for explicit retry. Offline machines disable saving.
Projects without repositories explain how to enable the choice. Uploaded images are a follow-up.

## Contracts

- PNG, JPEG, GIF, WebP, SVG and ICO files, up to **2 MiB**. File headers are checked; decoding
  remains the browser's job. Missing or undecodable images leave the project name usable.
- The registry resolves the project's current binding on its own machine. Repository path proof,
  symlink/metadata rejection and checkout ownership reuse the file viewer. No repository file is
  changed. Reads require Linux, as the existing file viewer does.
- Authenticated, uncached image responses use `nosniff` and a restrictive sandboxed CSP, retained
  through the attached-machine gateway. Logos are external image elements, never inline SVG.
- An atomic sidecar holds the logo choice and exact repository binding, leaving the existing
  strict version-1 project file unchanged for managed rollback. Logo changes compare both base
  revision and previous choice, independently of name/repository updates. Damaged/stale decoration
  does not hide the project. Removal/rebinding clears its choice; project deletion removes it.
- Workspace notifications and the canonical-file watcher include logo metadata. Image content
  is read on image requests; a page reload picks up file content changes at the same path.
- The picker reads one repository directory at a time through the existing file browser, showing
  folders and supported image names. Candidate previews use the same bounded, authenticated,
  isolated image route and validate the project's repository binding without saving. Folder and
  preview failures offer Retry; abandoned directory reads cannot replace the current folder.

## Verification

Verified November 9, 2026:

- **104 focused unit checks** pass across project logos/routes/storage, repository files/routes,
  machine gateway/routes, protocol, workspace notifications and Arena grouping. Coverage includes
  failed atomic writes, unchanged rollback-compatible base records, damaged/stale metadata,
  optimistic conflicts, image bounds/formats, path containment and external sidecar edits.
- **26 production-browser cases** pass in `project-logo`, `arena-projects` and `arena-tile-headers`.
  These cover both themes on desktop/phone, List/Tiles, retained choices after reload, session
  headers, removal, missing-image/re-add recovery, repository conflicts, multiple repositories,
  attached-machine routing, offline controls and existing project/session creation.
- Source TypeScript, isolated webpack compile/generate, `git diff --check`, both-theme
  desktop/phone screenshot inspection and independent read-only review pass. The final phone
  layout keeps project actions together. Review findings were fixed and covered by regressions.
- The ordinary lint command encounters the previously recorded generated `.next-e2e/types/app`
  checks for optional route request arguments. Source TypeScript passes with generated build
  checks excluded. The isolated build used `.next-e2e/project-logo`; Google Fonts required network
  access. Existing build settings and routes outside this feature were not changed.
- The running installation has not been rebuilt or restarted. Physical phone/Quest and real
  attached-executor TLS use remain unverified; remote routing used browser/gateway fixtures.

November 9 picker follow-up:

- The logo/placeholder itself now edits the choice in Arena, picker entries and the open header;
  the separate trailing image button is removed. Header controls remain separate buttons and
  restore focus after the dialog closes.
- **106 focused unit checks** and **28 distinct production-browser cases** pass. New coverage
  checks unsaved previews and invalid preview queries, folder navigation and cancellation,
  changing an existing image in place, failed preview/folder retry, abandoned directory reads,
  and attached-machine directory/preview routing. Both new preview route tests failed before
  implementation. Existing project creation and Arena header regressions pass.
- Source TypeScript, the isolated `.next-e2e/project-logo-picker` webpack compile/generate build,
  both-theme desktop/phone screenshot inspection, `git diff --check` and independent read-only
  review pass. The running installation has not been rebuilt or restarted.
