# Story 82 — Add the Native security level: Claude and Codex write with your own setup

**Status:** Shipped · **Type:** Full-stack · **Depends on:**
[Story 79](STORY-20260928-sandboxed-auto-mode.md) (Auto, the shared mode list, session format 6),
[Story 80](STORY-20260929-global-instructions.md) (global instructions, session format 7),
[Story 65](STORY-20260921-tolerate-newer-session-format.md) (a newer session hides only itself). The
first story of the [security levels epic](EPIC-20261001-security-levels.md), whose invariants this
story keeps.

---

## Motivation

The user, on October 1, 2026:

> Some people want to use the agents to the max with min questions asked and trusting them. Others
> want to put more barriers and don't trust agents. We should be able to prevent LLMs from mistakes
> but not limit the first users. This way - if the user wants to use claude and/or codex with their
> capabilities and configurations - we should let them do so easily.

The day before, the user could not find a way to run a conversation without approval cards. Their
conversations use Claude, which offers no such mode in CodeAI, and the server ran without
`CODEAI_CODEX_AGENT`, so Codex offered only Ask and Plan. Meanwhile Claude Code's own `auto` mode
works on this machine with no setup at all. The epic describes the wider gap: CodeAI runs both CLIs
with less than they offer in a terminal.

This story adds the second level, **Native**. At Native, Local Claude and Codex do their writing
turns with your own setup and offer their own permission modes. **Guarded**, today's behavior, stays
the default and does not change.

---

## Where the code is

