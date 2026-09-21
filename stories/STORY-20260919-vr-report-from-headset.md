# Story 56 — Report a VR problem from inside the headset

**Status:** In progress · **Type:** Full-stack · **Depends on:** [Story 51](STORY-20260905-vr-workspace-acceptance.md)

---

## Motivation

Physical Quest acceptance keeps producing findings that are hard to get out of the headset. In the
author's words: *"I want to be able to easier report errors, it's a bit hard from Quest"* and
*"sometimes I want screenshots"*.

Today both need a cable. Exception text is deliberately absent from the retained diagnostics
([immersiveDiagnostics.ts:58](../src/features/shell/immersive/immersiveDiagnostics.ts#L58)), so the
only way to read an actual error is USB debugging plus `chrome://inspect`
([README.md:280](../README.md#L280)). A screenshot means Quest's system capture, then transferring
the file off the device by hand. Both interrupt the run being accepted, and neither reaches the
machine where the work happens.

This story makes the headset report to the home machine it is already paired with: one action in the
always-accessible tool strip sends what the reporter sees plus the retained evidence, and VR errors
carry their message along the same path without being asked. It serves Story 51's acceptance loop in
the [immersive workspace epic](EPIC-20260905-immersive-workspace.md).

After using the first implementation, the user clarified that the problem may be beside the Report
control rather than under the current gaze: *"3 sec delay before taking screenshot — as the issue
could be on the side, not around 'report' button"*. The deliberate capture therefore gives the user
time to aim at the evidence; automatic error forwarding remains immediate.

---

## Current behavior (where the code is)

- [immersiveDiagnostics.ts:59](../src/features/shell/immersive/immersiveDiagnostics.ts#L59) records
  bounded lifecycle/sample entries into device storage and never retains messages, content, or poses.
- [ImmersiveBridge.tsx:112](../src/features/shell/immersive/ImmersiveBridge.tsx#L112) already listens
  for `error`/`unhandledrejection` and samples counters while a session is bound, discarding the
  exception itself; entry and end failures record events only
  ([ImmersiveBridge.tsx:25](../src/features/shell/immersive/ImmersiveBridge.tsx#L25)).
- [ImmersiveBoundary.tsx:40](../src/features/shell/immersive/ImmersiveBoundary.tsx#L40) contains
  renderer errors, and [ImmersiveBoundary.tsx:56](../src/features/shell/immersive/ImmersiveBoundary.tsx#L56)
  lists the semantic actions mirrored as DOM controls beside the scene.
- [ImmersiveWorkspace.tsx:285](../src/features/shell/immersive/ImmersiveWorkspace.tsx#L285) renders the
  always-accessible tool strip (panel toggles, Reset, Exit) and
  [ImmersiveWorkspace.tsx:117](../src/features/shell/immersive/ImmersiveWorkspace.tsx#L117) builds its
  status line; [ImmersiveWorkspace.tsx:126](../src/features/shell/immersive/ImmersiveWorkspace.tsx#L126)
  already reads the head pose through `gl.xr.getCamera()`.
- [immersiveResources.ts:7](../src/features/diagram/spatial/immersiveResources.ts#L7) and
  [workspaceIcons.ts:44](../src/features/shell/immersive/workspaceIcons.ts#L44) own action labels and
  Lucide glyphs; [immersiveTypes.ts:64](../src/features/diagram/spatial/immersiveTypes.ts#L64) owns the
  semantic action union.
- [api/voice/route.ts:19](../src/app/api/voice/route.ts#L19) is the pattern for an authorized,
  size-bounded device upload: `authorizePersonalDeviceRequest`, `boundedRequestBody`, shared limits.

---

## Desired behavior

1. **Report action.** A `report` action joins the tool strip and the DOM semantic controls. Invoking
   it starts a visible three-second countdown. The user can turn toward the problem during that time;
   after the countdown the status clears for one rendered frame, then CodeAI renders one mono frame
   from the *then-current* head pose into an offscreen target, encodes a JPEG, and uploads it with the
   retained diagnostics, recent VR error tail, and view context. Invoking Report again during the
   countdown cancels it without capturing or uploading. Leaving the workspace cancels it too. The
   tool strip stays reachable when panels are closed or content failed, so it works exactly when it
   is needed.
2. **Errors report themselves.** Window errors, unhandled rejections, renderer errors, failed entry,
   failed end, and WebGL context loss send the same bundle without a screenshot, rate-limited and
   capped per document so a repeating failure cannot flood the link or the disk.
3. **Messages leave the device but are not stored on it.** Error text and stacks live in memory only
   and travel to the paired home machine; device storage keeps the existing message-free history.
4. **The home machine keeps the report.** `POST /api/immersive/report` authorizes the personal device,
   bounds the body, and writes `<dataDir>/diagnostics/<timestamp>-<kind>.json` plus a sibling `.jpg`
   at mode `0600`, pruning to the newest 50 reports. It prints one line naming the file so a report
   is visible in the terminal running `start:remote`.
5. **Feedback in VR.** The workspace status line counts down `Capturing in 3…`, `2…`, `1…`, then
   confirms `Report sent` or explains a failure before returning to the ordinary status. Cancellation
   confirms `Report cancelled` briefly. A cancelled, failed capture, or failed upload never ends the
   session.
6. **Capture is honest about what it is.** The frame is one mono view from the head pose, taking its
   field of view and proportions from the headset's own projection rather than a desktop lens, and it
   is described that way wherever it is documented.

### Concrete changes

1. `src/shared/immersiveReport.ts` — wire schema and limits (errors per report, message/stack caps,
   body and image ceilings, retained report count, JPEG validation).
2. `src/features/shell/immersive/immersiveReport.ts` — in-memory error ring, `noteImmersiveError`,
   `sendImmersiveReport`, auto-forward rate limiting, page-lifetime cap.
3. `src/features/shell/immersive/immersiveCapture.ts` — `captureImmersiveFrame(renderer, scene, camera)`
   rendering to a transient target with `xr.enabled` briefly false, reading pixels, flipping rows, and
   encoding a JPEG; the frame's field of view and proportions come from the captured view's own
   projection, and the target is disposed in the same frame so the texture budget is untouched.
4. Action wiring: `report` in the semantic action union, its label, its glyph, the tool strip slot
   (the pill widens to hold six controls), the boundary's DOM control list, and a workspace-owned,
   cancellable capture deadline. `useFrame` clears the countdown, allows one clean frame, then captures
   and reports asynchronously from the current camera. No delayed callback owns or uses a stale
   renderer, scene, camera, session, project, or view identity. The delay is one exported constant and
   the deadline takes its clock as a parameter, so unit tests cover the countdown without waiting.
5. Error sites in `ImmersiveBridge`/`ImmersiveBoundary` note their message beside the existing
   diagnostic record.
6. `src/server/diagnostics/immersiveReports.ts` + `src/app/api/immersive/report/route.ts` — validate,
   write, prune, log.

### Type contract

```ts
// src/shared/immersiveReport.ts — crosses the browser/server boundary
export interface ImmersiveReportError { at: string; kind: string; message: string; stack?: string }
export interface ImmersiveReport {
  version: 1;
  kind: 'capture' | 'error';
  at: string;
  browser: string;
  view?: string;          // machine/project/session view key
  availability?: string;  // immersive availability when the report was made
  note?: string;
  errors: ImmersiveReportError[];
  diagnostics: { version: number; browser: string; events: Array<Record<string, string | number | boolean>> };
  screenshot?: string;    // base64 JPEG, no data: prefix
}
```

---

## Acceptance criteria

- [x] The tool strip and the DOM semantic controls both expose `report`; it is reachable with every
      panel closed and with no session selected.
- [ ] A deliberate report shows a three-second countdown, captures no earlier than three seconds
      after activation, and uses the head pose at capture time rather than the activation pose; the
      countdown itself is absent from the captured frame.
- [ ] Invoking Report again during the countdown, exiting VR, or unmounting the workspace cancels the
      pending capture without an upload or a late update against the next view.
- [x] Invoking `report` uploads a report whose `screenshot` decodes to a JPEG of the current view, and
      the response names the stored file.
- [x] Window errors, unhandled rejections, renderer errors, entry failure, end failure, and WebGL
      context loss each auto-forward a `kind: 'error'` report carrying the message text.
- [x] Auto-forwarding is rate-limited and capped per document; exceeding either drops reports silently
      without disturbing the session.
- [x] No error message or stack is written to `code-ai:device:v1:immersive-diagnostics`.
- [x] A capture or upload failure records a diagnostic, explains itself in the status line, and leaves
      the XR session bound.
- [x] The route rejects an unauthorized device, an oversized body, a malformed payload, and a
      screenshot that is not a JPEG.
- [x] Reports land under `<dataDir>/diagnostics/` at mode `0600`, pruned to the newest 50, and each
      write prints one line naming the file.
- [ ] `npm run lint` passes; `npm test` covers the error ring, capture encode, countdown/cancellation,
      and store; `npm run test:e2e` proves no upload before the deadline, capture after the deadline,
      cancellation, the report action, and one auto-forwarded error.

Verification of the first two **How to verify** steps on a physical Quest 3S remains pending; every
previously implemented automated check passes. The later countdown criteria are specified but not
yet implemented.

## Out of scope

- Screenshots attached to error reports (a lost context or renderer error cannot render a frame).
- Stereo or per-eye capture, video capture, and hand/controller pose replay.
- Any report destination other than the paired home machine — no third-party telemetry, ever.
- A UI for browsing/attaching stored reports; [Story 63](STORY-20260921-report-evidence-in-conversation.md)
  owns that follow-up and does not gate this story's capture transport. It adds to the upload response
  and keeps `name`, which becomes the report id, so the criterion above still holds.
- Desktop (non-XR) error forwarding, which DevTools already covers on that device.

## How to verify

1. `npm run build && npm run start:remote`, open the paired HTTPS origin on Quest, enter VR.
2. Press **Report** in the tool strip, turn at least 45° during `Capturing in 3…`, and hold the new
   view. Expect no earlier upload, no countdown text in the image, then `Report sent` in the status
   line. On the home machine expect a new `<dataDir>/diagnostics/<timestamp>-capture.json` plus
   `.jpg`; the image shows the final view, not the view at button press, and the terminal names it.
3. Press **Report** and press it again before the countdown completes. Expect `Report cancelled`, no
   new files, and an otherwise uninterrupted XR session. Repeat once while exiting VR during the
   countdown and expect no late report after returning.
4. In the desktop browser with an XR emulator (see README), run
   `window.dispatchEvent(new ErrorEvent('error', { message: 'probe' }))` during a session and confirm
   a `-error.json` report containing `probe` arrives without a screenshot.
5. `ls <dataDir>/diagnostics | wc -l` stays at or below 100 files (50 reports) after repeated use.
