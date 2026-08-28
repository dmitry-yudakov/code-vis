# Story 31 — Dock the repository and conversation panels beside the canvas

**Status:** Shipped · **Type:** Frontend-only ·
**Depends on:** [Story 30](STORY-20260828-theme-switch.md) (theme switch) ·
**Epic:** [shell design system](EPIC-20260828-shell-design-system.md)

---

## Motivation

Every panel in the application floats *over* the canvas instead of docking beside it, so opening
anything hides part of the diagram. In a canvas-first product where "once a diagram exists the
canvas becomes the primary workspace" ([README](../README.md#L6)), that is the most expensive
interaction cost in the app.

Concretely, from the current UI:

- The drawing toolbar sits on top of the leftmost participant boxes of a sequence diagram.
- The **Ask Claude…** pill covers the bottom lifeline labels.
- The zoom controls land on the rightmost participant column.
- Opening the conversation drawer covers the right third of the canvas; the diagram does not
  reflow and the hidden content is simply unreachable without closing the drawer again.

Fit-to-view makes this worse rather than better. It fits to the raw element bounds and applies a
flat `0.86` factor as a stand-in for chrome it cannot see, so it under-fits when nothing is open
and still parks content under the toolbar when something is.

The repository sidebar is the one panel already compensated for — with a hardcoded
`margin-left: 340px` on three sibling selectors. That approach does not extend to a second panel,
and it is why the drawer was built as an overlay in the first place.

---

## Current behavior (where the code is)

