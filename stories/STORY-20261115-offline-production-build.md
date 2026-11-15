# Story 139 — Restore the normal production build

**Status:** Shipped · **Type:** Full-stack · **Depends on:** nothing

## Motivation

The normal production build fails while fetching Google Fonts. Earlier Story 134 verification
also recorded generated route-type failures and used webpack compile/generate as a workaround.
A local-first application should build with its installed dependencies without contacting a font
service or bypassing Next.js validation.

## Current behavior (where the code is)

- [Root layout](../src/app/layout.tsx#L2) fetches Geist, Geist Mono, Archivo and Inter at build time.
- [Arena GET](../src/app/api/arena/route.ts#L27),
  [Checkouts GET](../src/app/api/checkouts/route.ts#L11) and
  [Projects GET](../src/app/api/projects/route.ts#L10) supply default synthetic requests, making
  the exported request parameters optional for Next.js's generated checks.
- [Build command](../package.json#L12) uses the normal Next.js production build with Turbopack.

## Desired behavior

Bundle the same font families locally, including their licenses and source provenance, and load
them through `next/font/local`. Preserve existing CSS variables, fallbacks, swap behavior, Archivo's
width range and Inter's disabled preload. Use required `Request` arguments on the affected routes,
matching Next.js's runtime contract; direct unit callers must supply real requests.

Disable synthesized metric-adjusted `local(Arial)` fallback faces: Linux hosts without Arial reject
`document.fonts.load` when those faces appear in the full font stack used before immersive entry.
Keep the existing explicit system fallback lists. Font assets and update instructions live in
[the bundled-font README](../src/app/fonts/README.md#L1); production browser regressions live in
[local-fonts.spec.ts](../e2e/local-fonts.spec.ts#L1).

Authorization and workspace snapshot/stream behavior retain their existing owners and contracts
(Stories 122 and 129). The build must retain TypeScript and generated route validation. Verify in
an isolated output directory without restarting the running installation.

## Acceptance criteria

- [x] The normal Turbopack production build completes with network access restricted and all
      TypeScript/generated route checks enabled.
- [x] All four font families are bundled with licenses and provenance; existing typography
      variables and loading choices remain usable, including Archivo's variable width.
- [x] Affected route, authorization and workspace-stream tests pass with explicit requests.
- [x] Production browser checks confirm local font delivery and usable shell typography.
- [x] TypeScript, diff checks and independent review pass; no deployment or restart occurs.

## How to verify

The pre-change isolated `CODEAI_DIST_DIR=.next-build-check npm run build` fails with four
`next/font` Google Fonts download errors under the restricted network. Repeat the normal build
after the fix in an isolated directory; record any subsequent failures and their corrections.
Run affected route/stream tests and source TypeScript, then inspect the production shell's loaded
fonts and variable-width headings in a disposable browser/server with fixture storage.

The browser regression using full CSS font stacks also failed before disabling generated Arial
fallback faces, with `page.evaluate: NetworkError` and a matching `font-loading-failed` immersive
diagnostic. It checks the real loaded Arena, local delivery of all four fonts, Inter's 400/600
weights, three preload links and Archivo's changing rendered width, across light/dark desktop/phone.

Asset tradeoff: bundling complete upstream glyph coverage increases the three preloaded font
files from 142,492 bytes in the prior cached Latin subsets to 330,252 bytes (about 183 KiB more).
All four WOFF2 assets total 566,696 bytes. No project dependency or build-time conversion is added.

Verified on 2026-11-15:

- `CODEAI_DIST_DIR=.next-e2e npm run build` passes under restricted networking, using normal
  Turbopack compilation, TypeScript, generated route checks and page generation.
- **46 tests** pass across `projectRoutes`, `sessionRoutes`, `machineRoutes`,
  `multiMachineArenaRoute`, `workspaceStreamAuth`, `workspaceFeed` and `designTokens`.
- `CODEAI_DIST_DIR=.next-e2e npx playwright test e2e/local-fonts.spec.ts` passes all **four**
  production-browser cases with external browser requests blocked. Light/dark 1440px desktop
  and 360px phone screenshots were inspected; the final run has no font-failure diagnostics.
- `npm run lint -- --incremental false`, `git diff --check` and independent review pass.

The running application was not rebuilt or restarted. Physical headset font rendering was not
rerun; the browser regression exercises the full font stacks and weights used by immersive entry.
