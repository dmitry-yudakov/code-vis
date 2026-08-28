# Story 29 — Replace hardcoded colors with a semantic design-token layer

**Status:** Shipped · **Type:** Frontend-only · **Depends on:** nothing ·
**Epic:** [shell design system](EPIC-20260828-shell-design-system.md)

---

## Motivation

A dark theme is wanted, and the obstacle is not the components — it is that the stylesheet has
almost no color indirection. `src/app/globals.css` declares 18 custom properties but then writes
**73 distinct hex literals across 126 occurrences** and **49 `rgba()` literals** directly into 135
selectors. Every one of those is a value that a second theme would have to override individually,
so "add dark mode" currently reads as a rewrite rather than a diff.

The token names are also physical rather than semantic — `--paper`, `--rust`, `--sage` describe a
specific cream-and-terracotta palette, so they cannot survive a palette change or invert into a
dark theme without lying about what they are.

A VR client using react-three-fiber is planned alongside the web version. WebGL materials cannot
read CSS, so the palette has to exist as data that both the DOM shell and the r3f renderer can
import — which also settles the question of whether to adopt Tailwind and shadcn/ui: their token
layer would be locked inside a CSS framework the VR client cannot use.

This story changes **no pixels**. It only makes the next two stories possible.

---

## Current behavior (where the code is)

