# Story 33 — Correct the details the restyle left behind

**Status:** Shipped · **Type:** Frontend-only ·
**Depends on:** [Story 32](STORY-20260828-visual-language.md) (sheet and instrument) ·
**Epic:** [shell design system](EPIC-20260828-shell-design-system.md)

---

## Motivation

> ok, it's implemented but there are some small visual details that need improvement

Story 32 landed the visual language. A pass through the running application in both themes at
1600px and 1100px found twenty-one details that did not survive the translation from mock to
shell: a header row that overflows its own grid track, two controls stranded by flex sizing that
only misbehaves above ~1300px, three places where a state hue is used for something that is not a
state, and several counts and labels that state a fact twice or state it in jargon.

None of it is structural. All of it is the kind of thing that reads as unfinished.

---

## Current behavior (where the code is)

- [globals.css](../src/app/globals.css#L165) (~line 165) pinned the conversation drawer's header
  row at 48px while its eyebrow/title/provider-badge stack measures 51px.
- [globals.css](../src/app/globals.css#L22) (~lines 22, 46–48) sized the project trigger and the
  conversation select's wrapper independently of their content.
- [globals.css](../src/app/globals.css#L297) (~line 297) and `.attachment-chip.sketch` (~line 109)
  set `wait` ink on a `plot` ground.
- [globals.css](../src/app/globals.css#L336) (~lines 336, 340, 270, 359, 361) used `live` for a
  branch glyph, an ahead/behind count, canvas provenance, a rename's previous path, and git areas.
- [mermaidRenderer.ts](../src/features/diagram/mermaid/mermaidRenderer.ts#L15) (~lines 15–31) set
  `primaryColor` but not `cScale0…n`.
- [RepositoryChangesView.tsx](../src/features/repository/RepositoryChangesView.tsx#L41) (~lines 41,
  78) showed git status twice per row and three counters including zeros.
- [DiagramNavigator.tsx](../src/features/diagram/components/DiagramNavigator.tsx#L25) (~lines 25,
  58) numbered cards 01…n from array position while titling them from `ordinal`.

---

## Shipped behavior

### Defects

1. The drawer and navigator header rows size to content (`auto`, `min-height: 48px`). Pinned at
   48px the eyebrow was clipped by the panel and the provider badge spilled onto the transcript.
2. `.repository-toggle.dirty` no longer mixes `wait` ink and border with a `plot` ground and a
   `plot` badge. An uncommitted tree is a fact about the repository, not an approval, so it reads
   achromatic and the count is the signal — which also frees `wait` to mean one thing.
3. Both attachment chips are diagram ink. The sketch variant set `wait` ink inside a `plot` chip,
   and the base chip was `live`; neither is a run state.
4. The project trigger shrink-wraps its label instead of holding 260px with `space-between`, which
   stranded the chevron beside a short project name.
5. `.thread-picker` caps the wrapper rather than the select. A growing wrapper around a capped
   select put the new-conversation button 335px from the picker it belongs to at 1600px — and
   correctly beside it below ~1100px, which is why it survived review.

### Consistency

6. One control height (28px) across the header; the row previously landed on 25/26/28/32px.
7. Header actions grouped by function — panels, thread action, readiness, then the one preference
   behind a rule.
8. Theme labels at 10px rather than 9px, the smallest type in the application.
9. The repository refresh icon is neutral, matching the close button beside it.

### Hue

10–12. Neutral branch glyph, ahead/behind count, canvas provenance, previous path, git-area chips
and repository count badge. Hue stays with `live`, `wait`, `stop`, `plot`, `add` and `del`.

### Information

13. Untracked files no longer carry both a `?` status mark and a `U` area chip. Staged/working
    tree remains, because it is a different fact.
14. Working-tree counters spell out only the non-zero ones (`9 unstaged · 2 untracked`).
15. Canvas history cards carry a kind mark, not a running index. `01…05` beside titles reading
    "Diagram 1 … Diagram 1" numbered an order the list does not have.
16. Timestamps drop seconds: `Aug 26, 8:57 PM`.
17. The titleblock and the attachment chip omit a zero mark count, and count marks in the singular.
18. The canvas controls separate view actions from downloads with a rule, and the downloads say
    what they save (`Source`, `Marks`) rather than the file format.

### Mermaid

19. `plotScale1…5` in [tokens.ts](../src/shared/design/tokens.ts#L54) feed `cScale0…11` and
    `cScaleLabel0…11`. Mindmap, pie, journey and quadrant sections read `cScale`, not
    `primaryColor`; unset, the base theme derives them by rotating the primary hue and lands on
    magenta and purple. Flowcharts were already on-palette, which is why this went unnoticed.
20. Transcript diagram previews scale to the card's width and fade off the overflow, instead of
    letterboxing a wide diagram down to unreadable 3px type.

### Typography

21. The empty-canvas measure is 760px. At 700px the display headline's second line broke, dropping
    "mean." onto a third line alone.

---

## Acceptance criteria

- [x] No panel header clips its own content or overlaps the region below it.
- [x] Every control in the 48px header is 28px tall, and the row is grouped by function.
- [x] No component mixes two state hues, and no state hue is used for a non-state.
- [x] Mindmaps render in the plot family in both themes.
- [x] No count is displayed at zero, and no fact is stated twice in one row.
- [x] The empty-canvas headline sets in two lines at desktop width.
- [x] `npm test`, `npm run lint`, `npm run build`, and `npm run test:e2e` pass.

## Out of scope

- **Naming a canvas.** Two cards can still both read "Diagram 1" when a later artifact starts a
  new lineage from an attached canvas — the ordinals genuinely collide. Distinguishing them needs
  a name field on `DiagramArtifact`, the data-model change Story 32 deferred and this one does
  not reopen. The lineage line tells them apart in the meantime.
- Per-call lifecycle for the run ribbon, a component library, Tailwind — unchanged from Story 32.

## How to verify

Automated on 2026-08-29: 159 Vitest assertions and seven Playwright scenarios pass. Two e2e
assertions were updated because they pinned behaviour this story deliberately changed — the
titleblock's `0 marks` and the chip's `1 marks`.

1. `npm test && npm run lint && npm run build && npm run test:e2e`.
2. At 1600px wide, confirm the project chevron sits beside its label and the `+` beside the
   conversation picker; repeat at 1100px, where both were already correct.
3. Open a conversation with a long transcript and scroll: the header must stay opaque and
   uncrossed.
4. Open a mindmap diagram in both themes and confirm no magenta or purple.
