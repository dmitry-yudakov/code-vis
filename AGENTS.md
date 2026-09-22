# CodeAI

A local-first Next.js application for working on a trusted repository through a persistent
local-agent conversation and a Mermaid canvas. The repository root **is** the application: one
private npm package, one Next.js 16 app, one set of commands. Node 20.9+.

## Now

Updated 2026-09-22. When a story ships, change the line that names it; each story file keeps its own
`Status:`, so nothing here duplicates it.

- **In flight:** [Story 47](stories/STORY-20260905-vr-conversation-input.md) — local voice
  dictation/correction and shared conversation/agent controls are implemented in the
  [immersive workspace epic](stories/EPIC-20260905-immersive-workspace.md).
  Physical Quest 3S acceptance remains pending for Stories 44–47.
- **Also in flight:** [Story 48](stories/STORY-20260905-vr-session-permissions.md) — session creation
  and active-session permissions in VR; physical Quest 3S acceptance remains pending.
- **Also in flight:** [Story 49](stories/STORY-20260905-vr-review-and-annotations.md) — automated
  repository review, diagram comparison, annotations, and marked attachments are implemented;
  physical Quest 3S acceptance remains pending.
- **Also in flight:** [Story 54](stories/STORY-20260917-vr-quest-visual-design.md) — the Quest-like
  visual system is implemented; screenshot review, performance baseline, and physical Quest 3S
  checks remain pending.
- **Also in flight:** [Story 50](stories/STORY-20260905-vr-spatial-diagrams.md) — parser-backed
  spatial Mermaid diagrams and automated 30/45 plus 100/150 checks are implemented; physical Quest
  3S readability, comfort, and performance acceptance remain pending.
- **Shipped:** [Story 51](stories/STORY-20260905-vr-workspace-acceptance.md) — the user accepted the
  controller-and-voice Quest 3S work journey on September 20, 2026.
- **Also in flight:** [Story 52](stories/STORY-20260905-vr-arena-inbox.md) — the immersive Arena,
  Inbox, cross-session permission return, and bounded automated checks are implemented; its own
  Quest 3S multi-session run remains pending.
- **Latest fix:** [Story 53](stories/STORY-20260910-vr-session-resilience.md) — preserve VR through
  controller/visibility interruptions and retain device-local exit diagnostics.
- **Also in flight:** [Story 56](stories/STORY-20260919-vr-report-from-headset.md) — reporting from
  inside the headset reaches the paired home machine without a cable; its new three-second
  aim-before-capture behavior and the Quest 3S run remain pending.
- **Also in flight:** [Story 57, optional local Docker execution](stories/STORY-20260908-local-docker-execution.md);
  release verification against a real daemon remains pending. Its follow-ups, Stories 58 and 59
  (Arena enablement, [shared provider login](stories/STORY-20260909-docker-session-friction.md)), are shipped.
- **Also in flight:** [Story 61](stories/STORY-20260920-spacial-merge-review-fixes.md) — repairs the
  defects left by merging Docker execution into the VR branch: Docker turns were rejected outright,
  and the VR permission review could hide the command being approved.
- **Also in flight:** [Story 62](stories/STORY-20260920-simplify-flat-shell.md) — shows less of the flat
  shell at once: one header menu, a conversation column beside a single side panel, an Arena list
  ordered by attention, and canvas history with thumbnails. It ships one part per commit.
- **Also in flight:** [Story 63](stories/STORY-20260921-report-evidence-in-conversation.md) — headset
  reports become attachable conversation evidence in CodeAI's own project, flat and in VR;
  implemented with automated checks, and the Quest 3S run remains pending.
- **Also in flight:** [Story 66](stories/STORY-20260922-select-model-and-effort.md) — choose the
  model and effort for an agent's next turn from the executing machine's own list; implemented with
  offline checks, and the real-provider verification remains pending.
- **Shipped:** [Story 65](stories/STORY-20260921-tolerate-newer-session-format.md) — a session in a
  newer format hides only that session instead of closing the store; Stories 63 and 64 depended on it.