- The whole palette is 18 physically-named properties in the `:root` block at
  [globals.css](../src/app/globals.css#L1) (~lines 1–19): `--ink`, `--paper`, `--rust`, `--sage`,
  `--line`, plus font stacks.
- Literals are written inline throughout. Representative clusters:
  - Header and chrome: `rgba(239, 226, 204, .94)` in [globals.css](../src/app/globals.css#L31)
    (~line 31), `#f9f3e9` (~line 81), `#f1e6d4` (~lines 116, 150, 155).
  - State colors have no tokens at all: `#8c491a` (agent mode, warnings) appears 15 times;
    `#fff0e6`, `#fff2eb` (caution washes) appear 8 times.
  - Git status marks hardcode their own palette in [globals.css](../src/app/globals.css#L340)
    (~lines 340–351).
  - Diff colors are literal in [globals.css](../src/app/globals.css#L371) (~lines 371–376):
    `#edf3df` additions, `#fae5da` removals, `#f1eaf6` hunks.
  - Code blocks pin a near-black that no token knows about:
    `background: #2d2925; color: #f8ead5` in [globals.css](../src/app/globals.css#L214) (~line 214).
- Mermaid carries a *second, duplicate* palette as a literal object in
  [mermaidRenderer.ts](../src/features/diagram/mermaid/mermaidRenderer.ts#L16) (~lines 16–25).
- `src/shared/` holds the side-effect-free modules imported from both sides
  ([AGENTS.md](../AGENTS.md#L48)) but owns nothing about presentation today.

---

## Desired behavior

One palette, declared once as data, **generated** into CSS custom properties, and consumed
everywhere by semantic name. Chrome is achromatic; every hue in the application carries meaning —
run state, mode escalation, git status, or diagram ink.

`src/shared/design/tokens.ts` is the single source of truth. It is a plain object with no imports,
no Node built-ins, and no DOM access, so it satisfies the existing `src/shared` constraint and can
be imported by a future react-three-fiber client without dragging in CSS.

CSS never restates a color. A small script projects `tokens.ts` into a **committed, generated**
`src/app/tokens.css` holding nothing but custom-property declarations. `globals.css` imports it and
contains no color values at all. Generated rather than hand-mirrored, and committed rather than
built, so the repository stays the source of truth for what ships and no build step is added to
`next dev`.

This split is also what lets [Story 30](STORY-20260828-theme-switch.md) add dark values without
fighting the lint rule below: the dark blocks are additional declaration blocks in the *generated*
file, and `globals.css` stays literal-free either way.

### Concrete changes

1. Add `src/shared/design/tokens.ts` exporting a `light` and `dark` record over one token key
   union, plus the font stacks. No side effects, no framework dependency. Story 29 uses only the
   light record; the dark record is declared here but not yet emitted.
2. Add `scripts/generate-tokens.ts` and an `npm run tokens` script that writes
   `src/app/tokens.css` from `tokens.ts`. The file carries a generated-file header naming its
   source. Story 29 emits one `:root` block; Story 30 extends the emitter, not the CSS.
3. Import `tokens.css` from `globals.css` and delete the existing `:root` block there.
4. Replace all 126 hex occurrences and 49 `rgba()` literals in `globals.css` with `var(--token)`
   references. Where a literal has no semantic equivalent yet, add the token rather than keeping
   the literal.
5. Derive shadows, washes, and the canvas grid from tokens too — they are theme-sensitive and are
   currently the easiest thing to leave behind.
6. Add two Vitest checks, which together are the parity guarantee:
   - **Purity:** `globals.css` contains no hex or `rgba()` literal anywhere. Font stacks and the
     keywords `transparent`, `inherit`, and `currentColor` are exempt.
   - **Parity:** regenerating `tokens.css` from `tokens.ts` in memory byte-matches the committed
     file, so the two can never drift. This test is what makes a committed generated file safe.
7. Leave `mermaidRenderer.ts` alone. Its palette is deduplicated in Story 30, where it also has to
   take an explicit theme.

### Type contract

```ts
// src/shared/design/tokens.ts — imported by globals.css generation and, later, the r3f client.
export type ThemeName = 'light' | 'dark';

export type ColorToken =
  // surfaces: the sheet is the diagram; the shell is everything around it
  | 'sheet' | 'shell' | 'shellSunk' | 'raised'
  // text and rules
  | 'ink' | 'ink2' | 'muted' | 'faint' | 'line' | 'lineStrong'
  // meaning, not decoration
  | 'live' | 'liveWash'      // a run is in progress
  | 'wait' | 'waitWash'      // Agent mode, pending approval
  | 'stop' | 'stopWash'      // failed, denied
  | 'plot' | 'plotWash'      // diagram ink, links
  | 'add'  | 'addWash'       // git additions
  | 'del'  | 'delWash'       // git removals
  | 'grid';                  // canvas dot grid

export const palette: Record<ThemeName, Record<ColorToken, string>>;
export const fonts: { sans: string; mono: string; display: string };
```

CSS custom properties use the kebab spelling of each key: `sheet` → `--sheet`,
`shellSunk` → `--shell-sunk`, `liveWash` → `--live-wash`.

---

## Acceptance criteria

- [x] `src/shared/design/tokens.ts` exports the light and dark palettes and the font stacks, with
  no imports, no Node built-ins, and no DOM access.
- [x] `npm run tokens` regenerates `src/app/tokens.css`, which is committed and contains only
  custom-property declarations under a generated-file header.
- [x] `globals.css` imports `tokens.css` and contains **no** hex or `rgba()` literal anywhere.
- [x] A Vitest case fails if a color literal is reintroduced into `globals.css`.
- [x] A Vitest case fails if the committed `tokens.css` does not byte-match a fresh generation
  from `tokens.ts`.
- [x] The rendered application is visually unchanged: the light palette maps the existing values
  onto the new names.
- [x] Git status marks, diff colors, code blocks, shadows, and the canvas grid all resolve through
  tokens rather than literals.
- [x] `npm test`, `npm run lint`, `npm run build`, and `npm run test:e2e` pass.

Verified August 28, 2026: 146 Vitest tests, strict TypeScript, the production build, and all four
Playwright scenarios pass. The before/after 1280×720 canvas screenshots differ only in 37 pixels
belonging to the live repository change-count glyph (`4` → `5`); the other 921,563 pixels match.

## Out of scope

- Declaring the dark values in CSS or adding any switch — [Story 30](STORY-20260828-theme-switch.md).
- Deduplicating the Mermaid palette — [Story 30](STORY-20260828-theme-switch.md).
- Any change to typefaces, spacing, radius, or layout — [Story 32](STORY-20260828-visual-language.md).
- Running the generator during `next dev` or `next build`. `tokens.css` is committed and the
  parity test guards it; adding a codegen step to the build is a cost with no benefit here.
- Spacing and type-scale tokens. Colors are what block dark mode; the rest can follow once the VR
  client actually needs them.

## How to verify

1. `npm test && npm run lint && npm run build && npm run test:e2e` from the repository root.
2. `grep -cE '#[0-9a-fA-F]{3,8}\b|rgba?\(' src/app/globals.css` must report `0`.
3. `npm run tokens && git diff --exit-code src/app/tokens.css` must be clean.
4. Start the app against a project with uncommitted changes. Compare against a screenshot taken
   before the change: the header, canvas, repository sidebar, diff inspector, conversation drawer,
   permission cards, and mode selector must all be pixel-identical.
