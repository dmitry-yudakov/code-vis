# Story 30 — Add a light, dark, and system theme switch

**Status:** Draft · **Type:** Frontend-only ·
**Depends on:** [Story 29](STORY-20260828-semantic-design-tokens.md) (semantic tokens) ·
**Epic:** [shell design system](EPIC-20260828-shell-design-system.md)

---

## Motivation

> Dark theme will also be needed with ability to easily switch.

CodeAI is a tool people keep open beside a terminal and an editor, both of which are usually dark.
The application is currently light-only and has no way to follow the desktop.

Story 29 made every color resolve through a semantic token, so the theme is now a matter of
redefining ~30 values. Two things still need real work: the switch must not flash the wrong theme
before hydration, and Mermaid holds its own hardcoded palette that caches after first
initialization — the diagram would stay light on a dark canvas.

---

## Current behavior (where the code is)

- The document root carries no theme information:
  `<html lang="en">` in [layout.tsx](../src/app/layout.tsx#L11) (~line 11). There is no inline
  script and no `suppressHydrationWarning`.
- After Story 29, `globals.css` declares only the light set in `:root`
  ([globals.css](../src/app/globals.css#L1)).
- Mermaid initializes **once per page load** behind a module-level flag and pins a light palette:
  `let initialized = false` in
  [mermaidRenderer.ts](../src/features/diagram/mermaid/mermaidRenderer.ts#L5) (~line 5), with
  `themeVariables` literals at [mermaidRenderer.ts](../src/features/diagram/mermaid/mermaidRenderer.ts#L16)
  (~lines 16–25). `mermaid.initialize` is a no-op on later calls, so the palette cannot change
  after the first render without resetting the flag.
- Rendered diagrams are cached as SVG strings by the canvas and by
  [DiagramCard.tsx](../src/features/diagram/components/DiagramCard.tsx), so a theme change must
  invalidate and re-render, not just re-initialize.
- **The only theme-sensitive raster in the application is the attachment composite, not a
  download.** `compositePng` rasterizes the *currently cached* SVG plus the user's marks when a
  canvas is attached to an agent message
  ([AppShell.tsx](../src/features/shell/AppShell.tsx#L604), ~lines 604–610). Under a dark theme the
  agent would receive a dark-background image — a correctness problem, not a cosmetic one.
- What the UI calls export is theme-independent and unaffected: the canvas offers `.mmd` source
  text and a marks JSON download
  ([DiagramCanvas.tsx](../src/features/diagram/components/DiagramCanvas.tsx#L265), ~lines 265–274),
  and the header **Export** serializes the conversation to JSON
  ([conversationStore.ts](../src/features/conversation/conversationStore.ts#L93), ~line 93). There
  is no PNG download anywhere.
- `localStorage` currently holds exactly one key, the selected-checkout preference
  ([AGENTS.md](../AGENTS.md#L76)). A theme preference is device-only and belongs in the same place.
- The header actions region is [AppShell.tsx](../src/features/shell/AppShell.tsx#L880) (~line 880).

---

## Desired behavior

Three states, not two: **Light**, **Dark**, and **System**. System is the default and follows
`prefers-color-scheme` live. An explicit choice stamps `data-theme` on `<html>` and wins over the
OS in both directions.

The CSS pattern is the three-block form, and every color stays defined at token level so no
component rule ever lives inside a media query:

```css
:root { /* complete light palette */ }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { /* dark tokens only */ }
}
:root[data-theme="dark"] { /* dark tokens only */ }
```

### Concrete changes

1. Extend `scripts/generate-tokens.ts` from Story 29 to emit the two dark blocks above from
   `palette.dark`. The blocks are emitted into the generated `tokens.css` and contain only
   custom-property declarations, so `globals.css` stays literal-free and no component selector
   ever appears inside a media or `[data-theme]` block.
2. Emit `color-scheme: light` and `color-scheme: dark` inside the corresponding root blocks, so
   native controls, scrollbars, and the canvas backdrop follow an **explicit in-app override**.
   Add Next's `viewport` export in [layout.tsx](../src/app/layout.tsx#L4) with
   `colorScheme: 'light dark'` for the pre-hydration default. A static `<meta>` alone does not
   follow an override and is not sufficient.
3. Add a blocking inline script in [layout.tsx](../src/app/layout.tsx#L11) that reads the stored
   preference and stamps `data-theme` before first paint. Wrap the `localStorage` read in
   `try/catch` — it throws in some privacy modes — and default to System on any failure. Add
   `suppressHydrationWarning` to `<html>` because the script mutates it before React attaches.
4. Add a `useTheme` hook owning the three-state preference: reads and writes `code-ai:theme` in
   `localStorage`, subscribes to `matchMedia('(prefers-color-scheme: dark)')` while in System, and
   exposes the resolved theme. `setPreference` must stamp `<html data-theme>` **synchronously**,
   and the hook must reapply the stamp in `useLayoutEffect` — development Strict Mode can discard
   root attributes set by the inline script, per the Next.js 16 guidance bundled in
   `node_modules/next/dist/docs/`.
5. Add a segmented Light / Dark / System control to the header actions in
   [AppShell.tsx](../src/features/shell/AppShell.tsx#L880), labelled and keyboard-operable.
6. **Make the theme an explicit argument rather than global renderer state.** `renderMermaid`
   takes a `theme` and builds `themeVariables` from that theme's tokens; `mermaid.initialize` is
   called per render when the requested theme differs from the last initialized one. A global
   `resetMermaidTheme()` is rejected: it cannot express "render this one light for the agent
   composite while the canvas is dark", and it races between the canvas, the diagram cards, and
   the composite.
   Because `mermaid.initialize` is process-global, serialize renders through a module-level
   promise chain so a light composite render cannot interleave with a dark canvas render.
7. Re-render every visible diagram when the resolved theme changes: drop the cached SVG in the
   canvas and in each `DiagramCard` and re-render at the new theme. Preserve pan, zoom, and
   annotation marks across the re-render — the ink layer is independent of the Mermaid SVG and
   must not be cleared.
8. Render the **attachment composite** at `'light'` regardless of the active theme, by rendering a
   throwaway light SVG for `compositePng` at
   [AppShell.tsx](../src/features/shell/AppShell.tsx#L604) instead of reusing
   `snapshotRef.current.svg`. What the agent receives must not depend on the user's appearance
   setting. Sketch attachments are unaffected — `EMPTY_CANVAS_SVG` has no theme.

### Type contract

```ts
// src/features/shell/useTheme.ts
export type ThemePreference = 'light' | 'dark' | 'system';

export function useTheme(): {
  preference: ThemePreference;      // what the user chose
  resolved: 'light' | 'dark';       // what is actually painted
  setPreference: (next: ThemePreference) => void;
};

// src/features/diagram/mermaid/mermaidRenderer.ts
// Theme is an argument, never ambient. Renders are serialized because mermaid.initialize
// is process-global: a light composite render must not interleave with a dark canvas render.
export function renderMermaid(
  id: string,
  source: string,
  theme: 'light' | 'dark',
): Promise<{ svg: string; viewBox: [number, number, number, number] }>;
```

Stored under `code-ai:theme`. An unrecognized stored value is treated as `system`.

---

## Acceptance criteria

- [ ] Light, Dark, and System are selectable from the header; the choice survives reload.
- [ ] System follows the OS live — changing the desktop appearance while the app is open repaints
  it without a reload.
- [ ] An explicit Light choice stays light under a dark OS, and an explicit Dark choice stays dark
  under a light OS.
- [ ] No flash of the wrong theme on load or on a hard refresh, in either OS setting, and the
  stamp survives development Strict Mode remounts.
- [ ] Native controls and scrollbars follow an explicit in-app override, not just the OS setting.
- [ ] A `localStorage` read or write that throws leaves the app on System rather than failing.
- [ ] `globals.css` still contains no color literal, and the theme blocks in the generated
  `tokens.css` redefine custom properties only — no component selector appears in either.
- [ ] `renderMermaid` takes an explicit theme; no module-level "current theme" exists.
- [ ] Mermaid diagrams re-render in the active theme, on the canvas and in conversation diagram
  cards, without losing pan, zoom, or annotation marks.
- [ ] The composite PNG attached to an agent message is light in both themes, verified from the
  intercepted request payload.
- [ ] A light composite render issued while the canvas is dark leaves the canvas dark — the two
  do not race.
- [ ] Body text, muted text, and every state color meet WCAG AA contrast against their own surface
  in both themes.
- [ ] `npm test`, `npm run lint`, `npm run build`, and `npm run test:e2e` pass, with a new
  Playwright case asserting the stamp and the re-rendered diagram in dark.

## Out of scope

- Persisting the theme to the host so it follows the user across devices. It is a device
  preference and stays in `localStorage` beside the checkout key.
- A high-contrast or custom user theme.
- Restyling anything. Dark is the same design in the mirrored palette —
  [Story 32](STORY-20260828-visual-language.md) owns the visual language.
- Theming the drawing ink palette per theme; marks keep their stored color and are drawn over the
  sheet, which stays the lightest surface in both themes.

## How to verify

1. `npm test && npm run lint && npm run build && npm run test:e2e`.
2. Set the desktop to dark, open CodeAI, and confirm it loads dark with no light flash. Repeat
   with the desktop light.
3. Choose **Light** explicitly, switch the desktop to dark, and confirm the app stays light.
   Reload and confirm it is still light. Repeat inverted with **Dark**.
4. With a diagram on the canvas: draw two marks, zoom to ~150%, pan off-center, then switch
   theme. The diagram must repaint in the new palette with the marks, zoom, and pan intact.
5. Open the conversation drawer with a diagram card visible and confirm the card repaints too.
6. In **dark** mode, attach the diagram and send a message. From the browser network panel, decode
   the attachment's composite PNG and confirm it has a light background — and that the canvas
   behind it stayed dark throughout.
7. Run `npm run dev` and confirm the theme stamp survives Strict Mode's double render.
