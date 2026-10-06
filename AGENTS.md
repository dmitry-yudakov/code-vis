# CodeAI

A local-first Next.js application for working on a trusted repository through a persistent
local-agent conversation and a Mermaid canvas. The repository root **is** the application: one
private npm package, one Next.js 16 app, one set of commands. Node 20.9+.

## Now

Updated 2026-10-06. When a story ships, change the line that names it; each story file keeps its own
`Status:`, so nothing here duplicates it.

- **Development queue:** [docs/development-queue.md](docs/development-queue.md) — ordered work for
  agent sessions, with stable item IDs, completion criteria, and source stories. Use it when asked
  for the next ready item.
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
  inside the headset reaches the paired home machine without a cable, after a three-second
  aim-before-capture countdown; the Quest 3S run remains pending.
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
- **Also in flight:** [Story 64](stories/STORY-20260921-managed-self-rebuild.md) — `npm run start:managed`
  builds CodeAI's own checkout into a spare slot on request, swaps to it once it reports ready, rolls
  back otherwise, and returns to the previous release on `kill -USR2`; verified offline and with a real
  build, restart, rollback, and `kill -USR2` on this machine, and the Quest 3S run remains pending.
- **Also in flight:** [Story 66](stories/STORY-20260922-select-model-and-effort.md) — choose the
  model and effort for an agent's next turn from the executing machine's own list; implemented with
  offline checks, and the real-provider verification remains pending.
- **Also in flight:** [Story 67](stories/STORY-20260923-docker-provider-upgrade.md) — update one
  provider's Docker CLI from Arena or `npm run docker:upgrade` after offline checks, roll back, and
  offer Docker Codex its worker's own models; verified against a real daemon, and signed-in turns
  on the owner's installation remain pending.
- **Also in flight:** [Story 68](stories/STORY-20260924-personal-git-ignore.md) — CodeAI's Git
  views honor the user's personal Git ignore file (`~/.config/git/ignore`), on host Git and in the
  Docker helper alike; verified against a real helper, and a check in the running app remains pending.
- **Also in flight:** [Story 69](stories/STORY-20260924-archive-from-conversation.md) — archive the
  open conversation from inside it: More → Archive session on the desktop, and Session tools →
  Archive session in VR, which then brings the Arena forward; implemented with automated checks, and
  the Quest 3S run remains pending.
- **Also in flight:** [Story 70](stories/STORY-20260924-remember-turn-choices.md) — this device
  remembers the last mode, new-session provider, and each provider's model and effort, and new
  sessions and agents start there; implemented with automated checks, and a check in the running app
  remains pending.
- **Also in flight:** [Story 71](stories/STORY-20260925-compact-composer.md) — one mode picker, a
  `+` attach menu, and an execution line under the composer, the first story of the
  [workbench shell epic](stories/EPIC-20260925-workbench-shell.md), whose design lives in
  `docs/design/workbench-shell/`; implemented with automated checks, and a check in the running app
  remains pending.
- **Also in flight:** [Story 72](stories/STORY-20260925-layout-frame.md) — an activity bar for the
  side panel's views, the Arena, the Inbox, and More, plus Canvas and Conversation layout icons, and
  a canvas that can be hidden; implemented with automated checks, and a check in the running app
  remains pending.
- **Also in flight:** [Story 78](stories/STORY-20260928-toast-notifications.md) — notices become a
  stack of toasts in the canvas's top-right corner, each with a tone, actions, and a lifetime, which
  pauses while the pointer rests on the stack; implemented with automated checks, and a check in the
  running app remains pending.
- **Also in flight:** [Story 79](stories/STORY-20260928-sandboxed-auto-mode.md) — a fourth mode, Auto,
  runs what the provider's sandbox contains without a card and asks for what leaves it; shipped for
  Codex and verified with real turns, and Codex's approval reviewer is pinned to the user. Claude
  Auto is not implemented: its sandbox could not be probed on this machine without `sudo`
  (`socat`, and an AppArmor profile for bubblewrap).
