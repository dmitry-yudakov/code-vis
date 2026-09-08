# Story 45 — Enter VR across the application

**Status:** Draft · **Type:** Frontend-only · **Depends on:** Story 44's implemented XR foundation
and [Story 41](STORY-20260904-authenticated-devices.md).

**Vision slice:** [immersive workspace epic](EPIC-20260905-immersive-workspace.md),
[vision step 9](../docs/vision.md#sequence). This is shell ownership, before operational VR parity.

## Motivation

The current VR button requires a diagram and the Spatial canvas, and changing sessions ends XR.
The user wants to enter CodeAI in VR and stay there while moving between work.

## Current behavior (where the code is)

- [CanvasWorkspace.tsx:107](../src/features/diagram/components/CanvasWorkspace.tsx#L107) and
  [135](../src/features/diagram/components/CanvasWorkspace.tsx#L135) gate Spatial and XR on a target.
- [ImmersiveBridge.tsx:256](../src/features/diagram/spatial/ImmersiveBridge.tsx#L256) owns the XR
  store/session under the diagram renderer, including cleanup on unmount.
- [AppShell.tsx:1144](../src/features/shell/AppShell.tsx#L1144) opens sessions across projects and
  machines; [shell layout:4](../src/app/(shell)/layout.tsx#L4) persists AppShell across shell routes.
- [immersiveCapability.ts:18](../src/features/diagram/spatial/immersiveCapability.ts#L18) provides
  existing capability checks. [workspaceViews.ts:24](../src/features/shell/workspaceViews.ts#L24)
  defines the independent Flat/Spatial canvas choice.

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

- [ ] One entry action works from Arena, Inbox, Flat, Spatial, and a session with no artifacts.
- [ ] Navigation across two projects and two machine identities retains the same XR session/store,
  including an empty session, a loading failure, and an Offline machine.
- [ ] There is one state/action/polling owner; no canonical record or provider policy is duplicated.
- [ ] A broken diagram leaves navigation, status, reset, and exit available in the headset.
- [ ] Exit, rejection, auth loss, unmount, and system end clean up once and preserve desktop context.
- [ ] XR stays lazy on ordinary desktop use; fake-adapter tests assert the new entry and navigation
  contract, replacing Story 44's non-empty-Spatial-only expectations.
- [ ] `npm run lint`, `npm test`, `npm run build`, and `npm run test:e2e` pass; a Quest 3S smoke check
  records genuine immersive entry and navigation continuity.

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

Pending implementation and headset verification.
