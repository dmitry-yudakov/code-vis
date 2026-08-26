# CodeAI

A local-first Next.js application for working on a trusted repository through a persistent
local-agent conversation and a Mermaid canvas. The repository root **is** the application: one
private npm package, one Next.js 16 app, one set of commands. Node 20.9+.

## Commands

All commands run from the repository root.

```sh
npm run dev        # Next.js dev server on 3023 (Turbopack, output in .next/dev)
npm start          # production server on 3023, after npm run build
npm run build      # production build (Turbopack)
npm run lint       # strict TypeScript check (tsc --noEmit) — there is no ESLint/Biome setup
npm test           # Vitest suite, offline, with fake Claude/Codex executables
npm run test:watch # the same suite in watch mode
npm run test:e2e   # production build into .next-e2e + Playwright against installed Chrome
```

`legacy/` is excluded from the TypeScript project, the Vitest include set, and the Playwright test
directory. Nothing in the root build traverses it.

`next dev` maintains two files itself: the `nextjs-agent-rules` block at the end of this document
and `next-env.d.ts` / the generated-type entries in `tsconfig.json`. They are committed as written
so a dev run leaves the working tree clean — edit them only through Next.js.

## Source ownership

| Path | Owns |
|------|------|
| `src/app/` | Next pages, layout, global CSS, and route handlers |
| `src/features/shell/` | Application composition (`AppShell`) |
| `src/features/agents/` | Activity timeline, participants, modes, permission cards |
| `src/features/conversation/` | Transcript, composer, drawer, thread selection, browser conversation store |
| `src/features/diagram/components/` | Canvas, cards, navigation, drawing and evidence UI |
| `src/features/diagram/mermaid/` | Mermaid validation policy and SVG renderer |
| `src/features/diagram/annotations/` | Drawing state and composite export |
| `src/features/projects/` | Project selection UI |
| `src/features/repository/` | Repository tree, status, and diff UI and client state |
| `src/server/agents/` | Provider policies, adapters, preflight, process runners |
| `src/server/conversation/` | Prompt, transcript, response parsing, orchestration |
| `src/server/projects/` | Project discovery and registry |
| `src/server/repository/` | Fixed read-only git invocations and bounded context |
| `src/server/runs/` | Run lifecycle and permission broker |
| `src/server/storage/` | Thread registry, durable server records, per-run temp attachments |
| `src/server/config.ts` | Environment resolution and limits |
| `src/shared/` | Wire schemas, limits, identities, types crossing the browser/server boundary |
| `test/`, `e2e/` | Vitest suite and Playwright suite |

`@/*` resolves to `src/*` in both TypeScript and Vitest. Prefer `@/…` for anything outside the
importing file's own directory; keep `./…` for same-directory siblings.

## Safety boundaries

- **Client components must not import `src/server`.** Provider execution, git invocation, and
  server storage stay behind route handlers.
- **Route handlers must not import browser storage or DOM modules.** `conversationStore`,
  `compositeExport`, and the Mermaid SVG renderer are browser-only.
- **`src/shared` must stay side-effect free** — no Node built-ins, no DOM access. It is imported
  from both sides.
- Provider capability is server-owned. The browser names a supported mode and nothing else; the
  executable, tool list, allowlist, permission mode, sandbox, and model flags are resolved on the
  server. An unknown or unsupported mode is a 400.
- Agent mode edits the real working tree after explicit per-action approval. There is no worktree
  isolation and no OS/container boundary — this runs as the desktop user.
- Never read, copy, log, or persist provider credentials. `.env*` other than `.env.example` is
  ignored and must stay untracked.

## Key conventions

- Mermaid source is the canonical stored diagram artifact. Diagrams are immutable; a revision is a
  new artifact, never a patch of an old one.
- Browser state (transcript, artifacts, marks, pins, selection) lives in revisioned
  `localStorage`; the server registry holds thread identity, roster, provider sessions, and
  transcript cursors.
- One agent run is active at a time, application-wide (`src/server/runs/runRegistry.ts`).
- Settings are `CODEAI_*`; every one also accepts its former `CODEAI_WEB2_*` spelling
  (`src/server/config.ts`). The neutral name wins when both carry a value.
- Two identifiers keep their historical `web2` spelling **because they name existing data**: the
  default data directory `~/.code-ai/web2` and the browser prefix `code-ai:web2:v1:`. Likewise the
  `cartograph.*` wire schemas, the `cartograph:plan:*` delimiters, and the Codex
  `serviceName`/`clientInfo.name` are compatibility identifiers, not branding. Renaming any of them
  needs its own tested migration.
- Active user-facing copy says **CodeAI**. Historical story prose and
  `docs/design/Cartograph.dc.html` are historical artifacts and are left alone.

## Legacy runtime

The original static-analysis server, React Flow web client, and VS Code extension are archived
under [`legacy/`](legacy/README.md) with their reference documentation in `legacy/docs/`. They are
kept as a coherent historical snapshot: not maintained, not built, and not imported by the root
application. Their conventions (duplicated `types.d.ts`, Socket.IO events, project-relative
analyzer paths) apply only inside `legacy/` and must not be carried into `src/`.

## Docs

- [README](README.md) — product behavior, safety model, configuration
- [Architecture](docs/architecture.md) — the current client/server boundary
- [Vision & North Star](docs/vision.md) — direction-setting (aspirational)
- [Multi-project, multi-session, multi-device environment](docs/multi-project-session-environment.md) — exploratory memo
- [Experiment log](docs/experiment-log.md) — manual real-agent matrix
- [Legacy architecture](legacy/docs/architecture.md) — the archived analyzer runtime

## Stories (spec-driven loop)

Implementation stories (specs/handoffs) live in `stories/`, named `STORY-<YYYYMMDD>-<title>.md`.

Non-trivial changes are spec-driven:

1. **Spec first.** Write or extend a story using [`stories/TEMPLATE.md`](stories/TEMPLATE.md) before implementing (`Status: Draft`). A story must carry **acceptance criteria as `- [ ]` checkboxes** and a **"where the code is"** section anchoring to `file:line` — these are what make a spec executable rather than just prose.
2. **Implement against it.** Set `Status: In progress` and tick boxes `[x]` as each criterion is satisfied.
3. **Done = every box `[x]` and "How to verify" passes.** Flip to `Status: Shipped` and update the story to match what actually shipped. (Set `Superseded` instead if a later story replaces it.)

Stories sit under [docs/vision.md](docs/vision.md) (the north star); reference the relevant phase/MVP when scoping one.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
