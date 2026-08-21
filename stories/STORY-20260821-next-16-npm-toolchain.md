# Story 25 — Move the root application to Next.js 16 and npm

**Status:** Shipped (2026-08-21) · **Type:** Full-stack · **Depends on:** [Story 24](STORY-20260820-promote-next-app-archive-legacy.md)

**Epic context:** [web2 operational collaboration](EPIC-20260806-web2-operational-collaboration.md)

---

## Motivation

Story 24 promoted the Next.js application to the repository root but kept the toolchain it
inherited from the `web2/` experiment: Next.js 15 and Yarn 1. Both are now the odd ones out.

Yarn 1 is unmaintained, and the repository has exactly one package with no workspaces — the reason
to run a second package manager alongside the one that ships with Node is gone. Every editor task
in `.vscode/tasks.json` is already `"type": "npm"`, so the tooling is half-migrated as it stands.

Next.js 15.5 is two majors behind. Staying there means the app keeps the Webpack dev/build path
while Turbopack is the maintained default, keeps the synchronous request-API compatibility shims,
and misses React 19.2. The application is small (one page, nine route handlers, no middleware, no
`next/image`, no custom Webpack config), so the cost of moving is close to the cost of reading the
upgrade guide — and it only grows the longer it waits.

---

## Current behavior (where the code is)

