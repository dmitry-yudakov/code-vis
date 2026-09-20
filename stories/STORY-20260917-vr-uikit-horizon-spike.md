# Story 55 — Spike pmndrs uikit's Horizon kit for the VR workspace

**Status:** In progress (software spike complete; Quest 3S and user verdict pending) · **Type:** Frontend-only · **Depends on:**
[Story 54](STORY-20260917-vr-quest-visual-design.md).

**Start only if** Story 54's headset check B concludes the restyled raster workspace still doesn't
feel like Quest. Otherwise mark this story Superseded.

**Recorded deviation (September 20, 2026):** the software spike was started before that check
concluded; Story 54's check B is still open. The spike also lives on `feat/spacial` rather than on
a branch of its own, so "the branch deleted" below cannot be honoured literally. On no-go, remove
instead: `UikitConversationSpike.tsx`, `uikitFontPolicy.ts`, `uikitFonts.generated.ts` (2.4 MB),
both `scripts/generate-uikit-fonts*` files, the `?vr-uikit-spike` branch in
`ImmersiveWorkspace.tsx`, its tests, and the three runtime dependencies that serve only the spike
(`@pmndrs/uikit`, `@pmndrs/uikit-horizon`, `@react-three/uikit`). It is opt-in behind a dynamic
import and adds nothing to the default bundle.

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

Keep the implementation isolated behind the `?vr-uikit-spike` query flag (and the equivalent e2e
hook). It must not replace the ordinary VR workspace before the headset verdict; the output is the
implementation and verification record below.

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

- [x] Atlases cover the listed ranges, and the fixture renders with no solid-box glyphs. The
  out-of-atlas policy is demonstrated.
- [x] Hooks set through refs pass the existing Conversation-panel e2e cases; each changed assertion
  is listed with its replacement.
- [x] Raster tooltips, diagrams, and a uikit dropdown draw in the correct order.
- [ ] Quest 3S numbers are recorded: frame deltas versus Story 54, atlas memory, and resource counts
  after twenty cycles.
- [ ] The user records go or no-go. On go, a migration story is written with the costs above. On
  no-go, this story is marked Superseded and the spike removed as listed in the recorded
  deviation above.

## Out of scope

Migrating any panel on the main branch, Canvas and Evidence in uikit, and new actions or behavior.

## Where the code is

- `scripts/generate-uikit-fonts-browser.ts:1` and `scripts/generate-uikit-fonts.mjs:1` — browser
  `TTFLoader` entry and reproducible headless atlas generator.
- `src/features/shell/immersive/uikitFontPolicy.ts:1` and
  `src/features/shell/immersive/uikitFonts.generated.ts:1` — bounded character policy and generated
  Inter 400/600 plus Geist Mono 400 atlases.
- `src/features/shell/immersive/UikitConversationSpike.tsx:47` — ref-owned hooks, Horizon
  Conversation UI, diagnostics, scroll/input integration, and explicit layering.
- `src/features/shell/immersive/ImmersiveWorkspace.tsx:84` — opt-in routing that leaves ordinary VR
  unchanged.
- `test/uikitFontPolicy.test.ts:4` and `e2e/immersive.spec.ts:1126` — character-policy and complete
  interaction/coexistence/resource regression coverage.

## How to verify

1. Run `npm install --package-lock-only --legacy-peer-deps --ignore-scripts --offline`.
2. Run `npm run lint`, `npm test`, and `CODEAI_DIST_DIR=.next-e2e npm run build`.
3. Run `CODEAI_DIST_DIR=.next-e2e npx playwright test`.
4. For atlas regeneration, obtain Inter 4.1 and Geist 1.7.0 release TTFs, then run:
   `node scripts/generate-uikit-fonts.mjs INTER_400.ttf INTER_600.ttf GEIST_MONO_400.ttf`.
5. On Quest 3S, open `/?vr-uikit-spike`, execute the Story 54 A/B fixture, and append the headset
   frame/resource numbers and user verdict below.

## Verification record

### 2026-09-18 — automated software spike

- The spike is opt-in only and loaded as its own client chunk. `?vr-uikit-spike` replaces the
  Conversation content while retaining its existing raster shell; the normal URL and existing VR
  tests continue to use the raster panel without downloading the atlas chunk.
- Atlases were generated through `@pmndrs/uikit`'s `TTFLoader` from the official Inter 4.1 regular
  and semibold TTFs and Geist 1.7.0 mono regular TTF. Each atlas contains 672 glyphs on one
  2048×2048 page. Encoded PNG sizes are 494,247 bytes, 522,474 bytes, and 486,834 bytes
  (1,503,555 total); their RGBA GPU allocation is 50,331,648 bytes (48 MiB).
- The covered set is printable Basic Latin, Latin-1 Supplement, Latin Extended-A, General
  Punctuation, Arrows, and Box Drawing, plus U+FFFD. Characters outside the set are converted to
  U+FFFD only in the uikit projection; the canonical draft retains the original text. The fixture
  preserves `Crème · café… ‹branch› → ┌─┐`; Cyrillic, CJK, and emoji exercise the replacement path.
  The browser emitted no `Missing glyph info` warning.
- `name`, `userData`, transform, input element, and transcript hooks are installed through uikit
  component refs. The spike case points at and wheels the transcript, points at/focuses/types into
  the input, and invokes the shared panel controls. No existing Conversation assertion was changed;
  the dedicated spike case adds uikit-specific hook and renderer assertions. The full existing
  Conversation cases pass unchanged.
- Canvas and Evidence remain raster. The automated scene check holds both open, exercises the
  raster Evidence tooltip at render order 1,000, and verifies the open uikit dropdown is displayed
  at render order 10,000. It also observes the renderer receiving uikit's actual
  `reversePainterSortStable` comparator. `test-results/vr-uikit-horizon-spike.png` is the generated
  comparison screenshot.
- Desktop Chrome's renderer counts did not increase beyond the asserted plateau after twenty
  close/open cycles (textures no higher than baseline; geometries at most baseline + 2). This is a
  leak regression check, not a substitute for the required Quest counts.
- Verification passed: lockfile offline audit (0 vulnerabilities), TypeScript, production build,
  all 400 Vitest tests, and all 71 Playwright tests. After isolating the spike in an on-demand client
  chunk, TypeScript, the production build, and the focused spike case passed again; that final case
  completed in 17.4 seconds (18.4 seconds including runner startup).

### Pending physical acceptance

- Quest 3S median/p95 frame deltas against Story 54 check A are not yet measured.
- Quest post-entry and post-twenty-cycle renderer texture/geometry counts are not yet recorded.
- The side-by-side user go/no-go verdict is not yet recorded; no migration story has been created.

### 2026-09-18 — external-review corrections

- Kept `ConversationTools`' action controller available while its raster visuals are hidden. The
  uikit Send ray now produces exactly one `/api/agent/message` request containing the unmodified
  Unicode draft; the intentional failure fixture confirms the established draft-retention contract.
- Reduced and repositioned the uikit surface below the retained panel header. Desktop rays now
  exercise Focus, Session tools, History/Back, and Agents in the focused spike test.
- Added raw/projected input reconciliation. Character-by-character Cyrillic, CJK, and emoji input
  remains intact in the real draft while U+FFFD remains a render-only atlas fallback.
- Replaced the transparent-sort label with an observed setter probe that compares the installed
  function by identity with uikit's exported `reversePainterSortStable`.
- Verification after the corrections: TypeScript, production build, all 401 Vitest tests, the
  strengthened spike test, and nine surrounding existing Conversation Playwright cases pass.