- **Also in flight:** [Story 80](stories/STORY-20260929-global-instructions.md) — agents get your
  global instructions (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`) as text by default, the Arena
  shows them and holds a switch per provider, a session can carry its own Use or Isolate choice
  (session format 7), and a Docker worker sees an allowlist of the provider folder read-only;
  verified with real Claude turns and a real Docker daemon, and a signed-in Docker Codex turn and a
  check in the running app remain pending.
- **Also in flight:** [Story 81](stories/STORY-20260930-paste-image-into-chat.md) — an image pasted
  into the composer, or dropped on it, becomes a chip and is sent with the next message for that
  turn only; the message records its type and size (session format 8). Implemented with automated
  checks; a real screenshot with real Claude and Codex turns remains pending.
- **Shipped:** [Story 73](stories/STORY-20261003-title-bar-tabs.md) — session tabs live in the
  title bar; All sessions opens closed and overflow views, with keyboard navigation, neighbour focus,
  and stored layouts preserved. TypeScript, build, unit/browser checks and review passed; three
  additional spatial/VR browser checks remain unverified because Chrome could not create WebGL contexts.
- **Next shell story:** Story 74, status-bar — planned in the workbench shell epic. The development
  queue's next implementation item is Q5, Story 7's persistent repository model.
- **Shipped:** [Story 6](stories/STORY-20261003-agent-emitted-software-model.md) — explicit `/model`
  turns emit typed LLM suggestions alongside Mermaid, with stable server-generated ids, atomic
  validation and bounded temporary checkout accumulation. Three independent real-Claude passes
  retained all five scoped entity ids and three relation ids. TypeScript, production build,
  1,038 unit tests, both-theme production browser checks and end-of-work review passed.
- **Shipped:** [Story 82](stories/STORY-20261001-native-security-level.md) — Native Local Claude and
  Codex writing modes load your own setup, with Accept edits, Auto, and Full access alongside Agent;
  Guarded remains the default. Real-provider probes, automated checks, and review passed. Claude
  Ask/Plan use tightened noninteractive permissions and user-only settings, and Native messages use
  session format 9. The first story of the [security levels epic](stories/EPIC-20261001-security-levels.md).
- **Shipped:** [Story 83](stories/STORY-20261001-turn-checkpoints.md) — writing turns save a private
  eligible-file checkpoint on the executing machine, and desktop/VR share explicit checkout Undo;
  failure/concurrency tests, production-browser checks and review passed. Recovery currently
  requires Linux; Git history/index, ignored/private files and external effects are excluded.
- **Shipped:** [Story 85](stories/STORY-20261002-auto-archive-inactive-conversations.md) —
  conversations automatically move to the recoverable archive after 48 hours without saved
  activity; owner-machine polling/loading, live-turn protection, Restore, automated checks,
  production-browser verification, and independent review passed. The threshold is fixed for now.
- **Shipped:** [Story 86](stories/STORY-20261002-new-chat-from-conversation.md) — New chat
  in the desktop conversation header creates a fresh session with the same project and agent
  settings, then closes the source tab while keeping its history. Offline checks, the production
  build, and all four focused browser checks pass.
- **Shipped:** [Story 87](stories/STORY-20261002-draw-on-pasted-images.md) — open a pending
  screenshot on the desktop canvas, draw over it, and send the bounded marked copy while keeping
  editable ink per image and session. Unit checks, TypeScript, the production build, 17 focused
  browser checks, and a subagent review passed.
- **Shipped:** [Story 88](stories/STORY-20261002-unlimited-approval-waits.md) — approval
  requests wait without expiry by default; `CODEAI_APPROVAL_TIMEOUT_MS=0` disables expiry and
  positive values retain optional auto-denial. Offline checks, TypeScript, and independent review passed.
- **Shipped:** [Story 89](stories/STORY-20261005-symlink-checkpoints.md) — turn checkpoints save
  symbolic links without following targets, and Undo restores retargeted/deleted links and file/link
  replacements. Existing checkpoints remain recoverable; all 1,083 offline tests, TypeScript and
  independent review passed. Populated-directory replacement by a link remains outside Undo.
- **Shipped:** [Story 90](stories/STORY-20261005-change-running-mode.md) — change supported modes
  during a queued, working, or approval-blocked turn on desktop and in VR; the same task resumes
  with its new policy, preserved evidence, checkout locking, checkpoint recovery, and remaining
  budgets. Offline tests, TypeScript, production build, both-theme browser checks and review passed.
- **Shipped:** [Story 91](stories/STORY-20261005-checkpoint-capacity.md) — writing turns recover
  tracked assets up to 8 MiB per file and 128 MiB per checkout; storage retention reserves active
  checkpoints before completed records. All 72 focused checks, TypeScript and independent review passed.
- **Shipped:** [Story 65](stories/STORY-20260921-tolerate-newer-session-format.md) — a session in a
  newer format hides only that session instead of closing the store; Stories 63 and 64 depended on it.
- **Plan of record:** [vision.md's sequence](docs/vision.md#sequence) for breadth (the arena and the
  machines behind it), the [software-model epic](stories/EPIC-20260705-north-star-roadmap.md) for
  depth (the model, lenses, and the change loop), and the
  [immersive workspace epic](stories/EPIC-20260905-immersive-workspace.md) for VR delivery, and the
  [workbench shell epic](stories/EPIC-20260925-workbench-shell.md) for the flat desktop shell, and the
  [security levels epic](stories/EPIC-20261001-security-levels.md) for how much a machine lets agents
  do on their own. Naming:
  [vocabulary.md](docs/vocabulary.md).

## Commands

All commands run from the repository root.

```sh
npm run dev        # Next.js dev server on 3023 (Turbopack, output in .next/dev)
npm run devs       # the same over HTTPS on the LAN for a headset — unauthenticated, see README
npm start          # production server on 3023, after npm run build
npm run start:remote # paired personal-device HTTPS server, after npm run build
npm run start:managed # the same server under a parent that can build, swap, and roll back releases
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
npm run docker:upgrade # print the Docker CLI versions; -- PROVIDER VERSION checks and switches one
npm run test:docker # probe the real Docker runtime; needs a running daemon
```

`legacy/` is excluded from the TypeScript project, the Vitest include set, and the Playwright test
directory. Nothing in the root build traverses it.

`next dev` maintains two things itself: the `nextjs-agent-rules` block at the end of this document
and the generated-type entries in `tsconfig.json`. They are committed as written so a dev run leaves
the working tree clean — edit them only through Next.js. Next also writes `next-env.d.ts`, which is
git-ignored as Next.js recommends: every dev, build, and e2e run points it at its own build directory.

## Source ownership

| Path | Owns |
|------|------|
| `src/app/` | Next pages, layout, global CSS, and route handlers |
| `src/features/shell/` | Application composition (`AppShell`) |
| `src/features/shell/immersive/` | The VR workspace: panels, tools, layout, input, capture, and reports |
| `src/features/agents/` | Activity timeline, participants, modes, permission cards |
| `src/features/arena/` | Host-wide session cards, Inbox derivation, polling, device read state, and the machine's Docker and Global instructions sections |
| `src/features/devices/` | Personal-device pairing gate and paired-device management UI |
| `src/features/conversation/` | Transcript, composer, drawer, session selection, public snapshot helpers, and the preparation of pasted or dropped images |
| `src/features/diagram/components/` | Canvas, cards, navigation, drawing and evidence UI |
| `src/features/diagram/mermaid/` | Mermaid validation policy and SVG renderer |
| `src/features/diagram/annotations/` | Drawing state and composite export |
| `src/features/diagram/spatial/` | Desktop spatial room, spatial diagram model, and the GPU resource ledger shared with VR |
| `src/features/projects/` | Project selection UI |
| `src/features/reports/` | The shared CodeAI report owner, the flat Reports tab, and report labels |
| `src/features/lifecycle/` | Build & restart in the browser: the pure confirm/build/restart/reconnect flow, its owner, and the More-menu section |
| `src/features/repository/` | Repository tree, status, and diff UI and client state |
| `src/server/agents/` | Provider policies, adapters, preflight, process runners, and the user's global instructions: file resolution, the machine's switches in `<dataDir>/instructions/`, and the framed text |
| `src/server/conversation/` | Prompt, transcript, response parsing, orchestration |
| `src/server/repository/` | Checkout discovery, the self-project rule, fixed read-only git invocations, and bounded context |
| `src/server/runs/` | Run lifecycle and permission broker |
| `src/server/storage/` | Project/session store, durable server records, promoted report evidence under `<dataDir>/attachments/`, per-run attachment directories under `<dataDir>/run-attachments/` |
| `src/server/config.ts` | Environment resolution and limits |
| `src/server/boundedTextFile.ts` | Whole-or-nothing reads of the user's own small text files (personal Git ignore, global instructions) |
| `src/server/devices/` | Hashed pairing/device records, cookies, transport and route authorization |
| `src/server/diagnostics/` | Immersive reports in the home machine's data directory, and their self-project-only reads |
| `src/server/lifecycle/` | A managed server's side of Build & restart: the private parent channel, status, and the scheduler's maintenance lease |
| `src/server/execution/` | Optional Docker execution: container profile, runtime, recovery, process transport, and the allowlist of user customizations a worker may see |
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
  and effort from the choices the executing machine lists for that provider, a new session's
  global-instructions choice, and this machine's switch for a provider, and nothing else; the
  executable, tool list, allowlist, permission mode, sandbox, model flags, and the instruction
  file's path and text are resolved on the server. An unknown mode, or an unlisted model or effort, is a 400; a mode the addressed provider
  does not advertise is a 409.
- At **Guarded**, Local Agent edits the real working tree after per-action approval and runs as the desktop user.
  Local Auto (Story 79, Codex only) runs without individual approval inside the provider's
  operating-system sandbox: the checkout except `.git`, `.codex`, and `.claude` at its root (a
  nested repository is not protected), with no network.
  Anything that leaves the sandbox raises Agent's card. CodeAI never detects dangerous commands
  itself and never lets a model answer an escalation. Do not widen the sandbox profile
  (`CODEX_AUTO_PROFILE`) or relax its echo check without a recorded real-provider probe. Two rules
  outside the sandbox keep it meaningful: host Git reads keep `safe.bareRepository=explicit`, and
  Auto is refused while the data directory is inside the checkout or a temp directory.
  Optional Docker execution (Story 57, release verification pending) uses a pinned non-root worker:
  Docker Agent edits the mounted checkout autonomously; Ask/Plan mount it read-only. There is no
  separate working copy. Writing turns save bounded eligible-file checkpoints on the executing host,
  outside worker mounts; explicit Undo refuses newer changes and changed Git HEAD/index. New Docker participants share a persistent provider home per
  installation/provider; existing individual homes retain their native history. Never mount the running CodeAI installation or provider host
  storage; see [the Docker execution contract](docs/docker-execution.md). The one exception
  (Story 80): a Docker turn whose Global instructions choice is on binds a fixed allowlist of the
  user's provider folder read-only under `/user/<provider>` (the instruction files, `skills/`,
  `agents/`, `commands/`, `prompts/`), never the folder. Do not add an entry to
  `PROVIDER_CUSTOMIZATIONS` or loosen `resolveUserPath` or the protected-path check without a
  recorded review: everything else in those folders holds credentials, tokens, or other projects'
  transcripts. A link that lives where a turn can write (the repositories root, a temp directory)
  is never followed, and nothing there is ever a bind source.
- At Guarded and in Docker, the user's global instructions reach a provider as text only
  (`--append-system-prompt` for Claude, `developerInstructions` for Docker Codex), read on the server whole or not at all, through
  `resolveUserPath`: never through a symbolic link under the repositories root or a temp directory,
  and never from a provider folder's private files. A file that lies where a turn can write is read
  only with proof that the open handle is the resolved file (`readBoundedTextFile` with `exactly`):
  there, a path is only as good as the moment it was checked. At Guarded, Claude
  stays in safe mode and Codex keeps its disabled features: never load hooks, skills, plugins, MCP,
  or settings natively to honor them. Instructions are guidance, never a boundary: no mode, sandbox,
  or approval may depend on them.
- **Native** is machine-set with `CODEAI_SECURITY_LEVEL`, fixed for the process, and Local only.
  Local writing turns load the user's provider setup: Claude omits safe mode and isolation flags;
  Codex leaves integrations, network/writable-root settings, and the approval reviewer to the user.
  Codex still disables `request_permissions_tool` and `exec_permission_approvals`, because CodeAI
  handles one approval at a time. Native Agent, Accept edits (Claude), Auto, and Full access take
  exclusive checkout access and the build budget. Full access reaches everything the desktop user
  can reach, including checkpoint storage. Undo covers eligible checkout files only; it never
  restores private/ignored files, Git history/index, external actions or writes elsewhere.
  CodeAI never reads provider credentials itself.
  Ask and Plan keep Guarded isolation at both levels: Local Claude uses noninteractive default
  permissions and user-only setting sources, so planted project rules cannot grant shell writes.
  Docker keeps its existing profile and customization allowlist. Pairing, exact HTTPS origins,
  server-owned capability resolution, budgets, cancellation, and session persistence hold at both
  levels. No browser request may set the level. A Native writing turn can plant provider settings
  that later writing turns load. An explicitly isolated session cannot run Native Claude writing.
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
