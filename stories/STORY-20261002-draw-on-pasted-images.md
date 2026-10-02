# Story 87 — Open pasted screenshots on the canvas and draw over them

**Status:** Shipped · **Type:** Frontend-only · **Depends on:** [Story 81](STORY-20260930-paste-image-into-chat.md).

## Motivation

The user on October 2, 2026: “Pasting screenshot works but I'm unable to open it in canvas for drawing by clicking on it”. Story 81 attached screenshots but deferred this interaction. This completes that slice of the conversation and canvas change loop in [the vision](../docs/vision.md).

## Current behavior (where the code is)

- [InstructionComposer.tsx:428](../src/features/conversation/InstructionComposer.tsx#L428) shows an image thumbnail and a remove button; there is no open action.
- [AppShell.tsx:876](../src/features/shell/AppShell.tsx#L876) keeps prepared images in browser memory per session and sends their unmarked bytes.
- [CanvasWorkspace.tsx:72](../src/features/diagram/components/CanvasWorkspace.tsx#L72) selects a durable diagram or sketch.
- [DiagramCanvas.tsx:62](../src/features/diagram/components/DiagramCanvas.tsx#L62) supplies drawing, undo/redo, erasing, and view controls.
- [imageAttachments.ts:57](../src/features/conversation/imageAttachments.ts#L57) re-encodes images within the existing pixel and byte limits.

## Desired behavior

Clicking a pending screenshot's thumbnail or label opens it on the flat canvas, including when the canvas is hidden. Existing drawing tools place ink over its pixels. Each image retains its own marks when switching images, canvases, or sessions. A Back to canvas action returns to the session's diagram or sketch. Removing an image or delivering its message clears its pending surface.

On Send, combine each marked image with its ink and run the existing bounded preparation again. Send one image attachment per screenshot, with metadata describing the actual encoded composite. Preserve the original screenshot and marks after preparation failures, failed turns, or cancellation. Images and marks remain browser memory only, as in Story 81; durable records and server contracts do not change.

Image drawing tools and shortcuts stop accepting edits while preparation or a turn runs, so the
pending ink stays consistent with the sent snapshot. View controls remain available. On a narrow
screen, opening an image closes the conversation overlay so the canvas can receive pointer input.

### Type contract

`PendingImage` gains optional `marks: DrawingMark[]`. The desktop drawing component accepts an additional local image target; the shared durable `CanvasTarget`, session format, and message wire remain unchanged. Image selection, marks, and camera updates must not enter durable canvas annotations or localStorage.

## Acceptance criteria

- [x] Each pending image has an accessible open button covering thumbnail and label; Remove remains independent.
- [x] Opening shows its actual pixels on the flat canvas even when hidden or previously spatial; Back to canvas restores the durable surface.
- [x] Drawing and undo/redo work, and image marks survive switching images and sessions without modifying durable annotations.
- [x] Send includes the marked screenshot exactly once, within existing byte and pixel limits, and records its actual format and size.
- [x] Preparation failures, failed sends, and cancellation preserve the screenshot and marks; successful delivery and Remove close its pending canvas.
- [x] Focused browser checks, image/sketch unit regressions, and TypeScript pass; review has no unresolved findings.

## Out of scope

Retaining screenshots after reload/delivery, opening historical transcript images (only metadata remains), VR image editing, new attachment entry points, and server/storage/schema changes.

## How to verify

1. Run `npm run lint -- --incremental false` and
   `npm test -- test/imageAttachments.test.ts test/sketchCanvas.test.ts test/drawingReducer.test.ts test/newChat.test.ts`.
   Run `npm run test:e2e -- e2e/images.spec.ts --project=chrome`, then the related checks against
   that build:

   ```sh
   CODEAI_DIST_DIR=.next-e2e npx playwright test e2e/canvas.spec.ts e2e/new-chat.spec.ts --project=chrome --grep 'creates, annotates|sketches a blank canvas|switches themes|docks only the panels|hides the canvas for a wide conversation|fresh .* chat|disables New chat'
   ```
2. Paste a screenshot, click its thumbnail or label, draw over it, use Undo/Redo, switch images, and return to it.
3. Hide the canvas and open the chip again. Verify it reappears with its marks. Return to the diagram using Back to canvas.
4. Send; inspect the outgoing composite pixels and metadata. Simulate an export failure and a rejected send: the draft and drawing remain available for retry.

## Implementation and verification

- [InstructionComposer.tsx:428](../src/features/conversation/InstructionComposer.tsx#L428)
  opens a pending image from its chip. [AppShell.tsx:903](../src/features/shell/AppShell.tsx#L903)
  reveals the canvas, retains per-session image selection and ink in browser memory, and closes
  the conversation overlay when needed.
- [CanvasWorkspace.tsx:80](../src/features/diagram/components/CanvasWorkspace.tsx#L80)
  supplies the local image drawing target while keeping durable marks, cameras and export frames
  separate. [DiagramCanvas.tsx:128](../src/features/diagram/components/DiagramCanvas.tsx#L128)
  keeps delayed parent echoes from truncating the image's stroke or clearing its undo history.
- [imageCanvas.ts:14](../src/features/diagram/annotations/imageCanvas.ts#L14) exports marked
  pixels through the existing composite renderer and bounded image preparation without replacing
  the editable original. The shell snapshots the sending session's canvas frame before asynchronous
  image export, preserving a sketch attachment even when navigation changes the visible session.
- October 2, 2026: the production build, TypeScript checking and all 32 focused unit tests passed.
  All 17 distinct focused production-browser checks passed: eight image checks, five canvas/layout
  regressions, and four New chat regressions. The checks inspect the outgoing marked pixels and
  recorded format/bytes, per-image and per-session isolation, hidden/spatial canvas return,
  narrow-screen pointer access, Undo/Redo, edit locking, export failure, rejected sends,
  cancellation, Remove, successful delivery and navigation during image export.
- The browser checks first failed on truncated strokes and on empty overlay containers blocking
  narrow-screen input. Images now use their mounted editor as the ink owner, with parent state
  restoring it on remount; empty repository/conversation containers ignore pointer events.
- Final review by a separate subagent found no blocking defects in gesture/Undo handling,
  durable Flat/VR synchronization, per-image/session isolation, bounded export and metadata,
  send-time navigation, failure preservation or empty-overlay pointer handling.
