# Story 124 — Make changed files easier to review

**Status:** Shipped · **Type:** Full-stack · **Depends on:** Stories 118, 120

[Story 140](STORY-20261115-tabbed-file-pane.md) moves review into independent file tabs and replaces
the nested inspector/divider and modal with the shared file pane's resize and maximize controls.

## Motivation

Long Markdown lines disappear beyond the narrow Changes inspector. Review needs wrapping,
adjustable space, a full-screen file view and rendered Markdown. This serves the repository
review slice of the vision and the workbench shell.

## Where the code is

- `src/features/repository/RepositoryDiffInspector.tsx:35` owns Wrap, Diff/Preview, fullscreen,
  keyboard isolation and focus/scroll restoration.
- `src/features/repository/RepositorySidebar.tsx:29` owns the pointer/keyboard review divider.
- `src/features/repository/RepositoryPanel.tsx:49` keys review state to the checkout and file.
- `src/server/repository/gitRepository.ts:114` reads bounded complete Markdown previews;
  `gitRepository.ts:140` retains staged and unstaged patches through hardened Git.
- `src/app/api/repository/diff/route.ts:11` authorizes exact current change-set membership.
- `src/app/globals.css:555` owns the sidebar split and independently scrolling review content.

## Desired behavior and contracts

Use MUI controls for Wrap, Diff/Preview and full screen. Wrap starts enabled and can be disabled
for horizontally scrolling code. A pointer/keyboard divider resizes the file list versus the
review when both are visible; narrow layouts retain Story 120's single view and Back button.
Full screen shows the reviewed file alone in a modal, with Restore and Escape, retaining the
underlying pane layout, selected file, draft and view choices.

Markdown preview renders the complete current working-tree `.md`/`.markdown` file using the
existing GFM renderer. Label the source so staged and working-tree versions cannot be confused.
Do not reconstruct documents from partial diff hunks. Preview reads are whole or unavailable,
bounded to 512 KiB of UTF-8 per file, regular files inside the checkout only, without following
symbolic links. Unavailable previews explain why and retain the diff and refresh recovery.
Preview currently requires Linux's open-handle path proof; other systems keep Diff with an
explicit unavailable message. Never treat a newly resolved checkout location as authorization.
Raw HTML is not executed, repository-relative links must not navigate the app and images must
not initiate external requests. The diff route's authorization and Git hardening remain intact.

## Acceptance criteria

- [x] Long diff lines wrap by default; toggling Wrap preserves line markers/colors and scrolling.
- [x] Pointer and keyboard resizing adjust the internal split; narrow views have no divider.
- [x] Full screen and Restore/Escape work on desktop/phone, preserving selection and shell layout.
- [x] Markdown preview includes unchanged sections, headings, lists, tables and fenced code.
- [x] Missing/deleted, binary, oversized and symbolic-link previews fail clearly without losing
      patches; safe Markdown rendering prevents executable HTML, app navigation and image loads.
- [x] Focused unit/browser regressions, TypeScript, isolated production build, both-theme desktop/
      phone screenshot inspection and independent review pass.

## How to verify

Run `npx vitest run test/gitRepository.test.ts test/workbenchFrame.test.ts test/panelLayout.test.ts test/gitRead.test.ts test/repositoryContext.test.ts`,
`npm run lint`, an isolated production build and the file-review, mobile-panes and affected desktop
workspace Playwright cases. Inspect both themes at desktop and phone viewport sizes. Physical
phone and Quest use are outside automated desktop-browser coverage. Do not restart the running app.

Verified November 4, 2026:

- All 69 focused unit checks pass. The initial Markdown checks failed before implementation;
  the platform-proof regression also failed before its guard was added. Real temporary Git
  repositories cover complete working-tree content, staged/unstaged distinctions, untracked and
  deleted files, bounded/binary reads, links, replaced roots and recovery ownership/release.
- `npm run lint` and `CODEAI_DIST_DIR=.next-e2e npm run build` pass.
- All 30 production-browser checks across `file-review`, `mobile-panes` and `desktop-workspace`
  pass, including both themes at 390 and 1440px, pointer/keyboard resizing, full-screen focus and
  scroll restoration, Markdown rendering and safe links/images, preview failure/retry, direct
  file switching, hidden-canvas keyboard isolation, and Escape above maximized Changes.