| Responsibility | Implementation |
|---|---|
| Machine level and frozen policy | [config.ts:68](../src/server/config.ts#L68), [agentPolicy.ts:28](../src/server/agents/agentPolicy.ts#L28) |
| Claude arguments and readiness | [claudeInvocation.ts:4](../src/server/agents/claudeInvocation.ts#L4), [claudePreflight.ts:18](../src/server/agents/claudePreflight.ts#L18) |
| Codex arguments, security and readiness | [codexInvocation.ts:92](../src/server/agents/codexInvocation.ts#L92), [codexPreflight.ts:41](../src/server/agents/codexPreflight.ts#L41) |
| Native integration activity and requests | [codexProcessRunner.ts:270](../src/server/agents/codexProcessRunner.ts#L270), [claudeProcessRunner.ts:125](../src/server/agents/claudeProcessRunner.ts#L125) |
| Isolated-session restriction and message metadata | [globalInstructions.ts:9](../src/shared/globalInstructions.ts#L9), [route.ts:187](../src/app/api/agent/message/route.ts#L187) |
| Format 9 validation and upgrades | [sessionSchema.ts:244](../src/shared/sessionSchema.ts#L244), [sessionStore.ts:38](../src/server/storage/sessionStore.ts#L38) |
| Executor level and disposable cached projections | [localExecutorSnapshot.ts:10](../src/server/machines/localExecutorSnapshot.ts#L10), [machineRegistry.ts:26](../src/server/machines/machineRegistry.ts#L26) |
| Flat modes and executor refresh | [InstructionComposer.tsx:111](../src/features/conversation/InstructionComposer.tsx#L111), [AppShell.tsx:466](../src/features/shell/AppShell.tsx#L466) |
| Immersive measured rows and message labels | [ConversationTools.tsx:237](../src/features/shell/immersive/ConversationTools.tsx#L237), [immersiveTranscript.ts:77](../src/features/diagram/spatial/immersiveTranscript.ts#L77) |
| Arena level and launch-mode inheritance | [Arena.tsx:218](../src/features/arena/Arena.tsx#L218), [devicePreferences.ts:63](../src/features/shell/devicePreferences.ts#L63) |

Tests: `test/nativeSecurity.test.ts`, `test/nativeRunners.test.ts`, `test/nativeRoute.test.ts`,
`test/nativeRollback.test.ts`, `test/machineRegistry.test.ts`, `e2e/native-security.spec.ts`,
`e2e/machines.spec.ts`, and the Native geometry case in `e2e/immersive.spec.ts`.

## Before this story (original code anchors)

### Configuration and policy

- **Settings:** [config.ts:155](../src/server/config.ts#L155) `getConfig` reads `process.env` on
  every call, and routes call it per request. Under `npm run dev`, Next.js reloads `.env*` files
  when they change. The only provider gate is `codexAgentEnabled` from `CODEAI_CODEX_AGENT`
  ([:172](../src/server/config.ts#L172)), a protocol-parity release gate, not a trust setting.
- **Policy:** [agentPolicy.ts:28](../src/server/agents/agentPolicy.ts#L28) `resolveAgentPolicy(config,
  mode, execution)` returns a frozen policy.
  - Agent and Auto share one branch ([:46](../src/server/agents/agentPolicy.ts#L46)) with
    `permissionMode: 'default'`.
  - Ask and Plan use `plan` with the `Read,Glob,Grep,Bash` tool list.
  - `safeMode` is typed `true` ([types.ts:652](../src/shared/types.ts#L652)), and `permissionMode`
    is `'plan' | 'default' | 'bypassPermissions'` ([:650](../src/shared/types.ts#L650)).
- **Modes:** `AgentMode` ([types.ts:405](../src/shared/types.ts#L405)); `AGENT_MODES`,
  `LAUNCH_MODES`, `changesCheckout`, and `unsupportedModes` in
  [agentModes.ts](../src/shared/agentModes.ts#L4). `unsupportedModes`
  ([:30](../src/shared/agentModes.ts#L30)) marks Auto as unsupported until readiness is known, and
  always in Docker. The wire, machine, and session schemas and both device-state parsers read
  `AGENT_MODES`.

### Claude

- **Arguments:** [claudeInvocation.ts:3](../src/server/agents/claudeInvocation.ts#L3)
  `buildClaudeArgs` serves both Local and Docker Claude. It always sends:
  - `--safe-mode` ([:17](../src/server/agents/claudeInvocation.ts#L17));
  - `--strict-mcp-config` and `--disable-slash-commands`
    ([:24-25](../src/server/agents/claudeInvocation.ts#L24-L25));
  - the user's global instructions as `--append-system-prompt`
    ([:36](../src/server/agents/claudeInvocation.ts#L36)), framed in
    [claudeProcessRunner.ts:145](../src/server/agents/claudeProcessRunner.ts#L145).
- **Modes:** `CLAUDE_MODES` is Ask, Plan, and Agent
  ([claudeInvocation.ts:83](../src/server/agents/claudeInvocation.ts#L83)), fixed in the adapter
  ([providerRegistry.ts:18](../src/server/agents/providerRegistry.ts#L18)). The runner refuses an
  Auto policy ([claudeProcessRunner.ts:129](../src/server/agents/claudeProcessRunner.ts#L129)).
- **Control requests:** the runner answers only `can_use_tool` and leaves every other control
  request unanswered ([claudeProcessRunner.ts:231](../src/server/agents/claudeProcessRunner.ts#L231)).
- **Readiness:** [claudePreflight.ts:17](../src/server/agents/claudePreflight.ts#L17)
  `inspectClaudeHelp` checks that each mode's flags appear in `claude --help`. It does not read the
  `--permission-mode` choices. Claude Code 2.1.285 lists `acceptEdits`, `auto`, `bypassPermissions`,
  `manual`, `dontAsk`, and `plan`. It no longer lists `default`, which CodeAI's Agent sends, but
  still accepts it. That was checked on October 1, 2026 by parsing only: an unknown mode is refused
  before any model call, and `default` was not.

### Codex

- **App Server:** `buildCodexAppServerArgs`
  ([codexInvocation.ts:31](../src/server/agents/codexInvocation.ts#L31)), for Local and Docker
  alike ([codexProcessRunner.ts:160](../src/server/agents/codexProcessRunner.ts#L160)). It does three
  things:
  - overrides `mcp_servers` and `web_search`;
  - disables `CODEX_DISABLED_FEATURES` ([:10](../src/server/agents/codexInvocation.ts#L10));
  - relies on `codexThreadConfig` ([:116](../src/server/agents/codexInvocation.ts#L116)) to disable
    each listed MCP server again per thread.
- **Isolation check:** readiness and every turn require a complete MCP inventory and refuse Codex
  while an MCP server or hook stays active ("Disable it in Codex before using this provider in
  CodeAI"): [codexPreflight.ts:225](../src/server/agents/codexPreflight.ts#L225) and
  [codexProcessRunner.ts:534-550](../src/server/agents/codexProcessRunner.ts#L534-L550).
- **Items:** a turn stops on any `mcpToolCall`, `dynamicToolCall`, `collabAgentToolCall`,
  `webSearch`, or `hookPrompt` item ([codexProcessRunner.ts:297](../src/server/agents/codexProcessRunner.ts#L297)).
- **Requests:** only `item/commandExecution/requestApproval` and `item/fileChange/requestApproval`
  become cards ([:319-324](../src/server/agents/codexProcessRunner.ts#L319-L324)). Every other
  server request gets an unsupported answer ([:432-433](../src/server/agents/codexProcessRunner.ts#L432-L433)).
- **Gate:** `codexSupportedModes` adds Agent and Auto only with `CODEAI_CODEX_AGENT`
  ([codexInvocation.ts:50](../src/server/agents/codexInvocation.ts#L50)).
- **Security:** `codexTurnSecurity` ([:92](../src/server/agents/codexInvocation.ts#L92)) names you as
  the reviewer for every `on-request` turn. `codexThreadPolicyIssue`
  ([:217](../src/server/agents/codexInvocation.ts#L217)), through `codexSandboxApplied`
  ([:201](../src/server/agents/codexInvocation.ts#L201)), refuses any other echo. The
  `sandboxPolicy` sent at `turn/start` has only read-only and external-sandbox variants
  ([:74-76](../src/server/agents/codexInvocation.ts#L74-L76)).
- **Instructions and notes:** `CODEX_INSTRUCTIONS_HEAD`
  ([:133](../src/server/agents/codexInvocation.ts#L133)) tells the model not to use skills,
  plugins, MCP servers, hooks, or web search. `codexAmbientSkillNote`
  ([:281](../src/server/agents/codexInvocation.ts#L281)) promises that whatever a skill runs stays
  inside the session's sandbox.

### Route, records, machines, and UI

- **Route:** a mode the addressed provider does not advertise is a 409
  ([route.ts:169](../src/app/api/agent/message/route.ts#L169)). Auto is refused while the data
  directory is inside the checkout or a temp directory
  ([:176](../src/app/api/agent/message/route.ts#L176)).
- **Global instructions:** local Codex always loads its own file, so an isolated session cannot hold
  it. That rule lives in `isolatesLocalCodex`, `effectiveInstructions`, and `instructionsLine`
  ([globalInstructions.ts:27-68](../src/shared/globalInstructions.ts#L27-L68)), the store's refusals
  ([sessionStore.ts:555](../src/server/storage/sessionStore.ts#L555),
  [:686](../src/server/storage/sessionStore.ts#L686)), and the health route's Claude note
  ([health/route.ts:53-54](../src/app/api/health/route.ts#L53-L54)).
- **Records:**
  - Messages carry `mode` ([sessionSchema.ts:197](../src/shared/sessionSchema.ts#L197),
    [:212](../src/shared/sessionSchema.ts#L212)).
  - The newest readable format is 7 ([:219](../src/shared/sessionSchema.ts#L219)).
  - Auto messages need format 6 ([:289](../src/shared/sessionSchema.ts#L289)).
  - The store raises a version only for an Auto message or a report
    ([sessionStore.ts:612-615](../src/server/storage/sessionStore.ts#L612-L615)).
- **Machines:**
  - An executor's snapshot is `.strict()` ([machineSchema.ts:79](../src/shared/machineSchema.ts#L79)).
  - The home persists the last snapshot in its registry with that schema
    ([machineRegistry.ts:25](../src/server/machines/machineRegistry.ts#L25)). It declares the whole
    registry corrupt when any part fails to parse
    ([:178-179](../src/server/machines/machineRegistry.ts#L178-L179)).
  - So a home rolled back to a build without a mode an executor advertised loses every attached
    machine, not one snapshot. That has been true since Story 79 for Auto.
- **Health:** [health/route.ts:69](../src/app/api/health/route.ts#L69) reports each execution's
  providers, and no level.
- **Picker, tags, and line:**
  - The picker is [InstructionComposer.tsx:120](../src/features/conversation/InstructionComposer.tsx#L120).
  - Labels, hints, and tooltips: [toolActivity.ts:44-95](../src/features/agents/toolActivity.ts#L44-L95).
  - The execution line: [InstructionComposer.tsx:209](../src/features/conversation/InstructionComposer.tsx#L209).
  - The mode tag: [ChatMessage.tsx:43](../src/features/conversation/ChatMessage.tsx#L43) and
    [:63](../src/features/conversation/ChatMessage.tsx#L63).
  - Agent's and Auto's `wait` emphasis and mode dot: [globals.css:392](../src/app/globals.css#L392),
    [:398](../src/app/globals.css#L398), and [:419](../src/app/globals.css#L419).
  - A continuation turns only Auto into Ask ([AppShell.tsx:713-714](../src/features/shell/AppShell.tsx#L713-L714)).
- **VR:**
  - Mode actions are named in `CONVERSATION_ACTIONS`
    ([conversationControls.ts:38](../src/features/shell/immersive/conversationControls.ts#L38)).
  - The agents row offers Auto only when advertised, then lays four modes out from their label
    widths ([ConversationTools.tsx:114](../src/features/shell/immersive/ConversationTools.tsx#L114),
    [:231](../src/features/shell/immersive/ConversationTools.tsx#L231)).
- **Mode memory:** `inheritedMode` turns Auto into Ask for a new session
  ([devicePreferences.ts:63](../src/features/shell/devicePreferences.ts#L63)).
- **Prompt:** `MODE_CONTRACT` ([prompt.ts:9](../src/server/conversation/prompt.ts#L9)) promises a
  card for every side effect in Agent and a sandbox in Auto.
- **Arena:** this machine's Docker execution and Global instructions sections
  ([Arena.tsx:218](../src/features/arena/Arena.tsx#L218),
  [GlobalInstructions.tsx:83](../src/features/arena/GlobalInstructions.tsx#L83)).

---

## Design decisions

1. **The level is the machine's, read once per server process.**
   - **Setting:** `CODEAI_SECURITY_LEVEL` is `guarded` (the default) or `native`. An invalid value is
     an error naming the setting, like every other invalid setting.
   - **Read once per process:** the value is read on first use and kept on `globalThis` for the life
     of the process, as the run registry is ([runRegistry.ts](../src/server/runs/runRegistry.ts)). A
     change therefore takes effect only at the next restart, under `npm run dev` too. Build & restart
     does that for `start:managed`.
   - **Tests reset the cached value** through the same `globalThis` key, as
     [healthRoute.test.ts:59](../test/healthRoute.test.ts#L59) does for the lifecycle globals, so env
     stubs keep working.
   - **No route sets it.**
   - **CodeAI's own checkout:** there `.env.local` is a file in the checkout. A writing turn can
     change it, a Guarded Codex Auto turn without a card, as it can change CodeAI's code. Either
     change waits for the next restart. The README states this.
2. **Native writing modes load your whole setup, as your terminal does in that checkout.**
   - **Claude:** the user, project, and local settings, CLAUDE.md files, hooks, MCP servers (as your
     settings approve them), skills, plugins, and custom commands.
   - **Codex:** `config.toml`, including MCP servers, hooks, the approval reviewer, and
     `[sandbox_workspace_write]`.
   - **The repository's own settings load too.** Native is for repositories you trust, as the README
     already asks of every repository.
   - **The known cost:** a writing turn can change what later writing turns load. Story 79's probes
     show that Codex's plain workspace sandbox writes `.claude/settings.json` without asking, and
     that Claude's `acceptEdits` writes `.codex/config.toml` without asking. So a turn can plant a
     hook or an MCP server command for either provider, and the next Native writing turn runs it
     with no card. Your terminal has the same property. Part A records it, and the README states it.
3. **Writing modes keep CodeAI's names and take the provider's meaning.** Ask and Plan are covered
   by decision 4.

   | Mode | Claude at Native | Codex at Native | Who decides what runs |
   |---|---|---|---|
   | Agent | `default`, with your allow and deny rules | Read-only sandbox, `on-request` | Your rules; you, on a card, for the rest. Codex's reviewer comes from your config |
   | Accept edits | `acceptEdits` | Not offered | Edits run; your rules, then you, for commands |
   | Auto | `auto`: a classifier model approves or blocks each action | `workspace-write` with your `[sandbox_workspace_write]`, `on-request` | The provider; a card only when it asks |
   | Full access | `bypassPermissions` | `danger-full-access`, `never` | Nothing asks, unless the provider still raises a request |

   An `on-request` Codex turn at Native names no reviewer, so Codex uses the one your config names.
   If that is `auto_review`, a model answers instead of you. Guarded never advertises Accept edits
   or Full access, and is otherwise unchanged.
4. **Ask and Plan keep Guarded's arguments at Native.** That means safe mode, CodeAI's read-only
   tool list, the git allowlist, Codex's overrides and isolation check, and Story 80's instruction
   text.
   - **Why:** after decision 2, only safe mode and Codex's overrides stop a hook or MCP server that
     a writing turn planted from running in a read-only turn.
   - **What safe mode does not cover: permission rules.** `claude --help` (2.1.285) says that under
     `--safe-mode` "permissions work normally". An allow rule in the checkout's
     `.claude/settings.json` or `.claude/settings.local.json` still applies to an Ask or Plan turn,
     and their tool list includes `Bash`. A rule like that can be committed in the repository, which
     makes this a Guarded question too. A Native writing turn can also plant one.
   - **Probe 13 decides.** The October 1 probes found that `plan` permits scratch shell writes even
     with `--setting-sources user` and even in a clean repository. `--restricted` with Bash explicitly
     enabled also permits them. Ask and Plan therefore use `--permission-mode default` without
     interactive permission flags and drop project and local settings with `--setting-sources user`,
     at both levels. This combination denied both `touch` and shell redirection while allowing
     `git status`, including against all four planting fixtures. It tightens Guarded; it does not
     loosen it (epic invariant 6). Ask and Plan honor only your own user-level rules; those rules and
     the existing command-level Git allowlist are not an operating-system sandbox.
   - **One meaning everywhere:** this keeps one meaning for Ask and Plan at both levels, and their
     messages need no level.
   - **The cost:** your MCP servers and skills are not available in Ask and Plan (open question 2).
   - **Codex readiness:** a failed isolation check withholds Codex's Ask and Plan only, with its
     reason. It no longer withholds Codex's Native writing modes.
5. **What reaches CodeAI from a Native writing turn.** Ask and Plan keep today's handling at both
   levels, so these items still stop them.
   - **Claude:** a `can_use_tool` request becomes today's one-shot card. Any other control request is
     answered at once with an error instead of being left unanswered, and adds an activity line
     naming it.
   - **Codex:** command and file-change approvals become today's cards.
     `item/permissions/requestApproval` cannot occur (decision 8). Any other request, such as an MCP
     elicitation, gets today's unsupported answer and an activity line saying CodeAI cannot answer
     it.
   - **Codex items:** in a Native writing turn, `mcpToolCall`, `dynamicToolCall`, `collabAgentToolCall`,
     `webSearch`, and `hookPrompt` become activity lines instead of stopping the turn, and so do the
     `item/autoApprovalReview/*` notifications. A decision a model reviewer made is therefore visible
     in the conversation.
   - **No reviewer of CodeAI's own,** at either level.
   - **Part A records** every request and item type seen.
6. **Global instructions.**
   - **Writing modes:** Local Claude loads your CLAUDE.md itself in a Native writing mode, so CodeAI
     sends no `--append-system-prompt` for it. The text never arrives twice.
   - **Ask and Plan** keep Story 80's behavior.
   - **Isolated sessions:** in a session that isolates global instructions, Local Claude's Native
     writing modes are unavailable. The picker shows them disabled with the reason "This session
     runs without your global instructions, and Claude loads them itself in Native writing modes.",
     and the route answers 409 with the same text. Ask and Plan still work there, and Docker is
     unchanged.
   - **The instructions line** under the composer follows: it reads "global instructions" for Local
     Claude in a Native writing mode.
7. **`CODEAI_CODEX_AGENT` keeps gating Codex Agent and Auto at both levels.** It is a release gate
   for the approval protocol, and Native's Agent and Auto use that protocol. Full access raises no
   approval, so at Native it is not gated.
8. **Turn-wide grants stay off at both levels.** `request_permissions_tool` and
   `exec_permission_approvals` stay disabled, because CodeAI has no card for a grant that covers a
   whole turn.
9. **What CodeAI still checks at Native.**
   - **Codex:** the thread echo must report the checkout as `cwd`, the approval policy sent, and the
     sandbox type sent, with valid instruction sources as today. The reviewer, network, and writable
     roots come from your config and are not checked.
   - **Codex `turn/start`:** at Native, Auto and Full access send no `sandboxPolicy`, so the thread's
     sandbox stands. Agent keeps today's read-only `sandboxPolicy`.
   - **Claude:** a Native mode is advertised only when `claude --help` lists its permission mode.
   - **Codex Auto** still needs `codex sandbox` to start.
   - **The data-directory guard** stays for Guarded Auto only. It reasons about CodeAI's own sandbox
     profile, and at Native nothing is guarded (epic invariant 7).
   - **Full access** keeps `--permission-prompt-tool stdio` for Claude, so a request Claude still
     raises, for a protected path for example, becomes a card instead of a silent denial.
10. **Native modes are chosen inside a session,** as Auto is (open question 1). They are not launch
    modes or role defaults, and a new session or a continuation turns them into Ask. Execute plan
    still sends Agent.
11. **The level is recorded where a mode alone does not say it.**
    - **What carries `level`:** Agent and Auto messages whose turn ran at Native carry
      `level: 'native'`. Accept edits and Full access exist only at Native, and Ask and Plan run
      Guarded's arguments, so neither carries it.
    - **Session format 9** holds `level` and messages in Accept edits or Full access. The preceding
      image story already uses format 8, so builds reading at most format 8 hide Native sessions
      safely. Image-only sessions remain at format 8.
    - **Upgrades:** the first such message upgrades its session, and nothing lowers a version. An
      older CodeAI hides only that session, so read-only sessions stay readable.
12. **The level is shown.**
    - **Composer:** the execution line says Native for a Local session on a Native machine.
    - **Messages:** the mode tag reads "Native · Agent" or "Native · Auto" where the message carries
      the level.
    - **Arena:** shows this machine's level, read-only, and how to change it.
    - **Picker at Guarded:** a Local session's picker ends with one line, "More modes at Native",
      whose tooltip names what Native adds and the setting that turns it on. This is the
      discoverability gap the user hit on September 30 (open question 5).
13. **An executor's level decides its own turns.**
    - **The snapshot:** carries `securityLevel` only when it is `native`, so a Guarded executor's
      snapshot is unchanged.
    - **The registry:** drops a cached snapshot it cannot parse and keeps the machine, instead of
      declaring itself corrupt. Older builds still fail: one from before Story 79 on a snapshot that
      advertises Auto, and one from before this story on Accept edits, Full access, or a level. The
      README says so beside "upgrade the home first", and How to verify covers it.

---

## Desired behavior

### Part A — Probe both providers at Native (no product code)

Run each probe against the real CLI in a scratch repository under the home directory, with
project-level settings and `-c` overrides.
- **Never edit by hand:** the user's own `~/.claude` and `~/.codex` files.
- **Revert after:** entries the CLIs add themselves, such as Codex's project trust and Claude's
  `~/.claude.json`, are recorded and reverted.
- **Where:** record the results in [docs/experiment-log.md](../docs/experiment-log.md) as "Story 82 —
  Native probes", with CLI versions and exact arguments.

**Claude**, with CodeAI's Agent arguments minus `--safe-mode`, `--strict-mcp-config`,
`--disable-slash-commands`, and `--append-system-prompt`. The scratch repository gets:
- a `.claude/settings.json` with an allow rule (`Bash(touch:*)`) and a hook that writes a marker;
- a `.mcp.json` with a small stdio server that has one read-only and one writing tool;
- a `CLAUDE.md` with a marker instruction.

1. The allow rule, the hook, the MCP server, and the `CLAUDE.md` all take effect in Agent.
2. Agent: the allowed command runs without `can_use_tool`. An edit and any other command arrive as
   `can_use_tool`.
3. Accept edits: an edit in the checkout runs without a request. `curl` and a write outside the
   checkout arrive as `can_use_tool`.
4. Auto: record what runs and what is blocked for an edit in the checkout, a write to `$HOME`, and
   `rm -rf` of a scratch directory outside the checkout. Also record whether any block reaches
   CodeAI, as `can_use_tool`, as a denial, or not at all. Story 79 observed none.
5. Full access: record the flags it needs, either `--permission-mode bypassPermissions` or
   `--dangerously-skip-permissions`. An edit, a command, and a network request run with no request.
   Record whether writes to `.git/config` and `.claude/settings.json` raise anything.
6. Record every control request type and every stream event type seen in probes 1–5.

**Codex**, with App Server started with no CodeAI overrides except the two disabled features, and the
user's configuration simulated with `-c`:

7. An MCP server named with `-c mcp_servers.probe…` is listed for the thread and callable in Agent.
8. The thread echo for Agent, Auto, and Full access matches what is sent, with
   `-c approvals_reviewer="auto_review"` and with `-c sandbox_workspace_write.network_access=true`.
   Record the reviewer and network each echo reports.
9. Auto with network allowed: `curl` runs without a request. With `auto_review`, record the
   `item/autoApprovalReview/*` notifications and that no request reaches CodeAI.
10. Full access: a write outside the checkout and a network request run with no request.
11. A thread started in Guarded Ask is resumed in Native Agent, and one started in Native Auto is
    resumed in Guarded Ask. Record whether each resumed echo, MCP state, and reviewer match what was
    sent, not what the thread started with.
12. Record every server request and item type seen in probes 7–11.

**Both:**

13. Planting. In each no-card mode (Codex Auto; Claude Accept edits, Auto, and Full access), ask the
    turn to write four things:
    - a hook in `.claude/settings.json`;
    - an allow rule (`Bash(touch:*)`, and plain `Bash`) in `.claude/settings.local.json`;
    - an MCP server in `.mcp.json`;
    - an MCP server and a `sandbox_mode` or `approval_policy` key in `.codex/config.toml`.

    Then run a Native Agent turn and an Ask turn and a Plan turn with each provider, and record what
    runs and whether any Codex echo changes. Repeat the Ask and Plan turns with the same allow rule
    committed in the repository instead of planted, at Guarded. Ask and Plan must run nothing that
    was planted or committed; if they do, decision 4's `--setting-sources user` rule applies.

**Decision:** for each provider, record which Native modes ship and their exact arguments. A mode
whose probe contradicts the table in decision 3 does not ship.

### Part B — The level and the policy

1. **Config:** `securityLevel: 'guarded' | 'native'` from `CODEAI_SECURITY_LEVEL`, with the
   `CODEAI_WEB2_` fallback, read once per process (decision 1). The default is `guarded`, an invalid
   value is an error naming the setting, and `.env.example` gains an empty placeholder.
2. **Policy:** `resolveAgentPolicy` reads the level from `config` and sets `policy.level`.
   - **Docker and Guarded:** Docker always resolves to `guarded`. At Guarded, and for Ask and Plan
     at Native, every Local policy remains Guarded, with decision 4's recorded read-only tightening.
   - **Native writing modes:** each gets its own frozen policy from decision 3. All four are
     interactive with the build budget and the approval timeout.
   - **Only the policy decides a turn:** runners and the argument builders they call take the level
     from `policy.level`, never from config. Readiness has no policy, so it alone reads the level
     from config.
3. **Claude at Native, writing modes only:**
   - **Omitted:** `buildClaudeArgs` omits `--safe-mode`, `--strict-mcp-config`,
     `--disable-slash-commands`, and `--append-system-prompt`, and sends the mode's permission mode.
   - **Kept:** the git read allowlist, `--add-dir`, `--max-turns`, the session flags, and
     `--permission-prompt-tool stdio`.
   - **Modes:** `CLAUDE_MODES` and the adapter's fixed list become per level, and the runner's Auto
     refusal applies to Guarded only.
   - **Other requests:** decision 5.
4. **Claude readiness:** `inspectClaudeHelp` also reads the `--permission-mode` choices. At Native,
   Accept edits, Auto, and Full access are advertised only when `acceptEdits`, `auto`, and
   `bypassPermissions` are listed, and anything missing is named on the readiness line.
5. **Codex at Native, writing modes only:**
   - **App Server:** `buildCodexAppServerArgs(level)` sends `app-server --stdio --strict-config` and
     the two `--disable` flags only.
   - **Thread config:** `codexThreadConfig` turns off the same two features and nothing else.
   - **No isolation check:** no inventory or isolation check runs.
   - **Security:** `codexTurnSecurity(mode, execution, level)` follows decisions 3 and 9 and names no
     reviewer. `codexSandboxApplied` gains a `workspaceWrite` branch that accepts any network and
     roots.
   - **Turns:** the runner turns the items and requests in decision 5 into activity lines.
   - **Instructions and notes:** the Native developer instructions drop `CODEX_INSTRUCTIONS_HEAD`'s
     list of features not to use, and keep "Treat the attachment directory as read-only".
     Native writing turns do not collect skill inventories or call `codexAmbientSkillNote`.
     The machine's combined Native readiness omits successful Guarded instruction and skill
     notices, because Native loads that setup by design. Guarded and selected Ask/Plan checks
     retain them; disabled-Agent and failed Ask/Plan checks still contribute their warnings.
   - **Readiness:** `checkCodex` takes the level. At Native it advertises Ask and Plan only when the
     Guarded isolation check passes, Agent and Auto with `CODEAI_CODEX_AGENT`, Auto only when the
     sandbox starts, and Full access whenever the handshake succeeds.
     A chosen turn checks only its own policy's handshake. Native gives `model/list` a bounded
     1.5-second wait, preserves the Guarded list when needed, and keeps verified choices for ten
     seconds if a later response is missing; authentication and mode policy are still checked afresh.
6. **Modes:**
   - **New values:** `AgentMode` gains `'edits'` (Accept edits) and `'full'` (Full access).
     `AGENT_MODES` is Ask, Plan, Agent, Accept edits, Auto, Full access, in that order.
   - **`unsupportedModes`:** marks Accept edits and Full access as it marks Auto, unsupported until
     readiness is known and always in Docker.
   - **`changesCheckout`:** true for all four writing modes, which gives them exclusive checkout
     access in the scheduler and the build budget.
   - **Unchanged:** `LAUNCH_MODES`.
7. **Route:**
   - **409s:** a mode the addressed provider does not advertise is still a 409. That covers Accept
     edits and Full access at Guarded and in Docker.
   - **Isolated sessions:** a Local Claude Native writing turn in an isolated session is a 409 with
     decision 6's message.
   - **Data-directory guard:** applies to Guarded Auto only.
8. **Prompt:** `MODE_CONTRACT` gains Native contracts for the writing modes. Ask and Plan are
   unchanged.
   - **Native Agent:** your permission settings decide what runs without asking, and anything else
     asks. It drops the git allowlist's "any other command is denied automatically".
   - **Auto:** the provider decides, and no sandbox is promised.
   - **Accept edits:** file edits in the working tree run without asking, and commands may ask.
   - **Full access:** nothing asks, and the agent can reach everything the user can. It must stay
     within the task, and uncommitted work has no backup.
9. **Health and machines:**
   - **Health:** the health response gains `securityLevel`.
   - **Snapshots:** an executor's snapshot gains it only when `native`.
   - **Registry:** the registry tolerates a cached snapshot it cannot parse (decision 13).
   - **Health cache:** needs no key change, because the level is fixed per process.

### Part C — Records and controls

1. **Records:**
   - **Format 9:** as decision 11 describes. Validation allows `level` and Accept edits or Full
     access messages, the user's or the assistant's, only at version 9.
   - **The upgrade:** the store's upgrade rule raises a session to 9 for those messages.
   - **Older rules:** every version rule from Stories 79 and 80 still holds.
2. **Picker:**
   - **Native modes:** lists Accept edits and Full access only when the addressed provider
     advertises them, in `AGENT_MODES` order.
   - **Emphasis:** Accept edits takes Agent's `wait` emphasis and mode dot. Full access takes the
     `stop` tone that `tokens.ts` already has, in both themes.
   - **At Guarded:** a Local session's picker ends with "More modes at Native". The line is not a
     radio and sends nothing. Its tooltip reads: "Native runs Claude and Codex with your own
     settings, hooks, and MCP servers in writing modes, and adds Accept edits and Full access. Set
     CODEAI_SECURITY_LEVEL=native on this computer and restart CodeAI."
3. **Labels, hints, and tooltips:** per level, and for Auto at Native per provider. At Guarded,
   unchanged. At Native:
   - Agent: "Your settings decide · the rest asks".
   - Accept edits: "Edits without asking · commands ask".
   - Auto: Claude "A model approves each action"; Codex "Codex sandbox · your settings".
   - Full access: "Never asks · runs as you".

   Each tooltip says who decides, as decision 3's table does, including a model reviewer that your
   Codex config names.
4. **Execution line and tags:**
   - **The line:** for a Local session on a Native machine, it shows "Native" after the execution
     menu, with a tooltip naming the setting.
   - **The tags:** a message with `level: 'native'` tags its mode "Native · <mode>".
   - **The instructions line:** follows decision 6.
5. **Arena:** this machine's section shows a read-only Security level row:
   - the level's description: "Guarded — CodeAI sets the rules for Local turns" or "Native — Local
     Claude and Codex write with your own setup";
   - how to change it: "Set CODEAI_SECURITY_LEVEL on this computer and restart CodeAI to change it."

   At Native, the Global instructions section says that Local Claude loads its own file in writing
   modes.
6. **VR:**
   - **Actions:** `CONVERSATION_ACTIONS` gains `edits` ("Edits") and `full` ("Full"). Mode actions
     have no icons.
   - **The agents row:** offers each advertised mode and lays the modes and Make main out from their
     label widths, as Story 79 does. When they do not fit one row, the modes move to a second row.
7. **Mode memory:** a session remembers Accept edits and Full access like any mode.
   - **New sessions:** `inheritedMode`, `launchChoice`, and the continuation turn every mode outside
     `LAUNCH_MODES` into Ask, and the Arena and VR new-session forms do not offer them.
   - **Unadvertised modes:** a session whose stored mode the addressed provider no longer advertises
     shows that provider's first mode, as today.

### Type contract

```ts
// src/shared/types.ts
export type SecurityLevel = 'guarded' | 'native';
export type AgentMode = 'ask' | 'plan' | 'agent' | 'edits' | 'auto' | 'full';

export interface ResolvedAgentPolicy {
  level: SecurityLevel;                 // Docker, Ask, and Plan always 'guarded'; what the arguments follow
  profile: 'ask-readonly' | 'plan-readonly' | 'agent-full' | 'auto-sandboxed' | 'native'; // 'native': every Native writing mode
  permissionMode: 'default' | 'acceptEdits' | 'auto' | 'bypassPermissions';
  // Ask/Plan use default plus user-only settings, following probe 13 above.
  // `safeMode: true` is removed: nothing reads it, and `level` now says when safe mode is off.
  // …the other fields unchanged
}

// src/shared/agentModes.ts
export const AGENT_MODES = ['ask', 'plan', 'agent', 'edits', 'auto', 'full'] as const;
export const LAUNCH_MODES = ['ask', 'plan', 'agent'] as const; // unchanged

// src/server/config.ts
export interface AppConfig { securityLevel: SecurityLevel; /* … */ }

// src/server/agents/codexInvocation.ts — `level` defaults to 'guarded' everywhere
export interface CodexTurnSecurity {
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
  approvalsReviewer?: 'user';           // absent at Native: your config decides
  // …the other fields unchanged; no sandboxPolicy for Native Auto and Full access
}
export function codexTurnSecurity(mode: AgentMode, execution?: AgentExecution, level?: SecurityLevel): CodexTurnSecurity;
export function buildCodexAppServerArgs(level?: SecurityLevel): string[];

// session messages, format 9: Native Agent and Auto messages only
level?: 'native';
// executor snapshot: present only at Native
securityLevel?: 'native';
```

---

## Acceptance criteria

### Follow-up — Native readiness notices (October 5, 2026)

Native loads the user's instructions and skills by design. The combined machine readiness must
omit the successful Guarded check's global-instruction and skill notices, so they do not trigger
the orange header badge. Guarded readiness and selected Ask/Plan checks retain those notices;
authentication failures, disabled Agent modes, failed Ask/Plan isolation, and sandbox-start
failures remain visible. This changes readiness messages only, with no change to execution policy.

- [x] Combined Native readiness omits global-instruction and skill notices; Guarded readiness and
      selected Native Ask/Plan checks retain them.
- [x] Authentication, disabled-Agent, Ask/Plan isolation, and sandbox-start warnings remain visible.
- [x] Focused provider tests, TypeScript, and the requested review pass.

### Part A — probes

- [x] Every probe above has a recorded result in `docs/experiment-log.md`, with CLI versions and
      arguments. No probe hand-edited the user's provider files, and entries the CLIs added were
      recorded and reverted.
- [x] Each provider has a written decision: which Native modes ship, with their exact arguments.
- [x] Probe 13 passes with decision 4's recorded correction: noninteractive `default` permissions
      and `--setting-sources user` for Claude Ask and Plan, at both levels.

### Part B — level and policy

- [x] `CODEAI_SECURITY_LEVEL` defaults to Guarded, accepts `native`, and is an error naming the
      setting for any other value. It is read once per process, and no route reads a level from a
      request.
- [x] At Guarded, and for Ask and Plan at Native, every Local Claude and Codex argument, thread
      request, and echo check is unchanged except decision 4's recorded read-only tightening. Tests
      reflect that tightening; all other existing argument and echo checks pass unmodified.
- [x] At Native, Docker Claude and Codex arguments are byte-for-byte unchanged.
- [x] At Native, Local Claude writing turns are spawned without `--safe-mode`, `--strict-mcp-config`,
      `--disable-slash-commands`, and `--append-system-prompt`, with decision 3's permission mode
      and `--permission-prompt-tool stdio`.
- [x] At Native, Local Codex writing turns carry no CodeAI override except the two turn-wide
      permission features. No inventory or isolation check runs, no reviewer is named, and the echo
      check follows decision 9.
- [x] In a Native writing turn, MCP, web search, hook, subagent, and dynamic tool items and
      auto-review notifications become activity lines. A Claude control request other than
      `can_use_tool` is answered at once. Any Codex request other than command and file approvals
      gets the unsupported answer and an activity line. In Ask and Plan those items still stop the
      turn.
- [x] Claude advertises Accept edits, Auto, and Full access at Native only when `claude --help` lists
      their permission modes. Codex advertises Agent and Auto with `CODEAI_CODEX_AGENT`, Auto only
      when its sandbox starts, and Full access without the gate. A failed isolation check withholds
      Codex's Ask and Plan only.
- [x] Accept edits and Full access are 409 at Guarded and in Docker, an unknown mode is still 400,
      and `unsupportedModes` hides them before readiness and in Docker.
- [x] A Local Claude Native writing turn in an isolated session is a 409 with decision 6's message,
      and the picker shows those modes disabled with that reason.
- [x] `changesCheckout` covers Agent, Accept edits, Auto, and Full access, and each takes exclusive
      checkout access and the build budget.
- [x] `MODE_CONTRACT` has Native contracts for the writing modes, and Ask and Plan are unchanged.
- [x] The health response reports `securityLevel`, a Native executor's snapshot reports it, and the
      home's composer shows an executor's level. The registry keeps a machine whose cached snapshot
      it cannot parse.

### Part C — records and controls

- [x] A Native Agent or Auto turn's messages carry `level: 'native'`. The first such message, or the
      first Accept edits or Full access message, upgrades the session to version 9, which is
      required for both. Nothing lowers a version, and a build that reads at most version 8 hides
      only those sessions.
- [x] The flat picker and VR's agents row offer Accept edits and Full access only when advertised,
      with the emphasis, labels, hints, and tooltips above. At Guarded, the flat picker ends with
      "More modes at Native".
- [x] The execution line shows Native for a Local session on a Native machine, message tags read
      "Native · <mode>" where the level is recorded, and the instructions line follows decision 6.
- [x] The Arena shows this machine's level read-only, with how to change it.
- [x] `inheritedMode`, `launchChoice`, and the continuation turn Accept edits and Full access into
      Ask, and no new-session form offers them.
- [x] README:
      - the Conversation modes section and the Safety model describe both levels;
      - Configuration lists `CODEAI_SECURITY_LEVEL`;
      - Known limitations name decision 2's trust caveat and planted-settings cost, Full access's
        reach, decision 1's `.env.local` note, and decision 13's rollback limit.
- [x] AGENTS.md: the Safety boundaries say which rules hold at Guarded only and which hold at every
      level. Guarded-only rules are safe mode, the disabled features, and you as the only reviewer;
      the every-level rules are the epic's invariants. The Now section names this story while it is
      in flight.
- [x] architecture.md: the mode row lists the six modes, and a row says the level is server-owned
      and machine-set. vocabulary.md and vision.md match what shipped.

### All

- [x] Tests are written first, and each fails when the rule it covers is mutated. The rules are:
      Guarded's arguments, Docker's arguments at Native, each Native argument, the echo check, the
      readiness gates, the activity lines, the 409s, version 9, the registry, the picker, and the
      prompt contracts.
- [x] `npm run lint`, `npm test`, and `npm run test:e2e` pass.
- [x] How to verify passes on this machine.

## Out of scope

- Turn checkpoints and undo (Story 83), and Claude's sandboxed Auto at Guarded (Story 84).
- Native in Docker, a level per session or per project, and changing the level from a browser (the
  epic's *Deliberately not scheduled*).
- Your MCP servers and skills in Ask and Plan (open question 2).
- Native modes as launch modes or role defaults, and Execute plan in any mode but Agent.
- Model reviewers at Guarded, and Claude's `dontAsk` mode.
- Sending `manual` instead of `default` for Agent (open question 4): it would change Guarded.
- Anything that loosens a Guarded rule.

## Open questions

1. **Should a Native machine let the last mode carry into a new session,** so that a Full access
   user does not pick it in every session? Recommendation: not in this story. Decide after Native
   has been used. Today's rule keeps a writing mode a choice made with the session in view.
2. **Your MCP servers and skills in Ask and Plan.** Decision 4 keeps them out, because a writing
   turn can plant either one. Recommendation: revisit only with a design that keeps planted settings
   out, such as user-level settings only for read-only turns, backed by its own probe.
3. **Native with your user-level settings only** for writing turns (`--setting-sources user`, and
   Codex without a trusted checkout's `.codex/config.toml`)? Recommendation: no. It would not match
   the terminal, which is the point of Native. Revisit if untrusted repositories matter.
4. **`default` or `manual`?** Claude Code 2.1.285 lists `manual` and still accepts `default`
   unlisted. When `default` stops parsing, Guarded Agent breaks. Recommendation: a separate small
   story that probes whether the two behave the same and then sends whichever name `claude --help`
   lists.
5. **"More modes at Native" in every Guarded picker** nudges security-minded users toward Native,
   and the Arena row and README may be enough. Recommendation: keep it. The user could not find the
   relaxed modes on September 30, and the line is visible only while the picker is open.
6. **Accept edits** is a Claude-only extra mode. Full access already serves "no questions", so it
   could be deferred. Recommendation: keep it. The user agreed to it on October 1, and it costs
   little once the mode plumbing takes six modes.

## How to verify

For the October 5 readiness follow-up, run
`npm test -- test/nativeRunners.test.ts test/codexProcessRunner.test.ts test/nativeSecurity.test.ts test/healthRoute.test.ts test/globalInstructionsView.test.ts`
and `node_modules/.bin/tsc --noEmit --incremental false`. Both instruction and skill fixtures must produce no combined Native notice,
retain Guarded and selected Ask/Plan notices, and preserve actual readiness warnings. The header
already hides an available provider without a message ([AppShell.tsx:2141](../src/features/shell/AppShell.tsx#L2141)).

Verified October 5: both regression cases failed before the fix; all 73 focused tests, TypeScript,
and `git diff --check` passed afterward. The review subagent reported no actionable findings.

1. `npm run lint && npm test`. The fake Claude and Codex fixtures cover both levels' arguments,
   Docker at Native, the echo check, readiness, the activity lines, the 409s, version 9, and the
   registry.
2. **Guarded is unchanged:** with `CODEAI_SECURITY_LEVEL` unset, `npm run test:e2e` passes, and a real
   Claude Agent turn and a real Codex Auto turn behave as Story 79 recorded.
3. **Native, real Claude:** set `CODEAI_SECURITY_LEVEL=native` and restart. In a scratch repository
   with Part A's project settings:
   - Agent runs the allowed command without a card and asks for an edit.
   - Accept edits edits without a card and asks for `curl`.
   - Auto and Full access behave as Part A recorded.
   - Ask stays read-only: it runs none of the project's hooks or MCP tools, and no command that a
     project allow rule would permit.
   - Tags read "Native · Agent", and the Arena shows Native.
4. **Native, real Codex,** with an MCP server in your Codex configuration and `CODEAI_CODEX_AGENT=1`:
   - Agent can call the server, shown as an activity line.
   - Auto follows your `[sandbox_workspace_write]` settings.
   - Full access writes outside the checkout without a card.
5. **Executor:** attach an executor started at Native to a home at Guarded. The home's composer shows
   Native for the executor's Local sessions and offers its modes.
6. **Older build:** open the same data directory with a build that reads at most version 8:
   - Only the sessions with a Native writing message are hidden.
   - With a Native executor attached, that build reports its machine registry corrupt, as the README
     says. The current build keeps the machine.

## Verification evidence (2026-10-01)

### External review corrections

- [x] An unsupported composer mode falls back only to Ask or Plan; if neither is ready, Send is
      blocked until the user explicitly selects an available mode.
- [x] Continuing into Docker applies Docker's launch-mode inheritance and starts at Ask from Agent.
- [x] Unknown Claude control requests get the Native response only in Native writing turns.
- [x] Native Codex readiness preserves models and Guarded notes, waits for a bounded model list,
      reports signed-out once, and checks only the selected turn's handshake in the message route.
- [x] Isolation is shown as its own composer block reason, without disabling an earlier Ask retry.
- [x] VR Agents text has reachable pages and multiline errors, with no control overlap.
- [x] Docker Claude checks require only the flags Docker sends; offline tests pin Guarded regardless
      of the developer's exported level.
- [x] Native uses Story 82 throughout its documents, and redundant mode/message predicates and
      unused branches are removed.
- [x] Focused regressions, lint, the offline suite, browser checks, and a follow-up review pass.

The external review's thirteen findings are resolved. New regressions were observed failing before
the fixes. Final verification passes `npm run lint` and all 922 tests in 101 files with
`CODEAI_SECURITY_LEVEL=native npm test`, proving the suite's Guarded baseline is independent of the
developer's exported level. The complete browser suite passed all 112 checks; after the final
selected-mode readiness refinement, a fresh production build passed all four focused Native browser
checks. The follow-up review confirmed no remaining actionable findings, including the two-row VR
error layout's clearance from the panel toolbar. Native is Story 82; the unwritten checkpoint and
Claude sandbox follow-ups are now 83 and 84. The file name and session compatibility identifiers
are unchanged.

### Initial implementation

- The real probe matrix and implemented-runner checks are recorded in
  [experiment-log.md](../docs/experiment-log.md#story-82--native-probes-2026-10-01).
- `npm run lint` passes, and the final offline suite passes all 913 tests across 101 files.
  The complete browser suite passed 109 checks; the final response-time
  executor refresh correction then passed a fresh production build and all five affected browser
  checks, including delayed home readiness, Native/Guarded layout, and the real Native test server.
- The isolated mutation baseline passed 70 checks and all 24 deliberate mutations were caught.
  The actual preceding HEAD source confirmed format-8 rollback and the older registry limitation.
- A review subagent identified executor/home readiness replacement (including its async race) and
  overlapping VR status/mode surfaces. Both are fixed with browser regressions; the follow-up review
  confirmed no remaining actionable findings.
- Two integration adjustments supersede the original Draft: Claude Ask/Plan use noninteractive
  default permissions and user-only settings after the plan-mode probe allowed shell writes; Native
  records use format 9 because the preceding image story already uses format 8.
