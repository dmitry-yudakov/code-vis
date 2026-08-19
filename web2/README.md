# Cartograph `web2`

An isolated, local-first prototype for working on a repository through a persistent local-agent
conversation and a large Mermaid canvas. Choose Claude Code or Codex as the first main agent, then
add more provider/role participants to the same conversation. Conversation is the command/history
channel, and once a diagram exists the canvas becomes the primary workspace. Each message runs in
one of three modes — **Ask**, **Plan**, or **Agent** — subject to the selected provider's supported
modes.

## Requirements

- Node.js 20 or newer and Yarn 1
- at least one current local agent CLI: `claude` and/or `codex`
- the chosen CLI authenticated as the desktop user (`claude` or `codex login` if needed)
- one trusted local project, or a directory whose immediate children are trusted projects

Provider credentials remain owned by the installed CLI. `web2` inherits the launch environment but
does not read, copy, or persist login material.

## Start

```sh
cd web2
yarn install
cp .env.example .env.local
# Edit CODEAI_WEB2_PROJECTS_ROOT in .env.local.
yarn dev
```

Open <http://localhost:3023>. If the configured root itself contains a common project marker, it is
offered as one project. Otherwise marked, non-hidden projects are discovered breadth-first up to
`CODEAI_WEB2_PROJECTS_DEPTH` (default 1, maximum 10). The header project picker shows the active
depth and searches project names and root-relative paths. If no marked project exists within the
bound, immediate child directories remain available as a fallback.

Useful commands:

```sh
yarn dev       # Next.js development server on 3023
yarn start     # production server on 3023, after yarn build
yarn test      # offline suite with fake Claude and Codex executables
yarn lint      # strict TypeScript check
yarn build     # production build
yarn test:e2e  # production build + Playwright/installed Chrome canvas workflow
```

## Participants, roles, and manual handoffs

A new conversation starts with one main `coder`. The main designation is only the default
recipient: select any `@participant` for the next message or make that participant main without
moving its provider session. Add Claude or Codex participants with one of five transparent prompt
presets: `orchestrator`, `coder`, `reviewer`, `tester`, or `custom`. Provider and role are
independent, so Claude can review Codex work, two Codex participants can keep separate contexts,
or an orchestrator can be main while a coder and reviewer handle focused turns.

Every send addresses exactly one participant and every message names its author. Each agent owns a
private native provider session. On handoff, the server gives the addressed agent a bounded,
author-labeled delta of the shared browser transcript it has missed. Quick handoff chips prefill an
editable recipient, prompt, and role-default mode; they never send automatically. Autonomous
agent-to-agent relay, parallel turns, and autopilot are intentionally not implemented yet.

## Conversation modes

Every message carries a mode. The browser sends only the mode name; the server resolves it to a
fixed provider policy. A thread can change modes and recipients; later turns resume only the
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
unanswered card is auto-denied after `CODEAI_WEB2_APPROVAL_TIMEOUT_MS` (default 10 minutes), and
the run's own timeout clock is paused while a card is pending. Cancelling resolves pending cards as
denied before terminating the child.

Agent mode edits **the real working tree** of the selected project, exactly like the corresponding
terminal agent. Review the result with `git diff`. Worktree isolation and apply/discard checkpoints are
deliberately out of scope for now.

Claude currently supports all three modes. Codex supports Ask and Plan by default. Codex Agent is
a release gate: set `CODEAI_WEB2_CODEX_AGENT=1` only after the installed App Server has passed the
real write, command, network-escalation, denial, and cancellation approval matrix documented in
`docs/experiment-log.md`. Without that opt-in, the UI reports Codex Agent as unsupported rather
than silently granting workspace writes.

**A run outlives the page that started it.** Closing the tab, reloading, or a dev-server refresh
only detaches the browser — the agent keeps working, and reopening the conversation reattaches to
the live turn, replaying the activity, any pending approval, and the answer. This matters most
right after you approve something: killing the run there would leave a half-applied change. Ending
a turn early is therefore an explicit act — the **Cancel** button — which resolves pending
approvals as denied and stops the child. A finished run stays reattachable for five minutes.

Building spends turns on research long before the first edit, so Agent gets its own budget
(`CODEAI_WEB2_BUILD_MAX_TURNS`, `CODEAI_WEB2_BUILD_TIMEOUT_MS`) rather than the conversation's. If a
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

