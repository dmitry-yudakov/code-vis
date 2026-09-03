# CodeAI

A local-first Next.js application for working on a repository through a persistent local-agent
conversation and a large Mermaid canvas. Choose Claude Code or Codex as the first main agent, then
add more provider/role participants to the same session. Conversation is the command/history
channel, and once a diagram exists the canvas becomes the primary workspace. Each message runs in
one of three modes — **Ask**, **Plan**, or **Agent** — subject to the selected provider's supported
modes.

**CodeAI** is the working product name until a naming decision replaces it. The superseded
static-analysis server, React Flow client, and VS Code extension are archived under
[legacy/](legacy/README.md); they are not built, started, or imported by this application.

## Requirements

- Node.js 20.9 or newer and npm (Next.js 16 sets the floor)
- at least one current local agent CLI: `claude` and/or `codex`
- the chosen CLI authenticated as the desktop user (`claude` or `codex login` if needed)
- one trusted local repository, or a directory containing trusted repositories

Provider credentials remain owned by the installed CLI. CodeAI inherits the launch environment but
does not read, copy, or persist login material.

## Start

```sh
npm install
cp .env.example .env.local
# Edit CODEAI_REPOSITORIES_ROOT in .env.local.
npm run dev
```

Open <http://localhost:3023>. If the configured root itself contains a common repository marker, it
is offered as one checkout. Otherwise marked, non-hidden repositories are discovered breadth-first
up to `CODEAI_REPOSITORIES_DEPTH` (default 1, maximum 10). Projects are durable bodies of work you
create in the header; sessions may belong to a project or remain under **No project**, and may bind
none, one, or several discovered repositories.

Useful commands, all run from the repository root:

```sh
npm run dev       # Next.js development server on 3023
npm start         # production server on 3023, after npm run build
npm test          # offline suite with fake Claude and Codex executables
npm run test:watch # the same suite in watch mode
npm run lint      # strict TypeScript check
npm run build     # production build
npm run test:e2e  # production build + Playwright/installed Chrome canvas workflow
```

### Upgrading from the `web2/` layout

The application used to live in `web2/`. If you have a working checkout from before that move:

```sh
mv web2/.env.local .env.local   # keep your ignored local settings
rm -rf web2                     # node_modules, .next, and build state are rebuilt at the root
npm install
```

