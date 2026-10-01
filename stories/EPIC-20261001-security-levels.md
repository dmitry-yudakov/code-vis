# EPIC — Security levels: Guarded and Native

**Status:** Draft · **Updated:** October 1, 2026 · **Owns:** how much a machine lets Claude and Codex
do on their own, and whose rules decide it. It changes the Local half of the
[safety model](../README.md#safety-model). Docker execution keeps
[its own contract](../docs/docker-execution.md).

## Motivation

The user, on September 30 and October 1, 2026, after
[Story 79](STORY-20260928-sandboxed-auto-mode.md) shipped Auto for Codex:

> ok, so we're now should be able to run claude/codex in auto-approve mode - but I don't see how I
> can do it for running conversation

> how does claude work in auto mode? I don't think I've did something with sudo or app armor?

> I feel we should have different levels of security for this product - for more and less
> security-oriented users. Some people want to use the agents to the max with min questions asked
> and trusting them. Others want to put more barriers and don't trust agents. We should be able to
> prevent LLMs from mistakes but not limit the first users.
> This way - if the user wants to use claude and/or codex with their capabilities and
> configurations - we should let them do so easily.

CodeAI has one level today, and it is stricter than the CLIs it runs:

- **Claude** runs in `--safe-mode` with an empty MCP configuration and slash commands disabled. Your
  CLAUDE.md, hooks, skills, plugins, MCP servers, and custom commands do not load (Story 80 passes
  your global instructions as text). Locally it offers Ask, Plan, and Agent only. Claude Code's own
  `auto` mode, which works on this machine with no setup, is not offered. Story 79's sandboxed Auto
  for Claude needs `socat` and an AppArmor change made with `sudo`.
- **Codex** runs with MCP servers, hooks, apps, and plugins disabled. If an MCP server or hook stays
  active, CodeAI refuses Codex outright: "Disable it in Codex before using this provider in CodeAI."
  An MCP, web search, or hook item stops the turn. Agent
  and Auto sit behind `CODEAI_CODEX_AGENT`, and the mode picker hides Auto without saying why. On
  September 30 the user could not find Auto in a running conversation for either provider.

For someone who already trusts their agents in the terminal, CodeAI is a downgrade. These limits do
not stop the model from making mistakes. They stop the user from using what they set up.

## The two levels

| | **Guarded** (default) | **Native** |
|---|---|---|
| Who sets the rules | CodeAI | The provider, from your own setup |
| Your settings, hooks, MCP servers, skills, plugins, custom commands | Claude: none (safe mode). Codex: MCP servers, hooks, apps, and plugins off; your `config.toml`, `AGENTS.md`, and skills load | Loaded for writing turns, as in your terminal. Ask and Plan stay as at Guarded |
| Global instructions | Passed as text ([Story 80](STORY-20260929-global-instructions.md)) | Loaded by the provider itself in writing turns |
| Local modes | Ask, Plan, Agent, and Auto for Codex | Ask and Plan as at Guarded; Agent, Accept edits (Claude), Auto, and Full access with the provider's meaning |
| Who answers an escalation | You | Whoever your setup names: you, or a model (Claude's `auto`, Codex's `auto_review`) |
| Docker sessions | Docker's contract | Docker's contract, unchanged |

The level belongs to the machine that runs the turn. It is set on that computer with
`CODEAI_SECURITY_LEVEL`, never from a browser, and every device that opens the machine's sessions
sees it.

There are two levels, not a ladder. Someone who wants no questions picks Native and Full access.
Someone who wants more barriers already has Guarded, with Ask, Plan, and Docker. Each further level
is one more set of behavior to test and to explain.

## Invariants (at every level)

1. **The level is set on the machine.** No route or request sets it, for the same reason pairing
   codes are issued in a terminal. It is read once per server process. A turn that can
   write CodeAI's own checkout can change `.env.local` there, as it can change CodeAI's code. Either
   change takes effect only at the next restart.
2. **Who can drive a machine does not change.** Pairing, the exact HTTPS origin, and device
   credentials are unchanged, and Native adds no route. The development-only `npm run devs` loop
   stays unauthenticated and for a trusted network only: anyone who reaches it can already send an
   Agent turn and approve its cards, so Native widens nothing there that is not already open.
3. **CodeAI itself never reads, copies, logs, or persists provider credentials.** Native changes
   what the provider loads, not what CodeAI reads.
4. **Ask and Plan are read-only at both levels.** At Native they keep Guarded's arguments. A Native
   writing turn can plant a hook, an MCP server, or a permission rule in the checkout's provider
   settings. Guarded's arguments keep a read-only turn from running the first two. Story 82 verified
   the third and tightened Claude Ask/Plan at both levels: normal noninteractive permissions and
   user-only setting sources block planted project permission rules as well as hooks and MCP.
5. **You can see the level.** At Native, the composer says so before you send, and a message
   records the level wherever its mode alone does not say it. Guarded, the default, is unmarked.
6. **Guarded does not loosen.** Every Guarded rule and its tests stay as they are. Native is a
   second path beside them, tested on its own.
7. **Full access is described honestly.** At Native an agent reaches what its provider's mode
   allows. In Full access that is everything you can reach as your desktop user, including CodeAI's
   data directory and the provider's own credential files. No CodeAI guard pretends otherwise. A
   Native writing turn can also change the provider settings that later writing turns load, as it
   can in your terminal.
8. **Native is Local only.** Docker keeps Story 80's allowlist. Mounting a whole provider folder
   into a worker would expose credentials and other projects' transcripts.

## Catching mistakes without asking

For someone who trusts the agent, the safety net is recovery, not approval. Story 83 saves a
checkpoint of the working tree before every turn that can change it and offers **Undo this turn**,
at both levels. It asks nothing, it is what makes Native with Full access a reasonable choice, and
it closes the gap Story 79 left open: uncommitted work has no backup.

## Story map

| # | Story | Theme | Status | Depends on |
|---|---|---|---|---|
| 82 | [native-security-level](STORY-20261001-native-security-level.md) | The level setting, and Native for Local Claude and Codex: their own setup and permission modes, plus Accept edits and Full access | Shipped | 79, 80 |
| 83 | [turn-checkpoints](STORY-20261001-turn-checkpoints.md) | A private eligible-file checkpoint before each writing turn and explicit checkout Undo at both levels | Shipped | 82 |
| 84 | claude-sandboxed-auto | Guarded Auto for Claude ([Story 79](STORY-20260928-sandboxed-auto-mode.md)'s open question 4): the remaining probes, then the policy | Blocked on this machine: `socat` and the AppArmor profile for `bwrap` need `sudo` | 79 |

Story 82 comes first because the user asked for it directly. Story 83 is independent and can run
beside it. Story 84 waits until someone wants Guarded Claude without cards and the machine change
is made. Write each story from the template when it starts. The rows above are the scope, not the
spec.

## Where the code is

| Today | Where | At Native |
|---|---|---|
| Claude: safe mode, strict empty MCP configuration, slash commands off | [claudeInvocation.ts:17](../src/server/agents/claudeInvocation.ts#L17), [:24](../src/server/agents/claudeInvocation.ts#L24) | Not sent; the mode picks the permission mode |
| Claude: global instructions appended as text | [claudeInvocation.ts:36](../src/server/agents/claudeInvocation.ts#L36), [claudeProcessRunner.ts:145](../src/server/agents/claudeProcessRunner.ts#L145) | Not sent for Local Claude, which loads CLAUDE.md itself |
| Claude: Ask, Plan, Agent | [claudeInvocation.ts:83](../src/server/agents/claudeInvocation.ts#L83) | Adds Accept edits, Auto, Full access |
| Codex: ambient features and MCP servers off | [codexInvocation.ts:10](../src/server/agents/codexInvocation.ts#L10), [:31](../src/server/agents/codexInvocation.ts#L31), [:116](../src/server/agents/codexInvocation.ts#L116) | Only the two turn-wide permission features stay off |
| Codex: refused while an MCP server or hook stays active | [codexPreflight.ts:225](../src/server/agents/codexPreflight.ts#L225), [codexProcessRunner.ts:543](../src/server/agents/codexProcessRunner.ts#L543) | Not checked for writing turns; withholds only Ask and Plan |
| Codex: an MCP, web search, or hook item stops the turn | [codexProcessRunner.ts:297](../src/server/agents/codexProcessRunner.ts#L297) | An activity line in writing turns; still stops Ask and Plan |
| Codex: Agent and Auto behind `CODEAI_CODEX_AGENT` | [config.ts:172](../src/server/config.ts#L172), [codexInvocation.ts:50](../src/server/agents/codexInvocation.ts#L50) | Still gates Agent and Auto, a protocol gate; Full access is not gated |
| Codex: approval reviewer pinned to you | [codexInvocation.ts:92](../src/server/agents/codexInvocation.ts#L92), [:217](../src/server/agents/codexInvocation.ts#L217) | Taken from your Codex config |
| One policy per mode and execution | [agentPolicy.ts:28](../src/server/agents/agentPolicy.ts#L28) | Also per level |
| The list of modes | [agentModes.ts:4](../src/shared/agentModes.ts#L4) | Gains Accept edits and Full access |

## Deliberately not scheduled

- **Native in Docker.** See invariant 8.
- **A level per session or per project.** A session that wants less than its machine's level uses
  Ask, Plan, or Docker.
- **A level in between,** such as Native with your user-level settings only and none from the
  repository. Revisit if project settings in untrusted repositories turn out to matter.
- **Model reviewers at Guarded.** Guarded keeps you as the only reviewer.
- **Changing the level from the Arena.** See invariant 1.

## Terms

[vocabulary.md](../docs/vocabulary.md) is authoritative: **security level**, **Guarded**,
**Native**, **Accept edits**, **Full access**, and what **Auto** means at each level.
