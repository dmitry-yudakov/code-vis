# Story 114 — Clarify the activity bar and keep global navigation in place

**Status:** Shipped · **Type:** Frontend-only · **Depends on:** [Story 72](STORY-20260925-layout-frame.md), [Story 110](STORY-20261020-desktop-workspace-design.md)

## Motivation

The selected activity button fills the rail and its rounded highlight looks clipped. Arena and
Inbox move upward when the project views disappear. This refines the existing workbench shell
slice of [the vision](../docs/vision.md) with clearer selection and stable global navigation.

## Current behavior (where the code is)

- `src/features/shell/ActivityBar.tsx:35` — session toggles, a conditional divider, Arena, Inbox, More.
- `src/app/globals.css:115` — full-width activity buttons, selected inset shadow, bottom-pinned More.
- `src/features/shell/AppShell.tsx:2611` — omits session views in Arena and on the welcome screen.
- `e2e/desktop-workspace.spec.ts:4` — offline workspace setup and appearance checks.

## Desired behavior

Inset the rounded controls within the existing 48px rail and mark selection with a short vertical
indicator as well as accent ink and background. Keep session views at the top. Keep Arena, Inbox,
and More together at the bottom, separated from the session views. Their positions must stay the
same when moving between a session, Arena, Inbox, and the welcome screen at the same viewport size.

Keep MUI controls, accessible names, pressed/current semantics, counts, keyboard focus, tooltips,
panel toggling, drafts, and the More popover. Use existing appearance tokens in both themes.

## Acceptance criteria

- [x] Selected controls have an inset rounded surface and short selection marker in both themes.
- [x] Arena, Inbox, and More remain together at the bottom regardless of available session views.
- [x] Navigation, panel toggling, drafts, badges, keyboard focus, and More remain usable on desktop and phone.
- [x] TypeScript, focused unit/browser checks, production build, screenshot inspection, and independent review pass.

## Out of scope

Server behavior, durable formats, VR, new dependencies, deployment, and restarting the running app.

## How to verify

Run `npm run lint`, `npm test -- test/workbenchFrame.test.ts`, and an isolated production build.
Run the activity-bar browser checks in `e2e/desktop-workspace.spec.ts` in both themes at desktop
and phone widths, plus the existing activity-bar navigation case in `e2e/canvas.spec.ts`.
Inspect the captured workspace and Arena screenshots. Record the before-change regression result
and final verification here.

Verified October 26, 2026:

- The new browser regression fails against the previous release: the selected button starts at
  x = -0.5px, outside the rail. The new controls start at x = 3.5px within the same 48px rail.
- `npm run lint`, `CODEAI_DIST_DIR=.next-e2e npm run build`, and 20 focused tests across
  `workbenchFrame`, `desktopTheme`, and `designTokens` pass.
- The browser checks cover both appearances at 1440px and 360px, comparing exact Arena/Inbox/More
  positions across session, Arena, Inbox, last-tab close, and welcome-screen reload. They also
  cover selected hover colors, keyboard focus and toggling, retained drafts, and More dismissal.
- Screenshot inspection found a hover-specificity conflict that temporarily hid selected colors;
  the hover selectors and regression assertions now preserve the accent on the selected control.
- All five focused browser cases pass against the isolated production build:
  `CODEAI_DIST_DIR=.next-e2e CODEAI_E2E_PORT=3051 npx playwright test
  e2e/desktop-workspace.spec.ts e2e/canvas.spec.ts --grep 'activity bar|picks side-panel views'`.
  Desktop and phone screenshots were inspected in both appearances.
- Independent review found no remaining implementation issues. Its welcome-screen coverage and
  animation-sensitive color assertion findings were addressed; expected colors now resolve from
  the existing tokens independently of the selected button's transition.

The running application has not been restarted.
