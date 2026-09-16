# Story 44 — View the active diagram and conversation in immersive WebXR

**Status:** In progress · **Type:** Full-stack (XR client + transport headers) ·
**Depends on:** [Story 43](STORY-20260904-desktop-spatial-surface.md) (the bounded desktop spatial
renderer) and [Story 41](STORY-20260904-authenticated-devices.md) (paired personal-device HTTPS)

**Scope review — 2026-09-05:** This implements an immersive **viewer**, not the full VR workspace
the user intended. Entry is nested under a non-empty Spatial canvas; conversation is read-only;
session navigation ends XR; composing, approvals, the Arena, and repository review remain outside
the headset presentation. These are limitations of this slice, not limits on the product vision.
The [immersive workspace epic](EPIC-20260905-immersive-workspace.md) owns the complete experience
and its follow-up stories. Keep this implementation and verification record as the foundation;
physical Quest acceptance remains open, and its completion alone does not deliver that epic.

**Implementation update — 2026-09-08:** [Story 45](STORY-20260905-application-vr-shell.md) now
supersedes this story's diagram-owned entry/lifetime. The reusable XR bridge moved to
[`shell/immersive/ImmersiveBridge.tsx`](../src/features/shell/immersive/ImmersiveBridge.tsx#L33),
and shell entry/navigation is automated. The original acceptance and physical-headset record below
remains historical evidence; its pending headset checks have not been completed.

**Vision slice:** [vision.md step 9](../docs/vision.md#sequence),
[multi-device delivery slice 12](../docs/multi-project-session-environment.md#possible-delivery-slices),
and an artifact-backed foundation for the north-star roadmap's later model-native
[Phase C / reserved Story 13](EPIC-20260705-north-star-roadmap.md#phase-c--surfaces-and-memory-parallel-can-start-during-phase-b).
This story does not wait for the model-native 3D renderer: it takes the Mermaid/sketch room Story 43
actually shipped into a Quest-class headset, while preserving the future renderer boundary.

---

## Motivation

The desktop spatial room proves that CodeAI can project session artifacts into bounded 3D without
inventing another document format. It is still a flat browser experience, however. As the user put
it after trying the room from a Quest headset:

> I want to be able to switch to VR mode and see the diagram and chat in full screen in 3D.

This story interpreted that request as a small immersive viewing slice. The 2026-09-05 review
clarified that the intended experience is using the whole system in VR. For this slice, entering
VR presents a readable active diagram and a nearby live conversation in world space. The first
slice must also respect the hard
parts Story 43 deliberately deferred: explicit user entry, secure transport, controller input,
stereoscopic resource budgets, session cleanup, and a useful fallback when WebXR is unavailable.

---

## Implementation (where the code lives)

- Surface entry remains inside the existing Flat/Spatial projection:
  [CanvasWorkspace.tsx](../src/features/diagram/components/CanvasWorkspace.tsx#L104) mounts Spatial
  only for an active canvas and passes the live, authenticated shell projection through its existing
  renderer boundary.
- [SpatialRoom.tsx](../src/features/diagram/spatial/SpatialRoom.tsx#L29) owns the second client-only
  XR chunk and its error boundary. Its room orchestration
  ([around line 386](../src/features/diagram/spatial/SpatialRoom.tsx#L386)) probes only non-empty
  Spatial views, retains the deterministic target selection, swaps the resource owner to the active
  artifact while XR is live, and keeps the semantic desktop test/accessibility controls wired to the
  same actions.
- [immersiveCapability.ts](../src/features/diagram/spatial/immersiveCapability.ts#L8) contains the
  secure-context, authenticated-device, API, and asynchronous `immersive-vr` support checks plus the
  injectable test adapter.
- [ImmersiveBridge.tsx](../src/features/shell/immersive/ImmersiveBridge.tsx#L33) owns the one
  `@react-three/xr` store, explicit `enterVR()` call, local-floor/local reference space, controller
  rays and thumbstick paging, world-space scene, frame recording, and idempotent end/error cleanup.
- [immersiveTranscript.ts](../src/features/diagram/spatial/immersiveTranscript.ts#L117) turns the
  canonical transcript and live preview into stable newest-first bounded pages.
  [immersiveResources.ts](../src/features/diagram/spatial/immersiveResources.ts#L209) rasterizes the
  read-only conversation and labelled controls while reusing Story 43's active artifact texture.
- [resourceLedger.ts](../src/features/diagram/spatial/resourceLedger.ts#L66) adds separate XR frame,
  pixel, and live-resource accounting to the existing single-owner cleanup ledger.
- [AppShell.tsx](../src/features/shell/AppShell.tsx#L193) derives the readable run/approval status and
  [passes it with secure device authorization](../src/features/shell/AppShell.tsx#L1622). No durable
  session or device-view schema changed.
- [next.config.ts](../next.config.ts#L40) and
  [start-remote.mjs](../scripts/start-remote.mjs#L72) send the same-origin-only
  `xr-spatial-tracking` response policy on ordinary and paired-HTTPS startup paths.

---

## Technical constraints and decisions

- WebXR immersive sessions require a secure context, permission for `xr-spatial-tracking`, a focused
  active document, and explicit user activation. Entry must therefore happen from one visible button
  and cannot be restored automatically after navigation or reload. See MDN's
  [`requestSession()`](https://developer.mozilla.org/en-US/docs/Web/API/XRSystem/requestSession) and
  [WebXR permissions and security](https://developer.mozilla.org/en-US/docs/Web/API/WebXR_Device_API/Permissions_and_security).
- Use the current `@react-three/xr` store API: one lazily created `createXRStore`, `<XR>` around the
  existing R3F scene, `store.enterVR()` from the click handler, and the store/session state for exit
  and lifecycle handling. The implementation must follow the current
  [React Three XR conversion guide](https://pmndrs.github.io/xr/docs/getting-started/convert-to-xr)
  rather than the removed v5 `VRButton` compatibility API.
- DOM Overlay is an optional WebXR feature and exposes one browser-composited DOM root. It is not a
  dependable foundation for the core Quest workspace. The diagram, transcript, status, and primary
  controls must be world-space R3F content; a DOM overlay may be a progressive enhancement only.
  See the [WebXR DOM Overlays specification](https://immersive-web.github.io/dom-overlays/).
- Quest 3-class hardware is the supported performance floor for this slice. Quest 2 may work, but it
  must not force the desktop renderer or future model to lose information globally.

---

## Desired behavior

### A. This initial viewer enters VR from Spatial

1. When Spatial is active, the browser is a secure context, and
   `navigator.xr.isSessionSupported('immersive-vr')` resolves true, the spatial controls expose one
   **Enter VR** button. Flat and an empty session do not load `@react-three/xr` or probe WebXR.
2. Capability checking is asynchronous and non-blocking. While it runs, the desktop room stays fully
   usable. An insecure origin, missing WebXR API, unsupported session mode, denied permission, or
   failed session request leaves Spatial intact and shows a concise reason beside the entry action.
   No failure switches the user to Flat or loses camera/placement state.
3. Clicking **Enter VR** is the user activation that calls `store.enterVR()`. A successful
   `immersive-vr` session uses the headset display as the full presentation surface; the ordinary
   shell remains mounted for canonical session updates but is not duplicated as browser chrome in
   the headset.
4. XR is another renderer state of the existing Spatial projection, not a new `CanvasSurface` value.
   The durable diagram/sketch, active selection, annotations, transcript, participants, and run
   records remain the same objects used by Flat and desktop Spatial.
5. Ending the session from an in-world **Exit VR** control, the headset system UI,
   component unmount, or error resolves exactly once. It releases XR-owned
   resources and returns to the same desktop Spatial selection, camera, and placements.
   Story 45 preserves XR across route/session changes; [Story 53](STORY-20260910-vr-session-resilience.md)
   also preserves it through temporary visibility loss and controller disconnection.

### B. The immersive workspace contains one primary diagram and one live chat panel

6. On entry, the active canvas target becomes a large upright primary panel centered at a
   comfortable standing/seated viewing distance. The panel uses Story 43's policy-checked,
   current-theme texture with durable marks; it never reparses an unsafe diagram or fetches an
   external asset.
7. A curved or angled conversation panel sits within an easy head turn of the primary panel. It is
   true world-space content visible in both eyes, not drei `<Html>` or a required DOM overlay. Its
   header names the session and addressed agent and shows run state, unread/new activity, and a
   non-actionable pending-approval warning.
8. The transcript projection is deliberately bounded. It exposes at most the newest
   `MAX_IMMERSIVE_CHAT_ENTRIES = 12` user/assistant messages and at most
   `MAX_IMMERSIVE_CHAT_CHARS = 12_000` display characters at once. It keeps author, role/mode,
   delivery state, readable prose/code text, and attachment summaries; embedded diagram blocks are
   summarized because the active artifact already has the primary panel.
9. The chat opens on the newest page. **Older** and **Newer** world-space controls page through the
   bounded projection. Live messages and the streaming preview update the newest page. If the user
   is reading an older page, new content raises a **New activity** indicator rather than moving the
   page underneath them.
10. **Previous canvas** and **Next canvas** controls move through Story 43's deterministic bounded
    target set and use the existing session selection path. The primary texture changes; the XR
    session, transcript position, and desktop camera/placements do not reset.
11. Changing light/dark theme outside the headset or receiving a new ready diagram updates the
    relevant world-space pixels without recreating the XR session. One independently bad diagram or
    transcript texture becomes a labelled in-world error panel and leaves exit/navigation usable.

### C. Controller interaction is small, explicit, and reversible

12. Default left- and right-controller ray pointers can target every in-world control. Trigger/select
    activates a control. Hover/focus and selected states use the semantic palette and remain legible
    against the room; no essential action depends on an unlabeled gesture.
13. The primary panel supports labelled **Larger**, **Smaller**, and **Reset view** controls. These
    modify an XR-only content origin or scale within conservative bounds; they do not write headset
    pose into `SpatialViewState` or mutate the durable canvas.
14. The transcript supports the page controls from rule 9 and controller thumbstick scrolling when
    a compatible primary-axis gamepad is available. Thumbstick input is an enhancement: ray-selectable
    controls remain the complete interaction path.
15. The in-world status surface always exposes **Exit VR** and identifies when an agent is working,
    failed, completed, or waiting for approval. Permission allow/deny, composing, sending, cancelling,
    agent management, and attachment changes are not presented as half-working XR controls; the user
    exits VR to perform them in the existing authenticated DOM shell.
16. The experience uses a `local-floor` reference space when available and falls back to `local`.
    It does not require a room boundary, teleportation, or physical walking. Content begins in front
    of the viewer and **Reset view** recenters it safely.

### D. Resource and frame budgets are stricter in the headset

17. Immersive mode keeps only the active canvas texture, one transcript texture, and the small set of
    UI/text resources needed for controls live. It does not upload all twelve desktop room previews
    stereoscopically. Aggregate XR raster allocation is capped at 4,194,304 logical pixels, with no
    individual texture edge above 2,048 and mipmaps disabled for generated UI textures.
18. The desktop `frameloop="demand"` behavior remains unchanged outside XR. While an immersive
    session is active, the XR animation loop may render continuously for head/controller tracking;
    it stops when the session ends. No second requestAnimationFrame loop is introduced by chat or
    controls.
19. XR session, listeners, generated object URLs, textures, materials, geometries, text resources,
    and store subscriptions have one owner and idempotent cleanup. After exit or failure, Story 43's
    instrumentation returns to the desktop baseline and stays there across repeated enter/exit cycles.
20. The renderer exposes development-only frame-time and live-resource counters. On the reference
    fixture, a Quest 3 manual run after warm-up must report median XR frame time at or below 16.7 ms,
    95th percentile at or below 27.8 ms, and no monotonic resource growth during five minutes of
    transcript updates and canvas switching.

### E. Secure access and failure boundaries remain explicit

21. CodeAI responses opt the same origin into `xr-spatial-tracking` with a narrow
    `Permissions-Policy`. Framing or arbitrary third-party origins are not granted XR access.
    Automated coverage asserts the production response header.
22. The supported headset path is the paired `npm run start:remote` HTTPS origin with a certificate
    the Quest trusts. `CODEAI_ALLOWED_DEV_ORIGINS` only fixes Next development assets/HMR; the UI must
    explain that an HTTP LAN development URL is not a WebXR secure context.
23. A paired headset may open a home-owned or proxied remote-machine session through the existing
    Arena. XR never receives provider credentials, machine credentials, TLS keys, or a capability to
    bypass the home server's authorization routes.
24. Context loss, session rejection, or a failed
    dynamic import ends only the immersive layer. The user gets an actionable desktop Spatial
    fallback, and Flat remains available through Story 43's existing boundary.
    Story 45 contains transcript raster failure within its panel; Story 53 retains the session
    through controller disconnection and records bounded device-local exit diagnostics.

---

## Type contract

These are client-only projection contracts, not shared wire records. Exact file placement may change
during implementation, but the bounds and ownership may not silently move into the canonical session
schema.

```ts
export type ImmersiveAvailability =
  | 'checking'
  | 'available'
  | 'insecure'
  | 'unsupported'
  | 'entering'
  | 'active'
  | 'failed';

export interface ImmersiveTranscriptEntry {
  id: string;
  author: string;
  meta: string;
  text: string;
  state?: string;
}

export interface ImmersiveConversationProjection {
  sessionTitle: string;
  addressedAgent?: string;
  entries: ImmersiveTranscriptEntry[]; // <= 12 and <= 12,000 display characters total
  preview?: string;
  runStatus: string;
  pendingApprovals: number;
}

export interface ImmersiveInstrumentation {
  sessionActive: boolean;
  frames: number;
  medianFrameMs?: number;
  p95FrameMs?: number;
  logicalTexturePixels: number; // <= 4,194,304 while active
  liveResources: number;
}
```

`DeviceViewState`, `SpatialViewState`, and every `src/shared` wire schema remain unchanged. In
particular, active XR state, head/controller poses, transcript page, and temporary XR scale are not
persisted.

---

## Acceptance criteria

- [x] A supported Quest-class browser on the paired HTTPS origin shows **Enter VR** only in a
  non-empty Spatial view; Flat, empty sessions, and unsupported browsers do not load the XR bundle.
- [x] Entering VR from the explicit button opens one immersive session with the active diagram as a
  readable primary panel and the bounded live conversation as a readable world-space companion.
- [x] Controller rays can activate Exit, previous/next canvas, diagram scale/reset, and complete chat
  paging controls; optional thumbstick scrolling is never the only path.
- [x] Transcript projection enforces the 12-entry/12,000-character bounds, updates streaming/new
  activity predictably, and never exposes a composer or permission-decision action in this slice.
- [x] Canvas changes, annotations, theme changes, and conversation/run updates reuse the canonical
  session state and update in XR without restarting the immersive session.
- [x] Exit, system-ended sessions, rejection, context loss, unmount, and injected resource failures
  clean up exactly once and restore the unchanged desktop Spatial view with Flat still available.
- [x] XR uses no more than 4,194,304 logical texture pixels, no generated texture edge exceeds 2,048,
  desktop demand rendering survives unchanged, and repeated enter/exit cycles return counters to
  baseline.
- [x] Production responses grant `xr-spatial-tracking` only to the same origin, and insecure or
  unpaired access cannot present itself as supported immersive entry.
- [x] Automated tests cover capability states, lazy loading, transcript bounds/paging, session
  lifecycle, controller-selectable actions, security headers, resource cleanup, and the non-XR
  desktop fallback using an injectable XR adapter rather than requiring physical hardware.
- [ ] A manual Quest 3 run passes the interaction, live-update, cleanup, and five-minute frame/resource
  checks below; results and browser/headset versions are recorded in the story before shipping.
- [x] README, architecture, vision/sequence, and the multi-device notes describe the supported
  paired-HTTPS Quest workflow and its deliberate limitations.
- [x] `npm run lint`, `npm test`, `npm run build`, and `npm run test:e2e` pass.

## Out of scope

The operational omissions below are assigned to
[Stories 45–49](EPIC-20260905-immersive-workspace.md#story-map); real spatial diagram geometry is
assigned to Story 50 and the later Arena to Story 52. They must not be carried forward as
requirements for the full workspace.

- Model-native entities, relations, regions, provenance materials, lenses, or change overlays. The
  future north-star Story 12 renderer can replace the artifact panel behind this XR boundary.
- AR/passthrough, anchors, scene understanding, hand tracking, hand-authored gestures, teleportation,
  room-scale placement, or shared multi-user avatars.
- Composing/sending messages, speech input, agent selection, cancellation, attachment editing, or
  permission approval inside VR. These remain in the existing DOM conversation for the first slice.
- Relying on DOM Overlay for any core content or control. It may be evaluated later as an optional
  convenience for a keyboard/composer.
- Persisting head/controller telemetry, automatically re-entering VR, or introducing a durable/shareable
  saved-view schema.
- A native Quest store application, Internet relay, coordinator, or relaxation of Story 41's pairing
  and exact-origin transport boundary.
- A formal Quest 2 performance guarantee. Record observations if available, but Quest 3-class
  hardware is the supported floor.

---

## How to verify

### Automated

1. Add an injectable XR capability/store adapter so Vitest and Playwright can exercise supported,
   unsupported, rejected, entered, ended, and context-loss states without replacing browser globals
   throughout product code.
2. Unit-test the pure immersive transcript projection with long Markdown/code messages, attachments,
   streaming preview, more than twelve messages, and multi-byte text. Assert both entry and character
   limits and stable newest/older paging.
3. Unit-test XR texture allocation and lifecycle accounting, including repeated enter/exit and a
   failure during each resource-construction stage.
4. In Playwright, begin on Flat and assert no XR chunk/probe; enter Spatial, expose the fake supported
   adapter, click **Enter VR**, exercise every ray-equivalent control through its semantic action,
   stream a conversation update, switch canvas, end the session, and assert the exact desktop state
   is restored. Repeat for insecure, unsupported, denied, context-lost, and aborted-chunk fallbacks.
5. Start the production server and assert `Permissions-Policy` grants `xr-spatial-tracking` to self
   without granting a wildcard or unrelated origin.
6. Run `npm run lint`, `npm test`, `npm run build`, and `npm run test:e2e`.

### Manual Quest 3

1. Build and start CodeAI with `CODEAI_REMOTE_ACCESS=paired`, an exact `https://` public origin, and
   a certificate whose CA is trusted by the headset. Pair the Quest as a personal device.
2. Open a session containing several diagrams and enough conversation to page. Select Spatial and
   confirm **Enter VR** appears; confirm the same button gives an actionable secure-context message
   when the page is intentionally opened over plain LAN HTTP.
3. Enter VR. From a comfortable seated and standing position, read the active diagram and newest chat
   without leaning, use both controllers' rays, page older/newer, change diagrams, resize/reset the
   diagram, and exit through the in-world control and through the headset system UI.
4. From another paired browser, start an agent turn while the headset remains immersive. Confirm run
   state, streaming preview, completed transcript, and any pending-approval warning update without
   moving an older page or restarting XR. Exit VR to make any permission decision.
5. Repeat entry/exit ten times, inject/observe one interrupted session, then run for five minutes while
   paging chat and changing diagrams. Record Quest model, OS/browser versions, median/p95 frame time,
   peak logical texture pixels, and live-resource counts before entry, during XR, and after exit.
6. Confirm the final desktop Spatial selection, camera, and placements match their pre-entry values;
   reload and confirm the browser does not attempt to enter VR without a fresh user gesture.

## Verification record

### Automated — 2026-09-04

- `npm run lint` — passed.
- `npm test` — passed: 45 files, 255 tests.
- `npm run build` — passed with Next.js 16.3.1.
- `npm run test:e2e` — passed: 22 Playwright tests in installed Chrome, including supported entry,
  semantic controls, live updates, repeated exit/re-entry, unsupported/rejected/context-lost states,
  lazy loading, resource cleanup, dynamic-import containment, and the production response header.

### Manual Quest 3 — pending

No Quest-class headset is available in this implementation environment. Before changing the story
to **Shipped**, run all six manual steps above and record the Quest model, OS and browser versions,
median/p95 frame time after warm-up, peak logical texture pixels, live-resource counts before/during/
after XR, five-minute update/switching behavior, and ten-cycle entry/exit result here.

Partial headset feedback on 2026-09-16 reports that the immersive workspace generally works. It also
identified native chat-input deletion as broken; Story 47 now provides a controller-selectable
**Clear draft** fallback while leaving native Backspace unaccepted. This does not close Story 44's
manual criterion: headset/browser versions, the interaction matrix, ten-cycle cleanup, five-minute
update/switching run, and frame/resource measurements have not been recorded. Conversation panel
shape and view polish are explicitly deferred for a future slice.
