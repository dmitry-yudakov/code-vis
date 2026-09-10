# Story 53 — Keep VR open through temporary interruptions and diagnose exits

**Status:** Shipped · **Type:** Frontend-only · **Depends on:** [Story 45](STORY-20260905-application-vr-shell.md)

## Motivation

VR sometimes returns unexpectedly to the ordinary browser page. A controller disappearing or a
temporarily hidden headset session currently makes CodeAI end XR itself, and there is no retained
event history to distinguish these exits from graphics failures or browser termination. This
hardens the application shell in the [immersive workspace epic](EPIC-20260905-immersive-workspace.md).

## Implementation (where the code is)

- [ImmersiveBridge.tsx:75](../src/features/shell/immersive/ImmersiveBridge.tsx#L75) owns XR lifecycle,
  preserves input/visibility interruptions, and samples diagnostic counters until cleanup.
- [ImmersiveBoundary.tsx:18](../src/features/shell/immersive/ImmersiveBoundary.tsx#L18) contains
  renderer errors and records their occurrence; its mount also records document readiness.
- [immersiveDiagnostics.ts:49](../src/features/shell/immersive/immersiveDiagnostics.ts#L49) validates
  and retains the bounded report in device storage and exposes it to the remote console.
- [resourceLedger.ts:61](../src/features/diagram/spatial/resourceLedger.ts#L61) exposes bounded
  application resource and frame-time counters consumed by diagnostic samples.
- [immersive.spec.ts:27](../e2e/immersive.spec.ts#L27) injects XR sessions around the real renderer.

## Desired behavior

1. Controller removal, including losing all controllers, leaves the XR session open. Reconnection
   restores input through the existing XR store. Temporary hidden/blurred visibility is left to
   WebXR's pause/resume behavior without discarding the workspace or entering another session.
2. Explicit exit, actual browser session end, graphics loss, page departure, and renderer unmount
   retain their cleanup behavior. Browser session end has a useful visible explanation.
3. A bounded, device-local diagnostic history survives reloads on a best-effort basis. Record
   lifecycle events and ten-second resource/frame samples, including renderer allocation counts
   and optional browser heap usage. Include page identity so a new document can be distinguished
   from XR re-entry. Collect no conversation/repository content, poses, credentials, or arbitrary
   exception messages. Diagnostics must not throw or introduce a second rendering loop.
4. Expose the report to the remote browser console and document how to inspect it, capture native
   errors, and distinguish a last sample without an end event from a confirmed browser crash.

## Acceptance criteria

- [x] Removing one/all controllers and reconnecting keeps one XR session and its workspace alive.
- [x] Hidden, blurred, and visible transitions retain XR and panel state.
- [x] Explicit exit, native end, WebGL loss, authorization removal, and late-entry cleanup pass.
- [x] Diagnostic history records lifecycle and periodic metrics, survives reload, is bounded,
      tolerates invalid/unavailable storage, and contains only the declared diagnostic fields.
- [x] Diagnostics do not eagerly load Three.js or create a renderer on unsupported devices.
- [x] Investigation instructions describe remote inspection and the limits of the evidence.
- [x] Focused Vitest/Playwright checks, TypeScript checking, and the production build pass.

## Out of scope

Automatic XR re-entry after a real end, GPU-context recovery, telemetry upload, and claiming a
hardware root cause without headset evidence. Physical acceptance for Stories 44–46 remains open.

## How to verify

Run `npm run lint`, the focused immersive Vitest files, then a production build into `.next-e2e`
and `playwright test e2e/immersive.spec.ts`. Use injected controller/visibility changes to verify
continuity, then actual session end and context-loss events to verify cleanup and recorded causes.
Reload and inspect the retained report; verify malformed/blocked storage and bounded history.
For hardware investigation, follow the README's VR exit diagnostics procedure while reproducing
on Quest, including controller sleep/reconnection and a temporary headset interruption.

## Verification record

September 10, 2026:

- `npm run lint` and `CODEAI_DIST_DIR=.next-e2e npm run build` passed.
- The focused diagnostics/model/layout Vitest run passed 22 tests in three files.
- All 18 immersive browser cases passed across the suite and the corrected diagnostics rerun;
  the existing canvas XR adapter/streaming case also passed. Controller changes exercise the real
  XR store as well as session events. Timer/error-listener cleanup uses a simulated clock; the
  separate reload test checks actual document time origins and retained history.
- `adb devices -l` found no connected headset. The reported hardware failure is not reproduced or
  attributed to a confirmed cause. Stories 44–46 retain their physical acceptance requirements.
