# Story 19 — Operational conversation modes: Ask, Plan, and a building Agent

**Status:** In progress — implemented, awaiting the real-agent smoke run · **Type:** Full-stack ·
**Depends on:** [Story 18](STORY-20260805-web2-agent-mermaid-canvas.md) ·
**Epic:** [web2 operational collaboration](EPIC-20260806-web2-operational-collaboration.md)

---

## Motivation

The `web2` conversation is a read-only explainer. That was the right first capability profile,
but it caps what the chat can do operationally:

> Make the chat more operational — Ask/Plan/Agent, differing in the tools available. Agent
> should use all allowed Claude tools, while somehow asking for permissions. I wish they all
> had access to git read tools — it's convenient to ask to review the PR or show a visual of
> the last 4 commits.

Two gaps today:

1. **No git/PR history access.** The server-generated snapshots cover status, working/staged
   diffs, and the last commit only. "Visualize the last 4 commits" or "review PR #12" is
   impossible because the agent has no Bash at all.
2. **No path from conversation to change.** Story 18's expansion path anticipated a developer
   profile; the user's workflow now needs it: discuss → plan → build in the same thread.

---

## Where the code is (as shipped)

Before this story: a single frozen `conversation-readonly` policy, a one-way `-p` invocation with
the prompt on stdin, no `--allowedTools`, no mode on the request, and one global
`REQUIRED_CLAUDE_FLAGS` list. Now:

