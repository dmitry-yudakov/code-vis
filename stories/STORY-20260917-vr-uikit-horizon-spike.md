# Story 55 — Spike pmndrs uikit's Horizon kit for the VR workspace

**Status:** Draft (conditional) · **Type:** Frontend-only · **Depends on:**
[Story 54](STORY-20260917-vr-quest-visual-design.md).

**Start only if** Story 54's headset check B concludes the restyled raster workspace still doesn't
feel like Quest. Otherwise mark this story Superseded.

## Motivation

`@pmndrs/uikit-horizon` is an MIT-licensed kit (Bela Bohlender 2024, Meta Platforms 2025) based on
Meta's Reality Labs Design System and offered by Meta's Immersive Web SDK. It could give CodeAI
native-looking panels, flex layout, and MSDF text that stays sharp at any distance. A September 17
review of the packages found problems that must be solved before any migration is worth planning.
This spike answers whether they can be solved at acceptable cost. It is not a migration.

## Known blockers and risks (verified in `@react-three/uikit*` 1.0.76)

- **Glyph coverage.** The bundled Inter and mono MSDF fonts (`@pmndrs/msdfonts`) contain 104 glyphs:
  ASCII plus `ÄÖÜäöüß§°`. They lack `·`, `…`, `‹`, `›`, and all other Unicode, and uikit renders any
  missing glyph as a solid box (`MISSING_GLYPH`, `renderSolid: true` in
  `@pmndrs/uikit/dist/text/font.js`). The loader accepts one atlas page (`text/cache.js`). Bundled
  Inter has no 400 weight.
- **Test hooks.** The R3F wrapper forwards only `args` and event handlers (`build.js`), so `name`
  and `userData` must be set through refs; `Component extends Mesh`. Wrapping in a `<group>` breaks
  layout, because a child's parent container is `this.parent instanceof Component`.
- **Kit defaults below Meta's minimums.** Buttons and icon buttons are 44 dp; `sm` sizes and field
  labels use 12 dp text; dividers are 1 dp. The light panel gradient `#FFFFFF`→`#F2F2F2` is
  hard-coded in `background-material.js`. The kit has no tooltip, control bar, segmented control, or
  card.
- **Contrast.** Kit dark negative `#F7818C` on `#414141` is 4.1:1; white on the destructive button
  is 2.5:1.
- **Renderer-global side effects.** uikit enables `localClippingEnabled` and sets
  `setTransparentSort(reversePainterSortStable)` on the whole renderer. It caches font atlases
  globally without disposal.
- **Dependencies.** Three direct packages (eight in total); the Inter chunk is about 450 KB.
  `zod`, `zustand`, and `@pmndrs/pointer-events` dedupe with the lockfile.

## Spike scope

Work on a throwaway branch. Nothing merges; the output is the verification record below.

1. **Fonts.** Generate Inter 400/600 and Geist Mono MSDF atlases offline with uikit's `TTFLoader`.
   Cover Latin-1, Latin Extended-A, General Punctuation, Arrows, and Box Drawing. Measure atlas size
   and check whether multiple pages are needed. Decide a policy for characters outside the atlas: a
   raster fallback, a replacement glyph, or larger atlases.
2. **Conversation panel.** Rebuild it in uikit with Story 54's `immersiveTheme.ts` tokens and sizes:
   header, transcript, inline input, Control Bar. Set test hooks through refs; confirm
   `pointAtAction` and the scroll tests work through desktop pointer events.
3. **Coexistence.** Keep Canvas and Evidence raster panels open. Check draw order of raster
   tooltips and diagrams under uikit's transparent sort, and whether a uikit dropdown renders in
   front of neighbouring panels.
4. **Measurement on Quest 3S.** Use Story 54's fixture: three panels, a 200-message transcript with
   `·…‹›`, accented, and non-Latin text, and a streaming reply.
   - Record median and p95 frame deltas against Story 54's check A numbers.
   - Record font atlas memory and renderer texture/geometry counts after first entry, and after
     twenty open/close cycles against that post-entry baseline.
   - Record the user's side-by-side verdict against the Story 54 panel.

## Acceptance criteria

- [ ] Atlases cover the listed ranges, and the fixture renders with no solid-box glyphs. The
  out-of-atlas policy is demonstrated.
- [ ] Hooks set through refs pass the existing Conversation-panel e2e cases; each changed assertion
  is listed with its replacement.
- [ ] Raster tooltips, diagrams, and a uikit dropdown draw in the correct order.
- [ ] Quest 3S numbers are recorded: frame deltas versus Story 54, atlas memory, and resource counts
  after twenty cycles.
- [ ] The user records go or no-go. On go, a migration story is written with the costs above. On
  no-go, this story is marked Superseded and the branch deleted.

## Out of scope

Migrating any panel on the main branch, Canvas and Evidence in uikit, and new actions or behavior.

## Verification record

_Not started._