- **Plan of record:** [vision.md's sequence](docs/vision.md#sequence) for breadth (the arena and the
  machines behind it), the [software-model epic](stories/EPIC-20260705-north-star-roadmap.md) for
  depth (the model, lenses, and the change loop), and the
  [immersive workspace epic](stories/EPIC-20260905-immersive-workspace.md) for VR delivery. Naming:
  [vocabulary.md](docs/vocabulary.md).

## Commands

All commands run from the repository root.

```sh
npm run dev        # Next.js dev server on 3023 (Turbopack, output in .next/dev)
npm run devs       # the same over HTTPS on the LAN for a headset — unauthenticated, see README
npm start          # production server on 3023, after npm run build
npm run start:remote # paired personal-device HTTPS server, after npm run build
npm run device:pair # issue a ten-minute, single-use pairing code
npm run machine:pair # issue a ten-minute, single-use executor pairing code
npm run machine:attach -- ORIGIN CODE # attach an executor from the home machine
npm run machine:list # list attached executors
npm run machine:detach -- MACHINE_ID # detach one executor
npm run machine:peers # list homes authorized by this executor
npm run machine:revoke -- HOME_MACHINE_ID # revoke one home on this executor
npm run build      # production build (Turbopack)
npm run lint       # strict TypeScript check (tsc --noEmit) — there is no ESLint/Biome setup
npm test           # Vitest suite, offline, with fake Claude/Codex executables
npm run test:watch # the same suite in watch mode
npm run test:e2e   # production build into .next-e2e + Playwright against installed Chrome
npm run docker:provision # build the pinned worker image and record the Docker profile
npm run docker:login -- PROVIDER # sign a provider in inside the shared Docker home
npm run docker:cleanup -- SESSION_ID PARTICIPANT_ID # remove one participant's Docker resources
npm run test:docker # probe the real Docker runtime; needs a running daemon
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
| `src/features/shell/immersive/` | The VR workspace: panels, tools, layout, input, capture, and reports |
| `src/features/agents/` | Activity timeline, participants, modes, permission cards |
| `src/features/arena/` | Host-wide session cards, Inbox derivation, polling, and device read state |
| `src/features/devices/` | Personal-device pairing gate and paired-device management UI |
| `src/features/conversation/` | Transcript, composer, drawer, session selection, public snapshot helpers |
| `src/features/diagram/components/` | Canvas, cards, navigation, drawing and evidence UI |
| `src/features/diagram/mermaid/` | Mermaid validation policy and SVG renderer |
| `src/features/diagram/annotations/` | Drawing state and composite export |
| `src/features/diagram/spatial/` | Desktop spatial room, spatial diagram model, and the GPU resource ledger shared with VR |
| `src/features/projects/` | Project selection UI |
| `src/features/reports/` | The shared CodeAI report owner, the flat Reports tab, and report labels |
| `src/features/repository/` | Repository tree, status, and diff UI and client state |
| `src/server/agents/` | Provider policies, adapters, preflight, process runners |
| `src/server/conversation/` | Prompt, transcript, response parsing, orchestration |
| `src/server/repository/` | Checkout discovery, the self-project rule, fixed read-only git invocations, and bounded context |
| `src/server/runs/` | Run lifecycle and permission broker |
| `src/server/storage/` | Project/session store, durable server records, promoted report evidence under `<dataDir>/attachments/`, per-run temp attachments |
| `src/server/config.ts` | Environment resolution and limits |
| `src/server/devices/` | Hashed pairing/device records, cookies, transport and route authorization |
| `src/server/diagnostics/` | Immersive reports in the home machine's data directory, and their self-project-only reads |
| `src/server/execution/` | Optional Docker execution: container profile, runtime, recovery, and process transport |
| `src/server/voice/` | Loopback-only transcription client for voice dictation |
| `src/server/machines/` | Machine pairing, registry, snapshot collection, and allowlisted gateway |
| `src/shared/` | Wire schemas, limits, identities, types crossing the browser/server boundary |
| `test/`, `e2e/` | Vitest suite and Playwright suite |

`@/*` resolves to `src/*` in both TypeScript and Vitest. Prefer `@/…` for anything outside the
importing file's own directory; keep `./…` for same-directory siblings.

## Safety boundaries

- **Client components must not import `src/server`.** Provider execution, git invocation, and
  server storage stay behind route handlers.
- **Route handlers must not import browser storage or DOM modules.** The client snapshot helpers,
  `compositeExport`, and the Mermaid SVG renderer are browser-only.
- **`src/shared` must stay side-effect free** — no Node built-ins, no DOM access. It is imported
  from both sides.
- Provider capability is server-owned. The browser names a supported mode and, optionally, a model
  and effort from the choices the executing machine lists for that provider, and nothing else; the
  executable, tool list, allowlist, permission mode, sandbox, and model flags are resolved on the
  server. An unknown or unsupported mode, or an unlisted model or effort, is a 400.
- Local Agent edits the real working tree after per-action approval and runs as the desktop user.
  Optional Docker execution (Story 57, release verification pending) uses a pinned non-root worker:
  Docker Agent edits the mounted checkout autonomously; Ask/Plan mount it read-only. There is no
  separate working copy or rollback. New Docker participants share a persistent provider home per
  installation/provider; existing individual homes retain their native history. Never mount the running CodeAI installation or provider host
  storage; see [the Docker execution contract](docs/docker-execution.md).
- Remote personal-device access must use `start:remote`, an exact HTTPS origin, a certificate the
  device trusts, and a paired credential. Ordinary HTTP/startup fails closed in paired mode. The
  one exception is the README's development-only headset loop (`npm run devs`): it is
  unauthenticated by design and for a network where every device is trusted. Do not extend it.
- Never read, copy, log, or persist provider credentials. `.env*` other than `.env.example` is
  ignored and must stay untracked.

## Key conventions

- Mermaid source is the canonical stored diagram artifact. Diagrams are immutable; a revision is a
  new artifact, never a patch of an old one.
- Canonical project and session content (repository bindings, transcript, artifacts, marks, pins,
  roster, provider sessions, cursors) lives in revisioned host JSON. Browser memory owns
  device-only views, selection, panels, mode, drafts, and canvas cameras; `localStorage` persists
  that disposable device state and never the durable session record.
- Agent turns use the process-wide per-machine scheduler in `src/server/runs/runRegistry.ts`:
  two eligible turns by default, a bounded queue, one turn per session/provider session, shared
  Ask/Plan checkout reads, and exclusive Agent checkout execution.
- Settings are `CODEAI_*`; every one also accepts its former `CODEAI_WEB2_*` spelling
  (`src/server/config.ts`). The neutral name wins when both carry a value.
- Two identifiers keep their historical `web2` spelling: the default data directory
  `~/.code-ai/web2` and the retired, untouched browser prefix `code-ai:web2:v1:`. Likewise the
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
- [Vision — the arena](docs/vision.md) — the main product direction (aspirational)
- [Vocabulary](docs/vocabulary.md) — naming authority; use these words in new code, UI, and docs
- [The software model](docs/software-model.md) — the model/map north star (a chapter of the vision)
- [Sessions, machines, and records](docs/multi-project-session-environment.md) — engineering notes behind the arena
- [Experiment log](docs/experiment-log.md) — manual real-agent matrix
- [Legacy architecture](legacy/docs/architecture.md) — the archived analyzer runtime

## Stories (spec-driven loop)

Implementation stories (specs/handoffs) live in `stories/`, named `STORY-<YYYYMMDD>-<title>.md`.

Non-trivial changes are spec-driven:

1. **Spec first.** Write or extend a story using [`stories/TEMPLATE.md`](stories/TEMPLATE.md) before implementing (`Status: Draft`). A story must carry **acceptance criteria as `- [ ]` checkboxes** and a **"where the code is"** section anchoring to `file:line` — these are what make a spec executable rather than just prose.
2. **Implement against it.** Set `Status: In progress` and tick boxes `[x]` as each criterion is satisfied.
3. **Done = every box `[x]` and "How to verify" passes.** Flip to `Status: Shipped` and update the story to match what actually shipped. (Set `Superseded` instead if a later story replaces it.)

Stories sit under [docs/vision.md](docs/vision.md) (the arena vision) and [docs/software-model.md](docs/software-model.md) (the model/map north star); reference the relevant slice, phase, or MVP when scoping one, and use the vocabulary of [docs/vocabulary.md](docs/vocabulary.md).

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