- Mode → policy: [web2/lib/server/agentPolicy.ts](../web2/lib/server/agentPolicy.ts#L10) —
  `GIT_READ_ALLOWLIST` plus the three profiles.
- CLI arguments and per-mode flags: [web2/lib/server/claudeInvocation.ts](../web2/lib/server/claudeInvocation.ts#L3).
- Control protocol, paused timeout clock, denial activity:
  [web2/lib/server/claudeProcessRunner.ts](../web2/lib/server/claudeProcessRunner.ts#L186).
- Pending approvals: [web2/lib/server/permissionBroker.ts](../web2/lib/server/permissionBroker.ts#L13),
  routed by [runRegistry](../web2/lib/server/runRegistry.ts#L16) and answered at
  [POST /api/agent/permission](../web2/app/api/agent/permission/route.ts#L8).
- Mode contracts and plan markers: [web2/lib/conversation/prompt.ts](../web2/lib/conversation/prompt.ts#L12)
  and [web2/lib/shared/plan.ts](../web2/lib/shared/plan.ts#L2).
- Per-mode preflight: [web2/lib/server/claudePreflight.ts](../web2/lib/server/claudePreflight.ts#L13).
- UI: [InstructionComposer](../web2/components/InstructionComposer.tsx#L60) (mode selector),
  [PermissionCard](../web2/components/PermissionCard.tsx#L5),
  [ChatMessage](../web2/components/ChatMessage.tsx#L72) (Execute plan),
  [CanvasWorkspace](../web2/components/CanvasWorkspace.tsx#L112) (pending badge).
- Git snapshots: [web2/lib/server/repositoryContext.ts](../web2/lib/server/repositoryContext.ts#L1)
  — unchanged; still the bounded default context, no longer the only history access.

Three decisions the spec did not pin down:

1. **`--permission-prompt-tool stdio` is required** alongside `--input-format stream-json`; it is
   what makes the CLI route `ask` decisions into `can_use_tool` control requests. The flag is
   hidden from `claude --help`, so preflight deliberately does not probe for it (probing would
   misreport a healthy install as outdated).
2. **Plan delimiters are HTML comments** (`<!-- cartograph:plan:start -->` / `…:end`), stripped
   before the message is stored so readers see the plan, not the scaffolding.
3. **Request ids shown to the browser are server-generated UUIDs** mapped to the CLI's own
   `request_id`; the CLI's ids never leave the server.

### Traps found while verifying in a real browser

Three bugs that unit tests could not have caught on their own; each now has a regression test.

1. **Never probe a flag `claude --help` hides.** 2.1.222 documents neither `--max-turns` (which
   Story 18 already probed) nor `--permission-prompt-tool`, though it supports both. Preflight
   therefore declared every mode unsupported and the UI offered only Ask. `UNPROBED_CLAUDE_FLAGS`
   now records the exemptions, and a test asserts every flag `buildClaudeArgs` emits is either
   probed or deliberately exempt. The fake CLI's `--help` mirrors the real one, omissions included.
2. **Route handlers do not share module singletons.** Next.js compiles each route into its own
   bundle, so `/api/agent/message` and `/api/agent/permission` held different `runRegistry`
   instances and every approval answered 404. The registry now hangs off `globalThis`.
3. **A grid track sized `auto` grows to max-content.** The drawer's implicit column let the wider
   composer row push the send button outside the panel. `grid-template-columns: minmax(0, 1fr)`
   clamps it, which also protects the panel from long paths and code spans.
4. **Building needs its own budget.** Agent mode inherited the read-only conversation's 20 turns
   and 5 minutes, and a real run spent all of it on research without reaching an edit. Agent now
   uses `CODEAI_WEB2_BUILD_MAX_TURNS` (200) and `CODEAI_WEB2_BUILD_TIMEOUT_MS` (30 min).
5. **A run must not depend on the browser that started it.** The turn was tied to its HTTP
   request, so any reload killed the child — measurably losing an edit the user had *already
   approved* (`POST /api/agent/permission 200` → reload → `terminate (cancelled)` → file never
   written). Story 18's read-only turns were short and side-effect-free, so this was invisible;
   agent mode makes it destructive. Runs now live in `runRegistry`, a disconnect only detaches,
   `GET /api/agent/stream?threadId=` reattaches and replays (including a pending approval card),
   and cancelling is an explicit `POST /api/agent/cancel`.
6. **`result` frames carry deliberate stops.** `error_max_turns` arrives as a result subtype with
   a zero exit, and the old handler flattened it to "exited before returning a complete response".
   It now has its own `max-turns` error code, a message naming the setting, and a **Continue**
   action in the notice banner — the session survives, so the agent resumes where it stopped.

---

## Desired behavior

Every user message carries a server-validated **mode**: `ask` (default), `plan`, or `agent`.
The browser sends only the mode name; the server resolves it to a fixed policy. Threads remain
mode-agnostic — the same native Claude session can serve an `ask` turn and then an `agent`
turn via `--resume`.

### Mode semantics

| | Ask | Plan | Agent |
|---|---|---|---|
| Purpose | Q&A, review, diagrams | Approvable implementation plan | Build in the working tree |
| Tools | `Read,Glob,Grep,Bash` (git allowlist only) | same as Ask | CLI default toolset |
| Permission mode | `plan` | `plan` | `default` |
| Side effects | never | never | via interactive approval |
| Prompts to user | never | never | permission cards in chat |

**Ask** is today's behavior plus the git read allowlist. **Plan** uses the identical toolset;
it differs by contract, not capability: its prompt requires the turn to end with a clearly
delimited implementation plan, and the UI renders an **Execute plan** action on that message.
Executing sends an ordinary follow-up turn in `agent` mode ("The plan above is approved —
implement it.") that resumes the same session, so the executing agent keeps all research
context. Without approval the plan is just a message; nothing auto-executes.

**Agent** omits `--tools` (full default toolset) and runs `--permission-mode default`, with
permission requests surfaced as interactive cards in the conversation (below). It edits the
real working tree of the selected project, exactly like terminal Claude Code — review happens
through git, and worktree isolation is deliberately deferred (see Out of scope).

### Git read allowlist (all modes)

All three modes add `Bash` to the tool list, gated by a fixed server-owned rule set passed via
`--allowedTools`:

```text
Bash(git log:*)   Bash(git show:*)    Bash(git diff:*)   Bash(git status:*)
Bash(git branch:*) Bash(git blame:*)  Bash(git shortlog:*)
Bash(gh pr view:*) Bash(gh pr diff:*) Bash(gh pr list:*)
```

In headless mode a Bash call matching no rule is auto-denied with a message the model sees, so
Ask/Plan degrade gracefully instead of erroring. The rules are not browser-configurable. The
server git snapshots from Story 18 remain as bounded default context; the allowlist adds
on-demand history and PR access on top.

Known caveat, documented rather than solved: command-level allowlisting is not argument-level
sandboxing — flags like `git log --output=<file>` can technically write. This stays inside the
existing trust stance ("capability restriction, not an OS sandbox; trusted local projects
only") and is called out in the README.

### Interactive permissions (agent mode)

Extend the existing spawn-based runner to the CLI's bidirectional control protocol rather than
migrating to the Agent SDK: add `--input-format stream-json`, keep stdin open after the
initial user message, and answer `can_use_tool` control requests. This preserves the offline
fake-CLI test approach, the byte/timeout bounds, and avoids a new runtime dependency; revisit
the SDK when Story 20 introduces the multi-provider adapter.

Flow:

1. The CLI emits a permission control request; the runner emits a `permission-request` NDJSON
   event carrying a server-sanitized description (tool name, project-relative path or
   truncated command — same sanitization rules as tool activity).
2. The conversation renders a card with **Allow** / **Deny**; the floating canvas control shows
   a pending-approval badge so full-screen users notice.
3. The browser answers via `POST /api/agent/permission` `{ runId, requestId, decision }`; the
   server validates the run/request and writes the control response to the child's stdin.
4. Deny does not kill the run — the model receives the denial and continues.
5. While a request is pending the run timeout clock pauses; a separate approval timeout
   (`CODEAI_WEB2_APPROVAL_TIMEOUT_MS`, default 600000) auto-denies on expiry. Cancelling the
   run resolves all pending requests as denied before SIGTERM.

`--safe-mode` stays on in all modes for this story: hooks execute without prompting, which
would undermine the permission story. The prompt may still tell the agent it can deliberately
Read `CLAUDE.md`/`AGENTS.md` as repository content; opting real project customization into
agent runs is a future decision.

### Environment and billing (bring your own auth)

The runner keeps inheriting the environment of the process that started web2, unchanged.
Whatever the user's Claude Code already uses — claude.ai subscription login, an
Anthropic-compatible endpoint configured via `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN`
(z.ai, Kimi, …), or their own API key — applies to web2 runs exactly as it does in their
terminal. web2 adds no provider credentials or endpoint variables of its own and never
persists any. The README states plainly that billing follows the login/environment of
whoever starts web2.

### Type contract

```ts
// web2/lib/shared/types.ts — replaces the single-profile literal
type AgentMode = 'ask' | 'plan' | 'agent';

interface ResolvedAgentPolicy {
  profile: 'ask-readonly' | 'plan-readonly' | 'agent-full';
  mode: AgentMode;
  tools?: readonly string[];          // undefined ⇒ CLI default toolset (agent)
  allowedTools: readonly string[];    // e.g. 'Bash(git log:*)'
  permissionMode: 'plan' | 'default';
  interactivePermissions: boolean;    // agent only: bidirectional control protocol
  safeMode: true;
  sessionPersistence: true;
  maxTurns: number;
  timeoutMs: number;
  approvalTimeoutMs?: number;
}

interface AgentMessageRequest {
  /* existing fields */
  mode?: AgentMode; // omitted ⇒ 'ask'; anything else is 400
}

type AgentEvent =
  /* existing events */
  | { type: 'permission-request'; runId: string; requestId: string; tool: string; detail: string }
  | { type: 'permission-resolved'; runId: string; requestId: string;
      decision: 'allow' | 'deny' | 'timeout' | 'cancelled' };
```

`buildClaudeArgs` becomes mode-aware; `REQUIRED_CLAUDE_FLAGS` splits into a base list plus
per-mode additions, and preflight verifies the union of flags every shipped mode needs.

### UI

- A compact mode selector in the composer (Ask / Plan / Agent), persisted per thread as the
  *default for the next message*, changeable per message. Mode is visible on each sent user
  message.
- Plan responses get an **Execute plan** affordance; agent runs render permission cards inline
  and a pending badge on the floating canvas control.
- Agent turns keep the existing tool-activity timeline; Edit/Write activity shows
  project-relative paths under the same sanitization rules.

---

## Acceptance criteria

- [x] The browser can send only a `mode` enum; tools, flags, allowlists, permission modes,
  environment, and executable path remain server-owned. Invalid modes are rejected with 400.
  *(`agentMessageRequestSchema` is `.strict()` with `mode: z.enum([...])`; covered in
  `test/agentModes.test.ts`, which also asserts `tools`/`allowedTools`/`permissionMode` in the
  body are rejected.)*
- [x] Ask remains byte-for-byte as safe as Story 18 for non-Bash tools; its only new
  capability is the fixed git/gh read allowlist.
- [x] "Show the last 4 commits" succeeds in Ask mode via allowlisted `git log`/`git show`
  without full Bash; a non-allowlisted command (e.g. `rm`, `git push`) is auto-denied and the
  turn still completes. *(The auto-deny half is covered offline — `system/permission_denied`
  surfaces as a visible denial and the turn completes. The success half needs the real-agent
  smoke run below.)*
- [x] Plan mode produces a delimited plan message; **Execute plan** starts an agent-mode turn
  that resumes the same session (verified via fake CLI: second invocation uses `--resume` with
  the same UUID and agent-mode flags).
- [x] Agent mode spawns with no `--tools` restriction, `--permission-mode default`, and
  `--input-format stream-json`; an Edit produces a permission card; Allow lets the run proceed
  and Deny lets it continue without the edit.
- [x] Pending permission pauses the run-timeout clock; approval timeout auto-denies; cancel
  resolves pending requests as denied and terminates the child cleanly.
- [x] The spawned child inherits the parent environment unchanged; web2 sets no provider
  credential or endpoint variables of its own, so subscription logins and
  `ANTHROPIC_BASE_URL`-style setups (z.ai, Kimi, …) behave exactly as in the terminal.
- [x] Preflight verifies per-mode flag support and reports an actionable error for an outdated
  CLI. *(Unsupported modes are also disabled in the composer, and a stored unsupported mode
  falls back to Ask.)*
- [x] Fake-CLI tests cover: allowlist deny, control-protocol permission round-trip (allow,
  deny, timeout, cancel), and plan→agent resume — no network, model, or authentication.
- [x] README documents the three modes, the git allowlist and its `--output`-style caveat,
  that billing follows the user's own Claude Code login/environment, and that agent mode
  edits the real working tree.
- [x] `cd web2 && yarn test`, `yarn lint`, `yarn build` pass; existing Story 18 acceptance
  behavior is unbroken for Ask-mode-only usage. *(70 tests green.)*
- [ ] The real-agent smoke run below is recorded in `web2/docs/experiment-log.md`.

## Out of scope

- Codex as a second single-agent provider —
  [Story 20](STORY-20260817-web2-codex-provider.md).
- Multiple agents, participants, and roles —
  [Story 23](STORY-20260817-web2-multi-agent-roles.md).
- Multiple humans, server-side transcripts, auth — [Story 21](STORY-20260806-web2-team-environment.md).
- Worktree isolation, apply/discard checkpoints, uncommitted-changes policy — future hardening
  of agent mode; v1 works in the real working tree behind explicit approvals.
- "Always allow" / `acceptEdits` per-run toggles; every side effect prompts in v1.
- Enabling project hooks/skills/MCP in agent runs (safe mode stays on).
- User-configurable allowlist additions.
- Migrating the runner to the Agent SDK.
- Remote hosting, multi-user, OS sandboxing.

## How to verify

Automated: `cd web2 && yarn test && yarn lint && yarn build` (fake CLI covers the new
control-protocol and env cases). **Passing:** 72 tests, clean typecheck, clean build.

Browser pass (done, with the fake CLI wired in via `CODEAI_WEB2_CLAUDE_BIN`): an Agent turn raises
a permission card, the status line and the floating canvas badge both announce it, **Allow** lets
the edit through, **Deny** lets the same session continue, and no panel overflows at 1440px or
420px. Worth repeating after any composer or drawer change.

Real smoke, in a disposable project:

1. Ask: "show me a visual of the last 4 commits" → git log/show activity, diagram, no
   permission prompts, working tree untouched.
2. Ask: request something requiring `rm` → visible graceful denial in the answer.
3. Plan: "plan a small refactor of X" → delimited plan message with **Execute plan**.
4. Execute → agent mode resumes the session; first Edit raises a permission card; Deny it,
   watch the agent adapt; Allow the next; verify the resulting diff with `git diff`.
5. Cancel an agent run mid-approval → child terminates, pending card resolves as cancelled,
   transcript intact.

---