Claude is spawned without a shell in the selected project's directory with:

- safe mode (project hooks, skills, MCP, and custom commands stay disabled), strict empty MCP
  configuration, and slash commands disabled, in every mode;
- the fixed git/gh allowlist, and in Ask/Plan the `Read,Glob,Grep,Bash` tool list with plan
  permissions;
- a bounded turn count, timeout, output size, and one global active process;
- native session persistence (`--session-id` first, `--resume` later).

Codex is spawned as a local [`codex app-server`](https://learn.chatgpt.com/docs/app-server) stdio
child for each active turn. Cartograph performs the App Server handshake, starts or resumes the
stored Codex thread, and streams the turn without opening a listener port. Ask and Plan use a
read-only sandbox with network disabled. Server-owned overrides disable MCP servers, apps,
plugins, hooks, web search, subagents, custom commands, and non-system skills; preflight also
queries the effective integration inventory and fails closed if an ambient executable capability
remains enabled. App Server approval requests are correlated to the active turn, sanitized, and
resolved as one-shot allow/deny decisions through the same permission cards.

Status and diff context are generated by fixed, read-only, no-shell Git invocations and placed with
diagram snapshots in a per-run temporary directory outside the project. It is always removed after
the turn.

This is a capability restriction, **not a separate operating-system or container boundary**. The
selected CLI still runs as your desktop user, and in Agent mode it changes real files once you
approve. Use this prototype
only with repositories you trust. It is not designed for remote hosting, multi-user use, or
untrusted projects.

## Authentication and billing (bring your own)

The spawned process inherits the environment of whatever started `web2`, unchanged. Whatever the
selected local CLI already uses — a subscription login, compatible endpoint environment, or API
key — applies to `web2` runs exactly as it does in the terminal. `web2` adds no provider
credentials or endpoint variables and never persists any. **Billing follows the login and
environment of whoever starts `web2`.**

## How conversations and data work

- A Cartograph thread UUID is registered server-side and permanently bound to one opaque project
  ID. Its roster contains one local human identity and one or more agent identities; each agent
  stores its provider-session continuity privately.
- The minimal server registry stores thread identity, timestamps, roster, main-agent pointer,
  private provider sessions, and transcript cursors. It uses atomic writes and user-only
  permissions. Older single-provider registries and browser threads migrate without changing
  their IDs, content, canvases, or provider session.
- Transcript, Mermaid artifacts, evidence references, pins, active selection, and vector marks are
  stored in versioned browser `localStorage`. Composite PNGs, repository files, and diffs are not.
- Reloading restores browser state; later turns resume the addressed participant's native provider
  session and receive only the bounded shared transcript delta missed since its last complete turn.
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

- `CODEAI_WEB2_PROJECTS_ROOT` — required project or projects directory;
- `CODEAI_WEB2_PROJECTS_DEPTH` — nested discovery depth, from 1–10 (default `1`);
- `CODEAI_WEB2_CLAUDE_BIN` / `CODEAI_WEB2_CLAUDE_MODEL` — local agent executable and optional model;
- `CODEAI_WEB2_CODEX_BIN` / `CODEAI_WEB2_CODEX_MODEL` — local Codex executable and optional model;
- `CODEAI_WEB2_CODEX_AGENT` — explicit Codex Agent release gate; unset means Ask/Plan only;
- `CODEAI_WEB2_DATA_DIR` — minimal server registry (tilde expansion is handled in Node);
- `CODEAI_WEB2_APPROVAL_TIMEOUT_MS` — how long an Agent permission card waits before auto-denying;
- `CODEAI_WEB2_AGENT_*` / `CODEAI_WEB2_BUILD_*` — per-message turn and time budgets for Ask/Plan
  and for Agent respectively;
- response, Mermaid, attachment, and Git-context bounds.

The health endpoint checks infrastructure and each provider independently, without invoking a
model. Claude flags are checked through `claude --help`; Codex performs a bounded App Server
handshake plus account and effective-capability inventory. A missing, logged-out, incompatible, or
over-capable provider is reported without making a healthy provider unusable.

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
- Participant removal, session transfer, editable custom-role instructions, parallel turns, and
  autonomous multi-agent relay are not implemented.
- The real-agent experiment matrix is manual and is tracked in `docs/experiment-log.md`.
