# Story 45 — Enter VR across the application

**Status:** In progress · **Type:** Frontend-only · **Depends on:** Story 44's implemented XR foundation
and [Story 41](STORY-20260904-authenticated-devices.md).

**Vision slice:** [immersive workspace epic](EPIC-20260905-immersive-workspace.md),
[vision step 9](../docs/vision.md#sequence). This is shell ownership, before operational VR parity.

## Motivation

The current VR button requires a diagram and the Spatial canvas, and changing sessions ends XR.
The user wants to enter CodeAI in VR and stay there while moving between work.

## Implementation (where the code is)

- [AppShell.tsx:1465](../src/features/shell/AppShell.tsx#L1465) keeps the immersive boundary mounted
  inside the persistent authenticated shell, including while its desktop content loads.
- [ImmersiveBoundary.tsx:38](../src/features/shell/immersive/ImmersiveBoundary.tsx#L38) owns capability,
  lazy preparation, entry/status controls, and disposable transcript/launcher paging.
- [ImmersiveBridge.tsx:33](../src/features/shell/immersive/ImmersiveBridge.tsx#L33) owns the persistent
  XR store, explicit entry, and idempotent cleanup, including late entry after unmount/departure.
- [ImmersiveWorkspace.tsx:115](../src/features/shell/immersive/ImmersiveWorkspace.tsx#L115) renders
  the launcher, status, active canvas/empty state, conversation, reset, and exit in world space.
  [ImmersiveEnvironment.tsx:4](../src/features/shell/immersive/ImmersiveEnvironment.tsx#L4) keeps the
  opaque VR background independent of the work tools.
- [AppShell.tsx:1400](../src/features/shell/AppShell.tsx#L1400) derives launcher choices from the
  existing Arena polling owner and resolves machine/project/session identity before calling the
  shared [navigation action:1147](../src/features/shell/AppShell.tsx#L1147).
- [CanvasWorkspace.tsx:131](../src/features/diagram/components/CanvasWorkspace.tsx#L131) suspends
  desktop Spatial resources while immersive without changing the saved surface or camera.
- [e2e/immersive.spec.ts:102](../e2e/immersive.spec.ts#L102) verifies application entry, navigation
  races, failures, resource cleanup, and fresh-gesture re-entry through the injected adapter.

## Desired behavior

1. Provide a shell-level **Enter VR** action from Arena/Inbox and every session, including an empty
   or repository-free session. Capability checking must not require a canvas or load its renderer.
   A supported entry uses one explicit gesture; loading/error reasons leave the DOM shell usable.
2. Give one persistent client boundary ownership of the XR store, renderer, entry/exit, and failure
   recovery. Keep the existing authenticated device gate outside it. The immersive shell initially
   contains navigation, session title/status, an empty-state surface or current artifact and
   conversation projection, plus **Exit VR** and **Reset view**.
3. Open one session at a time through a simple launcher across projects and machines without
   creating or ending an XR session. Same-document navigation/history across existing shell routes
   also keeps this ownership: until Story 52, Arena/Inbox routes show the current immersive session
   or launcher, not a multi-session spatial dashboard. Requests carry explicit target identity;
   loading, unavailable sessions, and Offline machines show in-world states.
4. Reuse the shell's state/actions and polling. Extract a client controller where necessary;
   do not duplicate API orchestration inside the renderer. Flat/Spatial remains a canvas choice,
   and the desktop selection must not be changed merely to enter immersive VR.
   Keep virtual background/environment configuration separate from reusable panels and commands
   to preserve the epic's future AR/passthrough option; do not implement AR in this story.
5. Explicit exit, system end, authorization loss, leaving the application, and unrecoverable XR
   failure clean up once. A diagram load failure is local to its surface. Exit returns to the
   currently focused work in DOM with existing per-view drafts, cameras, and placements preserved.
   Browser reload always needs a new entry gesture.

## Acceptance criteria

Implementation scope (September 8): keep AppShell as the state/action owner and add a persistent,
lazy immersive boundary beside its desktop presentation, including during catalog loading. Reuse
the existing world-space texture controls and diagram resource budget. A paged session launcher
consumes the existing Arena snapshots and calls the shell's explicitly addressed navigation action.
Keep the XR renderer independent of both desktop canvas surfaces; suspend desktop Spatial resources
while immersive. Physical Quest 3S evidence remains a separate, required verification step.

- [x] One entry action works from Arena, Inbox, Flat, Spatial, and a session with no artifacts.
- [x] Navigation across two projects and two machine identities retains the same XR session/store,
  including an empty session, a loading failure, and an Offline machine.
- [x] There is one state/action/polling owner; no canonical record or provider policy is duplicated.
- [x] A broken diagram leaves navigation, status, reset, and exit available in the headset.
- [x] Exit, rejection, auth loss, unmount, and system end clean up once and preserve desktop context.
- [x] XR stays lazy on ordinary desktop use; fake-adapter tests assert the new entry and navigation
  contract, replacing Story 44's non-empty-Spatial-only expectations.
- [x] `npm run lint`, `npm test`, `npm run build`, and `npm run test:e2e` pass.
- [ ] A Quest 3S smoke check records genuine immersive entry and navigation continuity.

## Out of scope

Movable tools (46), a working composer (47), active-session permissions (48), and evidence (49).
The spatial multi-session Arena/Inbox is later (52); the first shell needs only session navigation
and a launcher, even when Enter VR was activated from the desktop Arena.
This foundation alone is not the epic's usable VR release. No new `CanvasSurface` value, server
storage schema, or automatic XR restoration is needed.

## How to verify

1. Use the injected XR adapter to enter from all five locations above and count session creation/end
   while navigating. Assert desktop entry does not force Spatial or require a ready diagram.
2. Change focus while a target session is loading, return through browser history, and inject a
   failed artifact and an Offline executor; verify the shell and exit remain operational.
3. End via each lifecycle path and assert resource/subscription counts return to baseline and drafts
   survive. Run the automated commands above and repeat entry/navigation/exit on paired Quest 3S.

## Verification record

September 8, 2026:

- The 10 focused Chrome XR tests pass using the real R3F workspace and injected session adapter.
  Entry from all five locations preserves desktop state; navigation across two projects/machine
  identities, a delayed response after focus changes, Arena/Inbox/history, loading failure, and an
  Offline executor retains one entry and zero session ends/store destructions until deliberate exit.
- Rejection, broken canvas/transcript rasterization, system end, WebGL loss, authorization revocation,
  and pending entry during unmount/page departure are covered. Resource/listener counts return to
  baseline, and reloading never enters automatically. The existing streaming/paging regression
  remains in `e2e/canvas.spec.ts`.
- `npm run lint` passed; `npm test` passed all **255 tests in 45 files**; `npm run build` passed;
  `npm run test:e2e` passed all **30 Chrome tests**. The full browser run caught and verified fixes
  for hidden-canvas pointer interception and desktop menu/catalog loading regressions. The build
  required network access for the project's existing Google Fonts after the sandboxed fetch failed.
- **Pending physical verification:** paired Quest 3S, controller entry from Arena and an empty
  session, navigation across projects/machines, reset, exit, and re-entry. No headset is accessible
  in this execution environment. This story remains In progress until that smoke check is recorded;
  the foundation does not claim the epic's full voice/controller work loop.
