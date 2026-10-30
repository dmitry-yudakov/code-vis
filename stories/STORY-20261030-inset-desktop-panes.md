# Story 118 — Give desktop panes a quiet inset frame

**Status:** Shipped · **Type:** Frontend-only · **Depends on:** [Story 110](STORY-20261020-desktop-workspace-design.md)

## Motivation

The user supplied a VS Code screenshot and accepted inset Changes, Canvas, and Conversation
surfaces: narrow gutters, rounded corners, restrained headers, and little shadow. This refines
the pane geometry in the [workbench shell epic](EPIC-20260925-workbench-shell.md) without adding
controls or changing the conversation-first default.

## Current behavior (where the code is)

- `src/app/globals.css:21` — shell grid and edge-to-edge panes; pane headers use different heights.
- `src/features/shell/panelLayout.ts:1` — pane minimums, responsive bands and resolved dock widths.
- `src/features/shell/usePanelLayout.ts:151` — inspector admission, resizing and CSS width values.
- `src/features/shell/ActivityBar.tsx:33` — navigation controls, exact accessible counts and compact badges.
- `e2e/canvas.spec.ts:2125` — resize, saved-width restoration and docking boundary regressions.
- `e2e/desktop-workspace.spec.ts:1` — both-theme desktop/phone fixtures and navigation checks.

## Desired behavior

1. At docking widths, separate the three panes with 4px gutters, including a 4px top, bottom and
   right inset; the activity bar supplies the left boundary. Use 8px corners, existing theme
   surfaces, subtle outlines and no large pane shadows. Headers use a shared 42px minimum and
   grow for conversation repository context.
2. Treat persisted pane widths as content-frame widths. Reserve gutters before resolving widths
   and inspector admission, preserving the 268px repository, 320px conversation and 360px canvas
   minimums and the 80% maximum at roomy widths. Two docks still fit from 1008px. One dock now
   starts at 740px (either dock's minimum plus canvas, activity bar and the existing 12px allowance),
   replacing the old 688px threshold derived from the narrower repository. Smaller windows use
   the existing overlays rather than shrinking a docked conversation below its minimum.
3. Center reachable pointer/keyboard resize handles in the gutters. Preserve show/hide, focus,
   inspector, saved layouts, canvas fitting and conversation draft behavior from Stories 62,
   72, 107 and 110. A hidden canvas lets the conversation fill the remaining width.
4. Keep phone overlay geometry and its recovery/navigation controls usable. Implement both themes
   through the existing theme tokens and MUI controls; add no persistence or server behavior.
5. Inset the desktop activity bar within its existing 48px column, with the same 4px outer
   margins, 8px frame corners and aligned top/bottom edges as the panes. The gap to Changes (or
   the canvas/conversation when Changes is closed) is 4px. Keep selection, focus and badges
   visible inside the rail, More above adjacent panes, and global navigation anchored across
   session/Arena/Inbox/welcome views. Counts above 99 display as `99+`, retaining their exact
   accessible labels. Phone overlays retain their existing rail geometry.

## Acceptance criteria

- [x] Docked panes have aligned inset frames, quiet surfaces and consistent header minimums in both themes.
- [x] Minimum widths, responsive bands, 80% limits and saved preferences survive gutter allocation.
- [x] Pointer/keyboard resize, inspector admission, canvas hiding/focus/fitting and drafts remain usable.
- [x] Phone overlays and navigation remain usable without horizontal overflow.
- [x] Focused unit/browser checks, TypeScript, an isolated production build, both-theme screenshot inspection and independent review pass.
- [x] The desktop activity rail shares the pane insets and equal gaps, with selection, focus, menus and narrow navigation verified in both themes.

## Out of scope

Story 74's status bar, the remaining Story 76 toolbar work, new layout controls, backend/provider
changes, VR rendering, deployment and restarting the running application.

## How to verify

Run `npm run lint` and the panel-layout unit checks. Build in a separate `CODEAI_DIST_DIR`, then
run the desktop workspace checks and the canvas resize/dock/hide/fit regressions against the
offline Playwright fixture server. Inspect screenshots of three panes, a diff inspector, the
expanded conversation and phone overlays in light/dark appearances, including 1008/1007 and
740/739px boundary checks. Record results and any unavailable coverage here.

Verified October 30, 2026:

- `npx vitest run test/panelLayout.test.ts test/desktopTheme.test.ts test/designTokens.test.ts`:
  all 30 checks pass. The new three-pane threshold regression failed before implementation;
  the final tests also cover either dock's minimum at the one-dock threshold.
- `npm run lint` and `CODEAI_DIST_DIR=.next-e2e/inset-panes npm run build` pass. The isolated
  build required network access for existing Google Fonts and Next added its generated type
  entries to `tsconfig.json`.
- With `CODEAI_DIST_DIR=.next-e2e/inset-panes CODEAI_E2E_PORT=3054`, 27 selected production-browser
  checks pass across `desktop-workspace.spec.ts`, `canvas.spec.ts` and `mui-desktop.spec.ts`.
  Selection: `inset panes|diff inspector reserves|activity bar keeps|conversation starters|welcome uses|resizes the|docks only|opens and hides the canvas|picks side-panel views|panels visual baseline`.
  This covers pointer/keyboard resizing, the 80% cap and stored-width restoration, docking,
  inspector admission at 1560/1559px, hiding/focus/drawing/fitting, a fake-provider turn and approval
  return, drafts, both themes and phone navigation. Welcome geometry now waits for the existing
  ResizeObserver to reconcile the viewport instead of reading a transient old column width.
- Local screenshots were inspected in both themes: three panes at 1440/1008px, the expanded
  conversation, diff inspector and 360px phone overlays. Automated PNG comparisons remain disabled
  by the existing Playwright setting; geometry assertions and direct visual inspection passed.
- Independent review identified the old single-dock threshold's use of the smaller repository
  minimum. The 740px fix and 728/736/739/740px regressions were reviewed again without findings.
  `git diff --check` passes.

The broad legacy `creates, annotates, revises, restores, and exports a canvas session` browser
case was attempted but excluded from the final selection: its initial `No project` heading
assertion predates Story 110's welcome copy. Canvas fitting, drawing and show/hide delivery are
covered by the selected current regression. The full suite and VR were not rerun.

Navigation alignment follow-up, verified October 30, 2026:

- The activity rail now shares the desktop pane frame and 4px insets inside its existing 48px
  column. Its 32px-wide controls retain 44px height, visible selection markers and focus rings.
  The full phone rail and overlay placement remain unchanged.
- The new browser assertions fail against the previous release in both themes (the navigation
  frame has no rounded corners). They now verify equal 4px gaps to Changes and aligned top/bottom
  edges at 1440/1008px, alongside the existing minimum-width and resize-handle assertions.
- All 21 checks across `workbenchFrame`, `desktopTheme` and `designTokens`, TypeScript and the
  isolated production build pass. A new regression for 10000 changed files, 999 unread items
  and 123 updates failed before compact badge rendering; badges now show `99+` above 99 while
  keeping exact accessible counts.
- All eight production-browser cases selected by
  `inset panes|activity bar keeps|picks side-panel views|docks only` pass in the same isolated
  build and fixture port. This verifies selection, keyboard focus, More, retained drafts,
  stable navigation across session/Arena/Inbox/welcome, responsive docking and phone overlays.
  Updated desktop workspace and Arena screenshots were inspected in both themes.
- Independent follow-up review identified the large-badge overflow; the compact count fix and
  accessibility regression were reviewed again without findings. `git diff --check` passes.

The running application was not restarted. No deployment was performed.
