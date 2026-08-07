# Cartograph `web2`

An isolated, local-first prototype for working on a repository through a persistent Claude Code
conversation and a large Mermaid canvas. Conversation is the command/history channel; once a
diagram exists, the canvas becomes the primary workspace. Each message runs in one of three
modes — **Ask**, **Plan**, or **Agent**.

## Requirements

- Node.js 20 or newer and Yarn 1
- a locally installed, current `claude` binary
- Claude Code authenticated as the desktop user (`claude` once in a terminal if needed)
- one trusted local project, or a directory whose immediate children are trusted projects

Claude credentials remain owned by Claude Code. `web2` does not read, copy, or persist them.

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
yarn test      # offline test suite with a fake Claude executable
yarn lint      # strict TypeScript check
yarn build     # production build
yarn test:e2e  # production build + Playwright/installed Chrome canvas workflow
```

## Conversation modes

Every message carries a mode. The browser sends only the mode name; the server resolves it to a
fixed profile. Threads stay mode-agnostic — the same native Claude session serves an Ask turn and
then an Agent turn over `--resume`.

| | Ask (default) | Plan | Agent |
|---|---|---|---|
| Purpose | Q&A, review, diagrams | An approvable implementation plan | Building in the working tree |
| Tools | `Read,Glob,Grep,Bash` | same as Ask | CLI default toolset |
| Permission mode | `plan` | `plan` | `default` |
| Side effects | never | never | only after you approve each one |
| Prompts you | never | never | permission cards in the chat |
| Budget per message | 20 turns / 5 min | 20 turns / 5 min | 200 turns / 30 min |

**Ask** is the read-only conversation plus the git allowlist below. **Plan** has identical
capability and differs by contract: the turn ends with a delimited plan and the message gains an
**Execute plan** button. Executing sends an ordinary follow-up turn in Agent mode that resumes the
same session, so the executing agent keeps all of the research context. Nothing auto-executes.

**Agent** runs with the CLI's default toolset. Every side effect raises a permission card in the
conversation with **Allow** / **Deny**; the floating canvas control shows a pending badge so
full-screen users notice. Deny does not kill the run — the model is told and continues. An
unanswered card is auto-denied after `CODEAI_WEB2_APPROVAL_TIMEOUT_MS` (default 10 minutes), and
the run's own timeout clock is paused while a card is pending. Cancelling resolves pending cards as
denied before terminating the child.

Agent mode edits **the real working tree** of the selected project, exactly like terminal Claude
Code. Review the result with `git diff`. Worktree isolation and apply/discard checkpoints are
deliberately out of scope for now.

Building spends turns on research long before the first edit, so Agent gets its own budget
(`CODEAI_WEB2_BUILD_MAX_TURNS`, `CODEAI_WEB2_BUILD_TIMEOUT_MS`) rather than the conversation's. If a
message still runs out, the turn ends with an explicit notice and a **Continue** action — the
session is intact, so the agent picks up where it stopped.

### Git read allowlist (all modes)

All three modes add `Bash`, gated by a fixed server-owned rule set:

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

Every run uses a server-owned profile — `ask-readonly`, `plan-readonly`, or `agent-full`. The
browser can name a mode and nothing else: executable, tool list, allowlist, permission mode, model
flags, environment variables, and settings all stay server-owned, and an unknown mode is a 400.
Claude is spawned without a shell in the selected project's directory with:

- safe mode (project hooks, skills, MCP, and custom commands stay disabled), strict empty MCP
  configuration, and slash commands disabled, in every mode;
- the fixed git/gh allowlist, and in Ask/Plan the `Read,Glob,Grep,Bash` tool list with plan
  permissions;
- a bounded turn count, timeout, output size, and one global active process;
- native session persistence (`--session-id` first, `--resume` later).

Status and diff context are generated by fixed, read-only, no-shell Git invocations and placed with
diagram snapshots in a per-run temporary directory outside the project. It is always removed after
the turn.

This is a capability restriction, **not an operating-system sandbox**. Claude Code still runs as
your desktop user, and in Agent mode it changes real files once you approve. Use this prototype
only with repositories you trust. It is not designed for remote hosting, multi-user use, or
untrusted projects.

## Authentication and billing (bring your own)

The spawned process inherits the environment of whatever started `web2`, unchanged. Whatever your
Claude Code already uses — a claude.ai subscription login, an Anthropic-compatible endpoint set
through `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN` (z.ai, Kimi, …), or your own API key — applies
to `web2` runs exactly as it does in your terminal. `web2` adds no provider credentials or endpoint
variables of its own and never persists any. **Billing follows the login and environment of
whoever starts `web2`.**

## How conversations and data work

- A browser-generated thread UUID is registered server-side and also becomes the native Claude
  session ID. A thread is permanently bound to one opaque project ID.
- The minimal server registry stores only UUID, project ID, timestamps, and whether the native
  session started. It uses atomic writes and user-only permissions.
- Transcript, Mermaid artifacts, evidence references, pins, active selection, and vector marks are
  stored in versioned browser `localStorage`. Composite PNGs, repository files, and diffs are not.
- Reloading restores browser state; later turns resume the native Claude session without replaying
  the full transcript.
- If Claude's native session is missing, visible history is retained and the UI offers an explicit
  new-session continuation with a visible bounded recap.
- Export produces conversation/diagram/mark JSON without Claude credentials or server paths.

Local `.env*`, `.next`, `node_modules`, coverage, and TypeScript build state are ignored. The
tracked `.env.example` contains no secrets.

## Canvas workflow

Ask a normal question. Markdown-only answers are complete answers. Zero or more fenced Mermaid
blocks become immutable diagram artifacts; one invalid diagram does not hide prose or siblings.
The first valid diagram opens on the canvas.

The canvas supports pan, wheel/buttons zoom, fit/reset, pen, rectangle, arrow, text, eraser,
50-step undo/redo, confirmed clear, Mermaid source export, and diagram/marks JSON export. Chat and
diagram history are drawers. Focus mode fills the application viewport while retaining tools,
status, and the instruction composer.

The active diagram is visibly attached to the next instruction by default. The attachment contains
its immutable Mermaid source, the exact vector-mark snapshot, viewport, and a local composite PNG
when browser export succeeds. Remove its chip for a text-only turn, or use History to attach up to
four diagrams. Composite failure is non-fatal.

A single valid result derived from the still-active attachment becomes active automatically and
leaves **Previous version** one action away. Navigation during a run suppresses auto-activation.
Zero or multiple diagram results preserve the current canvas.

## Configuration

See [.env.example](.env.example). The most useful options are:

- `CODEAI_WEB2_PROJECTS_ROOT` — required project or projects directory;
- `CODEAI_WEB2_PROJECTS_DEPTH` — nested discovery depth, from 1–10 (default `1`);
- `CODEAI_WEB2_CLAUDE_BIN` / `CODEAI_WEB2_CLAUDE_MODEL` — local agent executable and optional model;
- `CODEAI_WEB2_DATA_DIR` — minimal server registry (tilde expansion is handled in Node);
- `CODEAI_WEB2_APPROVAL_TIMEOUT_MS` — how long an Agent permission card waits before auto-denying;
- `CODEAI_WEB2_AGENT_*` / `CODEAI_WEB2_BUILD_*` — per-message turn and time budgets for Ask/Plan
  and for Agent respectively;
- response, Mermaid, attachment, and Git-context bounds.

The health endpoint checks the projects root, data directory, executable, and the CLI flags each
shipped mode needs through `claude --help`; it never invokes a model. An outdated CLI is reported
with the modes and flags that are missing.

## Known limitations

- Mermaid diagrams are immutable outputs. Revisions create new artifacts rather than editing source.
- Ink does not snap to Mermaid elements and is not geometrically transferred to a revised diagram.
- Mermaid subgraphs cannot be generically collapsed; large diagrams use pan/zoom/fit and agent revision.
- Agent mode works directly in the checked-out tree: no worktree isolation, no apply/discard
  checkpoints, and no policy on pre-existing uncommitted changes. Review with `git`.
- Every side effect prompts; there is no "always allow" or `acceptEdits` tier yet.
- Source excerpts and editor deep links are still outside the experiment.
- Native Claude session history remains owned by Claude Code; deleting local browser data does not
  delete that history.
- The real-agent experiment matrix is manual and is tracked in `docs/experiment-log.md`.
