# Story 46 — Arrange a comfortable VR workspace

**Status:** Draft · **Type:** Frontend-only · **Depends on:**
[Story 45](STORY-20260905-application-vr-shell.md).

**Vision slice:** [immersive workspace epic](EPIC-20260905-immersive-workspace.md), the device-owned
views and layout of [the vision](../docs/vision.md#surfaces-web-desktop-vr).

## Motivation

A fixed diagram and chat pair cannot accommodate the tools needed to work. Users need readable
panels they can place, resize, hide, and recover without losing focus or needing to walk.
The user chose movable panels plus real 3D diagrams with controllers; a seated arrangement is the
initial implementation default, tested on Quest 3S.

## Current behavior (where the code is)

- [ImmersiveWorkspace.tsx:244](../src/features/shell/immersive/ImmersiveWorkspace.tsx#L244) fixes diagram
  and conversation positions; its reset/scale controls do not arrange the whole workspace.
- [workspaceViews.ts:36](../src/features/shell/workspaceViews.ts#L36) stores bounded desktop
  Spatial state; [useWorkspaceViews.ts:20](../src/features/shell/useWorkspaceViews.ts#L20) persists
  disposable device views.
- [resourceLedger.ts:103](../src/features/diagram/spatial/resourceLedger.ts#L103) owns derived GPU
  resources; [tokens.ts:1](../src/shared/design/tokens.ts#L1) supplies semantic colors.

## Desired behavior

1. Establish a small common panel/control system for conversation, canvas, evidence, and session
   controls, reusable by the later Arena.
   Start with a comfortable seated arrangement. Panels have a title, visible focus, labelled
   move/resize/close controls, and bounds on distance and size. No required action is behind the user.
2. Controller ray/select must support the complete navigation path. Dragging/grabbing is optional
   convenience beside labelled reposition controls. Moving a panel and manipulating its diagram
   use distinct handles/modes; hover cannot send text or answer an approval.
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

- [ ] The user opens, focuses, moves, resizes, closes, and recovers every panel using labelled actions.
- [ ] Panel movement cannot trigger a content action; live updates preserve focus and placement.
- [ ] Conversation, a diagram, and a diff can be read in one seated arrangement with Exit accessible.
- [ ] Layout round-trips per device without changing canonical exports or desktop Spatial state;
  corrupt data and a changed physical seating direction recover to safe defaults.
- [ ] Hidden/closed surfaces respect a documented aggregate resource budget, including repeated
  open/close/reset cycles; no unbounded high-resolution background panels remain live.
- [ ] Actual headset reading and controller checks record chosen sizing/bounds and user comfort;
  synthetic pointer tests cover actions but are not counted as physical validation.
- [ ] `npm run lint`, `npm test`, `npm run build`, and `npm run test:e2e` pass.

## Out of scope

Room mapping, teleportation, shared layouts, and headset telemetry storage. Individual tools gain
their operational features in Stories 47–49; real diagram geometry is Story 50.

## How to verify

1. In automated coverage, exercise panel actions and invalid stored layouts; compare canonical
   exports and desktop views before/after. Test collisions between drag and button selection.
2. In the headset, read a representative paragraph, a code block, a diff, and diagram labels;
   arrange the tools while seated, hide/recover one, and re-enter facing a different direction.
3. Stream content while moving/focusing tools, repeat open/close twenty times, inspect aggregate
   counters, and run the four repository checks. Record headset versions and selected layout values.

## Verification record

Pending implementation and Quest 3S measurements.
