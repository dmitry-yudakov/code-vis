# Story 46 — Arrange a comfortable VR workspace

**Status:** In progress · **Type:** Frontend-only · **Depends on:**
[Story 45](STORY-20260905-application-vr-shell.md).

**Vision slice:** [immersive workspace epic](EPIC-20260905-immersive-workspace.md), the device-owned
views and layout of [the vision](../docs/vision.md#surfaces-web-desktop-vr).

## Motivation

A fixed diagram and chat pair cannot accommodate the tools needed to work. Users need readable
panels they can place, resize, hide, and recover without losing focus or needing to walk.
The user chose movable panels plus real 3D diagrams with controllers; a seated arrangement is the
initial implementation default, with physical acceptance to be recorded on Quest 3S.

## Implementation (where the code is)

- [workspaceLayout.ts:15](../src/features/shell/immersive/workspaceLayout.ts#L15) defines forward
  placement bounds, size presets, and version 1 slot migration to the version 2 layout.
- [useImmersiveLayout.ts:9](../src/features/shell/immersive/useImmersiveLayout.ts#L9) persists at most
  100 machine/project/session views in device storage, independently of desktop/canonical state.
- [WorkspacePanel.tsx](../src/features/shell/immersive/WorkspacePanel.tsx) supplies rounded panel chrome,
  the lower Control Bar (Move, panel name, Size, Close), ray-hover tooltips, and a preset size menu.
  Content stays visible but inactive while dragging.
- [usePanelDrag.ts:7](../src/features/shell/immersive/usePanelDrag.ts#L7) owns capture, preview,
  release/cancellation, and unmount cleanup;
  [panelDrag.ts:7](../src/features/shell/immersive/panelDrag.ts#L7) converts controller rays to bounded placement with 4× depth gain.
- [ImmersiveWorkspace.tsx:112](../src/features/shell/immersive/ImmersiveWorkspace.tsx#L112) composes
  four tools, a protected status/recovery strip, resource ownership, and viewer-relative re-entry.
- [AppShell.tsx:232](../src/features/shell/AppShell.tsx#L232) owns the shared repository controller;
  [useRepositoryDiff.ts:7](../src/features/repository/useRepositoryDiff.ts#L7) scopes/aborts diff reads.
- [workspaceText.ts:4](../src/features/shell/immersive/workspaceText.ts#L4) wraps prose/code and diffs;
  [workspaceResources.ts:119](../src/features/shell/immersive/workspaceResources.ts#L119) rasterizes a
  single evidence page. The existing immersive ledger enforces the aggregate texture ceiling.
- [immersiveLayout.test.ts:1](../test/immersiveLayout.test.ts#L1) verifies layout recovery/bounds and
  complete text paging; [immersive.spec.ts:331](../e2e/immersive.spec.ts#L331) exercises real scene
  controls, persistence, isolation, delayed responses, and repeated resource disposal.

## Desired behavior

1. Establish a small common panel/control system for conversation, canvas, evidence, and session
   controls, reusable by the later Arena.
   Start with a comfortable seated arrangement. Panels have a title, visible focus, labelled
   and a compact Control Bar beneath the frame with Move, panel name, Size, and Close plus
   ray-hover tooltips.
   Distance and size stay bounded. No required action is behind the user.
2. Hold the controller trigger on a labelled drag handle to move a panel continuously left/right,
   up/down, and nearer/farther by moving the controller in space. Release to save the placement;
   cancellation restores the previous placement. Moving a panel and manipulating its diagram
   use distinct handles; hover cannot send text or answer an approval.
   Push/pull uses 4× depth gain over a 2.0–4.5 m range; sideways and vertical movement retain their
   existing sensitivity. The lower control strip and the workspace recovery controls stay reachable.
3. Provide **Reset workspace** and a tool list to recover hidden or misplaced panels. Opening a tool
   never obscures Exit or a pending decision. Content updates do not move panels or steal focus.
4. Persist bounded, versioned immersive layout separately from desktop camera/placement state,
   keyed by device and machine-qualified view identities. Store deliberate placement relative to a
   resettable workspace origin, never raw tracking. Corrupt/missing state restores usable defaults;
   re-entry places the restored layout safely in front of the current viewer.
5. Bound the number of live detailed panels (initial proposal: four within the active session).
   Budget textures/text/geometry across the entire scene, virtualize long content, and
   dispose closed surfaces. Re-budget against actual headset measurements before marking accepted.
6. Choose physical text sizes, distance/scale bounds, and interaction targets using the reference
   headset; record values and the reading fixture here. Selected prose, code, and action labels must
   be readable from the default seat without leaning. No forced locomotion or animated camera motion.

## Acceptance criteria

Implementation scope (revised September 10): reuse the persistent shell and its controller ray/select path.
Provide four panels with continuous bounded placement in front of a resettable, eye-height workspace
origin. Replace directional/nudge buttons with a captured drag handle and a Size menu containing
Small, Medium, Large, and Extra large presets. Keep content visible but inactive during dragging;
do not write tracking or intermediate drag frames to storage. Migrate the existing slot layout to
the new versioned placement format. Keep Exit, Reset workspace, the tool list, and pending
approval status in a separate nearer strip. Store only deliberate layout in a versioned device
record keyed by machine/project/session; re-entry and reset use the current viewer's direction.
Reuse repository status/diff controllers from the shell for a paged read-only evidence surface;
full review/annotation actions remain Story 49. Closed surfaces unmount their derived resources.
Keep an aggregate 5,592,405-pixel ceiling, including 4/3 mip chains, and document each allocation and provisional
physical size. Physical sizing, comfort, and controller acceptance remain pending Quest 3S use;
Story 45's outstanding hardware verification does not prevent this implementation work.

- [x] Every panel has a labelled drag handle and a Size menu with Small/Medium/Large/Extra large;
  directional and incremental panel resize buttons are removed.
- [x] Move, the 600-weight panel name, Size, and Close sit in a compact Control Bar below the panel, with legible hover
  tooltips that do not intercept rays or trigger actions; labels remain available to semantic controls.
- [x] A 10 cm push/pull changes depth by about 40 cm, within 2.0–4.5 m bounds, without amplifying
  sideways or vertical movement, or changing placement when first grabbed.
- [x] A captured drag moves continuously in angle, height, and depth, including outside the handle;
  release saves once, cancellation/reset/exit/navigation discards the preview and releases capture.
- [x] Panel movement cannot trigger a content action; live updates preserve focus and placement.
- [ ] Conversation, a diagram, and a diff can be read in one seated arrangement with Exit accessible.
- [x] Layout round-trips per device without changing canonical exports or desktop Spatial state;
  existing slot layouts migrate, and corrupt data or a changed seating direction recover safely.
- [x] Hidden/closed surfaces respect a documented aggregate resource budget, including repeated
  open/close/reset cycles; no unbounded high-resolution background panels remain live.
- [ ] Actual headset reading and controller checks record chosen sizing/bounds and user comfort;
  synthetic pointer tests cover actions but are not counted as physical validation.
- [x] `npm run lint`, `npm test`, `npm run build`, and `npm run test:e2e` pass.

## Out of scope

Room mapping, teleportation, shared layouts, and headset telemetry storage. Individual tools gain
their operational features in Stories 47–49; real diagram geometry is Story 50.

## How to verify

1. In automated coverage, exercise panel actions and invalid stored layouts; compare canonical
   exports and desktop views before/after. Verify ray hover does nothing, drag capture survives
   leaving the handle, controller translation changes depth, cancellation preserves saved placement,
   and dragging cannot activate content. Exercise every size preset and migration from slot records.
2. In the headset, read a representative paragraph, a code block, a diff, and diagram labels;
   arrange the tools while seated, hide/recover one, and re-enter facing a different direction.
3. Stream content while moving/focusing tools, repeat open/close twenty times, inspect aggregate
   counters, and run the four repository checks. Record headset versions and selected layout values.

## Verification record

September 10, 2026 — toolbar and depth refinement.

- Drag, Size, and Close now use icons in a shared pill beneath each panel. Hover shows a tooltip;
  moving away hides it. The icon textures contain only glyphs, preserving the continuous toolbar
  background. The recovery strip sits lower to leave the default panel toolbars accessible.
- Push/pull uses 4× depth gain over 2.0–4.5 m. Tests verify that 10 cm of controller movement
  produces about 40 cm of depth change, respects both bounds, leaves lateral/vertical sensitivity
  unchanged, and does not jump on grab. These gains and distances remain provisional for headset feel.
- `npm run lint`, the production build, **271 Vitest tests in 46 files**, and **35 Chrome tests**
  pass. Scene coverage verifies all three icon targets below each frame, tooltip show/hide without
  actions, dragging and size selection, closing via the icon, recovery, and bounded resource reuse.
- The synthetic browser ray targets a point inside an icon triangle, avoiding the floating-point
  edge case at the exact shared seam of a quad. Screenshots were inspected:
  `test-results/vr-panel-toolbar.png` and `test-results/vr-panel-size-menu.png`.

September 10, 2026 — replaced panel nudge controls with a drag handle and size presets.

- Typecheck and production build pass; **270 Vitest tests in 46 files** pass. The full Chrome
  suite passes **35 tests**; the four panel interaction/resource checks also pass after the final
  handle-anchoring refinement. Playwright required access outside the sandbox to start its server.
- Scene checks cover all panels, the four size presets, release outside the handle, cancellation,
  Reset workspace, system exit, and navigation while holding a panel. Capture is released and
  cancelled previews do not replace saved placement. Content actions are blocked during dragging.
- Ray math tests cover physical push/pull, recentered coordinates, bounds, and keeping the grabbed
  handle point under the ray while the panel turns. Slot-format migration and device/canonical
  isolation remain covered. No headset tracking or intermediate drag frames are persisted.
- Screenshots: `test-results/vr-panel-drag-handle.png` and `test-results/vr-panel-size-menu.png`.
  Physical controller feel, readable sizing, and seated comfort still require Quest 3S acceptance.

September 9, 2026 — implementation verified locally; physical Quest 3S acceptance remains pending.

- `npm run lint` and `npm run build` pass; `npm test` passes **261 tests in 46 files**;
  `npm run test:e2e` passes **34 Chrome tests**. Build verification required network access for
  the existing Google Fonts. Synthetic XR results below do not substitute for headset use.

- Synthetic browser checks exercise all four panels, actual world-mesh ray clicks and hover,
  separate movement/resize actions, close/recovery, reload, corrupt layout, navigation across
  machine identities, and re-entry at a changed camera position/direction. Streaming preserves
  deliberately selected panel focus/layout. Pending/late diff reads cannot populate another session.
- Twenty close/open/reset cycles keep four or fewer detailed panels live. Closed-panel resources
  are disposed, and XR exit returns tracked resource counts to zero. DOM and Evidence share one
  selected-file read; paging, movement, and reopen cycles do not issue duplicate diff requests.
- The browser reading fixture contains prose, indented TypeScript, a three-node Mermaid flowchart,
  and staged/working-tree patch text. Screenshots are produced in `test-results/vr-*-panel.png`.
  This fixture caught a pre-existing omission of small active diagrams: their native short edge
  is now upscaled to 128 pixels within the same edge/pixel budget instead of being discarded.
  The immersive canvas also preserves the native diagram aspect ratio inside its bounded frame.

### Provisional physical sizing and allocation

These are implementation values, **not headset measurements or a comfort claim**.

| Item | Value |
|---|---|
| Panel frame | 1.4 × 1.8 m; Small 0.85×, Medium 1× (default), Large 1.15×, Extra large 1.3×; uniform scale preserves text and diagram proportions |
| Forward placement | Defaults −57°, −19°, +19°, +57°; continuous drag within −65°…+65°, without moving neighboring panels |
| Distance/height | Default 2.6 m; continuous distance 2.0–4.5 m with 4× push/pull gain; height −0.3…+0.5 m; panels may deliberately overlap and Reset recovers the default arrangement |
| Reset origin | Current eye position and horizontal viewing direction; no tracking is stored |
| Recovery strip | 1.3 m ahead, 1.45 m below eye height, lowered to leave the panel toolbars clear in the default arrangement |
| Panel Control Bar | 0.94 m pill, 12 dp below the panel; Move, 14 dp panel name, Size, and Close; 48 dp icon targets before panel scale |
| Control targets | Icon circles and labelled pills are 48 dp tall before panel scale |
| Text | Inter 18 dp conversation body; Geist Mono 16 dp diff body; about 46 columns derived from content width |
| Paged content | Conversation is virtualized; diff lines per page derive from the available content height; launcher ≤4 rows |
| Canvas allocation | ≤800,000 base texels across the active/comparison canvases, edge ≤2,048 pixels |
| Conversation / Evidence | 1,048,576 / 786,432 base texels, one raster page per open surface, with 4/3 mip chains |
| Global controls and status | Bounded shared icon/label textures; recovery actions remain available with all panels closed |
| Panel chrome | Geometry and solid-color materials; no texture allocation for the rounded surface, focus outline, or Control Bar pill |
| Aggregate | Ledger ceiling 5,592,405 logical texels including mipmaps; every tracked mipmapped texture is charged at 4/3 of its base texels |

The cap covers application-owned surface textures; native XR eye framebuffers and controller
rendering still require hardware measurements. Geometry/material counts are bounded by four fixed
panel types and four launcher rows, with per-mount ledgers and no closed-content cache.

**Pending physical verification:** record Quest 3S browser/runtime versions; enter from Arena and an
empty session; navigate across projects/machines without ending XR (Story 45 smoke check); read the
fixture while seated, arrange/recover tools with controllers, re-enter facing another direction,
and record comfort, frame timing, and chosen sizing. Adjust these provisional values against that
evidence. The seated-reading and physical-controller criteria remain unchecked and this story
remains In progress until the hardware checks pass.
