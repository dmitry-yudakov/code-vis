# Story 24 — Promote the Next.js product to the repository root and archive the legacy runtime

**Status:** Shipped (2026-08-21) · **Type:** Full-stack · **Depends on:** [Story 18](STORY-20260805-web2-agent-mermaid-canvas.md)

**Epic context:** [web2 operational collaboration](EPIC-20260806-web2-operational-collaboration.md)
and [north-star Phase C — surfaces & memory](EPIC-20260705-north-star-roadmap.md#phase-c--surfaces--memory-parallel-track-can-start-during-phase-b)

---

## Motivation

The repository root still presents the original static-analysis server, React Flow web client,
and VS Code extension as the product. The product now being developed is the Next.js CodeAI
application under `web2/`: its Mermaid canvas, conversations, agent modes, providers, repository
tools, and participant model form the current runtime.

Keeping the current product in a directory named `web2` makes it look temporary and leaves the
default README, commands, editor configuration, and architecture documentation pointing at the
older product. A separate future `web3d` application would also duplicate the application shell
and its project, thread, agent, persistence, and permission boundaries.

Promote the Next.js application to the repository root, place its runtime source under `src/`, and
move the superseded web/server/extension runtime and its reference documentation under an explicit
`legacy/` boundary. The result should have one obvious product entry point and a source topology
that can later accept alternative Mermaid renderers and a multi-project, multi-session environment
without implementing either feature in this refactor.

The exploratory direction for that later environment is recorded separately in
[Multi-project, multi-session environment](../docs/multi-project-session-environment.md).

---

## Current behavior (where the code is)

- Root product instructions: [README.md](../README.md#L1) (~line 1) — describe the original
  `server/` + `web/` pair and require two processes.
- Repository instructions: [AGENTS.md](../AGENTS.md#L1) (~line 1) — identify the static analyzer as
  the current product and encode path conventions for `server/`, `web/`, and `extension/`.
- Current Next.js package: [web2/package.json](../package.json#L1) (~line 1) — owns the active
  development, build, test, lint, and end-to-end commands, but only from `web2/`.
- Current Next.js entry point: [web2/app/page.tsx](../src/app/page.tsx#L1) (~line 1) — mounts the
  application shell, which is still labelled “Cartograph” in the current UI.
- Current browser shell: [web2/components/AppShell.tsx](../src/features/shell/AppShell.tsx#L92)
  (~line 92) — owns one selected project, one selected thread, and one global browser-side running
  state; this behavior is preserved by this story.
- Current import root: [web2/tsconfig.json](../tsconfig.json#L17) (~line 17) — resolves `@/*`
  from the `web2/` package root rather than a repository-root `src/` directory.
- Current configuration: [web2/lib/server/config.ts](../src/server/config.ts#L7) (~line 7) —
  exposes `Web2Config` and reads `CODEAI_WEB2_*` variables.
- Current browser persistence: [web2/lib/client/conversationStore.ts](../src/features/conversation/conversationStore.ts#L6)
  (~line 6) — stores existing local conversations under the `code-ai:web2:v1:` key prefix.
- Current server persistence: [web2/lib/server/config.ts](../src/server/config.ts#L68)
  (~line 68) — defaults to `~/.code-ai/web2`; existing thread/session bindings live there.
- Current agent concurrency: [web2/lib/server/runRegistry.ts](../src/server/runs/runRegistry.ts#L36)
  (~line 36) — permits one global active run. It is intentionally not changed by this story.
- Legacy architecture reference: [docs/architecture.md](../legacy/docs/architecture.md#L1) (~line 1) —
  accurately describes the older Socket.IO analyzer and React Flow client, but currently occupies
  the canonical architecture path.
- Legacy runtime roots: [server/package.json](../legacy/server/package.json),
  [web/package.json](../legacy/web/package.json), and [extension/package.json](../legacy/extension/package.json)
  — remain top-level peers of `web2/` even though they are no longer the product entry point.
- Roadmap surface split:
  [EPIC-20260705-north-star-roadmap.md](EPIC-20260705-north-star-roadmap.md#L145) (~line 145) —
  still describes a separate `web3d` bootstrap, predating the decision to keep 2D and spatial
  renderers in the same Next.js application.

---

## Desired behavior

The repository root is a self-contained Next.js/Yarn application. Running `yarn dev`, `yarn test`,
`yarn lint`, `yarn build`, or `yarn test:e2e` from the repository root operates on CodeAI.
There is no additional `apps/web`, `web2`, or separate spatial application wrapper.

Runtime source lives under `src/`. The move establishes clear browser-feature, server-only, and
shared-protocol boundaries while preserving behavior. The old static analyzer product is retained
under `legacy/` as source and historical reference, but it is not imported, built, or started by
the root application.

### Target repository topology

```text
code-ai/
  .env.example
  .gitignore
  AGENTS.md
  README.md
  package.json
  yarn.lock
  next.config.ts
  tsconfig.json
  vitest.config.ts
  playwright.config.ts
  next-env.d.ts
  src/
    app/                         # Next pages, layout, CSS, and route handlers
    features/
      shell/                     # application composition and current AppShell
      agents/                    # activity, participants, modes, permissions
      conversation/              # transcript, composer, drawer, thread selection
      diagram/
        components/              # canvas, cards, navigation, drawing/evidence UI
        mermaid/                 # current Mermaid policy and SVG renderer
        annotations/             # drawing state and composite export
      projects/                  # project selection UI
      repository/                # tree, status, and diff UI/client state
    server/
      agents/                    # provider policies, adapters, preflight, runners
      conversation/              # prompt, transcript, parsing, orchestration
      projects/                  # project discovery/registry
      repository/                # fixed git reads and bounded context
      runs/                       # run lifecycle and permission broker
      storage/                    # thread registry and durable server records
      config.ts
    shared/                      # wire schemas, limits, identities, shared types
  test/
  e2e/
  docs/
    architecture.md              # current Next.js architecture
    multi-project-session-environment.md
    vision.md
    design/
  stories/
  legacy/
    README.md
    web/
    server/
    extension/
    docs/
      architecture.md
      analyzer.md
      server.md
      web.md
      websocket-api.md
```

This topology is an ownership map, not permission to rewrite working modules. Files should move to
the narrowest existing owner, imports should be updated, and behavior should remain equivalent.
Do not create empty placeholder directories for future environment or spatial code.

### Concrete changes

1. **Promote the package and tooling.**
   - Move the tracked `web2` package configuration, lockfile, tests, E2E suite, and application
     assets to their root locations.
   - Change the private package name from `code-ai-web2` to `code-ai`, use **CodeAI** as the active
     UI/product label, and retain the current port `3023`.
   - Point the `@/*` TypeScript/Vitest alias at `src/*`.
   - Merge the application ignore rules into the root `.gitignore`; `.env*`, Next output,
     coverage, test output, and TypeScript build state remain ignored while `.env.example` stays
     tracked.
   - Replace or update root VS Code tasks/launch settings so their default actions target the root
     application. Any extension-specific launch configuration belongs with the archived extension
     or is clearly labelled as legacy.

2. **Move current runtime source under `src/`.**
   - Move `web2/app/` to `src/app/`.
   - Move browser components and client helpers into the feature owners shown above.
   - Move Node-only provider, repository, registry, and conversation code into `src/server/`.
   - Move types, limits, participant helpers, plan markers, and request validation used across the
     browser/server boundary into `src/shared/`.
   - Preserve `server-only` and browser-only boundaries: client components must not import
     `src/server`, route handlers must not depend on browser storage/DOM modules, and shared modules
     must not acquire Node- or DOM-specific side effects.
   - Keep Mermaid source as the canonical diagram artifact. This story relocates the current
     Mermaid policy/SVG implementation but adds no intermediate representation or 3D renderer.

3. **Archive the previous runtime.**
   - Move top-level `web/`, `server/`, and `extension/` to `legacy/web/`, `legacy/server/`, and
     `legacy/extension/` using history-preserving moves.
   - Move the five runtime-specific reference documents listed in the target topology to
     `legacy/docs/`.
   - Add `legacy/README.md` explaining what the archived runtime does, that it is not maintained,
     where its documentation lives, and how to run it if historical comparison is needed.
   - Preserve the archived packages as coherent snapshots. Do not modernize their dependencies,
     protocols, type duplication, or UI as part of the move.
   - Root build/test/start scripts must not traverse or compile `legacy/`.

4. **Make root documentation describe the current product.**
   - Rewrite `README.md` around CodeAI's root Next.js application, its local-agent requirements,
     configuration, and root commands. Link to the legacy runtime without presenting it as the
     default.
   - Rewrite `AGENTS.md` with current root source ownership, safety boundaries, commands, and the
     spec-driven loop. Retain a concise legacy note rather than applying legacy conventions to new
     source.
   - Create a new `docs/architecture.md` describing the current Next.js client/server boundary,
     browser-local conversation/artifact persistence, server-owned thread/provider session
     registry, streamed agent route, repository access, and current single-run constraint.
   - Update `docs/vision.md`, active epics, and other current documentation so path references and
     “current product” claims are accurate. The 3D roadmap must describe a spatial renderer inside
     the root application rather than a separate `web3d` product.
   - Preserve historical wording and filenames of shipped/in-progress stories where it explains
     the `web2` experiment, but update their source links so they resolve after the move.
   - Replace active user-facing “Cartograph” branding with “CodeAI” in page metadata, headings,
     help/error copy, current README/docs, export filenames, and provider-facing display metadata.
     Historical story prose and the design source filename `docs/design/Cartograph.dc.html` remain
     historical artifacts and are not rewritten merely for naming consistency.

5. **Provide a compatibility bridge for the former `web2` name.**
   - New documentation and `.env.example` use neutral `CODEAI_*` environment names.
   - For every renamed setting, configuration accepts the corresponding `CODEAI_WEB2_*` variable
     as a fallback for at least this migration. The neutral name wins if both are set.
   - Rename product code identifiers such as `Web2Config` where doing so has no persistence or
     protocol impact.
   - Keep the existing default data directory `~/.code-ai/web2` and browser storage prefix
     `code-ai:web2:v1:` in this story. They are persisted compatibility identifiers; changing them
     would require a separate, tested data migration.
   - A developer's ignored `web2/.env.local` must not be committed or printed. The migration notes
     instruct the developer to move it to root `.env.local`; old variable names continue to work.
   - Existing server thread records, provider session references, browser threads, diagrams,
     drawings, and selected-project state load without reset or manual export/import.
   - Existing machine-readable identifiers containing `cartograph`—including stored schemas and
     plan delimiters—remain accepted unless the implementation supplies a backward-compatible
     migration and tests it. User-facing branding and compatibility identifiers are separate
     concerns.

6. **Repair path-dependent tests and references.**
   - Update test fixtures, snapshot expectations, E2E working directories, fake provider paths,
     Next build-directory configuration, temporary-directory labels where appropriate, and docs
     commands for root execution.
   - Update relative Markdown links affected by the archive. A link to tracked source must resolve
     either to the root application or `legacy/`; no compatibility symlink or duplicate source tree
     should be introduced merely to preserve an old path.

### Configuration compatibility contract

For a renamed setting, resolution follows one rule:

```ts
value = process.env.CODEAI_SETTING
  ?? process.env.CODEAI_WEB2_SETTING
  ?? defaultValue;
```

Boolean and bounded-integer validation remains identical after the selected raw value is resolved.
An invalid neutral value must fail validation rather than silently falling back to a valid legacy
value. The compatibility mapping is documented and covered by configuration tests.

---

## Acceptance criteria

- [x] The repository root contains the active private Next.js package and the root commands
  `dev`, `start`, `test`, `test:watch`, `lint`, `build`, and `test:e2e`; `web2/package.json` and a
  second active lockfile no longer exist.
- [x] All active runtime source lives under `src/` and follows the browser-feature/server/shared
  boundaries in the target topology; `@/*` resolves from `src/*`.
- [x] The current Ask, Plan, Agent, Claude, Codex, multi-agent participant, Mermaid canvas, sketch,
  repository sidebar, permission, cancellation, continuation, and reload/reattach behaviors remain
  functionally unchanged.
- [x] Mermaid source remains the canonical stored diagram artifact and the existing Mermaid
  validation/rendering policy remains intact.
- [x] `web/`, `server/`, and `extension/` no longer exist as top-level tracked runtime directories;
  their tracked contents and runtime-specific docs exist under `legacy/` with an explanatory README.
- [x] Root build, lint, unit-test, and E2E discovery exclude `legacy/`.
- [x] Root `README.md`, `AGENTS.md`, and `docs/architecture.md` describe the promoted Next.js
  product and its real current constraints; current vision/epic paths are accurate.
- [x] Active user-facing branding says “CodeAI,” not “Cartograph”; historical prose/design files
  and deliberately preserved compatibility identifiers are clearly distinguished from active
  product copy.
- [x] The north-star roadmap locates desktop 3D and WebXR as code-split renderers/modes in the same
  root Next.js product, without adding R3F/WebXR dependencies in this story.
- [x] Historical stories remain available; their source/document links resolve after the move,
  while historical prose that deliberately names the `web2` experiment is not rewritten as though
  it had always lived at root.
- [x] Neutral `CODEAI_*` variables are documented and preferred, every renamed
  `CODEAI_WEB2_*` variable remains a tested fallback, and validation behavior is unchanged.
- [x] Starting with only the former `CODEAI_WEB2_*` environment continues to discover the same
  projects and use the same provider configuration.
- [x] Existing `~/.code-ai/web2` records and `code-ai:web2:v1:` browser data load without data loss;
  the refactor does not silently create a parallel empty history.
- [x] Ignored environment files and credentials remain ignored and are never copied into tracked
  files, logs, fixtures, or documentation.
- [x] No root runtime module imports from `legacy/`, and no symlink or duplicate compatibility copy
  makes legacy code part of the active dependency graph.
- [x] Root unit tests, strict TypeScript check, production build, and Playwright E2E suite pass.
- [x] `git status` shows history-preserving moves where Git can detect them and no unrelated
  generated output or user files are included.

## Out of scope

- Implementing the multi-project/multi-session environment described in
  [the memo](../docs/multi-project-session-environment.md).
- Allowing more than one concurrent agent run or changing per-thread/provider session semantics.
- Moving browser transcripts, Mermaid artifacts, or annotations to server-side storage.
- Adding `react-three-fiber`, WebXR, a Mermaid intermediate representation, or any new renderer.
- Rewriting `AppShell` into multi-workspace state or redesigning the current UI.
- Changing Mermaid syntax, supported diagram kinds, prompts, parsing policy, evidence semantics, or
  drawing behavior.
- Renaming the persisted `~/.code-ai/web2` directory or `code-ai:web2:v1:` browser key prefix.
- Modernizing, fixing, or deleting the archived analyzer/web/extension runtime.
- Introducing an `apps/` monorepo, reusable `packages/`, workspace manager, database, authentication,
  remote hosting, or team collaboration.
- Choosing a permanent market name. **CodeAI** is the working product name until a later naming
  decision replaces it.

## How to verify

1. From the repository root, run:

   ```sh
   yarn test
   yarn lint
   yarn build
   yarn test:e2e
   ```

2. Run `yarn dev`, open `http://localhost:3023`, select a fixture or trusted project, and verify:
   - an existing locally saved thread and its active diagram/drawings are restored;
   - a new Ask or Plan turn streams and produces the same prose/Mermaid behavior;
   - project/thread switching, repository status/diff, cancellation, and reload/reattach still work;
   - an available provider can be added and addressed using the existing participant controls.
3. Start once with only neutral `CODEAI_*` configuration and once with only the corresponding
   legacy `CODEAI_WEB2_*` configuration. Confirm both resolve the same project root, provider
   settings, limits, and data directory; add a unit test proving neutral variables take precedence.
4. Inspect tracked paths with `git ls-files`: active source/configuration is rooted at `src/` and
   the repository root; the previous runtime exists only under `legacy/`; generated and secret
   files are absent.
5. Search active runtime imports for `legacy/`, `../legacy`, and the former root runtime paths;
   none should be present.
6. Check all changed Markdown links, especially current docs/epics and historical story links into
   `legacy/`. Open the new root architecture document and the legacy architecture document and
   confirm each clearly identifies which runtime it describes.
7. Optionally run the archived packages from their new working directories to confirm the move did
   not remove required tracked files. Failures already present before the move are documented, not
   repaired in this story.

---

## As shipped (2026-08-21)

Root `yarn lint`, `yarn test` (137 tests / 20 files), `yarn build`, and `yarn test:e2e`
(3 Playwright tests) all pass from the repository root. Decisions and deviations worth recording:

- **Empty assignments count as unset.** The compatibility rule is
  `CODEAI_X ?? CODEAI_WEB2_X ?? default` for any value, but an env assignment with an *empty* value
  is treated as absent on both names. That is exactly how every setting already behaved (`||` /
  `if (!raw)`), and `.env.example` ships empty placeholders for the optional settings — so a
  literal `??` would have let a blank neutral placeholder silently mask a real legacy value.
  Covered by `test/config.test.ts`.
- **Error messages name the variable that was actually read**, so an invalid legacy value reports
  `CODEAI_WEB2_*` and an invalid neutral value reports `CODEAI_*`. The neutral value is never
  discarded in favour of a valid legacy one.
- **Compatibility identifiers left alone**, as specified: `~/.code-ai/web2`, `code-ai:web2:v1:`,
  the `cartograph.current-request.v1` / `cartograph.historical-transcript.v1` wire schemas, and the
  `<!-- cartograph:plan:* -->` delimiters. Additionally the Codex App Server `serviceName`
  (`cartograph_web2`) and `clientInfo.name` are kept, because existing Codex threads were created
  under them; only `clientInfo.title` — actual display metadata — became `CodeAI`.
- **Renamed as branding**, having no persistence or protocol impact: `Web2Config` → `AppConfig`,
  the prompt contract header (`[CodeAI conversation contract vN]`), export filenames
  (`codeai-*.json`), the per-run temp-directory prefix (`code-ai-run-`), page metadata, UI brand,
  help/error copy, and Codex developer-instruction prose.
- **`docs/experiment-log.md`** was promoted from `web2/docs/`; it keeps its historical entries and
  gains a note that pre-move prose names the product Cartograph.
- **Pre-existing E2E failure repaired.** `test/fixtures/fake-claude.mjs` still matched the
  `[User message]` prompt framing that commit `bcec08f` replaced with the current-request JSON, so
  the canvas E2E test was already failing on `master` before this refactor. The fixture now matches
  the request's `text` field. No product code was changed for it.
- **`web3d/`** contains only an untracked `node_modules` directory and no tracked files, so there
  was nothing to archive; it was left on disk untouched. The roadmap now describes desktop 3D and
  WebXR as code-split renderers inside the root application.
- **Git rename detection** covers 208 of the moved paths. Four files pair by path instead of by
  content because the same path now holds different content (`README.md` / `legacy/README.md`,
  `docs/architecture.md` / `legacy/docs/architecture.md`) or was substantially rewritten in place
  (`src/server/config.ts`, `test/config.test.ts`).
