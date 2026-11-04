# Story 110 — Make the desktop workspace clear and inviting

**Status:** Shipped · **Type:** Frontend-only · **Depends on:** [Story 106](STORY-20261013-mui-desktop-ui.md)

## Motivation

The user asked for a better UI because the current one feels weird. The empty conversation offers
little direction, routine navigation looks like a row of primary actions, and the welcome screen
reserves space for an absent conversation. Improve the workbench shell slice of
[the vision](../docs/vision.md) using its existing MUI controls and appearance owner.

## Current behavior (where the code is)

- `src/features/shell/desktopTheme.ts:26` — shared MUI typography and component defaults.
- `src/features/shell/DesktopPopover.tsx:86` — shared navigation and composer picker triggers.
- `src/features/shell/AppShell.tsx:2731` — welcome and closed-session screens.
- `src/features/conversation/ConversationDrawer.tsx:154` — conversation header, history, empty state, and composer.
- `src/features/conversation/InstructionComposer.tsx:383` — instruction surface and send controls.
- `src/features/diagram/components/CanvasWorkspace.tsx:121` — canvas tools and initial prompts.
- `src/features/arena/Arena.tsx:131` — session overview and project groups.
- `src/app/globals.css:21` — workbench geometry and specialized content styling.

## Desired behavior

1. Use a consistent, readable type scale, quieter navigation, clear selected controls, and restrained
   surfaces in light and dark appearances. Keep MUI responsible for ordinary controls.
2. Give an empty conversation a short welcome and useful starter actions that only fill the draft.
   Preserve a draft already being written. Make the composer one clear input surface with an
   obvious send action and visible execution/permission context.
3. Simplify welcome and canvas copy; make the welcome screen use the available workspace width.
   Keep existing canvas prompts, drawing, session, approval, and layout actions working.
4. Give Arena a concise subtitle and more readable session rows and project grouping.
5. Fit desktop, narrow, and phone screens without clipping essential controls or overflowing.

## Acceptance criteria

- [x] Shared MUI controls and desktop chrome have consistent typography, spacing and selection states in both appearances.
- [x] Empty conversation starter actions fill and focus the instruction without sending it or replacing an existing draft.
- [x] Welcome and canvas empty states are concise, usable and responsive; welcome has no reserved empty dock.
- [x] Arena session rows, grouping, status and primary action are clear in both appearances.
- [x] Existing conversation, layout, session and approval interactions pass focused browser checks.
- [x] TypeScript, focused offline checks, isolated production build, visual inspection and independent review pass.

## Out of scope

Server/provider policy, durable formats, VR rendering, new dependencies, deployment, and restarting
the user's running application.

## November 3 follow-up — composer model details and Auto

The model picker truncates `GPT-6.1-Sol · Extra high` at 150px even in a wide composer, and
Auto's filled amber trigger reads as a warning during routine work.

Where the code is: `src/features/conversation/InstructionComposer.tsx:102` owns the mode trigger;
`src/app/globals.css:754` caps the shared model picker, also used by session setup.

- [x] Show the full model and effort when space permits; wrap long labels in narrow panes without
      horizontal overflow or overlapping Attach, mode, or Send controls.
- [x] Auto uses a neutral text trigger with its existing name, chevron, permission hint and menu
      behavior. Agent/Accept edits and Full access retain their warning/error emphasis.
- [x] Focused unit checks, TypeScript, an isolated production build, and light/dark browser checks
      at wide, docked, and 390/320px phone widths pass; inspect the resulting screenshots.

Verified: 72 focused unit checks, `npm run lint`, `CODEAI_DIST_DIR=.next-e2e npm run build`,
and seven production-browser checks across `native-security`, `canvas`, and `session-setup` pass.
The new layout regression fails against the previous build on the clipped model label. All eight
light/dark layout screenshots were inspected; independent review found no issues. The running
application has not been restarted.

## How to verify

Run `npm run lint`, focused existing theme/layout/arena offline tests, and an isolated production
build. Use the offline Playwright fixture server to inspect welcome, empty/populated conversation,
canvas, Arena and pickers at 1440, 1000 and 390/360 pixels in light/dark appearances. Verify starter
actions preserve existing drafts, Send/approval handling, theme changes and session navigation.

Verified October 20, 2026:

- `npm run lint` and `CODEAI_DIST_DIR=.next-e2e/ui-design npm run build` pass. The isolated build
  required network access for the existing Google Fonts downloads; Next added its generated type
  entries to `tsconfig.json`.
- 41 offline tests pass across `desktopTheme`, `designTokens`, `panelLayout`, `arenaModel`,
  `visualLanguage` and `arenaRoutes`.
- `CODEAI_DIST_DIR=.next-e2e/ui-design CODEAI_E2E_PORT=3046 npx playwright test
  e2e/desktop-workspace.spec.ts e2e/title-bar-tabs.spec.ts e2e/new-chat.spec.ts
  e2e/chronological-chat.spec.ts e2e/chronological-drafts.spec.ts e2e/mui-desktop.spec.ts`:
  69 pass; the optional screenshot-mismatch check is skipped because stored screenshot
  comparisons are disabled. Existing visual-fixture assertions now target the shared approval
  area and explicitly open the canvas before resizing its adjacent conversation.
- Local screenshots were inspected in both appearances, including the 900 px welcome breakpoint
  and 390 px conversation. Independent review found a welcome overflow and lost starter focus;
  both were fixed, covered in browser tests, and reviewed again without further findings.
- Mode-picker colors change immediately, avoiding a transient contrast failure when changing
  between read-only and writing modes.

The user's running application was not restarted.