- The shell is a two-row grid with no column model:
  `grid-template-rows: 64px minmax(0, 1fr)` in [globals.css](../src/app/globals.css#L30) (~line 30).
- The repository sidebar is `position: fixed` at 340px wide, outside the grid, in
  [globals.css](../src/app/globals.css#L308) (~line 308); the canvas is pushed aside by a
  hardcoded margin on three selectors at [globals.css](../src/app/globals.css#L303) (~lines 303–306).
- The conversation drawer and diagram navigator are `position: fixed` overlays sharing one rule at
  [globals.css](../src/app/globals.css#L165) (~line 165), pinned `top: 74px; right: 10px` at
  `min(460px, …)` wide with `z-index: 60`.
- Floating canvas chrome, all `position: absolute` with no shared inset model:
  drawing toolbar `left: 16px; top: 16px` ([globals.css](../src/app/globals.css#L148), ~line 148),
  zoom controls `right: 16px; bottom: 16px` ([globals.css](../src/app/globals.css#L153), ~line 153),
  ask pill `left: 16px; bottom: 16px` ([globals.css](../src/app/globals.css#L93), ~line 93).
- Fit-to-view knows nothing about any of it:
  [DiagramCanvas.tsx](../src/features/diagram/components/DiagramCanvas.tsx#L114) (~lines 114–117),
  where the `* 0.86` is the entire allowance for chrome.
- Panel state lives in two places: `repositoryOpen` at
  [AppShell.tsx](../src/features/shell/AppShell.tsx#L76) (~line 76), `chatOpen` and `historyOpen`
  at [AppShell.tsx](../src/features/shell/AppShell.tsx#L74) (~lines 74–75); `focusMode` is separate
  again in [CanvasWorkspace.tsx](../src/features/diagram/components/CanvasWorkspace.tsx#L44) (~line 44).
- The ask pill is the only way to open the conversation from the canvas
  ([CanvasWorkspace.tsx](../src/features/diagram/components/CanvasWorkspace.tsx#L124), ~line 124).

---

## Desired behavior

The shell becomes a three-column grid. Panels take real columns and the canvas reflows into the
space that is left; nothing covers the sheet. Both side panels are resizable by dragging their
inner edge, and the widths persist per device.

Only the drawing toolbar and the zoom controls still float, because they belong to the canvas
rather than the shell. They declare their footprint as canvas insets, and fit-to-view consumes
those insets instead of guessing — so **Fit** never places a node under a button.

```
┌────────────────────────────────────────────────────────────────┐
│ header                          grid-column: 1 / -1            │
├──────────────┬───────────────────────────────┬─────────────────┤
│ repository   │ canvas (reflows, never        │ conversation    │
│ 268–480px    │ occluded)  min 360px          │ 320–560px       │
│ resizable    │                               │ resizable       │
└──────────────┴───────────────────────────────┴─────────────────┘
```

### How many panels can dock

Minimum widths do not fit at every viewport, so docking is conditional rather than absolute.
Three docked columns need `268 + 360 + 320` plus two 4px handles and borders — call it **960px**.
One docked panel plus the canvas needs **640px**. The existing 850px breakpoint sits between the
two, so it is not a single threshold and the story defines three bands:

| Viewport | Behavior |
|---|---|
| ≥ 960px | Both panels dock. Full three-column grid. |
| 640–959px | **One** panel docks at a time — the most recently opened. Opening the second closes the first rather than shrinking the canvas below 360px. |
| < 640px | Both panels overlay, as today. The existing 850px rules move to this breakpoint. |

The band is derived from the live column minimums, not hardcoded twice: a `useDockCapacity` hook
measures the shell and reports how many panels fit, so changing a clamp cannot desynchronize the
CSS from the behavior.

### The diff inspector

The inspector currently widens the repository sidebar to `min(920px, 100vw - 12px)`
([globals.css](../src/app/globals.css#L309), ~line 309), which directly contradicts a 480px clamp
on that column. It gets its own rule rather than an exception:

- **≥ 960px:** the inspector opens as a **second pane inside the repository column**, which grows
  to `repositoryWidth + inspectorWidth`, clamped so the canvas column stays ≥ 360px and the
  conversation panel keeps its width. If that clamp cannot be met, the conversation panel closes
  first, and only then is the inspector width reduced.
- **< 960px:** the inspector **replaces** the file list within the repository column at the
  column's current width. The existing close control is the way back, so no new affordance is
  needed.

The 920px sidebar rule is deleted in both cases. The inspector never widens a column past what
the canvas minimum allows.

### Concrete changes

1. Give `.app-shell` a named grid:
   `grid-template-columns: [rail] auto [canvas] minmax(360px, 1fr) [dock] auto` with side columns
   collapsing to `0` when closed, and `grid-template-areas` naming `header`, `rail`, `canvas`,
   `dock`. The header spans `grid-column: 1 / -1`. The welcome, fatal-empty, and app-loading
   states occupy the `canvas` area so they inherit the same reflow as the canvas rather than
   needing their own margin rules. Delete the `margin-left: 340px` compensation on all three
   selectors and the `position: fixed` on the sidebar.
2. Move the conversation drawer and diagram navigator into the `dock` column. They share the
   column and remain mutually exclusive, as they are today. Below 640px they stay overlays,
   because there is no room to dock — that is the one case where covering the canvas is correct.
3. Add a drag handle on the inner edge of each side panel. Clamp the repository panel to 268–480px
   and the conversation panel to 320–560px, and clamp both so the canvas column never falls below
   360px. Handles are keyboard-operable with arrow keys and expose `role="separator"` with
   `aria-valuenow`, `aria-valuemin`, and `aria-valuemax`.
4. Persist both widths in `localStorage` under `code-ai:panel-widths`, wrapped in `try/catch`
   like the theme preference. A stored width outside its clamp is clamped on read, not rejected.
5. Publish canvas insets as custom properties on the canvas stage —
   `--canvas-inset-top/right/bottom/left` — measured from the floating chrome with a
   `ResizeObserver`, so a wrapped toolbar or a widened zoom cluster updates them.
6. Rewrite `fit()` to fit the **visible rect**, not the element rect, replacing the `0.86`
   constant. Asymmetric insets shift the visible center, so the fit must both scale to the
   inset-reduced box *and* translate pan by half the inset difference on each axis
   (`(left - right) / 2`, `(top - bottom) / 2`). Scaling alone leaves the diagram off-center
   whenever the insets are uneven, which they always are.
7. Refit on inset or column change only when the view is already fitted — track whether the user
   has panned or zoomed since the last `fit()`. An explicit pan or zoom is a deliberate choice and
   survives a panel resize; an untouched fitted view follows the new geometry. Debounce refits
   during a drag to one per animation frame.
8. Lift `focusMode` from `CanvasWorkspace` into `AppShell` beside the other panel state, so one
   place owns which regions are visible. Focus mode collapses both side columns rather than
   fixed-positioning the canvas over everything.
9. Retire the **Ask Claude…** pill. Its three jobs move to surfaces that do not cover the diagram:
   run status and pending-approval count to the header state pill, unread count to the
   conversation panel toggle, and the attachment chip into the composer where the attachment
   actually is. Opening the conversation is the panel toggle.

### Type contract

```ts
// src/features/shell/usePanelLayout.ts
export interface PanelLayout {
  repositoryOpen: boolean;
  conversationOpen: boolean;   // replaces chatOpen
  historyOpen: boolean;        // shares the dock column with conversation
  inspectorOpen: boolean;      // second pane in the rail column, or replaces it below 960px
  focusMode: boolean;          // collapses both side columns
  repositoryWidth: number;     // 268–480, persisted, clamped on read
  conversationWidth: number;   // 320–560, persisted, clamped on read
}

/** How many side panels the current viewport can dock. Derived from live column minimums. */
export type DockCapacity = 0 | 1 | 2;
export function useDockCapacity(): DockCapacity;

// Set on the canvas stage element by a ResizeObserver over the floating chrome; read by fit().
// --canvas-inset-top | --canvas-inset-right | --canvas-inset-bottom | --canvas-inset-left
```

---

## Acceptance criteria

- [x] Opening either side panel reflows the canvas; no panel overlaps the sheet at ≥ 640px.
- [x] With both panels open on a sequence diagram, no participant box, lifeline label, or message
  label is covered by the toolbar, the zoom controls, or a panel.
- [x] **Fit** places the whole diagram inside the visible canvas rect, *centered within it*, in
  all four open/closed combinations — no node ends up under the toolbar or the zoom controls, and
  the diagram is not offset toward the side with the smaller inset.
- [x] Between 640 and 959px exactly one panel docks; opening the second closes the first. Below
  640px both overlay. At ≥ 960px both dock.
- [x] The diff inspector never pushes the canvas column below 360px at any viewport, and the
  `min(920px, …)` sidebar rule is gone.
- [x] Both panels resize by drag and by keyboard within their clamps; the canvas column never
  drops below 360px; widths survive reload and out-of-range stored widths are clamped, not
  discarded.
- [x] A fitted view refits when a panel resizes; a view the user has panned or zoomed keeps its
  pan and zoom.
- [x] Focus mode collapses both side columns and restores the previous widths on exit.
- [x] The welcome, fatal-empty, and loading states occupy the canvas area and reflow with it.
- [x] The conversation and history panels remain mutually exclusive and keep their current
  open/close entry points.
- [x] Run status, pending approvals, and unread count remain visible from the canvas with the
  conversation closed, without the ask pill.
- [x] `npm test`, `npm run lint`, `npm run build`, and `npm run test:e2e` pass, with the Playwright
  canvas scenario extended to assert the diagram bounding box sits inside the visible canvas rect
  with both panels open.

Shipped August 28, 2026. Shell ownership and persisted widths live in
[usePanelLayout.ts](../src/features/shell/usePanelLayout.ts), with pure clamps and capacity math in
[panelLayout.ts](../src/features/shell/panelLayout.ts). The stage publishes measured chrome insets
and fits against them in
[DiagramCanvas.tsx](../src/features/diagram/components/DiagramCanvas.tsx). Verification passes
with 151 Vitest tests, strict TypeScript, the default production build, and all six Playwright
scenarios; the browser suite covers both docked panels, centered visible-rect fitting, keyboard
resizing and persistence, focus collapse, and the 640/960px responsive bands.

## Out of scope

- Making the panels detachable, stackable, or reorderable.
- A resizable *bottom* panel for the diff inspector, and an independently draggable width for the
  inspector pane. It sizes with the repository column under the rules above.
- Changing what any panel contains. This story moves and sizes them only.
- Typefaces, palette, header layout, and the run ribbon —
  [Story 32](STORY-20260828-visual-language.md).

## How to verify

1. `npm test && npm run lint && npm run build && npm run test:e2e`.
2. Open a project with uncommitted changes and ask for a sequence diagram.
3. With both panels open, confirm the full diagram is visible and nothing is covered. Press
   **Fit** in each of the four open/closed combinations and confirm the diagram lands inside the
   visible area and is centered in it every time — the toolbar inset on the left must not push
   the diagram right.
4. Drag each panel edge to both clamps and confirm the canvas never collapses past 360px. Reload
   and confirm the widths return.
5. Press **Fit**, then drag a panel edge: the view refits. Pan the canvas, then drag again: the
   pan is preserved.
6. Open a file's diff with both panels open and confirm the canvas still holds ≥ 360px.
7. Start a run with the conversation closed and confirm status, approvals, and unread are still
   readable from the canvas.
8. Resize the window through 960px and 640px and confirm the three bands behave as specified.
