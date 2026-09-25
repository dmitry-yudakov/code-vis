# Story 72 — Give the shell an activity bar and layout icons, and let the canvas hide

**Status:** In progress · **Type:** Frontend-only · **Depends on:** nothing. Second story of the
[workbench shell epic](EPIC-20260925-workbench-shell.md); Stories 73, 75, 76, and 77 build on its
frame.

---

## Motivation

The user, on September 25, 2026, with VS Code beside the running app:

> I like the style of vscode - especially the panes.

And after the first design round:

> the canvas pane should also be toggle-able

The shell reaches the same places three ways. The header holds links (Arena, Inbox), toggles
(Repository, Conversation), and More. The side panel has its own tabs (Changes, History, Reports).
The canvas toolbar adds a second History button, and the conversation has its own close button. The
canvas cannot be hidden at all, so the conversation never gets the width for reading.

The design is the frame of [docs/design/workbench-shell/](../docs/design/workbench-shell/): the
activity bar and layout icons of `Main`, the canvas-hidden `ChatWide` board, and the one-dock rule of
`Narrow1000`.

---

## Current behavior (where the code is)

- **Header actions:** [AppShell.tsx:1768](../src/features/shell/AppShell.tsx#L1768). The Arena and
  Inbox links are at [:1885](../src/features/shell/AppShell.tsx#L1885), the Repository toggle with its
  change count at [:1894](../src/features/shell/AppShell.tsx#L1894), the Conversation toggle with the
  run state, approvals, and unread count at [:1904](../src/features/shell/AppShell.tsx#L1904), and
  More (theme, Export, Archive, VR unavailable, Build & restart) at
  [:1944](../src/features/shell/AppShell.tsx#L1944).
- **Side panel tabs and close:** [RepositorySidebar.tsx:38](../src/features/repository/RepositorySidebar.tsx#L38).
  Reports appears only where `reports` is given, which is CodeAI's own project.
- **Toolbar History:** [CanvasWorkspace.tsx:112](../src/features/diagram/components/CanvasWorkspace.tsx#L112),
  wired to `panelLayout.toggleHistory`.
- **Conversation close:** [ConversationDrawer.tsx:84](../src/features/conversation/ConversationDrawer.tsx#L84).
- **Layout state:** `PanelLayout` and `DEFAULT_PANEL_LAYOUT` in
  [panelLayout.ts:37](../src/features/shell/panelLayout.ts#L37), stored per view by
  `parseViewPanelLayouts` ([:76](../src/features/shell/panelLayout.ts#L76)).
- **Dock bands:** `dockCapacityForWidth` ([panelLayout.ts:129](../src/features/shell/panelLayout.ts#L129))
  gives 960 and 640 from the column minimums. `resolveDockWidths` ([:144](../src/features/shell/panelLayout.ts#L144))
  always reserves the canvas minimum.
- **Layout actions:** [usePanelLayout.ts](../src/features/shell/usePanelLayout.ts). At one-dock capacity an
  effect closes one panel ([:95](../src/features/shell/usePanelLayout.ts#L95)), and the diff inspector
  can close the conversation ([:102](../src/features/shell/usePanelLayout.ts#L102)). `openSide`,
  `toggleSide`, and `closeConversation` are at [:109](../src/features/shell/usePanelLayout.ts#L109),
  [:120](../src/features/shell/usePanelLayout.ts#L120), and [:150](../src/features/shell/usePanelLayout.ts#L150).
- **Shell grid:** [globals.css:27](../src/app/globals.css#L27) (header, tabs, then rail · canvas ·
  dock). Below the one-dock band the panels are fixed overlays ([:689](../src/app/globals.css#L689)).
- **Tests that touch the frame:**
  - `.repository-toggle` in [canvas.spec.ts:78](../e2e/canvas.spec.ts#L78) and :1597, [reports.spec.ts:130](../e2e/reports.spec.ts#L130), and [immersive.spec.ts:1804](../e2e/immersive.spec.ts#L1804)
  - "Open conversation", "Close conversation drawer", and `.run-status-toggle` in about 25 steps of canvas.spec.ts
  - `.header-menu` in [canvas.spec.ts:70](../e2e/canvas.spec.ts#L70), [lifecycle.spec.ts:26](../e2e/lifecycle.spec.ts#L26), and [immersive.spec.ts:1247](../e2e/immersive.spec.ts#L1247)
  - the side panel's buttons in [reports.spec.ts:66](../e2e/reports.spec.ts#L66) and "Close side panel" in [canvas.spec.ts:1575](../e2e/canvas.spec.ts#L1575)
  - the Arena and Inbox links in canvas, immersive, and machines specs
  - the bands in [panelLayout.test.ts:20](../test/panelLayout.test.ts#L20) and [canvas.spec.ts:1584](../e2e/canvas.spec.ts#L1584)

---

## Desired behavior

### Part A — The activity bar

1. A 48px activity bar sits left of the side panel, below the header, as a `nav` named "Views". It
   appears once the shell has loaded, on the Arena page and the welcome screen too.
2. With a session open it starts with Changes, History, and, only in CodeAI's own project, Reports.
   Each toggles its view in the side panel: pressing the shown view closes the panel, and pressing
   another switches to it. `aria-pressed` says which view is showing.
3. Changes carries the working tree's change count as a badge, and its name says it ("Changes, 7
   files"). The count stays achromatic, as the Repository toggle's is today.
4. Arena and Inbox follow a divider. They are links to the Arena page until Story 75. Inbox keeps
   today's unread badge and name ("Inbox, 2 unread"). On the Arena page the current section's link
   carries `aria-current="page"`.
5. A gear at the bottom opens More, with today's contents. Its menu opens beside the bar.
6. The header loses the Arena and Inbox links, the Repository toggle, and More. The side panel loses
   its Changes/History/Reports tabs and its close button, and names its view in its header instead.
   The canvas toolbar loses History.
7. Pressing a view, or any other way of opening a panel, leaves focus mode, which would otherwise
   keep the panel hidden.
8. The dock bands move by the bar's width: two docks from 1008px, one from 688px. Below 688px both
   overlays sit right of the bar, so the bar stays usable.

### Part B — Layout icons, and hiding the canvas

1. The header ends with two layout icons, Canvas and Conversation, shown while a session is open.
   Each is a toggle button with `aria-pressed`. The Enter VR button, where offered, stays left of them.
2. Conversation replaces the Conversation toggle and the conversation's own close button. While the
   conversation is closed, a badge on it shows pending approvals in `wait`, or else the unread count,
   and its name says so ("Conversation, 1 action waiting for your approval"). The run state itself
   stays on the session's tab (Story 74 adds the status bar).
3. Canvas hides the canvas and opens the conversation, which then takes the width. Its transcript and
   composer stay centred at up to 760px for reading. Pressing Canvas again shows the canvas.
4. The canvas and the conversation are never both hidden. Closing the conversation shows the canvas
   again, and a stored layout that says both are hidden shows the canvas.
5. With the canvas hidden, both panels fit from 688px. Showing the canvas keeps the conversation and
   closes the side panel wherever the side panel no longer fits: below 1008px, or beside a diff
   inspector that would need the conversation's room. Below 688px the canvas always shows under the
   overlays, and Canvas is not offered.
6. A hidden canvas is unmounted, so its drawing shortcuts cannot act unseen. On return it restores
   its stored camera, and a fitted view fits the new size.
7. Hiding the canvas leaves focus mode. A layout stored before this story opens with the canvas.
8. Opening a diagram from the conversation or History, or starting a sketch from `+`, shows a hidden
   canvas.

The design's side panel icon is left out. The activity bar already toggles the side panel, and the
icon would add a control to the default layout (see *What shipped differently*).

### Type contract

```ts
// panelLayout.ts
export const ACTIVITY_BAR_WIDTH = 48;
export interface PanelLayout extends PanelWidths {
  // … today's fields
  canvasOpen: boolean;              // absent in stored layouts means true
}
/** Hidden only beside an open conversation, outside focus mode, and above the overlay band. */
export function isCanvasHidden(layout: PanelLayout, capacity: DockCapacity): boolean;
export function toggledCanvas(layout: PanelLayout, capacity: DockCapacity, sideFits?: boolean): PanelLayout;
/** Every way of closing the conversation goes through this, so it also shows the canvas. */
export function withoutConversation(layout: PanelLayout): PanelLayout;
// dockCapacityForWidth(shellWidth) now includes the activity bar;
// resolveDockWidths({ …, canvasShown }) reserves the conversation minimum when the canvas is hidden.
```

No wire type or stored session changes. The per-view layout gains one optional field.

---

## Acceptance criteria

### Part A
- [x] The activity bar shows Changes, History, and, only in CodeAI's own project, Reports; each
      toggles its view, and `aria-pressed` names the shown one.
- [x] Changes shows the change count; Inbox shows the unread count; Arena and Inbox open the Arena
      page, where the current section is marked.
- [x] The gear opens More with theme, Export, Archive, and Build & restart where offered.
- [x] The header no longer holds Arena, Inbox, Repository, or More; the side panel has no tabs or
      close button; the toolbar has no History.
- [x] Opening a view leaves focus mode.
- [x] Two docks from 1008px, one from 688px, overlays below; the bar stays visible beside the
      side panel overlay.

### Part B
- [x] Conversation opens and closes the conversation and shows approvals, else unread, while it is
      closed; the conversation has no close button of its own.
- [x] Canvas hides the canvas, opens the conversation, and centres it at up to 760px; pressing it
      again brings the canvas back with its camera, and a fitted view fits.
- [x] Closing the conversation shows the canvas; no action or stored layout leaves both hidden.
- [x] With the canvas hidden, the side panel and the conversation share 688–1007px; showing the
      canvas there closes the side panel. Below 688px there is no Canvas icon and the canvas shows.
- [x] A layout stored before this story still parses and opens with the canvas.

### All parts
- [x] At 1440×900 the default layout shows no more visible controls than before this story (45 on
      the e2e data, 42 on Story 62's data), measured after each part.
- [x] Every new control has an accessible name and a tooltip, and its text and badges meet 4.5:1 in
      both themes.
- [x] The e2e steps that used the removed controls use the new ones, and each was shown to fail
      against the old frame.
- [x] `docs/design/workbench-shell/` matches what shipped, or is updated in the same change.
- [x] `npm run lint`, `npm test`, and `npm run test:e2e` pass after each part.

## Out of scope

- Session tabs in the title bar, All sessions, and the provider badge (Story 73).
- The status bar and the notice row (Story 74). Notices still float.
- Arena and Inbox as side-panel views (Story 75).
- Pane headers, flat icon buttons, and the floating canvas bar (Story 76).
- The phone bottom bar (Story 77); below 688px the activity bar stays.
- The immersive workspace.

## How to verify

1. `npm run lint && npm test && npm run test:e2e`.
2. `npm run dev` at 1440×900 on a session with changes. The activity bar shows Changes with the
   count, History, Arena, Inbox, and the gear; in the code-ai project, Reports too. The header ends
   with Canvas and Conversation.
3. Press Changes: the side panel opens on Changes. Press History: it switches. Press History again:
   it closes.
4. Press Canvas: the canvas disappears and the conversation reads at the centre. Press Conversation:
   the canvas returns and the conversation closes. Press Canvas again and reload: the canvas is still
   hidden.
5. Narrow the window to 1000px with the canvas hidden: the side panel and conversation both stay.
   Press Canvas: the side panel closes. Narrow to 600px: the Canvas icon goes and the panels overlay.
6. Start an Agent turn that asks for approval, close the conversation: the Conversation icon shows
   the approval badge.
7. Open the gear, switch to the dark theme, and repeat steps 2 and 4.

## What shipped

- **Part A — the activity bar.** `ActivityBar` ([ActivityBar.tsx:16](../src/features/shell/ActivityBar.tsx#L16))
  renders the session's views as toggle buttons, the Arena and the Inbox as links marked
  `aria-current="page"` on their section, and More as a gear-shaped `<details>` whose menu opens
  beside the bar. Its icons are `ShellIcon` ([ShellIcon.tsx](../src/features/shell/ShellIcon.tsx)).
  AppShell mounts it after the header ([AppShell.tsx:1920](../src/features/shell/AppShell.tsx#L1920))
  and marks the view the side panel really shows, which is Changes where a remembered Reports view is
  unavailable ([:1724](../src/features/shell/AppShell.tsx#L1724)). The side panel names its view in
  an `h2` instead of tabs and a close button ([RepositorySidebar.tsx:36](../src/features/repository/RepositorySidebar.tsx#L36)).
  `toggleSide` compares against the view on screen and treats a panel hidden by focus mode as closed,
  and opening any panel leaves focus mode ([usePanelLayout.ts:118](../src/features/shell/usePanelLayout.ts#L118),
  [:128](../src/features/shell/usePanelLayout.ts#L128)). `ACTIVITY_BAR_WIDTH` moves the bands in
  `dockCapacityForWidth` ([panelLayout.ts:135](../src/features/shell/panelLayout.ts#L135)), and
  `useDockCapacity` hands the panes the shell width less the bar
  ([usePanelLayout.ts:39](../src/features/shell/usePanelLayout.ts#L39)). The grid gains an `activity`
  column ([globals.css:27](../src/app/globals.css#L27)); the bar has no z-index, so More's menu rises
  above the phone overlays ([:174](../src/app/globals.css#L174)), and both overlays start right of
  the bar ([:701](../src/app/globals.css#L701)).
- **Part B — layout icons and a hidden canvas.** `LayoutToggles`
  ([LayoutToggles.tsx:10](../src/features/shell/LayoutToggles.tsx#L10)) ends the header
  ([AppShell.tsx:1905](../src/features/shell/AppShell.tsx#L1905)); a pressed icon is marked by ink and
  an edge. The rules are pure: `isCanvasHidden`, `withoutConversation`, and `toggledCanvas`
  ([panelLayout.ts:146](../src/features/shell/panelLayout.ts#L146)–[161](../src/features/shell/panelLayout.ts#L161)),
  and `resolveDockWidths` reserves the conversation minimum instead of the canvas's
  ([:199](../src/features/shell/panelLayout.ts#L199)). Every close of the conversation goes through
  `withoutConversation`, including the one-dock and diff-inspector effects. Showing the canvas closes
  the side panel where it no longer fits, and flat actions aimed at the canvas show it
  (`showCanvas`, [usePanelLayout.ts:166](../src/features/shell/usePanelLayout.ts#L166)). A stored
  layout without `canvasOpen`, or with both closed, opens with the canvas
  ([panelLayout.ts:93](../src/features/shell/panelLayout.ts#L93)). The hidden canvas is an empty
  hidden tab panel ([CanvasWorkspace.tsx:100](../src/features/diagram/components/CanvasWorkspace.tsx#L100)),
  and a restored fitted view fits once its diagram renders
  ([DiagramCanvas.tsx:224](../src/features/diagram/components/DiagramCanvas.tsx#L224)). Unread replies
  now count while focus mode hides the conversation, so its badge tells the truth.

## What shipped differently

- **Two layout icons, not three.** The design's side panel icon would have raised the default
  layout from 45 to 46 visible controls, against the epic's rule that no story raises the count, and
  the activity bar already opens and closes the side panel. The repository copy of the design, the
  epic's target (now 35), and the budget note say so; the private Claude Design original still shows
  three.
- **Today's wording and colours where the design mocked new ones:** the Inbox keeps "Inbox, 2 unread"
  and its `wait` badge, More is named "More", and the Conversation badge says "1 action waiting for
  your approval". The icons' tooltips say what a press does ("Hide the canvas"). The design copy now
  matches.
- **Arena and Inbox are links** until Story 75, so on the Arena page the Inbox count appears on the bar
  and on the Arena's own tab.
- **Known and left alone:** each mount of the canvas reports its marks once, which writes the
  annotation again; tab switches already did this, and hiding the canvas makes it more frequent.
  While VR is active, the flat page's semantic controls now start right of the bar.

## Verification record

September 25, 2026, offline, against the fake Claude.

- `npm run lint` passes; `npm test` passes 91 files / 733 tests, including
  [workbenchFrame.test.ts](../test/workbenchFrame.test.ts) (activity bar, side panel header, layout
  icons), the bands and canvas rules in [panelLayout.test.ts](../test/panelLayout.test.ts), and the
  on-emphasis/ink-2 pair in [designTokens.test.ts](../test/designTokens.test.ts).
- `npm run test:e2e` passed 94/94 after Part A, 95/95 after Part B, and 95/95 on the final code. New:
  [canvas.spec.ts:1625](../e2e/canvas.spec.ts#L1625) (the activity bar),
  [:1697](../e2e/canvas.spec.ts#L1697) (hiding the canvas), and new steps in the bands test
  ([:1838](../e2e/canvas.spec.ts#L1838)) and the phone step of Story 71's test
  ([:1603](../e2e/canvas.spec.ts#L1603)).
- Against a build of the code before this story, all 25 changed e2e tests fail and the 24 unchanged
  ones selected with them pass.
- Mutation proofs, each restored: 28 unit mutations (bands, plural, pressed view, `aria-current`,
  badges, tooltips, Reports fallback, the canvas rules, the stored default, both-closed layouts, the
  conversation minimum, approvals before unread, the overlay band, and others) and 12 e2e mutations
  (focus exit, the overlay beside the bar, closing without showing the canvas, a hidden but mounted
  canvas, the change count, the one-dock effect with the canvas hidden, More under the overlay, the
  badge colour, the 760px column, the phone conversation overlay, canvas-aimed actions, and a drawing
  shortcut acting on a hidden canvas) all fail their tests. The refit fix in `DiagramCanvas` could not
  be made to fail an e2e test: Chrome renders the fixture diagram within the first resize frame, which
  refits anyway, so the fix guards slower renders.
- Visible controls at 1440×900 in the default layout, counted with the same script on a production
  build with the e2e fixtures and a diagram on the canvas: 45 before, 45 after Part A, 45 after Part
  B, and 45 on the final code.
- Screenshots of the default layout, the hidden canvas beside History in both themes, More, and a
  390px phone matched the design boards.
- A review subagent found the refit on return, the phone overlay covering the bar, showing the canvas
  beside a diff inspector closing the conversation, stale `canvasOpen` after focus mode, canvas-aimed
  actions leaving the canvas hidden, the unmarked view after a Reports fallback, colour-only pressed
  icons, VR controls over the gear, a test that could not fail, and stale docs; all are fixed and
  covered, apart from the annotation rewrite above.
- Pending before **Shipped**: **How to verify** steps 2–7 in the running app on real data.