- Light/dark desktop/phone screenshots were inspected. The existing long-phone-patch regression
  now accounts for the review toolbar and still requires more than 500px of scrollable content,
  with Back and Restore in reach.
- Independent review found and verified fixes for unsupported-platform proof, a replaced checkout
  root, modal naming/focus, portal scroll restoration, maximized split geometry, per-file scroll
  state and underlying canvas shortcuts. Its final review reports no material findings; its
  repeated Linux root-swap probe confirms outside content is refused.
- Browser review tests use intercepted diff responses; preview file reads use real Git/unit tests.
  Physical phones, Docker helpers, attached executors and Quest were not rerun. The running app
  was not restarted or deployed; no changes were staged or committed.

## Out of scope

Editing/staging files, rendered before/after Markdown comparisons, a repository file browser,
browser/OS fullscreen APIs and changes to VR.

## November 20 follow-up — Mermaid in Markdown previews

**Status:** Shipped

The repository review slice of the workbench should render fenced `mermaid` blocks in both
Files and Changes previews, alongside ordinary GFM content.

Where the code is:

- `src/features/repository/RepositoryFilesProvider.tsx:220` renders the current file preview.
- `src/features/repository/RepositoryDiffInspector.tsx:69` renders the Changes preview.
- `src/features/repository/MarkdownPreviewCodeBlock.tsx:11` owns each preview diagram and its fallback.
- `src/features/diagram/mermaid/mermaidRenderer.ts:78` owns lazy, serialized, themed SVG rendering.
- `src/features/diagram/mermaid/mermaidPolicy.ts:91` validates diagram source before rendering.

Use a shared Markdown code-block component and the existing renderer/policy. Each diagram must
have independent SVG identifiers and follow the shared appearance owner. Invalid, empty,
oversized or disallowed diagrams show a concise error and their source without hiding the rest
of the document. Refreshing corrected content recovers. Late render results after replacement
or unmount must not replace current content. Preserve ordinary code, Source/Diff toggles,
repository-link behavior and blocked image/HTML loading from the original story.

Acceptance criteria:

- [x] Files and Changes previews render multiple Mermaid fences while preserving ordinary Markdown/code.
- [x] Diagram colors follow appearance, SVG IDs remain independent, and diagrams fit desktop/phone panes.
- [x] Invalid/disallowed diagrams retain readable source; corrected content recovers through refresh.
- [x] Focused browser regressions, existing Mermaid units, TypeScript, isolated production build,
      both-theme desktop/phone screenshot inspection and independent review pass.

How to verify: run `npx vitest run test/mermaidPolicy.test.ts test/mermaidParse.test.ts test/uuid.test.ts`,
`npm run lint`, `CODEAI_DIST_DIR=.next-e2e npm run build`, then
`CODEAI_DIST_DIR=.next-e2e npx playwright test e2e/markdown-mermaid-preview.spec.ts e2e/file-review.spec.ts e2e/local-file-links.spec.ts`.
Use the offline fixture server; do not restart or deploy the running application.

Verified November 20, 2026:

- All 23 Mermaid policy/parser and UUID unit checks, TypeScript and the isolated production build pass.
- All 34 distinct browser cases pass across runs, including five new Mermaid journeys. The combined
  run passed 33 cases; the refresh assertion briefly matched the previous pair of diagrams before
  the updated file arrived. Waiting for the new diagram count fixes that test, and the corrected
  refresh/theme/UUID-fallback case passes three consecutive runs.
- The new regression failed before implementation because the preview contained zero rendered diagrams.
  Browser checks use intercepted file/diff content with the real Markdown and Mermaid renderers.
- Light/dark Files and Changes screenshots at 1440px and 390px were inspected: diagrams fit, labels
  remain readable, and syntax failures retain concise feedback and source.
- Independent review identified and verified the fix for browsers without `crypto.randomUUID`.
  Its final review passes with no material findings. Render state is scoped to source and theme,
  and abandoned renders cannot replace current content.
- Physical phones, Quest and attached executors were not exercised. The running application was
  not rebuilt, restarted or deployed.
