# Story 49 — Review and annotate session work in VR

**Status:** Draft · **Type:** Frontend-only · **Depends on:**
[Story 46](STORY-20260905-vr-workspace-panels.md), [Story 47](STORY-20260905-vr-conversation-input.md),
[Story 48](STORY-20260905-vr-session-permissions.md).

**Vision slice:** [inside a session](../docs/vision.md#inside-a-session), delivered through the
[immersive workspace epic](EPIC-20260905-immersive-workspace.md). Uses existing artifacts and diffs;
the future software-model change overlay is independent.

## Motivation

Working in VR requires inspecting what an agent changed and showing it a correction. A viewer that
requires exiting to open a diff or mark a diagram cannot complete this loop.

## Current behavior (where the code is)

- [RepositoryDiffInspector.tsx:25](../src/features/repository/RepositoryDiffInspector.tsx#L25) reads
  bounded staged/unstaged diffs; [useRepositoryChanges.ts:7](../src/features/repository/useRepositoryChanges.ts#L7)
  provides checkout change state. There is no general file editor to port.
- [DiagramCanvas.tsx:56](../src/features/diagram/components/DiagramCanvas.tsx#L56) provides Flat
  drawing; [drawingReducer.ts:36](../src/features/diagram/annotations/drawingReducer.ts#L36) bounds
  marks and undo/redo; [compositeExport.ts:53](../src/features/diagram/annotations/compositeExport.ts#L53)
  creates the attachment projection.
- [AppShell.tsx:605](../src/features/shell/AppShell.tsx#L605) selects artifacts and
  [613](../src/features/shell/AppShell.tsx#L613) creates sketches; Story 44 only shows the active texture.

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

- [ ] Readable checkout status, changed files, and bounded diffs are available alongside chat in VR.
- [ ] Two artifact revisions can be compared without losing the active session or exceeding the
  aggregate budget; one failing artifact does not remove other tools.
- [ ] A controller creates/edits marks with undo/redo and sends a selected marked artifact as context.
- [ ] Mark coordinates and attachment content agree between Flat and VR independent of panel pose.
- [ ] Failed reads/exports, stale diffs, and unsupported/binary content have usable in-world states.
- [ ] Quest 3S verification completes read → annotate → attach → instruct → inspect new revision/diff.
- [ ] `npm run lint`, `npm test`, `npm run build`, and `npm run test:e2e` pass, including coordinate
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

Pending implementation and Quest 3S verification.
