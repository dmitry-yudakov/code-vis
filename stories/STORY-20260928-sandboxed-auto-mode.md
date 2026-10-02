# Story 79 — Add an Auto mode that asks only for what leaves the sandbox

**Status:** In progress · **Type:** Full-stack · **Depends on:**
[Story 19](STORY-20260806-web2-conversation-modes.md) (modes),
[Story 20](STORY-20260817-web2-codex-provider.md) (Codex App Server),
[Story 65](STORY-20260921-tolerate-newer-session-format.md) (a newer session hides only itself),
[Story 70](STORY-20260924-remember-turn-choices.md) (remembered choices). It changes
[vision.md's](../docs/vision.md#not-now) "Local keeps per-action approvals" line.

---

## Motivation

The user, on September 28, 2026:

> hypothetically - could we use claude and codex auto/auto-approve modes? with detecting
> potentially dangerous operations? or we handle this part entirely?

Today CodeAI makes every approval decision itself and has no way to tell a dangerous action from a
safe one. Local Agent turns every edit and every command outside the git read allowlist into a
permission card. Docker Agent never asks, because the container is the boundary. There is nothing in
between. In practice this means:

- **Card fatigue.** A build turn raises a card for every edit and every test run. Each one needs you
  there, and answering with a controller in VR is slow.
- **Unattended turns stall.** An unanswered card is denied after `CODEAI_APPROVAL_TIMEOUT_MS`
  (10 minutes). A turn left running while you are in another session or away from the desk ends up
  denied, not finished.
- **Docker is the only alternative.** Docker Agent is autonomous but needs a provisioned daemon and
  image, a separate provider home, and a session created for it.

**Later change:** [Story 88](STORY-20261002-unlimited-approval-waits.md) removes the default
approval expiry; the ten-minute behavior above records the motivation when this story began.

Both providers can now run with less supervision:

- **Codex** has the `workspace-write` sandbox with `on-request` approvals, the preset its own CLI
  calls Auto. The operating system limits writes to the checkout and blocks the network. Codex asks
  only when an action would leave that sandbox.
- **Claude** has `acceptEdits`, which approves edits inside the working directory by itself, and an
  opt-in Bash sandbox that runs sandboxed commands without asking.

This story adds that middle ground as a fourth mode, **Auto**. What stays inside an enforced sandbox
runs without a card; anything that leaves it still raises a card. CodeAI still detects nothing
itself. The sandbox provides the containment and you still approve anything that escapes it (see
*Design decisions*).

While checking this, the review found an existing gap that ships first, as Part A: CodeAI never
checks which reviewer Codex uses for approvals.

---

## Current behavior (where the code is)

This section describes the code before the story, and its line anchors are from that commit.
*What shipped*, at the end, has the current ones.

### Policy and providers

- **Policy:** [agentPolicy.ts:24](../src/server/agents/agentPolicy.ts#L24) `resolveAgentPolicy`
  maps a mode and execution to a frozen, server-owned policy. Local Agent
  ([:41-53](../src/server/agents/agentPolicy.ts#L41-L53)) uses `permissionMode: 'default'` with
  `interactivePermissions: true`. Docker ([:25-34](../src/server/agents/agentPolicy.ts#L25-L34))
  uses `bypassPermissions`.
- **Claude arguments:** [claudeInvocation.ts:16](../src/server/agents/claudeInvocation.ts#L16)
  passes `--permission-mode`. [:28-31](../src/server/agents/claudeInvocation.ts#L28-L31) adds
  `--permission-prompt-tool stdio` for interactive modes, so every prompt reaches CodeAI as a
  `can_use_tool` control request
  ([claudeProcessRunner.ts:219](../src/server/agents/claudeProcessRunner.ts#L219)), described for
  the card by `describeToolUse` ([:51](../src/server/agents/claudeProcessRunner.ts#L51)). Per-mode
  flags that preflight probes are in `MODE_CLAUDE_FLAGS`
  ([claudeInvocation.ts:76-82](../src/server/agents/claudeInvocation.ts#L76-L82)). `--add-dir`
  puts the per-run attachment directory in Claude's reach
  ([:26](../src/server/agents/claudeInvocation.ts#L26)).
- **Codex arguments:** [codexInvocation.ts:11-33](../src/server/agents/codexInvocation.ts#L11-L33)
  `buildCodexAppServerArgs` disables ambient features. `codexTurnSecurity`
  ([:41-60](../src/server/agents/codexInvocation.ts#L41-L60)) gives Local Agent the `readOnly`
  sandbox with `on-request`, so every write and command has to ask. `codexThreadPolicyIssue`
  ([:131-144](../src/server/agents/codexInvocation.ts#L131-L144)) fails closed unless App Server
  echoes `readOnly` with no network for a local turn. It takes only `approvalPolicy` and
  `execution`, and it does not check `approvalsReviewer`. Codex Agent is advertised only with
  `CODEAI_CODEX_AGENT` ([config.ts:172](../src/server/config.ts#L172),
  [codexInvocation.ts:36-40](../src/server/agents/codexInvocation.ts#L36-L40)).
- **Codex thread and turn start:** [codexProcessRunner.ts:501-506](../src/server/agents/codexProcessRunner.ts#L501-L506)
  sends the sandbox and approval policy at `thread/start`/`thread/resume`, and
  [:551-552](../src/server/agents/codexProcessRunner.ts#L551-L552) sends them again at
  `turn/start`. No reviewer is sent.
- **Codex approvals:** [codexProcessRunner.ts:268-299](../src/server/agents/codexProcessRunner.ts#L268-L299)
  turns `item/commandExecution/requestApproval` and `item/fileChange/requestApproval` into cards,
  and answers each with a one-shot `accept`/`decline`/`cancel`. Any other `*/requestApproval`,
  including `item/permissions/requestApproval`, gets an unsupported response
  ([:281-283](../src/server/agents/codexProcessRunner.ts#L281-L283)).
- **Broker:** [permissionBroker.ts:13](../src/server/runs/permissionBroker.ts#L13) holds one-shot
  requests with a timeout that denies. It needs no change.
- **Attachment directory:** [tempAttachments.ts:8](../src/server/storage/tempAttachments.ts#L8)
  creates each run's directory with `mkdtemp` in the system temp directory.
- **Host Git reads:** [gitRead.ts:13-17](../src/server/repository/gitRead.ts#L13-L17) neutralizes
  hooks, fsmonitor, the pager, and `diff.external`. It does not neutralize `filter.*.clean` or
  `diff.*.textconv` defined in the checkout's `.git/config` and selected by an in-tree
  `.gitattributes`. So whatever can write `.git/config` can make CodeAI's own `git status` or
  `git diff` run a command on the host, outside any sandbox.

### Modes on the wire, in records, and in the UI

- **Type and schemas:** `AgentMode` is `'ask' | 'plan' | 'agent'`
  ([types.ts:344](../src/shared/types.ts#L344)); `ResolvedAgentPolicy`
  ([:580-594](../src/shared/types.ts#L580-L594)). The same enum appears in
  [protocol.ts:37](../src/shared/protocol.ts#L37), [machineSchema.ts:22](../src/shared/machineSchema.ts#L22)
  (`.max(3)`), and [sessionSchema.ts:11](../src/shared/sessionSchema.ts#L11).
- **Status codes:** a mode outside the enum is a 400 from the schema. A known mode the provider does
  not advertise is a 409 ([route.ts:167-171](../src/app/api/agent/message/route.ts#L167-L171)).
- **Session format:** the newest readable format is 5
  ([sessionSchema.ts:213-222](../src/shared/sessionSchema.ts#L213-L222)). Report evidence upgrades a
  session to 5 whenever its version is not already 5
  ([sessionStore.ts:602-605](../src/server/storage/sessionStore.ts#L602-L605)), and validation
  compares with `!== 5` ([sessionSchema.ts:262](../src/shared/sessionSchema.ts#L262)). Both would
  lower or reject a version 6.
- **Executors:** a home parses an executor's snapshot with the machine schema and drops the whole
  snapshot when it does not parse ([machineClient.ts:54-55](../src/server/machines/machineClient.ts#L54-L55)).
- **Hard-coded mode lists**, which the compiler will not flag when `AgentMode` grows:
  [providerRegistry.ts:17](../src/server/agents/providerRegistry.ts#L17) and
  [:114](../src/server/agents/providerRegistry.ts#L114),
  [claudeInvocation.ts:82](../src/server/agents/claudeInvocation.ts#L82),
  [dockerRuntime.ts:93](../src/server/execution/dockerRuntime.ts#L93),
  [InstructionComposer.tsx:13](../src/features/conversation/InstructionComposer.tsx#L13),
  [AppShell.tsx:88](../src/features/shell/AppShell.tsx#L88),
  [Arena.tsx:319](../src/features/arena/Arena.tsx#L319), and two parsers that would silently drop
  `'auto'` on reload: [devicePreferences.ts:6](../src/features/shell/devicePreferences.ts#L6) and
  [workspaceViews.ts:20](../src/features/shell/workspaceViews.ts#L20). `Record<AgentMode, …>` maps
  (labels, hints, tooltips, the Docker hints at
  [toolActivity.ts:77](../src/features/agents/toolActivity.ts#L77) and
  [:83](../src/features/agents/toolActivity.ts#L83), and the local prompt's `MODE_CONTRACT` at
  [prompt.ts:9](../src/server/conversation/prompt.ts#L9)) will fail to compile, which is the point.
- **"May change the checkout" checks:** 14 `=== 'agent'` mode checks in 9 files (September 28,
  2026). Six sit on Docker-only paths ([agentPolicy.ts:27-32](../src/server/agents/agentPolicy.ts#L27-L32),
  [dockerRuntime.ts:426](../src/server/execution/dockerRuntime.ts#L426),
  [prompt.ts:50](../src/server/conversation/prompt.ts#L50)). The rest include the scheduler's write
  access ([route.ts:201](../src/app/api/agent/message/route.ts#L201)) and the build budget
  ([claudeProcessRunner.ts:108](../src/server/agents/claudeProcessRunner.ts#L108)).
  [ConversationTools.tsx:151](../src/features/shell/immersive/ConversationTools.tsx#L151) and
  [:201](../src/features/shell/immersive/ConversationTools.tsx#L201) match VR mode actions by name.
- **VR controls:** mode actions are named in `CONVERSATION_ACTIONS`
  ([conversationControls.ts:38](../src/features/shell/immersive/conversationControls.ts#L38)) and
  listed in the agents row ([ConversationTools.tsx:113](../src/features/shell/immersive/ConversationTools.tsx#L113)).
- **Mode memory:** mode is remembered per session on this device, and as the device's last mode
  (`setMode`, [AppShell.tsx:939-943](../src/features/shell/AppShell.tsx#L939-L943)). A new session
  in the conversation starts from `inheritedMode`
  ([devicePreferences.ts:45-51](../src/features/shell/devicePreferences.ts#L45-L51)). The Arena
  and VR new-session forms use `launchChoice`
  ([devicePreferences.ts:69-78](../src/features/shell/devicePreferences.ts#L69-L78);
  [Arena.tsx:129](../src/features/arena/Arena.tsx#L129),
  [SessionTools.tsx:75](../src/features/shell/immersive/SessionTools.tsx#L75)), which reads the last
  mode directly.

### What the providers offer (checked September 28, 2026; no model turn was run)

Checked against Claude Code 2.1.283 and codex-cli 0.156.1 through `--help`, `codex features list`,
`codex app-server generate-json-schema`, the settings descriptions inside the Claude binary, and the
Claude Code documentation.

| | Option | What decides |
|---|---|---|
| Codex | `thread/start` and `thread/resume` take a `sandbox` mode string (`workspace-write`), `approvalPolicy`, `approvalsReviewer`, and `config`; `turn/start` takes the full `sandboxPolicy` | The thread's network and writable roots otherwise come from the user's `[sandbox_workspace_write]` config. The thread echo reports the sandbox, approval policy, and reviewer; `turn/start` echoes nothing. |
| Codex | `workspaceWrite` with `networkAccess`, `writableRoots`, `excludeSlashTmp`, `excludeTmpdirEnvVar` | The operating system. Both exclusions default to false, so `/tmp` and `$TMPDIR` are writable too. |
| Codex | `approvalsReviewer: 'user' \| 'auto_review'` | Who answers escalations: you, or a reviewer subagent. `auto_review` reports through `item/autoApprovalReview/started` and `/completed`, whose payload is marked **UNSTABLE**. |
| Codex | `item/permissions/requestApproval`; `fileChange.grantRoot` | The first grants a permission profile for the **whole turn**; its response has no decline value. `grantRoot` asks to allow writes under a root "for the remainder of the session (unclear if this is honored today)". The features behind turn-wide requests, `request_permissions_tool` and `exec_permission_approvals`, are off by default ("under development"). |
| Claude | `--permission-mode acceptEdits` | Edits and common filesystem commands (`mkdir`, `rm`, `mv`, `cp`, `sed`) on paths in the working directory, and per the docs in `--add-dir` directories too, run without asking. Other Bash still prompts. |
| Claude | `--settings` with `sandbox.enabled`, `autoAllowBashIfSandboxed`, `allowUnsandboxedCommands`, `failIfUnavailable` | The operating system (bubblewrap on Linux, Seatbelt on macOS). **It fails open by default:** "When false (default), a warning is shown and commands run unsandboxed." `allowUnsandboxedCommands` defaults to true. On Linux it needs `bwrap` and `socat`; this machine has `bwrap` but not `socat`, and sets `kernel.apparmor_restrict_unprivileged_userns=1`, which may stop bubblewrap. A network request outside the sandbox arrives as `can_use_tool` with `tool_name: "SandboxNetworkAccess"` and `input.host`. |
| Claude | `--permission-mode auto` | A classifier model approves or blocks each action. Per the docs, a blocked action is denied back to the model; whether it can reach the host instead is unconfirmed. |
| Claude | `--disallowedTools` | Server-owned deny rules for the Edit and Write tools, which the Bash sandbox does not cover. |

---

## Design decisions

1. **CodeAI does not detect dangerous operations itself.** A pattern-based detector would repeat the
   README's known caveat about the git allowlist: rules match the command, not its arguments
   (`git log --output=<file>` writes). Containment comes from the provider's sandbox, and judgment
   stays with you.
2. **Auto is defined by an enforced sandbox, not by a model's judgment.** Actions the
   operating-system sandbox contains run without a card. Anything that leaves it raises the same
   card as Agent, with the same timeout, or is refused.
3. **Auto never runs unprotected.** If the sandbox cannot start, the turn fails with a message
   saying so. It never falls back to running commands unsandboxed or to a classifier.
4. **Some paths stay protected inside the checkout.** No Auto action writes `.git/**`, `.claude/**`,
   or `.codex/**` without a card. The first protects CodeAI's own host Git reads (see *Current
   behavior*) and the history; the other two hold provider settings that could widen later runs.
   A commit in Auto therefore asks.
5. **Attachment directories are out of reach.** Per-run attachment directories move out of the
   system temp directory, which both sandboxes may leave writable and which test tools need. `/tmp`
   stays writable for those tools.
6. **Escalations still come to you.** Codex runs with `approvalsReviewer: 'user'`, sent explicitly
   and verified, in Agent as well as Auto. Model reviewers (Codex `auto_review`, Claude `auto`) are
   out of scope; Part B records how they behave so a follow-up can start from facts.
7. **A card says exactly what Allow grants.** Normally that is one action. Where a provider can only
   grant more, such as a network host for the rest of the turn, the card says so. Turn-wide
   permission requests stay off: CodeAI disables the features that raise them.
8. **Auto ships only for a provider whose probe passes.** If Part B shows that a provider cannot
   meet decisions 2–5 headless, Part C does not implement Auto for it, and the story records why.
9. **Auto is a mode, not a setting on Agent.** It is chosen per turn in the same picker, shown on the
   message, and understood by the server like the other modes.

---

## Desired behavior

### Part A — Pin Codex's approval reviewer to you

This is an existing gap, independent of Auto, and ships on its own.

- For local turns with `on-request` (Codex Agent today, Auto later), `thread/start` and
  `thread/resume` send `approvalsReviewer: 'user'`, and `turn/start` sends it too.
- `codexThreadPolicyIssue` takes the expected security (sandbox, network, approval policy,
  reviewer) instead of `approvalPolicy` and `execution`, and fails closed when the echo differs.
  Docker turns (`never`) do not check the reviewer.

### Part B — Probe both providers (no product code)

Install `socat` first. Run each probe against the real CLI in a scratch repository and record the
results in [docs/experiment-log.md](../docs/experiment-log.md) as "Story 79 — Auto probes", with CLI
versions and exact arguments.

**Codex** (`workspace-write` at thread start, `sandbox_workspace_write` overridden through
`config` to no network and no extra roots, `workspaceWrite` at turn start, `on-request`, reviewer
`user`, and `--disable request_permissions_tool --disable exec_permission_approvals`):

1. The thread echo shows `workspaceWrite`, no network, no extra writable roots, `on-request`, and
   reviewer `user`, including when `~/.codex/config.toml` sets `approvals_reviewer` to `auto_review`
   and `[sandbox_workspace_write] network_access = true`.
2. An edit and a command writing inside the checkout run with no approval request.
3. A write outside the checkout, such as `$HOME/codeai-auto-probe`, raises
   `item/commandExecution/requestApproval` or `item/fileChange/requestApproval`, or is refused.
4. A network command (`curl https://example.com`) is refused or raises a request. Record the method,
   and confirm `item/permissions/requestApproval` never appears with the two features disabled.
5. Writes to `.git/config`, `.git/hooks/pre-commit`, `.codex/config.toml`, and a `git commit`, both
   by shell and by patch: each asks or is refused.
6. A write to a directory under the CodeAI data directory (where attachments will live) asks or is
   refused.
7. With the sandbox unable to start (for example, run where unprivileged user namespaces are
   blocked): Codex refuses to run commands. Record exactly what happens.
8. After a `fileChange` approval carrying `grantRoot`, record whether a later write under that root
   asks again.

**Claude** (`acceptEdits`, `--permission-prompt-tool stdio`, `--safe-mode`, the sandbox with
`enabled`, `failIfUnavailable: true`, and `autoAllowBashIfSandboxed`, tried with
`allowUnsandboxedCommands` both true and false):

1. The sandbox passed with `--settings` takes effect under `--safe-mode`.
2. With `failIfUnavailable: true` and the sandbox unable to start (without `socat`, and with user
   namespaces blocked), Claude refuses to run commands. It never runs them unsandboxed.
3. An edit and a sandboxed command writing inside the checkout run without `can_use_tool`.
4. A write outside the checkout arrives as `can_use_tool` or is refused.
5. A network command arrives as `SandboxNetworkAccess` with the host. After Allow, record whether
   the host stays allowed for the rest of the turn.
6. With `allowUnsandboxedCommands: true`, a retry with the sandbox disabled arrives as
   `can_use_tool`, with input that shows it is unsandboxed. With `false`, it is refused.
7. The Edit and Write tools, and sandboxed Bash, writing `.git/config`, `.git/hooks/pre-commit`,
   `.claude/settings.json`, and `.codex/config.toml`: each asks or is refused once the
   `--disallowedTools` rules are in place. Record which paths the sandbox already protects without
   them.
8. The Edit tool and sandboxed Bash writing the `--add-dir` attachment directory, and another run's
   attachment directory: each asks or is refused.

**Model reviewers, recorded but not wired:** repeat Codex probes 3–5 with `auto_review` and Claude
probes 4–7 with `--permission-mode auto`. Record what each approves, what it blocks, and whether a
block reaches CodeAI at all.

**Decision:** for each provider, write down whether it meets decisions 2–5, the exact arguments
Part C sends, and the chosen `allowUnsandboxedCommands` value.

**Outcome (September 30, 2026).** The results are in
[docs/experiment-log.md](../docs/experiment-log.md#story-79--auto-probes-2026-09-30-utc).

- **Codex passes**, with different arguments from the ones planned above. The plain
  `workspace-write` sandbox leaves `.claude/` writable, which breaks decision 4. A Codex permission
  profile that extends `:workspace` and makes `.claude` read-only closes that, and App Server echoes
  the profile so it can be verified. Part C sends the profile and no legacy sandbox.
- **Claude could not be verified**, so by decision 8 Part C does not implement Claude Auto. Its
  sandbox refuses to start without `socat` (good), but with `socat` every sandboxed command fails
  under Ubuntu's AppArmor profile for bubblewrap. Both fixes need `sudo`, which the session did not
  have. The file-tool half of the probes ran and is recorded for the follow-up.
- `socat` was unpacked into a scratch directory for the probes, not installed.

### Part C — Auto mode

#### Policy (server-owned)

- `AgentMode` gains `'auto'`. `resolveAgentPolicy(config, 'auto', 'local')` returns a frozen
  `auto-sandboxed` profile with Agent's budget, timeout, and approval timeout, and
  `interactivePermissions: true`.
- **Codex:** `codexTurnSecurity('auto', 'local')` returns `on-request`, reviewer `user`, and the
  permission profile `codeai-auto`, with no legacy `sandbox` and no `sandboxPolicy`: App Server
  drops a profile when a legacy sandbox is named beside it. `codexThreadConfig` defines and selects
  the profile for the thread (extends `:workspace`; `.claude` read-only; network off).
  `codexThreadPolicyIssue` accepts exactly this echo for Auto: `on-request`, reviewer `user`,
  `activePermissionProfile` `codeai-auto` extending `:workspace`, and a `workspaceWrite` sandbox
  with no network and no writable roots. `buildCodexAppServerArgs` disables
  `request_permissions_tool` and `exec_permission_approvals` for every turn, and any
  `item/permissions/requestApproval` keeps today's unsupported answer. Codex Auto is advertised only
  with `CODEAI_CODEX_AGENT`, because its escalations use the path Agent's release gate protects.
  Auto has its own developer instructions: with Agent's ("Never broaden the configured sandbox")
  a real turn reported a blocked commit and stopped instead of asking.
- **Claude:** not implemented (see the Part B outcome). Claude never advertises Auto, and its runner
  refuses an Auto policy.
- **Attachments:** every run's attachment directory, in every mode, is created under the data
  directory (`<dataDir>/run-attachments/`) instead of the system temp directory, still per run,
  private, and removed after the turn. Leftovers from a crash are removed once per server process,
  before that process creates its first run directory. That is the earliest point at which the
  process is known to hold the session store's writer lock, so the sweep cannot remove a directory
  another live server is using.
- **Readiness:** Codex advertises Auto only when `codex sandbox` can run a command here, checked
  without a model turn each time readiness is read. If it cannot, the readiness line says so and
  Auto is withheld, which is how decision 3 holds for Codex: inside a turn, a sandbox that cannot
  start makes every command fail and ask, never run unsandboxed.
- **Docker:** Docker execution does not advertise Auto. Docker Agent is already autonomous inside its
  container.
- **Cards:** Auto's command and file approvals become the same cards as Agent's, one action per
  card. A Codex card, in Agent as well as Auto, shows what Allow would do, in this order:
  - the whole command, or every changed file with those outside the checkout first and named by
    their full path. A command too long to show keeps both ends and says how many characters are
    missing between them;
  - the network host, when Codex supplies one (`networkApprovalContext`);
  - in Auto, "may run outside the sandbox" (or "may write"). Codex asks for what leaves the sandbox
    and also for commands its own rules treat as destructive, such as `rm -rf` inside the checkout,
    and a request does not say which it is, so the card states the most Allow can mean;
  - the reason, labelled "reason given", because the model wrote it.

  Nothing Codex grants is wider than one action (probe 8), so no card has a wider grant to state.
- **What the sandbox covers.** Decision 4 holds for `.git`, `.codex`, and `.claude` at the
  checkout's root. A directory of the same name deeper in the checkout is an ordinary path to the
  sandbox (see open question 6).
- **Host Git reads.** A checkout need not be a Git repository, and `HEAD`, `config`, `objects`, and
  `refs` at its root are not protected names. CodeAI's Git reads pass `safe.bareRepository=explicit`
  so they never adopt such a folder as a repository and obey the `config` in it.
- **The data directory.** Auto is refused, with 409, while `CODEAI_DATA_DIR` lies inside the checkout
  or a temp directory, where the sandbox would let a turn rewrite CodeAI's own records.
- **Prompt:** `MODE_CONTRACT` gains an Auto contract: edit and run commands inside the sandbox;
  anything outside it asks the user; network, protected paths, and commits ask.

#### Everything that means "may change the checkout"

A shared, side-effect-free helper in `src/shared` (for example `changesCheckout(mode)`) replaces
each non-Docker `=== 'agent'` check that means this turn may change the checkout, including the
scheduler's exclusive write access and the build budget. The Docker-only checks stay as they are,
since Auto is never Docker. VR's mode-action checks gain `'auto'`. Every hard-coded mode list above
gains `'auto'` where Auto belongs, or says in a comment why not.

#### Records and wire

- `protocol.ts`, `machineSchema.ts` (`.max(4)`), and `sessionSchema.ts` accept `'auto'`.
- **Session format 6** is format 5 plus Auto messages. Writing the first Auto message upgrades a
  session to 6. No upgrade ever lowers a version: attaching a report to a version 6 session keeps 6.
  Validation allows report evidence at version 5 or later, and Auto messages only at version 6. A
  session without an Auto message keeps its version, and an older CodeAI hides only an upgraded
  session (Story 65).
- **Executors:** an older home drops the whole snapshot of an executor that advertises Auto. That is
  accepted; the README says to upgrade the home before its executors.
- A role default (`defaultMode`) is never `'auto'`.

#### Controls

- The composer's picker and VR's agents row offer **Auto** after Agent when the addressed provider
  advertises it. The flat shell gains no visible control: Auto is an item in the existing picker. In
  VR the four modes and Make main are laid out from their label widths when Auto is offered, and
  keep the three-mode layout otherwise.
- The tooltip: "Auto — edits the working tree and runs sandboxed commands without asking; anything
  outside the sandbox asks you. Network, commits, and writes outside the checkout always ask." The
  hint under the mode's name and on the execution line is the short form the other modes use:
  "Edits in a sandbox · asks beyond it". Auto takes Agent's `wait` emphasis on the picker and tag.
- Unlike the other modes, an Auto that is not advertised is not listed at all, even disabled.
- Messages sent in Auto carry an **Auto** mode tag.
- Auto is remembered for its session on this device, like any mode, and stays selected for an agent
  added to that session later whose provider offers it; for one that does not, the session shows
  and sends that provider's first mode until an agent that offers Auto is addressed again. It never carries into a new session: `inheritedMode` and
  `launchChoice` turn a last mode of `'auto'` into Ask, and the Arena and VR new-session forms do not
  offer Auto.
- **Execute plan** still sends Agent.

#### Docs

- README: the modes table gains an Auto column; a section states the sandbox contract, protected
  paths, per-provider requirements (including `socat` for Claude on Linux), and that CodeAI does not
  detect dangerous commands itself. The machines section says to upgrade a home before its executors.
- AGENTS.md: the Safety boundaries bullet says that Local Auto runs without individual approval
  inside the provider's sandbox; the "Now" section names this story while it is in flight.
- [architecture.md:95](../docs/architecture.md#L95): the mode row lists `auto`.
- [vocabulary.md](../docs/vocabulary.md): an Auto entry noting that it means CodeAI's sandboxed mode,
  not Claude Code's classifier-based `auto` permission mode.
- vision.md's "Not now" line: Local keeps per-action approvals for anything that leaves the
  provider's sandbox.

### Type contract

As shipped. Claude's `settings` and `disallowedTools` fields were not added, because Claude Auto
is not implemented.

```ts
// src/shared/types.ts
export type AgentMode = 'ask' | 'plan' | 'agent' | 'auto';

export interface ResolvedAgentPolicy {
  profile: 'ask-readonly' | 'plan-readonly' | 'agent-full' | 'auto-sandboxed';
  // …unchanged fields. Auto's policy equals Agent's apart from `profile` and `mode`.
}

// src/shared/agentModes.ts — the one list of modes, used by every schema and parser
export const AGENT_MODES = ['ask', 'plan', 'agent', 'auto'] as const;
export const LAUNCH_MODES = ['ask', 'plan', 'agent'] as const; // a new session, a role default
export function changesCheckout(mode: AgentMode): boolean;      // agent or auto

// src/server/agents/codexInvocation.ts
export interface CodexTurnSecurity {
  approvalPolicy: 'never' | 'on-request';
  sandboxPolicy?: …;             // absent for Auto
  sandbox?: 'read-only' | 'danger-full-access'; // absent for Auto
  approvalsReviewer?: 'user';    // named for every `on-request` turn
  permissionProfile?: 'codeai-auto'; // Auto only
}
export function codexThreadPolicyIssue(value: unknown, cwd: string, expected: CodexTurnSecurity): string | undefined;
```

---

## Acceptance criteria

### Part A — Codex reviewer

- [x] Local `on-request` turns send `approvalsReviewer: 'user'` at thread start, thread resume, and
      turn start.
- [x] A thread echo with any other reviewer fails closed with the existing policy message, including
      when the user's Codex config sets `auto_review`. Docker turns are unaffected.

### Part B — probes

- [x] Every Codex and Claude probe above has a recorded result in `docs/experiment-log.md`. Claude
      probes 3 and 5, and the Bash halves of 4, 7, and 8, are recorded as not testable on this
      machine, with the reason.
- [x] The model-reviewer probes are recorded.
- [x] Each provider has a written pass or fail against decisions 2–5 and the arguments Part C sends.
      Codex passes. Claude is recorded as not verified, and its `allowUnsandboxedCommands` value is
      left undecided for the follow-up.

### Part C — policy and providers

- [x] `resolveAgentPolicy(config, 'auto', 'local')` returns the `auto-sandboxed` profile with Agent's
      budget, timeout, and approval timeout.
- [x] Codex Auto sends exactly the Part B arguments, and a thread echo reporting anything else fails
      closed. Codex Auto is advertised only with `CODEAI_CODEX_AGENT`.
- [x] `buildCodexAppServerArgs` disables `request_permissions_tool` and `exec_permission_approvals`.
- [ ] Claude Auto sends exactly the Part B arguments, including `failIfUnavailable: true` and the
      `--disallowedTools` rules. No browser input reaches them. **Not implemented:** Claude did not
      pass Part B (decision 8).
- [ ] A Claude Auto turn whose sandbox cannot start fails and runs no command. **Not implemented**,
      as above.
- [ ] Claude Auto is withheld on Linux, with a readiness line naming the missing dependency, when
      `bwrap` or `socat` is not on `PATH`. **Not implemented**, as above. Codex has the equivalent:
      Auto is withheld, with a readiness line, when its sandbox cannot start.
- [x] Attachment directories are created under the data directory, removed after each turn, and swept
      once per server process before its first run directory is created, in every mode.
- [x] A provider that did not pass Part B, and Docker execution, do not advertise Auto; a request
      naming Auto for them returns 409, and an unknown mode string still returns 400.
- [x] Auto's approvals produce the same one-shot cards and timeout as Agent. A card shows the whole
      action, names the network host when Codex supplies one (in the probes it supplied none, and
      the command carried the URL), and says the action may run outside the sandbox. Codex grants
      nothing wider than one action, so there is no wider grant to state.
- [x] Every non-Docker `=== 'agent'` mode check uses the shared helper or keeps `'agent'` with a
      comment saying why, and every hard-coded mode list is updated or commented. An Auto turn takes
      exclusive checkout access in the scheduler.
- [x] `MODE_CONTRACT` has an Auto contract.

### Part C — records and controls

- [x] `'auto'` is accepted by the message route, the machine snapshot schema, the session schema, and
      both device-state parsers, and survives a reload.
- [x] Writing an Auto message upgrades the session to version 6. Attaching a report to a version 6
      session keeps version 6. A session without an Auto message keeps its version, and a build that
      reads at most version 5 hides only the upgraded session.
- [x] The flat picker and VR's agents row offer Auto only when the provider advertises it. The flat
      picker carries the hint and tooltip above; VR's row is a button labelled "Auto".
- [x] Auto messages show an Auto mode tag.
- [x] `inheritedMode('auto', …)` and `launchChoice` with a last mode of `'auto'` return Ask, and the
      Arena and VR new-session forms do not offer Auto.
- [x] README, AGENTS.md, architecture.md, vocabulary.md, and vision.md are updated as described.

### All

- [x] Tests for Part A and Part C are written first, and each is shown to fail when the rule it covers
      is mutated.
- [x] `npm run lint`, `npm test`, and `npm run test:e2e` pass after each part. After Part A, e2e had
      one failure that the untouched master had too; see the verification record.
- [x] How to verify passes on this machine for each provider that passed Part B. Steps 1–3, 5, and 6
      pass for Codex. Step 4 is Claude's. VR was checked in the desktop XR adapter, not on a Quest.

## Out of scope

- **Model reviewers answering escalations** (Codex `auto_review`, Claude `auto`). This is the
  "detect dangerous operations" half of the question. Part B records their behavior; wiring them
  needs a way to show a reviewer's decision and rationale, and Codex marks that payload unstable. A
  follow-up story.
- **Detection owned by CodeAI.** Not planned; see decision 1.
- **Checkpoints or undo for an Auto turn.** See *Open questions*.
- **Network allowlists** (for example, a package registry). Auto has no network; an install asks.
- **Auto in Docker, as a role default, from Execute plan, or in the new-session forms.**
- **Turn-wide permission grants.**
- **Hardening host Git reads against checkout-defined filters for Agent mode.** Agent asks before
  every edit; Auto protects `.git` instead.
- **Claude Auto.** It follows once Claude's sandbox can be probed; see *Open questions*.

## Open questions

1. **Model reviewers next?** Recommendation: after Part C has been used on real work, write the
   follow-up from Part B's records. It would make unattended turns possible, at the cost of
   replacing your judgment with a model's for escalations.
2. **Checkpoint before an Auto turn?** Recommendation: not in this story. With `.git` protected,
   history and Git configuration cannot change without a card. What remains at risk is uncommitted
   work in the checkout, which an Auto turn can overwrite or delete without asking. Decide once
   Part B reports and Auto has been used.
3. **The name.** "Auto" is what both providers call their own relaxed presets, but Claude Code's
   `auto` permission mode is the classifier this story deliberately does not use. Recommendation:
   keep "Auto" in the UI and record the difference in vocabulary.md; "Sandboxed" is the alternative
   if the overlap confuses.

4. **Claude Auto.** It needs two things done with `sudo` on this machine before its probes can
   finish: `sudo apt install socat`, and the AppArmor profile for `bwrap` from Claude Code's
   sandboxing guide (Ubuntu 24.04 and later). Then Part B's Claude probes 3 and 5 and the Bash halves
   of 4, 7, and 8 can run, `allowUnsandboxedCommands` can be chosen, and Claude Auto is a small
   follow-up: the policy, scheduler, records, and controls are already provider-neutral. What the
   finished probes already require is in the experiment log's decision. Recommendation: a follow-up
   story, since the AppArmor change is the user's to make.
5. **Codex marks an Auto checkout as trusted.** Starting a writable-sandbox thread writes
   `trust_level = "trusted"` for the checkout into `~/.codex/config.toml`, after which Codex loads
   that checkout's `.codex/config.toml`. CodeAI's echo check refuses a turn if that file widens the
   profile's writable roots or network, and the sandbox keeps `.codex` read-only, so an Auto turn
   cannot plant one. The README says this happens. Recommendation: accept it; it is what Codex's own
   CLI does.

6. **A repository nested in the checkout is not protected.** Found in review. The profile protects
   only the root's `.git`, `.codex`, and `.claude`; a profile cannot make a glob read-only. So an
   Auto turn can write `sub/.git/config` without a card. If `sub` is itself a checkout opened in
   CodeAI (possible with `CODEAI_REPOSITORIES_DEPTH` above 1, or a repository cloned inside
   another), CodeAI's next `git status` there runs whatever filter that config names, on the host.
   The README says not to use Auto in such a checkout. Recommendation: close it at the source with
   the item already listed under *Out of scope*, hardening host Git reads against checkout-defined
   filters, which also removes the reason `.git` needs protecting at all. Until then, an interim
   guard could refuse Auto for a checkout that contains another discovered checkout. The related
   case of a checkout with no `.git` at all is closed (see *What the sandbox covers*).

## How to verify

1. `npm run lint && npm test`. The fake Claude and Codex fixtures cover the arguments, the policy
   checks, the reviewer check, the version upgrade, and the mode rules.
2. **Part A, real Codex:** set `approvals_reviewer = "auto_review"` in `~/.codex/config.toml`, run a
   Codex Agent turn with `CODEAI_CODEX_AGENT=1`, and confirm its escalations still arrive as cards.
   Restore the config. Without editing your config, point `CODEAI_CODEX_BIN` at a script that runs
   `codex "$@" -c 'approvals_reviewer="auto_review"'`: `-c` outranks `config.toml`.
3. **Real Codex Auto:** in a scratch repository, choose Codex and Auto, and ask it to add a file and
   run the tests. Expect no card. Ask it to write `$HOME/codeai-auto-probe`: expect a card; deny it
   and see the turn continue. Ask it to `curl` a URL and to commit: expect a card or a refusal each
   time, never a silent success.
4. **Real Claude Auto,** with `socat` installed: repeat step 3; the network card names the host.
   Then remove `socat` from `PATH`: expect Auto to be withheld with a readiness line naming it.
   Not applicable until Claude Auto is implemented (open question 4).
5. Start a new session from the conversation, the Arena, and VR: none starts in Auto, even though
   Auto was the last mode.
6. Open the same data directory with a build that reads at most version 5: only the session with an
   Auto message is hidden.

## What shipped

Parts A and C, for Codex. Claude Auto is not implemented (see the Part B outcome and open
question 4).

- **Codex reviewer (Part A).** Every `on-request` turn names `approvalsReviewer: 'user'` at
  `thread/start`, `thread/resume`, and `turn/start`
  ([codexProcessRunner.ts](../src/server/agents/codexProcessRunner.ts#L549)), and
  `codexThreadPolicyIssue` takes the expected security and refuses any other echoed reviewer
  ([codexInvocation.ts](../src/server/agents/codexInvocation.ts#L212)). A
  `never` turn, Docker included, neither names nor checks one.
- **One list of modes.** [agentModes.ts](../src/shared/agentModes.ts#L4) holds
  `AGENT_MODES`, `LAUNCH_MODES` (a new session, a role default), `isAgentMode`, and
  `changesCheckout`. The wire, machine, and session schemas and both device-state parsers read it,
  so the next mode cannot be silently dropped by one of them.
- **Policy.** `resolveAgentPolicy` gives Auto Agent's policy under the `auto-sandboxed` profile
  ([agentPolicy.ts](../src/server/agents/agentPolicy.ts#L46)). The scheduler's exclusive
  access ([route.ts](../src/app/api/agent/message/route.ts#L207)), the build
  budget message, and the run status use `changesCheckout`. The Docker-only `=== 'agent'` checks
  stay, each with a comment.
- **Codex Auto.** The profile is `CODEX_AUTO_PROFILE`
  ([codexInvocation.ts](../src/server/agents/codexInvocation.ts#L64));
  `codexTurnSecurity('auto')` names it and no legacy sandbox
  ([codexInvocation.ts](../src/server/agents/codexInvocation.ts#L92));
  `codexThreadConfig` defines and selects it; the runner omits `sandbox` and `sandboxPolicy` when the
  security has none; and the echo check requires the profile, no network, and no writable roots
  ([codexInvocation.ts](../src/server/agents/codexInvocation.ts#L196)). The two
  turn-wide permission features are disabled for every turn
  ([codexInvocation.ts](../src/server/agents/codexInvocation.ts#L10)). Auto has its own
  developer instructions ([codexInvocation.ts](../src/server/agents/codexInvocation.ts#L145)).
- **Readiness.** `checkCodex` runs `codex sandbox … -- true` beside the handshake when the release
  gate is set, and withholds Auto with "Codex's sandbox cannot start on this machine, so Auto is
  withheld." when it fails ([codexPreflight.ts](../src/server/agents/codexPreflight.ts#L35)).
- **Cards.** A Codex approval card shows the whole command (both ends of one too long to show,
  with the count between them) or every changed file, those outside the checkout first and by full
  path; then the network host when Codex names one; in Auto, "may run outside the sandbox"; and
  last the reason, labelled "reason given" ([codexProcessRunner.ts](../src/server/agents/codexProcessRunner.ts#L324)).
  Only whole path prefixes are shortened, so a sibling of the checkout keeps its name. Answers stay
  `accept`, `decline`, or `cancel`.
- **Host Git reads.** `safe.bareRepository=explicit` in `GIT_READ_OPTIONS`
  ([gitRead.ts](../src/server/repository/gitRead.ts#L17)), and Git's
  refusal reads as "not a repository".
- **Data directory guard.** `autoDataDirectoryIssue`
  ([agentPolicy.ts](../src/server/agents/agentPolicy.ts#L78)) makes the
  route answer 409 for Auto while the data directory is inside the checkout or a temp directory.
- **Claude and Docker.** `CLAUDE_MODES` is what Claude is checked and run for
  ([claudeInvocation.ts](../src/server/agents/claudeInvocation.ts#L79)); the Claude runner
  refuses an Auto policy ([claudeProcessRunner.ts](../src/server/agents/claudeProcessRunner.ts#L126));
  the Docker adapters and the Docker engine's readiness list no Auto.
- **Prompt.** `MODE_CONTRACT.auto` ([prompt.ts](../src/server/conversation/prompt.ts#L34))
  states the sandbox, what asks, and that uncommitted work has no backup. It does not carry the git
  allowlist text, which says other commands are denied.
- **Run directories.** `createRunDirectory(dataDir)` makes `<dataDir>/run-attachments/code-ai-run-*`
  (both 0700), and the once-per-process sweep removes what a crash left
  ([tempAttachments.ts](../src/server/storage/tempAttachments.ts#L14)).
- **Records.** Format 6 ([sessionSchema.ts](../src/shared/sessionSchema.ts#L228));
  the first Auto message raises a session to it and nothing lowers a version
  ([sessionStore.ts](../src/server/storage/sessionStore.ts#L604)); validation allows Auto
  messages, the user's or the assistant's, only at version 6, and report evidence from version 5
  ([sessionSchema.ts](../src/shared/sessionSchema.ts#L274)). A role
  default cannot be Auto, in the type and in the schema.
- **Flat controls.** The picker lists Auto after Agent only when it is not among the unsupported
  modes ([InstructionComposer.tsx](../src/features/conversation/InstructionComposer.tsx#L120)).
  `unsupportedModes` ([agentModes.ts](../src/shared/agentModes.ts#L30)) counts
  Auto as unsupported until readiness is known, and always in a Docker session. Label, hint, and
  tooltip are in [toolActivity.ts](../src/features/agents/toolActivity.ts#L69); the mode
  tag comes from the same label. Auto shares Agent's `wait` emphasis
  ([globals.css](../src/app/globals.css#L380)).
- **Mode memory.** `inheritedMode` and `launchChoice` turn a last mode of Auto into Ask,
  `launchModes` is what the Arena and VR forms offer, and session creation takes a `LaunchMode`, so
  a continuation in the other execution cannot carry Auto either
  ([devicePreferences.ts](../src/features/shell/devicePreferences.ts#L46)).
- **VR.** `auto` is a conversation action; the agents row includes it only when offered, and then
  lays the four modes and Make main out from their label widths, because the three-mode spacing
  does not fit five controls ([ConversationTools.tsx](../src/features/shell/immersive/ConversationTools.tsx#L231)).
- **Fixtures.** `fake-codex.mjs` echoes a permission profile only when no legacy sandbox is named,
  answers `codex sandbox`, and has modes for a dropped, foreign, widened, or networked profile, a
  model reviewer, and a sandbox that cannot start.
- **An e2e test that was already failing.** `VR session tools create a repository-free session…`
  cycled at most 20 projects to reach "No project", and the suite now creates more than 30. Its
  bound is 80. The untouched master failed it the same way.
- **Docs.** README (modes table, an **Auto** section, machines, safety model, configuration, known
  limitations), AGENTS.md, architecture.md, vocabulary.md, vision.md, and the experiment log.

## Verification record

September 30, 2026. Codex 0.156.1 and Claude Code 2.1.284 on Ubuntu 26.04.1.

- `npm run lint`: passes.
- `npm test`: 769 tests in 93 files pass.
- `npm run test:e2e`: 100 of 100 pass in installed Chrome, including
  [the flat picker test](../e2e/canvas.spec.ts#L1645) and
  [the VR agents row test](../e2e/immersive.spec.ts#L474).
  After Part A alone the run was 97 passed and 1 failed; the same test failed on an untouched
  worktree of master, and is the one fixed above.
- **Tests first, then mutation.** Part A: four mutations (the echo check, the reviewer at thread
  start, at turn start, and in the security) each failed the reviewer test. Part C: 48 mutations of
  single rules, one at a time, each failed at least one unit test, and none survived; 18 more after
  the second review (the card rules, the data-directory guard, the Git read option, the Docker
  engine's modes, and `unsupportedModes`) were caught the same way. They cover the
  policy, `changesCheckout`, the scheduler access, the profile's contents, each part of the echo
  check, the release gate, the disabled features, the legacy sandbox at thread and turn start, both
  card rules, the sandbox readiness check, Claude and Docker not advertising or running Auto, the
  version upgrade and both validations, the role default, the run directory's location, sweep, and
  permissions, the four device rules, both parsers, the picker, the tooltip, and the prompt
  contract. Two more in a scratch build (the VR row offering Auto regardless, the Arena form
  offering Auto) failed the two e2e tests.
- **Real providers.** Part B's probes and the real turns through a production build are in
  [docs/experiment-log.md](../docs/experiment-log.md#story-79--auto-probes-2026-09-30-utc): an Auto
  turn edited and ran the tests with no card; a write to `$HOME`, a `curl`, and a commit each
  raised one card and were not done when denied; an allowed commit happened; Agent and Ask followed
  on the same provider session; and with Codex configured for `auto_review`, an Agent file change
  still raised a card for the user. How to verify step 2 used `-c` instead of editing
  `~/.codex/config.toml`.
- **Older build.** The untouched master build, opened on the data directory those turns wrote,
  listed the version 4 session, reported one session as written by a newer CodeAI, and answered 409
  for the version 6 one.
- **Reviews.** Two independent review subagents read the diff.
  - The first confirmed no defect. Its concern that another config layer might re-open `.git` or
    `.codex` unnoticed was probed: each such entry appears in `writableRoots` and the turn is
    refused. It found that only root-level directories are protected (open question 6).
  - The second found a host escape in a checkout with no `.git`: the sandbox lets a turn lay out a
    repository at the root, and CodeAI's own `git diff` then ran the filter its `config` named. It
    is reproduced in a test and closed by `safe.bareRepository=explicit`. It also found that a card
    named a file outside the checkout by its base name only, cut a long command silently, and
    claimed "outside the sandbox" for requests Codex raises inside it; that nothing kept the data
    directory out of the sandbox's reach; and several smaller gaps. All are fixed, except the VR
    permission review's paging and the comma limit on a Docker data directory, which is documented.
- **Not done here.** Claude's sandboxed-command probes and everything that depends on them (needs
  `sudo`); a physical Quest check of the VR agents row, which was checked in the desktop XR adapter.
