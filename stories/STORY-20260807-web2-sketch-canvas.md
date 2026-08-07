# Story 22 — Sketch first: a blank canvas the user draws on and sends

**Status:** Shipped · **Type:** Full-stack · **Depends on:** [Story 18](STORY-20260805-web2-agent-mermaid-canvas.md) ·
**Epic:** [web2 operational collaboration](EPIC-20260806-web2-operational-collaboration.md)

---

## Motivation

Story 18 made ink a *reaction*: you could only draw on a diagram the agent had already produced, so
the first turn of every conversation had to be typed. That inverts how people actually explain
structure to each other.

> Could you finish the implementation of the feature of being able to make a sketch at the
> beginning of the chat and send it, not necessarily draw over diagram.

A drawing is often the clearest statement of intent — "this box talks to that one, why?" — and it
should be available before anything exists on the canvas.

---

## Current behavior (where the code is)

Before this story, a canvas was always a `DiagramArtifact` produced by an assistant message:

- The canvas took an artifact directly and always rendered Mermaid:
  [web2/components/DiagramCanvas.tsx](../web2/components/DiagramCanvas.tsx#L49).
- The empty canvas offered only text prompts:
  [web2/components/CanvasWorkspace.tsx](../web2/components/CanvasWorkspace.tsx#L100).
- Attachments assumed Mermaid source existed: `source: z.string().min(1)` in
  [web2/lib/shared/protocol.ts](../web2/lib/shared/protocol.ts#L19) and an unconditional
  `validateMermaidSource` in [web2/lib/server/tempAttachments.ts](../web2/lib/server/tempAttachments.ts#L26).

---

## Desired behavior

A **sketch** is a blank sheet the user opens directly. It lives on the thread rather than inside a
message, but shares the canvas id space with diagrams, so selection, annotations, pinning,
attachment, and history need no parallel code paths.

### Concrete changes

1. `CanvasKind`, `SketchCanvas`, and `CanvasTarget` model "whatever the canvas is showing";
   `ChatThread.sketches` is optional so threads saved before this story still load.
2. **Start a sketch** on the empty canvas (and **New sketch** in the topbar) creates a
   1600×1000 sheet, makes it active, and attaches it to the next message.
3. `DiagramCanvas` accepts a `CanvasTarget`: a sketch skips Mermaid rendering entirely and its
   sheet is ready immediately; the Mermaid error state and `.mmd` export apply only to diagrams.
4. A sketch attaches with `kind: 'sketch'`, empty source, its marks, and a composite PNG rendered
   over `EMPTY_CANVAS_SVG`. The schema *requires* source for a diagram and *forbids* it for a
   sketch, and `writeDiagramAttachments` re-checks the same rule server-side.
5. The prompt names each attachment as Sketch or Diagram and, when a sketch is present, tells the
   agent the marks and PNG are the entire content and not to invent structure.
6. Because the drawing is itself the instruction, a sketch turn sends with an empty composer,
   substituting a fixed instruction; the thread is then titled "Sketch conversation" rather than
   with that instruction.

### Type contract

```ts
export type CanvasKind = 'diagram' | 'sketch';
export interface SketchCanvas { id: string; threadId: string; ordinal: number; createdAt: string; viewBox: [number, number, number, number] }
export type CanvasTarget = { kind: 'diagram'; artifact: DiagramArtifact } | { kind: 'sketch'; sketch: SketchCanvas };
interface ChatThread { /* … */ sketches?: SketchCanvas[] }
interface DiagramMessageAttachment { /* … */ kind?: CanvasKind }  // omitted ⇒ diagram
```

---

## Acceptance criteria

- [x] A sketch can be started with no diagram present, drawn on with every existing tool, and sent.
- [x] A sketch turn sends with an empty composer; the thread title does not become the synthesized
  instruction.
- [x] The wire payload for a sketch is `kind: 'sketch'`, empty source, its marks, the sheet's
  viewBox, and a composite PNG — verified in the browser from the intercepted request.
- [x] A diagram attachment without source and a sketch attachment *with* source are both rejected,
  in the schema and again in `writeDiagramAttachments`.
- [x] A sketch produces `sketch-N-marks.json` and `sketch-N.png` and no `.mmd`.
- [x] The prompt distinguishes sketches from diagrams and explains a sketch has no Mermaid source.
- [x] Sketches persist across reload and appear in canvas history beside diagrams; threads saved
  before this story still load.
- [x] `yarn test` (83), `yarn lint`, `yarn build`, and `yarn test:e2e` (2) pass.

## Out of scope

- The agent drawing *onto* a sketch, or converting a sketch into a Mermaid diagram — it answers
  with prose or a new diagram instead.
- Sketch templates, multiple sheet sizes, images/photos as attachments, and freehand smoothing.
- Sharing ink between a sketch and a diagram derived from it.

## How to verify

`cd web2 && yarn test && yarn lint && yarn build && yarn test:e2e`.

Manually: new conversation → **Start a sketch** → draw with the pen → the composer shows
"Your sketch included · N marks" and Send is enabled with no typed text → send → the user message
reads "1 sketch attached" → reload and confirm the sheet and its ink return, and that History
lists the sketch next to any diagrams.
