# Story 49 — Review and annotate session work in VR

**Status:** In progress · **Type:** Frontend-only · **Depends on:**
[Story 46](STORY-20260905-vr-workspace-panels.md), [Story 47](STORY-20260905-vr-conversation-input.md),
[Story 48](STORY-20260905-vr-session-permissions.md).

**Vision slice:** [inside a session](../docs/vision.md#inside-a-session), delivered through the
[immersive workspace epic](EPIC-20260905-immersive-workspace.md). Uses existing artifacts and diffs;
the future software-model change overlay is independent.

## Motivation

Working in VR requires inspecting what an agent changed and showing it a correction. A viewer that
requires exiting to open a diff or mark a diagram cannot complete this loop.

## Current behavior (where the code is)

- [ImmersiveWorkspace.tsx:38](../src/features/shell/immersive/ImmersiveWorkspace.tsx#L38) projects the
  selected session checkout's branch, status, changed files, and bounded diff, while
  [AppShell.tsx:1626](../src/features/shell/AppShell.tsx#L1626) keeps checkout/file selection shared
  with Flat and routes reads through the selected machine.
- [CanvasReviewTools.tsx:81](../src/features/shell/immersive/CanvasReviewTools.tsx#L81) owns comparison,
  drawing, text labels, undo/redo, deliberate clear, sketches, and attachment selection. Controller
  intersections become canonical artifact coordinates in
  [canvasReviewModel.ts:3](../src/features/shell/immersive/canvasReviewModel.ts#L3).
- [DiagramCanvas.tsx:103](../src/features/diagram/components/DiagramCanvas.tsx#L103) mirrors external VR
  mark updates into Flat, and [sessionStore.ts:48](../src/features/conversation/sessionStore.ts#L48)
  protects newer optimistic marks from an older save response.
- [AppShell.tsx:1080](../src/features/shell/AppShell.tsx#L1080) uses the existing stable composite
  projection for marked attachments and stops a send—with its draft intact—if that required export
  fails.

## Desired behavior

1. Open a repository tool beside the conversation/canvas. Select among the session's checkouts,
   inspect branch/status and changed files, and open staged/unstaged/untracked text diffs through the
   existing read-only routes. Keep machine, repository, path, and loading/error/truncation visible.
2. Make long code and diff lines navigable with scrolling and readable scaling. Preserve reading
   position on background updates and provide explicit refresh when the working tree changes.
   Do not manufacture a full-file reader from a partial diff or require an external editor.
3. Browse artifact history, choose revisions, and compare two diagrams/sketches in panels within
   the aggregate scene budget. The conversation and Exit remain usable during texture failures.
4. Create a sketch and draw pen/rectangle/arrow marks, erase, undo/redo, clear deliberately, and add
   text through the Story 47 input path. Map pointer intersections into canonical 2D artifact
   coordinates. Panel manipulation uses different controls from marking; durable marks keep their
   existing representation and show in Flat after VR exit.
5. Select/remove the active or additional diagram/sketch attachments and send the marked artifact
   through the existing stable composite export path. Changing panel pose cannot change the image
   sent to the agent. A failed export explains itself and preserves the draft for retry.
6. Treat attachment creation, drawing, reading diffs, and showing a new immutable revision as a
   complete in-headset loop. Changes to files still occur through approved agent execution.

## Acceptance criteria

- [x] Readable checkout status, changed files, and bounded diffs are available alongside chat in VR.
- [x] Two artifact revisions can be compared without losing the active session or exceeding the
  aggregate budget; one failing artifact does not remove other tools.
- [x] A controller creates/edits marks with undo/redo and sends a selected marked artifact as context.
- [x] Controller drawing follows a press-hold-release gesture, keeps the canvas/title stable while
  drawing, and reliably ends the stroke on trigger release or cancellation.
- [x] Mark coordinates and attachment content agree between Flat and VR independent of panel pose.
- [x] Failed reads/exports, stale diffs, and unsupported/binary content have usable in-world states.
- [ ] Quest 3S verification completes read → annotate → attach → instruct → inspect new revision/diff.
- [x] `npm run lint`, `npm test`, `npm run build`, and `npm run test:e2e` pass, including coordinate
  mapping, attachment parity, correct checkout routing, and bounded-resource checks.

## Out of scope

Code/terminal editing, repository administration, new git write routes, model-native change overlays,
and free-floating 3D ink. Story 50 provides spatial graph exploration; existing marks remain on the
canonical artifact plane, reachable inside VR even when a graph view is open.

## How to verify

1. Use a fixture with two checkouts, staged/unstaged/untracked changes, a long diff, binary content,
   two diagram revisions, and a sketch. Verify bounded reads route to the selected checkout/machine.
2. Move/resize the artifact panel, draw and undo/redo, attach it, and inspect the fake provider's
   received context. Compare durable marks and exported composite with the Flat representation.
3. Repeat the complete journey on Quest 3S, including voice-labelled marks and reading diff lines
   from the default seat. Inject resource/read/export failure and run the repository checks.

## Verification record

September 16, 2026 — automated implementation complete. `npm run lint` passed; `npm test` passed
(62 files, 392 tests); `npm run test:e2e` passed its production build and full Chrome suite (65
tests), including the marked-export failure check. Coverage includes
checkout routing, branch/status/file and paged-diff review, panel-pose-independent coordinates,
Flat/VR mark parity, undo/redo and deliberate clear, comparison failure containment, aggregate
resource bounds, composite attachment capture, failed-send preservation, failed-export
preservation, and sketch creation. Physical Quest 3S verification remains pending.

September 17, 2026 — controller drawing now previews only while the trigger is held, commits once
on release, discards cancelled strokes, and keeps the raster/title mounted during the gesture.
`npm run lint`, the full 392-test Vitest suite, the production build, and the focused immersive
Playwright review/annotation scenario passed. The focused scenario reproduces the XR runtime's
capture-loss-before-pointer-up ordering so a normal trigger release cannot be mistaken for a
cancelled stroke. After physical testing exposed that controller release events could still be
missed, Quest trigger state is also polled each frame. A subsequent physical test exposed transient
double-allocation against the immersive pixel budget; the live stroke now paints into the existing
budgeted canvas texture and replacement generations dispose before allocating. Lint, focused unit
and budget tests, the production build, and the zero-allocation drawing Playwright scenario pass.
Physical trigger acceptance remains part of the pending Quest 3S verification above.
