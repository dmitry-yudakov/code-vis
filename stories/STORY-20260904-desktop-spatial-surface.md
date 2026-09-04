# Story 43 — Project a session into a desktop spatial room

**Status:** Shipped · **Type:** Frontend-only ·
**Depends on:** [Story 18](STORY-20260805-web2-agent-mermaid-canvas.md) (the current root session
canvas; its remaining manual experiment evidence stays independent),
[Story 22](STORY-20260807-web2-sketch-canvas.md) (sketch artifacts, shipped),
[Story 30](STORY-20260828-theme-switch.md) (device-owned themes and explicit Mermaid rendering,
shipped), [Story 31](STORY-20260828-dock-canvas-panels.md) (the unobstructed session canvas,
shipped), [Story 36](STORY-20260830-multi-session-workspace.md) (device-owned session views,
shipped), and [Story 42](STORY-20260904-second-execution-machine.md) (machine-qualified remote
views, shipped)

**Vision context:** step 9, “Spatial surfaces,” in [vision.md](../docs/vision.md#sequence), and the
first step of the pragmatic rollout in
[multi-project-session-environment.md](../docs/multi-project-session-environment.md#mermaid-across-2d-and-3d).
This is a delivery spike before the north-star roadmap's model-native
[Story 12](EPIC-20260705-north-star-roadmap.md#proposed-stories-to-be-written): it proves the spatial
surface with today's canonical Mermaid and sketch artifacts, but does not claim that later story's
real 3D entities, relations, regions, or provenance materials.

---

## Motivation

CodeAI can now keep several sessions visible, run turns concurrently, surface attention in the
Arena, and reach sessions from personal devices and a second execution machine. The next vision
step is spatial, but the product has not yet answered the smallest practical question behind it:
can the existing session canvas become a useful, reliable 3D surface without inventing a second
artifact format or weakening the flat workspace?

Today a person can inspect only one diagram or sketch at a time. Other artifacts are names in the
history drawer, so comparing a sequence or a set of alternatives means repeatedly replacing the
active canvas. This story places a bounded set of those same artifacts together in a desktop 3D
room. It is intentionally a projection, not a new document: Mermaid remains canonical, sketches
and annotations remain canonical session content, and camera and panel placement remain disposable
device layout.

The result should be useful enough to compare diagrams and arrange a working set, while remaining
small enough to reveal whether React Three Fiber, textured SVG panels, navigation, accessibility,
and resource limits are credible before CodeAI attempts native 3D graphs or WebXR.

---

## Shipped implementation (where the code is)

- Projection switch and shell integration:
  [CanvasWorkspace.tsx](../src/features/diagram/components/CanvasWorkspace.tsx#L98) keeps the shared
  top bar, Run Ribbon, title block, focus behavior, and empty Flat experience while mounting the
  spatial boundary only for a non-empty Spatial view;
  [AppShell.tsx](../src/features/shell/AppShell.tsx#L1618) connects that surface to the existing
  selection and machine/project/session-qualified device view.
- Bounded pure state and layout:
  [workspaceViews.ts](../src/features/shell/workspaceViews.ts#L21) owns and validates surface,
  camera, and placement state, and
  [spatialModel.ts](../src/features/diagram/spatial/spatialModel.ts#L5) owns the 12-panel selection,
  chronological arrangement, initial camera, physical sizing, digest, and pixel allocation rules.
- Optional browser renderer:
  [SpatialBoundary.tsx](../src/features/diagram/spatial/SpatialBoundary.tsx#L7) is the eager
  capability/error boundary around the client-only dynamic import, while
  [SpatialRoom.tsx](../src/features/diagram/spatial/SpatialRoom.tsx#L166) owns the demand-rendered R3F
  scene, pointer interaction, accessible list, keyboard shortcuts, and labelled camera/arrangement
  controls.
- Disposable panel pixels:
  [panelResources.ts](../src/features/diagram/spatial/panelResources.ts#L13) builds current-theme SVG
  panel textures from the policy-checked Mermaid renderer and the common mark compositor;
  [resourceLedger.ts](../src/features/diagram/spatial/resourceLedger.ts#L52) instruments and releases
  every module-owned URL, texture, material, and geometry.
- Verification:
  [spatialModel.test.ts](../test/spatialModel.test.ts#L27) covers selection, layout, budgets, and the
  resource ledger; [workspaceViews.test.ts](../test/workspaceViews.test.ts#L131) covers bounded
  storage/reconciliation/reset; and [canvas.spec.ts](../e2e/canvas.spec.ts#L242) covers lazy entry,
  the 13-target fixture, navigation, restoration, themes, failure seams, demand rendering, cleanup,
  and the unchanged Flat fallback.
- Dependencies: [package.json](../package.json#L27) and the npm lockfile pin compatible Three.js,
  React Three Fiber, and drei packages. No server or shared wire type imports them.

---

## Desired behavior

### A. Flat and Spatial are two projections of one session

1. When a session contains at least one diagram or sketch, its canvas top bar offers a two-option
   **Flat / Spatial** surface control. Flat remains the default for existing and new device views.
   Empty sessions keep today's empty-canvas experience and do not eagerly load spatial code.
2. Spatial replaces only the central canvas renderer. The session tabs, repository and conversation
   rails, Run Ribbon, title block, permissions, and agent activity remain usable. Focus mode keeps
   its current meaning and hides the rails around either projection.
3. The room contains at most `MAX_SPATIAL_PANELS = 12` canvas targets from the focused session. It
   always contains the active target, fills the remaining slots with the most recently created
   targets, and orders the selected set by `createdAt`, then target id as a stable tie-breaker. That
   order is shared by the DOM panel list and the physical left-to-right slots. If more targets
   exist, the controls state how many are omitted; history remains the route to any omitted target.
4. Each panel names its diagram or sketch ordinal. Within the texture budget it renders the same
   content visible in Flat: current-theme Mermaid SVG or the sketch sheet, plus its durable marks.
   A target omitted from the pixel budget remains a labelled panel that states its preview was
   omitted and offers **Open in Flat**. A non-ready or independently unrenderable diagram becomes a
   labelled error panel; one bad target never prevents the rest of the room from opening.
5. Selecting a panel updates the session view's active canvas through the existing selection path.
   **Open in Flat** switches projections without creating, revising, or copying an artifact. A
   running agent may add a diagram while Spatial is open; the bounded room updates without resetting
   the user's camera or placements, and the existing active-canvas preservation rule still applies.
6. Spatial is view-only for artifact content in this slice. The user can open the selected panel in
   Flat to draw or edit marks. Spatial may display selection and mark counts, but it must not present
   a drawing tool that appears to edit canonical annotations.

### B. Desktop spatial navigation is useful with mouse, touch, and keyboard

7. The initial room is a deterministic, shallow chronological arc of upright panels centered in the
   scene; stable panel order comes from rule 3. Panel aspect ratios follow their view boxes, but
   physical dimensions are clamped so an extreme Mermaid diagram cannot dominate the room. The
   initial camera targets the active panel even when it is not the middle chronological slot, and
   the active panel is visibly selected using the semantic plot tokens.
8. Pointer drag on the background orbits, wheel/pinch dollies, and a dedicated control pans. A
   single click/tap selects a panel; double-click/tap or **Focus selected** moves the camera to a
   readable frontal view. **Reset room** restores the deterministic camera and panel arrangement.
9. **Arrange** exposes movement for the selected panel. Pointer controls can translate it within a
   bounded room and rotate it around the vertical axis. Equivalent labelled buttons nudge left,
   right, up, down, forward, back, and rotate in either direction, so placement does not require a
   precision pointer or an unlabeled 3D gizmo.
10. A DOM control surface mirrors the panels as a labelled listbox. Arrow keys move selection;
    Enter focuses; **Open in Flat** is an ordinary button. Labelled camera controls and shortcuts
    provide orbit left/right/up/down, pan left/right/up/down, dolly in/out, focus, and reset without
    requiring pointer gestures. The WebGL canvas has an accessible name, visible instructions, and
    no essential state is communicated by depth, motion, or color alone. Camera transitions become
    immediate when `prefers-reduced-motion` is active.

### C. Spatial layout belongs only to this device view

11. The chosen surface, spatial camera, and explicit panel placements are additive fields on the
    existing `DeviceViewState`. They are parsed, finite, clamped, count-bounded, and stored under the
    existing machine/project/session-qualified device scope. Unknown, malformed, or excessive
    values fall back independently instead of invalidating the rest of the workspace record.
12. Switching sessions restores each session view's last projection and spatial layout. Reloading
    restores them on the same browser. A second browser or device gets Flat and the deterministic
    room defaults. No camera, placement, or surface preference is written to `SessionSnapshot`, a
    server route, an exported session, or an agent message.
13. Placement is keyed by canvas target id. Targets not in the bounded room retain their bounded
    device placement for later; ids no longer present in the reconciled session are discarded.
    **Reset room** removes both `spatial.camera` and every explicit placement for the focused
    session, applies the deterministic defaults immediately, and does not change the selected
    surface or active target. Reloading after a reset must restore those defaults, not the old
    camera.

### Device type contract

```ts
export type CanvasSurface = 'flat' | 'spatial';

export interface SpatialPose {
  position: [number, number, number];
  rotationY: number;
}

export interface SpatialCameraState {
  position: [number, number, number];
  target: [number, number, number];
}

export interface SpatialViewState {
  camera?: SpatialCameraState;
  placements: Record<string, SpatialPose>;
}

export interface DeviceViewState {
  // existing fields stay unchanged
  surface?: CanvasSurface; // omitted means 'flat'
  spatial?: SpatialViewState;
}
```

Coordinates and rotations are renderer units, not document geometry. The parser accepts only
finite tuples, clamps coordinates to the room bounds and rotation to one turn, and keeps at most
the existing `MAX_CANVAS_VIEWS` number of placement entries. These types stay in the browser-owned
`workspaceViews.ts`; they do not move to `src/shared` because no server or wire contract consumes
them.

### D. The renderer is isolated, bounded, and safely optional

14. Add compatible `three`, `@react-three/fiber`, and `@react-three/drei` dependencies and commit
    the npm lockfile. Three.js, R3F/drei, SVG rasterization, and the WebGL scene are loaded through a
    client-only dynamic boundary. Only the lightweight Flat/Spatial control, non-lazy parent
    capability/error fallback, and pure device-state helpers may load eagerly. A Flat-only page load
    must not evaluate the heavy spatial module, construct a WebGL context, render hidden canvases,
    or fetch the spatial application chunk before the user first chooses Spatial.
15. Add a browser-only spatial feature under `src/features/diagram/spatial/`. Keep deterministic
    target selection/default arrangement and device-state validation in pure modules; keep WebGL,
    texture allocation, and browser feature detection out of `src/shared` and server imports.
16. Panel pixels are derived, disposable renderer state. Build them from the already-policy-checked
    Mermaid render plus marks serialized by the common annotation helper. Rasterization preserves
    aspect ratio and first caps every candidate at a 2,048-pixel long edge and 2 million base-level
    texels. Mipmaps stay disabled. The active panel keeps that capped size; all other candidates
    receive one deterministic common downscale so the sum of active plus remaining live textures is
    at most 16 million base-level texels. If a panel's shorter edge would fall below 128 pixels, it
    uses a semantic labelled placeholder instead of a texture. Old resources are released before a
    theme-wide replacement allocation, so pending and live generations never transiently exceed
    the same aggregate budget. Cleanup revokes each object URL, clears image handlers/src and
    references, and calls `.dispose()` exactly once on every texture, material, and geometry after
    replacement or unmount.
17. Use the semantic palette directly for the room, frames, selection, labels, and fallback panels.
    A theme change rerenders visible panel textures and room materials without changing the camera,
    selection, placements, canonical Mermaid, or the theme-independent light composite attached to
    agent messages.
18. Render on demand rather than running an idle animation loop. Camera interaction, selection,
    arrangement, resize, activity changes, and theme changes invalidate the scene; an untouched
    room settles to no continuous frames. Context loss, texture failure, dynamic-import failure, or
    absent WebGL is contained by a non-lazy parent capability/error boundary with a clear
    **Return to Flat** action.
19. The first implementation may use the current renderer's SVG output for every Mermaid grammar;
    it must not parse Mermaid's private SVG DOM into supposed entities or persist a derived graph.
    The cache key includes canvas id, a stable digest of source/view box/marks, resolved theme, and
    a local renderer version so stale pixels cannot masquerade as current work.
20. Every font, image, shader, environment, and label asset used by Spatial is bundled locally or
    generated from session data. Entering Spatial makes no request to a font CDN, image host, shader
    host, or other external origin.

### E. Verification protects the existing product

21. Pure unit tests cover bounded target selection, deterministic arrangement, camera/pose parsing,
    placement reconciliation, reset behavior, and default-Flat compatibility with existing stored
    workspaces. Browser-level tests cover lazy loading, selection/focus, Flat round-trip, same-device
    restoration, second-device defaults, dark-theme repaint, reduced motion, one failed diagram,
    WebGL unavailability, and return to the unchanged Flat canvas.
22. The spatial module exposes inert test instrumentation for its own module evaluation, scene
    frames, object URLs, textures, materials, geometries, and logical texture pixels. Unit tests
    exercise the resource ledger. Playwright confirms the module-evaluation sentinel and spatial
    chunk request are absent before entry and present after entry; confirms the spatial frame count
    stops increasing after controls settle; and confirms all live-resource counters return to the
    pre-entry baseline after replacement and unmount. Browser seams inject capability and texture
    failures. Dynamic-import failure is exercised by aborting the post-click spatial chunk, and
    context loss uses `webglcontextlost` or `WEBGL_lose_context`; each must reach the parent-owned
    **Return to Flat** fallback.
23. Extend the offline fake provider with a deterministic Spatial-fixture instruction that emits
    eight diagrams, including one non-ready artifact. The browser test creates five sketches through
    the real UI to exceed the twelve-panel bound, explicitly selects the non-ready artifact before
    entering Spatial so it cannot be omitted, and uses the injected texture seam for a different
    visible, ready target. No production-only seed route is added.
24. Shipping updates the README/architecture surface description, the spatial rollout notes if the
    implementation changes them, this story's actual file anchors and constraints, and the `Now`
    block in `AGENTS.md`. The story becomes Shipped only after every criterion and the verification
    below pass.

---

## Acceptance criteria

- [x] A session with canvas targets can switch between Flat and a client-only, code-split Spatial
      projection; Flat remains the default and an empty session loads no spatial runtime.
- [x] Spatial shows the active target plus a deterministic bounded working set of up to 12 diagrams
      and sketches. Admitted textures include current-theme content and durable marks; budget-
      omitted previews and bad diagrams remain labelled, actionable panels instead of room-wide
      failures.
- [x] Selection, focus, orbit/pan/dolly, reset, and bounded panel arrangement work without disrupting
      the surrounding session shell, running turns, permissions, or active-canvas preservation.
- [x] A labelled DOM panel list and ordinary controls provide keyboard equivalents for selection,
      focus, opening Flat, camera orbit/pan/dolly/reset, panel translation, and rotation;
      reduced-motion mode has no animated camera transitions.
- [x] Surface choice, camera, and placements restore per machine/project/session-qualified device
      view, are validated and bounded, and never enter canonical session records, exports, requests,
      or agent context.
- [x] Three.js, R3F/drei, SVG rasterization, and WebGL scene code stay behind the dynamic boundary;
      only the lightweight control/fallback and pure state helpers load eagerly. A Flat-only load has
      no WebGL context or spatial chunk request, and unsupported/lost WebGL returns safely to Flat.
- [x] Panel rasterization obeys the per-texture and aggregate budgets, renders only on invalidation,
      and module-owned automated instrumentation verifies that scene frames settle and
      replaced/unmounted GPU and browser resources are logically released.
- [x] Light/dark switching updates the spatial surface without changing layout or the stable light
      attachment payload agents receive.
- [x] Spatial uses only local or generated assets and makes no external request on first load.
- [x] Unit and Playwright coverage exercises the pure layout/storage rules and the critical browser
      paths, while all existing Flat canvas behavior remains green.
- [x] Documentation and status files describe the spatial projection that actually shipped and
      preserve the boundary with model-native Story 12 and immersive Story 13.
- [x] `npm run lint`, `npm test`, `npm run build`, and `npm run test:e2e` pass.

## Out of scope

- Native 3D Mermaid nodes, edges, groups, evidence selection, model entities/relations, lenses,
  arrangement regions, or provenance materials. Those remain the north-star roadmap's Stories
  6–12; this story deliberately renders a bounded artifact as a panel.
- WebXR, headset controllers, hand tracking, room-scale movement, stereoscopic performance work, or
  Quest support. Those belong to Story 13 after the desktop surface has evidence.
- A spatial Arena containing several sessions, cross-project or cross-machine rooms, background
  session previews, durable workspace identity, coordinator continuity, shared placement, links, or
  multi-person presence.
- Editing Mermaid, drawing marks, or creating artifacts in Spatial. Existing Flat and conversation
  flows remain the content-authoring surfaces.
- Persisting rasterized SVG, textures, generated room geometry, camera, or placement in canonical
  host records. Renderer caches are memory-only and disposable.
- Replacing the Flat renderer, changing Mermaid policy, renaming the historical
  `activeDiagramId`/`diagramId` compatibility fields, or changing provider prompts and attachment
  contracts.

## How to verify

1. Install from the committed lockfile, run `npm run dev`, invoke the Spatial instruction added to
   the offline fake provider to create eight diagrams including one non-ready artifact, then create
   five sketches through the UI. Add annotations and at least one agent-produced revision, then
   select the non-ready artifact as active before entering Spatial. Confirm Flat behaves exactly as
   before.
2. Open Spatial. Confirm only its dynamic chunk and WebGL context appear now; the active target and
   eleven most recent peers form the deterministic room, the omitted count is accurate, marks are
   visible, and the invalid artifact is a labelled panel rather than a room-wide failure.
3. Orbit, pan, dolly, select, focus, move, and rotate panels. Perform camera orbit/pan/dolly/reset,
   selection, focus, every panel nudge, rotation, and **Open in Flat** using only the DOM/keyboard
   controls. Confirm the selected target opens in Flat and returns to the same spatial camera and
   placements. Move the camera and panels again, choose **Reset room**, reload, and confirm the
   deterministic camera and arrangement remain reset.
4. Leave Spatial open while an agent turn streams and produces a diagram. Confirm status and
   permission UI remain operational, the bounded room updates, and existing camera/placement state
   does not jump. Toggle focus mode and both shell rails.
5. Reload and switch between two session tabs to confirm per-view restoration. Open a second browser
   context and confirm it starts Flat with deterministic defaults. Inspect exported session JSON and
   intercepted session/turn requests to confirm they contain no surface, camera, or placement data.
6. Toggle light/dark/system and `prefers-reduced-motion`; confirm textures/materials update, spatial
   layout remains fixed, camera focus is immediate under reduced motion, and a captured agent
   attachment is still the light projection.
7. Exercise the injected unsupported-WebGL and texture-conversion paths, abort the post-click
   spatial chunk request, and trigger synthetic WebGL context loss. Target a visible ready panel for
   the injected texture failure. Each failure must preserve the session and offer **Return to Flat**
   from the non-lazy boundary. Use the module-owned ledger and frame counter across theme changes,
   target replacement, settled idle, and unmount to confirm resource counts return to the pre-entry
   baseline and the scene stops requesting frames. Confirm first Spatial entry makes no request to
   an external origin.
8. Run `npm run lint`, `npm test`, `npm run build`, and `npm run test:e2e`.
