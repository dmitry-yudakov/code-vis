# Story 73 — Move session tabs into the title bar

**Status:** Shipped · **Type:** Frontend-only · **Depends on:** [Story 72](STORY-20260925-layout-frame.md)'s implemented frame.

---

## Motivation

Session selection occupies both a breadcrumb picker and a separate 34px tab row. Moving the tabs
beside project identity gives that height back to the canvas and shows the session title once in
the title bar. This is Q3 of the [development queue](../docs/development-queue.md), following the
[workbench shell epic](EPIC-20260925-workbench-shell.md)'s Main board and presentation-only contract.
It supports the arena's [device views](../docs/vision.md) without changing durable sessions.

## Where the code is

- [AppShell.tsx:1988](../src/features/shell/AppShell.tsx#L1988) mounts `WorkspaceTabs` after the
  project picker, followed by All sessions and the existing new-session form in the title bar.
- [WorkspaceTabs.tsx:13](../src/features/conversation/WorkspaceTabs.tsx#L13) renders ordered tabs,
  live and unread badges, arrow navigation, and one focused-view close button. Its effect at
  [:42](../src/features/conversation/WorkspaceTabs.tsx#L42) reveals the selected tab, and `closeView`
  at [:59](../src/features/conversation/WorkspaceTabs.tsx#L59) shares Delete/button focus restoration.
- [SessionPicker.tsx:112](../src/features/conversation/SessionPicker.tsx#L112) lists all sessions in
  the current project (or loose-session scope) through the native All sessions select, including a
  placeholder when the last view closes, and owns the existing new-session form.
- [globals.css:27](../src/app/globals.css#L27) gives the shell one 48px title bar above its body;
  phone headers keep 78px. The native picker and tabs are styled here, as are Arena's body row and
  the fixed panel and toast insets adjusted for the removed 34px row.
- [useWorkspaceViews.ts](../src/features/shell/useWorkspaceViews.ts) and
  [workspaceViews.ts](../src/features/shell/workspaceViews.ts) own device-only open views and focus;
  [canvas.spec.ts:580](../e2e/canvas.spec.ts#L580) already verifies drafts, cameras, and closing.

## Desired behavior

1. Put open session tabs after the project picker in the title bar. Remove the separate tab row
   across desktop, narrow, welcome, and Arena layouts. Keep the current phone header's two rows.
2. Replace the breadcrumb's displayed session title with a 28px **All sessions** chevron. Reuse the
   native session select and its complete scoped list, including closed views and overflow tabs;
   choosing one opens and focuses that view. Preserve new-session creation beside it.
3. Tabs use the Main board's compact rounded shape. Constrain their width to the title bar's available
   space; clip overflow and scroll the selected tab into view on selection, resize, or title changes.
   All sessions remains available when tabs do not fit. Keep overflow in CSS, without recording a
   separate visible-tab list or changing stored device state.
4. Keep one close button after the tablist, outside its accessibility tree. It closes only the focused
   view and is disabled during a running, queued, or approval-blocked turn. Delete, arrows with wrap,
   and neighbour focus continue to work. Closing the last view returns keyboard focus to All sessions.
5. Preserve run state, approval, queue, and unread badges, device drafts, cameras, and stored layouts.
   Remove the obsolete 34px from phone overlays and toast insets; Arena continues below the header.
6. Use existing theme tokens, accessible names, and tooltips, with an inset keyboard-focus outline
   that stays visible inside the clipped tablist. The default 1440×900 layout must not add
   visible controls: All sessions replaces Session, and the one close and new-session controls remain.

No wire, server, session-store, or browser-storage schema changes.

## Acceptance criteria

- [x] Tabs live in the title bar; the canvas gains 34px, and Arena/welcome still occupy the body row.
- [x] All sessions opens both closed and overflow views in the current scope, without a duplicate
      visible title; new-session creation still works.
- [x] Selection remains visible through overflow, resize, and title changes; long titles cannot push
      project identity, All sessions, or layout icons out of the header, including at 390px.
- [x] Arrow navigation wraps; Delete and the single close button preserve neighbour focus and cannot
      close live views; closing the last view focuses All sessions and leaves history recoverable.
- [x] Drafts, cameras, stored layouts, and live/unread tab indicators retain their existing behavior.
- [x] Both themes match the design's title-bar arrangement, use theme tokens, and keep the visible
      control count at or below the pre-change count at 1440×900.
- [x] TypeScript, focused unit and production-browser checks, and an independent review pass.

## Out of scope

- Status bar (Story 74), Arena in the side panel (75), flat panes/floating canvas bar (76), and phone
  bottom bar (77). The current activity bar and canvas toolbar remain.
- Provider badges or new provider behavior, tab reordering, cross-project tabs, and session deletion.
- Physical Quest acceptance and Q2's real-data/provider verification. The immersive workspace keeps
  its existing session controls.

## How to verify

1. Run `npm run lint` and the focused workspace-tab, workspace-view, panel-layout, and token unit tests.
2. Build into `.next-e2e` and run the title-bar browser checks plus existing workspace, concurrency,
   responsive panel, theme, Arena, new-chat, and auto-archive checks against fake providers.
3. At 1440×900 in each theme, inspect the header and measure visible controls against the same fixture
   before this story. Confirm the canvas starts at 48px instead of 82px and compare Main/ArenaDark.
4. Open enough long-named sessions to overflow at 1000px and 390px. Use All sessions and arrows to
   reach hidden views, resize, close via Delete and the button, then reopen from All sessions.
5. Start an approval-blocked turn and verify its tab badge and disabled close control. Switch away,
   return and cancel. Reload with a draft and hidden-canvas layout and confirm both restore.
6. Review with a subagent, address concrete findings, and record evidence here and in Q3.

## Verification record — October 3, 2026

- The three new production-browser checks failed against the pre-story build on missing title-bar
  placement and All sessions. On the implementation they cover both themes, the 34px gain, native
  keyboard selection, overflow and resize at 1000px/390px, arrows with wrap, Delete/button neighbour
  focus, last-view focus, reopening, stored draft/layout restoration, and approval-blocked views.
- The same one-session fixture at 1440×900 has **27 visible controls before and after**. The canvas
  body moves from y=82px to y=48px, reaching 852px high. Light/dark and phone screenshots were inspected.
- `npm run lint` and the production build into `.next-e2e` pass. The build needed network access for
  the existing Google fonts. The 53 focused unit checks pass. The full offline suite had 103 of 106
  suites pass inside the sandbox; its three filesystem-fixture suites (`dockerCustomizations`,
  `dockerRuntime`, `globalInstructions`) then passed outside it, covering **106 files / 993 tests**
  altogether. No provider credentials were used.
- The broader production-browser run passed **43 of 46 existing journeys**, including workspace
  drafts/cameras, background turns and approvals, Arena navigation, responsive panels, themes, toasts,
  new chat, auto-archive, checkpoints, Native security, and Docker continuation/creation. The final
  **three Story 73 checks pass**, including the review's focus-ring regression: **46 passed checks
  altogether**. Its focus-ring assertion failed against the pre-fix build and passed after rebuilding.
- **Environment gap:** three additional spatial/VR journeys encountered Chrome's GPU WebGL
  context-creation failure (`BindToCurrentSequence`). A temporary Playwright config tried both
  SwiftShader ANGLE backends, but Chrome still supplied no usable WebGL context. Those three checks
  remain unverified here; the default browser configuration and spatial/VR application code are
  unchanged. They are outside this story's desktop acceptance and do not close any Quest criterion.
- The review subagent found one P2 accessibility issue: the global focus ring was clipped at narrow
  tab widths. Tabs now inset their outline; the overflow browser check measures that the whole
  keyboard-focus ring fits within the tablist. The reviewer confirmed the fix and reported **no
  remaining findings**; the rebuilt Story 73 browser checks then passed.
- A fresh review requested after completion found a second P2: the native select's opaque hover
  and focus fill covered the All sessions chevron. The noninteractive glyph now paints above that
  fill while clicks still reach the select. A rendered-pixel regression hides the glyph without
  changing geometry and compares screenshots, on hover and keyboard focus in both themes. It
  failed against the old build and passed after the fix; TypeScript, production rebuild, and all
  three Story 73 browser checks passed again. This reviewer also independently passed 41 focused
  unit checks and confirmed **no remaining findings**. The three unavailable spatial/VR journeys
  still leave shared panel/toast geometry on those surfaces unverified on this machine.