The current host store lives under `~/.code-ai/web2/session-store-v2`. On first open it copies a
valid `session-store-v1` into that store and leaves the old directory untouched as a rollback (a
direct upgrade from `conversation-store-v1` is also supported).
The older `threads.json` prototype and browser keys under `code-ai:web2:v1:` are still deliberately
left untouched and are not imported. Environment variables were renamed from `CODEAI_WEB2_*` to
`CODEAI_*`, and **the old names continue to work** — see [Configuration](#configuration).

### Upgrading from the Yarn/Next.js 15 toolchain

The package manager is npm and the framework is Next.js 16. A checkout from before that switch
still has a Yarn-installed `node_modules` and no `package-lock.json`:

```sh
rm -rf node_modules yarn.lock .next .next-e2e
npm install
```

Nothing else changes: same port, same commands (`yarn x` → `npm run x`), same configuration, same
stored data. `next dev` and `next build` now use Turbopack, and `next dev` writes its output under
`.next/dev`, which stays ignored.

## Arena and Inbox

The workspace lives at `/`; the Arena's canonical destinations are `/arena` for active sessions,
`/arena/inbox`, and `/arena/archived`. Header controls and Arena tabs use client navigation, so
refresh, bookmarks, and browser Back/Forward preserve the top-level destination without encoding
device-local tabs, drafts, or panel state in the URL.

The header **Arena** control opens a machine-wide overview of active sessions, grouped by project.
Cards show Idle, Running, Needs you, Queued, or Failed state plus their repositories, agents, and
latest activity. An inactive session can be archived from its card and later restored intact from
the **Archived** view; a session with a reserved, queued, executing, or permission-blocked turn
cannot be archived. Use **New session** there to choose a project, provider, and initial mode before
opening an empty session; creation never sends a prompt automatically.

The header **Inbox** follows you into every session. It puts live permission requests first, then
failed and completed turns, and lets you answer a background session's permission without opening
it. Finished-item read markers are bounded device-only state. The Arena polls a compact host
summary; a failed refresh leaves the last good overview usable.

## Participants, roles, and manual handoffs

A new session starts with one main `coder`. The main designation is only the default
recipient: select any `@participant` for the next message or make that participant main without
moving its provider session. Add Claude or Codex participants with one of five transparent prompt
presets: `orchestrator`, `coder`, `reviewer`, `tester`, or `custom`. Provider and role are
independent, so Claude can review Codex work, two Codex participants can keep separate contexts,
or an orchestrator can be main while a coder and reviewer handle focused turns.

Every send addresses exactly one participant and every message names its author. Each agent owns a
private native provider session. On handoff, the server gives the addressed agent a bounded,
author-labeled JSON delta of the canonical host transcript it has missed. Failed, definitely
undelivered instructions are excluded; ambiguous/cancelled delivery remains visibly labelled.
Quick handoff chips prefill an
editable recipient, prompt, and role-default mode; they never send automatically. Autonomous
agent-to-agent relay, simultaneous turns inside one session, and autopilot are intentionally not
implemented yet.

New sessions default to **Plan** because their initial participant is the `coder` preset. Arena
creation may set another supported initial mode as device-local state before the empty session opens.

Independent sessions can execute at the same time. The machine runs two eligible turns by default
and visibly queues additional work; `CODEAI_MAX_CONCURRENT_RUNS` sets a limit from 1–8. Ask and
Plan turns may share a checkout, while Agent takes an exclusive checkout execution lock and keeps
its slot while an approval is pending. Every tab owns its own status, preview, activity,
permissions, cancellation, and reload recovery.

## Conversation modes

Every message carries a mode. The browser sends only the mode name; the server resolves it to a
fixed provider policy. A session can change modes and recipients; later turns resume only the
addressed participant's private provider-owned session.

| | Ask (wire fallback; reviewer/tester/custom default) | Plan (orchestrator/coder default) | Agent |
|---|---|---|---|
| Purpose | Q&A, review, diagrams | An approvable implementation plan | Building in the working tree |
| Provider policy | server-owned read-only profile | server-owned read-only profile | provider approval profile |
| Side effects | never | never | only after you approve each one |
| Prompts you | never | never | permission cards in the chat |
| Budget per message | 20 turns / 5 min | 20 turns / 5 min | 200 turns / 30 min |

**Ask** is the read-only conversation plus the git allowlist below. **Plan** has identical
capability and differs by contract: the turn ends with a delimited plan and the message gains an
**Execute plan** button. Executing sends an ordinary follow-up turn in Agent mode that resumes the
same session, so the executing agent keeps all of the research context. Nothing auto-executes.

**Agent** runs with the provider's server-owned approval policy. Every side effect raises a permission card in the
conversation with **Allow** / **Deny**; the floating canvas control shows a pending badge so
full-screen users notice. Deny does not kill the run — the model is told and continues. An
unanswered card is auto-denied after `CODEAI_APPROVAL_TIMEOUT_MS` (default 10 minutes), and
the run's own timeout clock is paused while a card is pending. Cancelling resolves pending cards as
denied before terminating the child.

Agent mode edits **the real working tree** of the session's primary repository, exactly like the corresponding
terminal agent. Review the result with `git diff`. Worktree isolation and apply/discard checkpoints are
deliberately out of scope for now.

Claude currently supports all three modes. Codex supports Ask and Plan by default. Codex Agent is
a release gate: set `CODEAI_CODEX_AGENT=1` only after the installed App Server has passed the
real write, command, network-escalation, denial, and cancellation approval matrix documented in
[docs/experiment-log.md](docs/experiment-log.md). Without that opt-in, the UI reports Codex Agent as
unsupported rather than silently granting workspace writes.

**A run outlives the page that started it.** Closing the tab, reloading, or a dev-server refresh
only detaches the browser — the agent keeps working, and reopening the conversation reattaches to
the live turn, replaying the activity, any pending approval, and the answer. This matters most
right after you approve something: killing the run there would leave a half-applied change. Ending
a turn early is therefore an explicit act — the **Cancel** button — which resolves pending
approvals as denied and stops the child. A finished run stays reattachable for five minutes.

Building spends turns on research long before the first edit, so Agent gets its own budget
(`CODEAI_BUILD_MAX_TURNS`, `CODEAI_BUILD_TIMEOUT_MS`) rather than the conversation's. If a
message still runs out, the turn ends with an explicit notice and a **Continue** action — the
session is intact, so the agent picks up where it stopped.

### Claude Git read allowlist

Claude modes add `Bash`, gated by a fixed server-owned rule set:

```text
Bash(git log:*)    Bash(git show:*)    Bash(git diff:*)    Bash(git status:*)
Bash(git branch:*) Bash(git blame:*)   Bash(git shortlog:*)
Bash(gh pr view:*) Bash(gh pr diff:*)  Bash(gh pr list:*)
```

This is what makes "show me the last 4 commits" or "review PR #12" work without full Bash. A
command matching no rule is denied automatically and shown as a denial in the activity timeline, so
Ask and Plan degrade gracefully instead of erroring. The rules are not browser-configurable.

Known caveat, documented rather than solved: command-level allowlisting is **not argument-level
sandboxing**. Flags such as `git log --output=<file>` can technically write. That stays inside the
trust stance below. `git fetch`/`git pull`/`gh api` are deliberately excluded because, despite
looking read-only, they are arbitrary command execution.

## Safety model

Every run uses a server-owned provider profile. The browser can name a supported mode and nothing
else: provider, executable, tool list, allowlist, permission mode, model flags, environment
variables, sandbox, and settings all stay server-owned. An unknown or unsupported mode is a 400.

Claude is spawned without a shell in the primary repository's checkout directory with:

- safe mode (repository hooks, skills, MCP, and custom commands stay disabled), strict empty MCP
  configuration, and slash commands disabled, in every mode;
- the fixed git/gh allowlist, and in Ask/Plan the `Read,Glob,Grep,Bash` tool list with plan
  permissions;
- a bounded turn count, timeout, output size, and one global active process;
- native session persistence (`--session-id` first, `--resume` later).

Codex is spawned as a local [`codex app-server`](https://learn.chatgpt.com/docs/app-server) stdio
child for each active turn. CodeAI performs the App Server handshake, starts or resumes the
stored Codex thread, and streams the turn without opening a listener port. Ask and Plan use a
read-only sandbox with network disabled. Server-owned overrides disable MCP servers, apps,
plugins, hooks, web search, subagents, custom commands, and non-system skills; preflight also
queries the effective integration inventory and fails closed if an ambient executable capability
remains enabled. App Server approval requests are correlated to the active turn, sanitized, and
resolved as one-shot allow/deny decisions through the same permission cards.

Status and diff context are generated by fixed, read-only, no-shell Git invocations and placed with
diagram snapshots in a per-run temporary directory outside the repository. It is always removed after
the turn.

This is a capability restriction, **not a separate operating-system or container boundary**. The
selected CLI still runs as your desktop user, and in Agent mode it changes real files once you
approve. Use CodeAI
only with repositories you trust. It is not designed for remote hosting, multi-user use, or
untrusted repositories.

## Authentication and billing (bring your own)

The spawned process inherits the environment of whatever started CodeAI, unchanged. Whatever the
selected local CLI already uses — a subscription login, compatible endpoint environment, or API
key — applies to CodeAI runs exactly as it does in the terminal. CodeAI adds no provider
credentials or endpoint variables and never persists any. **Billing follows the login and
environment of whoever starts CodeAI.**

## How sessions and data work

- `session-store-v2` is the canonical store. Its manifest gives this installation a durable
  host id and label; projects and sessions are separate validated, revisioned JSON records containing repository bindings,
  roster, messages, Mermaid artifacts, sketches, annotations, and pins. Provider session ids and
  transcript cursors live in the same private record but are removed from every route response.
  Active session files live under `sessions/`; recoverable archived records move atomically to
  `archived-sessions/` with an archive timestamp.
- Writes are operation-level and serialized. A process-owned `writer.lock` excludes a second
  CodeAI process from the same data directory; session files are flushed and atomically renamed with
  user-only permissions. Revision-bearing overwrite operations reject stale clients with 409,
  while stable request ids make append retries idempotent.
- Projects group sessions and repository bindings. Sessions carry an optional project id and their
  own independently editable repository list. A session can be loose or repository-free; the
  canvas, roster, and conversation record remain available, while a turn clearly asks for a primary
  repository.
- The browser lists and hydrates snapshots from `/api/sessions`. A versioned device record in
  `localStorage` restores open/focused session views, drafts, unread counts, active canvases,
  addressee/mode, repository selection, canvas cameras, and per-view panels. It writes no
  transcript, canvas, roster, annotation, project, or repository-binding content there. Reloading
  or a second browser context sees committed host content after refetch, with its own layout.
- Later turns resume the addressed participant's host-bound native provider session and receive
  only the bounded canonical transcript delta missed since its last complete turn. The server
  defaults to 40 entries / 24 KB and never accepts a browser-supplied transcript.
- If the provider's native session is missing, visible history is retained and the UI offers an explicit
  new-session continuation with a visible bounded recap.
- Export includes the roster and expanded author/provider/role metadata for every entry, plus
  diagram/mark state, without provider session ids, credentials, or server paths.

Local `.env*`, `.next`, `node_modules`, coverage, and TypeScript build state are ignored. The
tracked `.env.example` contains no secrets.

## Canvas workflow

Ask a normal question. Markdown-only answers are complete answers. Zero or more fenced Mermaid
blocks become immutable diagram artifacts; one invalid diagram does not hide prose or siblings.
The first valid diagram opens on the canvas.

The canvas supports pan, wheel/buttons zoom, fit/reset, pen, rectangle, arrow, text, eraser,
50-step undo/redo, confirmed clear, Mermaid source export (diagrams only), and canvas/marks JSON
export. Chat and canvas history are drawers. Focus mode fills the application viewport while
retaining tools, status, and the instruction composer.

**Start a sketch** opens a blank sheet with the same drawing tools — available before any diagram
exists, so a drawing can be the very first thing in a conversation. A sketch has no Mermaid source:
its marks and composite PNG are the whole attachment, and the agent is told to read them as your
own drawing rather than infer structure you did not draw. Because the drawing is itself the
instruction, a sketch turn sends with an empty composer. Sketches share the canvas id space with
diagrams, so selection, ink, pinning, attachment, and history work identically for both.

The active canvas is visibly attached to the next instruction by default. A diagram attachment
contains its immutable Mermaid source, the exact vector-mark snapshot, viewport, and a local
composite PNG when browser export succeeds. Remove its chip for a text-only turn, or use History to
attach up to four canvases. Composite failure is non-fatal.

A single valid result derived from the still-active attachment becomes active automatically and
leaves **Previous version** one action away. Navigation during a run suppresses auto-activation.
Zero or multiple diagram results preserve the current canvas.

## Configuration

See [.env.example](.env.example). The most useful options are:

- `CODEAI_REPOSITORIES_ROOT` — repository or repositories directory;
- `CODEAI_REPOSITORIES_DEPTH` — nested discovery depth, from 1–10 (default `1`);
- `CODEAI_CLAUDE_BIN` / `CODEAI_CLAUDE_MODEL` — local agent executable and optional model;
- `CODEAI_CODEX_BIN` / `CODEAI_CODEX_MODEL` — local Codex executable and optional model;
- `CODEAI_CODEX_AGENT` — explicit Codex Agent release gate; unset means Ask/Plan only;
- `CODEAI_DATA_DIR` — canonical host session store root (tilde expansion is handled in Node);
- `CODEAI_HOST_LABEL` — label persisted when a fresh host store is first created;
- `CODEAI_APPROVAL_TIMEOUT_MS` — how long an Agent permission card waits before auto-denying;
- `CODEAI_MAX_CONCURRENT_RUNS` — machine-wide execution slots, from 1–8 (default `2`);
- `CODEAI_AGENT_*` / `CODEAI_BUILD_*` — per-message turn and time budgets for Ask/Plan
  and for Agent respectively;
- `CODEAI_MAX_TRANSCRIPT_MESSAGES` / `CODEAI_MAX_TRANSCRIPT_BYTES` — server-side prompt bounds
  applied to the canonical host transcript;
- response, Mermaid, attachment, and Git-context bounds.

**`CODEAI_WEB2_*` compatibility.** Every setting above also accepts its former `CODEAI_WEB2_*`
spelling for this migration, so an environment written for `web2/` starts the root application
unchanged:

```ts
value = process.env.CODEAI_SETTING ?? process.env.CODEAI_WEB2_SETTING ?? defaultValue;
```

The neutral name wins when both are set to a value; an assignment with an empty value counts as
unset on either name, which is how these settings have always behaved. Validation runs on whichever
raw value is selected, so an invalid neutral value fails rather than silently falling back to a
valid legacy one. Repository discovery also accepts `CODEAI_PROJECTS_ROOT` and
`CODEAI_PROJECTS_DEPTH` as compatibility fallbacks, with the repository-named settings taking
precedence. The default data directory keeps its historical `~/.code-ai/web2` spelling. The
old browser prefix `code-ai:web2:v1:` is also left untouched, but current code neither reads nor
writes session records under it.

The health endpoint checks infrastructure and each provider independently, without invoking a
model. Claude flags are checked through `claude --help`; Codex performs a bounded App Server
handshake plus account and effective-capability inventory. A missing, logged-out, incompatible, or
over-capable provider is reported without making a healthy provider unusable.

## Documentation

- [Architecture](docs/architecture.md) — the current client/server boundary
- [Vision — the arena](docs/vision.md) — the main product direction
- [Vocabulary](docs/vocabulary.md) — the words the product uses, and why
- [The software model](docs/software-model.md) — the model/map north star (a chapter of the vision)
- [Sessions, machines, and records](docs/multi-project-session-environment.md) — engineering notes behind the arena
- [Experiment log](docs/experiment-log.md) — manual real-agent matrix
- [Repository conventions](AGENTS.md) — source ownership and the spec-driven loop
- [Legacy runtime](legacy/README.md) — the archived analyzer, web client, and extension

## Known limitations

- Mermaid diagrams are immutable outputs. Revisions create new artifacts rather than editing source.
- Ink does not snap to Mermaid elements and is not geometrically transferred to a revised diagram.
- A sketch is a fixed-size sheet the agent can read but not draw on; it never becomes a diagram
  artifact, and the agent answers with prose or a new Mermaid diagram instead.
- Mermaid subgraphs cannot be generically collapsed; large diagrams use pan/zoom/fit and agent revision.
- Agent mode works directly in the checked-out tree: no worktree isolation, no apply/discard
  checkpoints, and no policy on pre-existing uncommitted changes. Review with `git`.
- Every shipped Agent side effect prompts; there is no "always allow" or `acceptEdits` tier yet.
- Source excerpts and editor deep links are still outside the experiment.
- Native provider session history remains owned by its CLI; deleting local browser data does not
  delete that history.
- Participant removal, session transfer, editable custom-role instructions, simultaneous turns in
  one session, and autonomous multi-agent relay are not implemented.
- Queues and provider processes are machine-memory state; a server restart leaves canonical
  transcript recovery intact but does not resume queued or executing processes.
- The real-agent experiment matrix is manual and is tracked in
  [docs/experiment-log.md](docs/experiment-log.md).