- Package manager pin: [package.json:5](../package.json#L5) — `"packageManager": "yarn@1.22.21"`,
  with `yarn.lock` as the tracked lockfile at the repository root.
- Framework versions: [package.json:16-23](../package.json#L16) — `next ^15.5.4`,
  `react`/`react-dom` `^19.1.1`, `@types/react` `^19.1.16`, `@types/react-dom` `^19.1.9`.
- E2E script: [package.json:13](../package.json#L13) — `test:e2e` shells out to `yarn build`.
- E2E web server: [playwright.config.ts:26](../playwright.config.ts#L26) — starts the production
  server with `yarn next start -p …`.
- Editor launch configurations: [.vscode/launch.json:11](../.vscode/launch.json#L11) and
  [.vscode/launch.json:22](../.vscode/launch.json#L22) — `"runtimeExecutable": "yarn"`.
- Build output selection: [next.config.ts:6](../next.config.ts#L6) — `distDir` from
  `CODEAI_DIST_DIR` (E2E uses `.next-e2e`), with the `CODEAI_WEB2_DIST_DIR` fallback.
- Generated type wiring: [next-env.d.ts:3](../next-env.d.ts#L3) references
  `./.next/types/routes.d.ts`; [tsconfig.json:26-27](../tsconfig.json#L26) includes
  `.next/types/**/*.ts` and `.next-e2e/types/**/*.ts`.
- Documented toolchain: [README.md:16](../README.md#L16) ("Node.js 20 or newer and Yarn 1") and its
  `yarn …` command blocks; [AGENTS.md:5](../AGENTS.md#L5) ("one private Yarn 1 package") and its
  command block; [docs/architecture.md:11](../docs/architecture.md#L11) ("One private Yarn 1
  package, one Next.js 15 App Router application").
- Ignore rules: [.gitignore:4-7](../.gitignore#L4) — `.next/`, `.next-e2e/`, `*.tsbuildinfo`.

Not present, and therefore not affected by the Next.js 16 breaking changes: `middleware.ts`,
`next/image` usage, a custom `webpack` config, `next lint`, AMP, `serverRuntimeConfig` /
`publicRuntimeConfig`, parallel routes, `revalidateTag`/`unstable_cache*` callers, and any
synchronous `params`/`searchParams`/`cookies()`/`headers()` access. `lint` is `tsc --noEmit`, not
`next lint`.

---

## Desired behavior

The repository root is a single private **npm** package running **Next.js 16** on React 19.2.
`npm install` produces a tracked `package-lock.json`; `yarn.lock` no longer exists. Every documented
command is `npm run …`. Application behavior, storage identifiers, environment names, and the
`legacy/` boundary are unchanged.

### Concrete changes

1. **Switch the package manager to npm.**
   - Replace the `packageManager` pin with `npm@<installed major.minor.patch>` and declare
     `engines.node` at `>=20.9.0` (the Next.js 16 floor).
   - Delete `yarn.lock`; track `package-lock.json`.
   - `test:e2e` calls `npm run build` instead of `yarn build`.
   - `playwright.config.ts` starts the E2E server with `npx next start` instead of `yarn next start`.
   - `.vscode/launch.json` runs `npm` with `["run", "dev"]` / `["run", "test"]`.
   - No workspaces, no monorepo, no `.npmrc` beyond what npm writes itself.

2. **Upgrade to Next.js 16 and React 19.2.**
   - `next`, `react`, `react-dom`, `@types/react`, and `@types/react-dom` move to their current
     releases. `@types/node` stays on the `22.x` line, matching the Node runtime in use.
   - No `--turbopack` flag anywhere: Turbopack is the default for `next dev` and `next build` in 16
     and the project has no Webpack configuration to preserve.
   - Adjust `tsconfig.json` / `next-env.d.ts` only if Next.js 16 generates its route types at
     different paths; regenerate rather than hand-write them.
   - Keep `distDir` and the `CODEAI_DIST_DIR` / `CODEAI_WEB2_DIST_DIR` resolution exactly as is,
     including the separate `.next-e2e` output used by the E2E run.

3. **Absorb the Next.js 16 agent-docs block.**
   `next dev` (16.2+) writes a managed `<!-- BEGIN:nextjs-agent-rules -->` block into `AGENTS.md`
   pointing at the version-matched docs bundled in `node_modules/next/dist/docs/`. Commit that block
   rather than fighting it, so the working tree stays clean after a dev run.

4. **Update the documented toolchain.**
   - `README.md`, `AGENTS.md`, and `docs/architecture.md` describe npm and Next.js 16, including the
     requirements line, the start/upgrade snippets, and the command tables.
   - Add a short note for developers with an existing checkout: remove `node_modules`/`yarn.lock`
     and run `npm install`.
   - Historical story prose (including Story 24's `yarn` verification commands and the `web2`
     experiment stories) is left as written — it records what was true then.

### Out-of-scope dependency moves

`vitest` stays on 3.x, `@playwright/test` on 1.x, and the remaining dependencies keep their existing
caret ranges — `npm install` may resolve them to newer patch/minor releases, which is expected. No
major upgrade other than Next.js is part of this story.

---

## Acceptance criteria

- [x] `package-lock.json` is tracked at the repository root and `yarn.lock` no longer exists; the
  package declares `packageManager: npm@…` and `engines.node >= 20.9.0`.
- [x] No tracked file outside `legacy/`, `stories/`, and unrelated project-marker lists invokes
  `yarn`; `package.json`, `playwright.config.ts`, and `.vscode/launch.json` use npm/npx.
- [x] `next` resolves to 16.x with React 19.2 and matching `@types/react*`; the installed tree
  satisfies every peer dependency.
- [x] `npm run dev`, `npm start`, `npm run build`, `npm run lint`, `npm test`, `npm run test:watch`,
  and `npm run test:e2e` all exist and behave as their Yarn predecessors did.
- [x] `npm run lint` (strict `tsc --noEmit`), `npm test`, `npm run build`, and `npm run test:e2e`
  pass from the repository root.
- [x] The E2E run still builds into `.next-e2e` and serves it; `CODEAI_DIST_DIR` and its
  `CODEAI_WEB2_DIST_DIR` fallback are unchanged.
- [x] Ask/Plan/Agent turns, the Mermaid canvas, participants, repository sidebar, permission,
  cancellation, and reload/reattach behave as before the upgrade. The only edits under `src/` are
  build-hygiene annotations with no runtime effect (see *As shipped*); no behavior is changed
  opportunistically.
- [x] Persisted identifiers are untouched: `~/.code-ai/web2`, `code-ai:web2:v1:`, the `cartograph.*`
  wire schemas, the `cartograph:plan:*` delimiters, and the Codex `serviceName`/`clientInfo.name`.
- [x] `README.md`, `AGENTS.md`, and `docs/architecture.md` state npm and Next.js 16, and give
  existing checkouts a one-time migration snippet.
- [x] `AGENTS.md` carries the managed Next.js agent-rules block, and a `next dev` run leaves the
  working tree clean.
- [x] Nothing in `legacy/` is modified, built, or reinstalled by this story.

## Out of scope

- Upgrading Vitest to 4.x, Playwright to a new major, or any dependency other than the Next.js/React
  set named above.
- Adopting Next.js 16 opt-in features: `cacheComponents` (PPR), `reactCompiler`, `proxy.ts`,
  View Transitions, or `updateTag`/`refresh`.
- Adding ESLint or Biome. `lint` remains `tsc --noEmit`.
- Any change to product behavior, UI, prompts, storage layout, environment variable names, or the
  single-active-run constraint.
- Re-installing, modernizing, or otherwise touching the archived runtime under `legacy/`.
- Adding CI configuration.

## How to verify

1. From a clean checkout state, remove `node_modules` and `yarn.lock`, then run `npm install`.
   Confirm the install reports no unmet peer dependencies and writes `package-lock.json`.
2. Run, from the repository root:

   ```sh
   npm run lint
   npm test
   npm run build
   npm run test:e2e
   ```

3. Run `npm run dev`, open <http://localhost:3023>, and confirm: an existing locally saved thread
   restores with its diagram and drawings; a new Ask or Plan turn streams with the same prose and
   Mermaid behavior; project/thread switching, repository status/diff, cancellation, and
   reload/reattach still work.
4. Confirm `git status` after the dev run is clean (the Next.js agent-rules block in `AGENTS.md` is
   committed, not regenerated as a diff).
5. `git grep -n yarn -- . ':!legacy' ':!stories'` returns only project-marker filenames, the
   migration note in `README.md`, and no commands.

---

## As shipped (2026-08-21)

`npm run lint`, `npm test` (137 tests / 20 files), `npm run build` (zero warnings), and
`npm run test:e2e` (3 Playwright tests) all pass from the repository root. Decisions and deviations
worth recording:

- **Installed set:** `next@16.3.1`, `react`/`react-dom@19.2.8`, `@types/react@19.2.18`,
  `@types/react-dom@19.2.4`. `@types/node` deliberately stays on `^22.18.8` (the 26.x line is ahead
  of the Node 22 runtime in use). `vitest` resolved to 3.2.7 and `@playwright/test` to 1.62.1 within
  their existing ranges. Fresh install: 290 packages, no peer-dependency warnings, 0 vulnerabilities,
  `lockfileVersion: 3`.
- **`packageManager: "npm@10.9.2"`** matches the npm bundled with the Node 22.14 in use, and
  `engines.node` is `>=20.9.0` — the Next.js 16 floor, not the installed version.
- **The upgrade required no product code change.** Nothing in the app touched a Next.js 16 breaking
  change: there is no `middleware.ts`, no `next/image`, no custom Webpack config, no `next lint`, no
  AMP, no runtime config, no parallel routes, and every route handler already used the async
  request APIs. `lint` was already `tsc --noEmit`, so removing `next lint` was a non-event.
- **Four `/* turbopackIgnore: true */` markers** were added — `src/server/repository/repositoryContext.ts`
  (2) and `src/server/storage/tempAttachments.ts` (2). Turbopack's static analysis flagged
  `path.join(directory, <variable>)` writes as "dynamic filesystem access causes tracing of the whole
  project" and emitted four warnings per build. In every case `directory` is a per-run `mkdtemp`
  directory under the OS temp dir, never a project path, so the documented opt-out is correct and no
  behavior changes. Without it, every build carries four warnings that would train the eye to ignore
  build output.
- **Next.js rewrote two files itself,** and both are committed as it writes them so a dev run leaves
  a clean tree: `next-env.d.ts` now `import`s `.next/dev/types/routes.d.ts` and
  `.next/dev/types/root-params.d.ts` instead of the old `/// <reference path>`, and `tsconfig.json`
  gained `.next/dev/types/**/*.ts` + `.next-e2e/dev/types/**/*.ts` includes, switched `jsx` from
  `preserve` to `react-jsx`, and was reformatted to Next's own expanded JSON style. `tsc --noEmit`
  passes from a clean checkout with no `.next` present, so the generated-type imports are not a
  prerequisite for `npm run lint`.
- **`AGENTS.md` gained the managed `nextjs-agent-rules` block** on the first `next dev` run, plus a
  sentence in the Commands section explaining that Next.js owns that block and the generated type
  wiring.
- **`next dev` now writes to `.next/dev`** while `next build` keeps `.next`, so the two can run
  concurrently. The existing `.next/` ignore rule already covers it; `.gitignore` needed no change.
  The E2E flow still builds into `.next-e2e` and serves that directory, and `CODEAI_DIST_DIR` /
  `CODEAI_WEB2_DIST_DIR` resolution is untouched.
- **Verification boundary.** Ask/Plan/Agent, canvas, sketch, participant-handoff, permission, and
  cancellation paths were exercised through the Vitest and Playwright suites, which drive the fake
  Claude/Codex executables, plus a `next dev` boot serving `/` and `/api/health` (200, providers
  probed). No turn against a real provider subscription was run as part of this story.
- **The fixture plan prose** in `test/fixtures/fake-claude.mjs` now says `npm test` instead of
  `yarn test`; it is sample agent output, asserted on only by marker, not by wording.
- **Story 24's `yarn` verification commands are left as written**, per the repository's convention of
  preserving historical story prose.
- **A pre-existing `next dev` (Next 15.5.22) was running on port 3023** during this work, so the dev
  check ran on a spare port. That process now serves errors — its `node_modules` was replaced under
  it — and needs a restart.
