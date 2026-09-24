# Story 66 — Choose the model and effort for an agent's next turn

**Status:** In progress · **Type:** Full-stack · **Depends on:** [Story 19](STORY-20260806-web2-conversation-modes.md) (modes), [Story 20](STORY-20260817-web2-codex-provider.md) (Codex App Server)

**Vision slice:** the **agent** of [vocabulary.md](../docs/vocabulary.md), "a provider, a role, a
mode". For each turn it can now also run on a chosen model at a chosen effort. The choice is device
state, like mode. No session record, wire schema version, or provider permission changes.

---

## Motivation

The user, September 22, 2026:

> add possibility to select models and effort for codex and claude models

Today each installation has one model per provider, set by `CODEAI_CLAUDE_MODEL` /
`CODEAI_CODEX_MODEL`. Changing it means editing the environment and restarting the server. Effort
cannot be set at all, although it is the main lever that trades cost against quality. A quick Ask
and a long Agent build in the same session need different settings, and so do a coder and a
reviewer.

Capability stays server-owned (AGENTS.md): *"The browser names a supported mode and nothing else …
An unknown or unsupported mode is a 400."* The same rule applies here. The browser may name only a
model and an effort that the executing machine listed for that provider. Anything else is a 400.

---

## Current behavior (where the code is)

- The installation defaults are two optional settings that also accept their `CODEAI_WEB2_*`
  spellings: [config.ts:159](../src/server/config.ts#L159) and
  [config.ts:161](../src/server/config.ts#L161).
- Each adapter builds every runner with the installation model:
  [providerRegistry.ts:33](../src/server/agents/providerRegistry.ts#L33) and
  [providerRegistry.ts:55](../src/server/agents/providerRegistry.ts#L55). Docker does the same:
  [dockerProcessRunner.ts:47](../src/server/execution/dockerProcessRunner.ts#L47).
- Claude gets `--model` only when that setting is present:
  [claudeInvocation.ts:31](../src/server/agents/claudeInvocation.ts#L31). Preflight reads
  `claude --help` and turns off a mode when one of its flags is missing:
  [claudePreflight.ts:12](../src/server/agents/claudePreflight.ts#L12). The probed flag set is
  defined at [claudeInvocation.ts:41](../src/server/agents/claudeInvocation.ts#L41).
- Codex receives the same optional model on `thread/start` / `thread/resume`
  ([codexProcessRunner.ts:497](../src/server/agents/codexProcessRunner.ts#L497)) and on
  `turn/start` ([codexProcessRunner.ts:541](../src/server/agents/codexProcessRunner.ts#L541)). Codex
  never receives an effort. Readiness is a model-free App Server handshake:
  [codexPreflight.ts:119](../src/server/agents/codexPreflight.ts#L119).
- The turn request is strict. Its `mode` is an enum, so an unknown mode fails the schema:
  [protocol.ts:36](../src/shared/protocol.ts#L36), [protocol.ts:41](../src/shared/protocol.ts#L41).
  The route answers 400 when parsing fails ([route.ts:34](../src/app/api/agent/message/route.ts#L34))
  and checks the mode against the provider's health on every turn
  ([route.ts:122](../src/app/api/agent/message/route.ts#L122)). The policy is resolved and the runner
  called at [conversationService.ts:72](../src/server/conversation/conversationService.ts#L72) and
  [conversationService.ts:98](../src/server/conversation/conversationService.ts#L98).
- `ProviderHealth` is `available`, `authenticated`, `supportedModes`, and `message`:
  [types.ts:124](../src/shared/types.ts#L124). Docker health checks only the engine and the pinned
  image, and the same object is reused for both providers:
  [dockerRuntime.ts:68](../src/server/execution/dockerRuntime.ts#L68),
  [health/route.ts:53](../src/app/api/health/route.ts#L53),
  [execution/docker/route.ts:32](../src/app/api/execution/docker/route.ts#L32).
- Another machine: the executor snapshot validates provider health strictly
  ([machineSchema.ts:10](../src/shared/machineSchema.ts#L10), parsed at
  [machineClient.ts:54](../src/server/machines/machineClient.ts#L54)). The browser uses those
  `providers` as that machine's health ([AppShell.tsx:541](../src/features/shell/AppShell.tsx#L541)).
  `POST agent/message` is forwarded without change
  ([machineRoutePolicy.ts:12](../src/server/machines/machineRoutePolicy.ts#L12)), and the executor's
  own route validates it. The snapshot caches health for 10 s:
  [localExecutorSnapshot.ts:13](../src/server/machines/localExecutorSnapshot.ts#L13).
- Mode is device state. It lives in the per-session view
  ([workspaceViews.ts:41](../src/features/shell/workspaceViews.ts#L41), parsed and bounded at
  [workspaceViews.ts:181](../src/features/shell/workspaceViews.ts#L181)). When the provider cannot
  run it, it falls back to Ask ([AppShell.tsx:283](../src/features/shell/AppShell.tsx#L283)). It is
  sent from `send()` ([AppShell.tsx:1065](../src/features/shell/AppShell.tsx#L1065), body at
  [AppShell.tsx:1174](../src/features/shell/AppShell.tsx#L1174)).
- The composer puts the mode radiogroup, the mode hint, and Send on one row:
  [InstructionComposer.tsx:78](../src/features/conversation/InstructionComposer.tsx#L78). Mode is
  passed down through [ConversationDrawer.tsx:139](../src/features/conversation/ConversationDrawer.tsx#L139).
  The header's **More** menu is a `<details>` menu:
  [AppShell.tsx:1758](../src/features/shell/AppShell.tsx#L1758).
- VR has its own mode buttons in the shared controls contract
  ([conversationControls.ts:4](../src/features/shell/immersive/conversationControls.ts#L4)). Its
  Send calls the same `send()` as the flat shell:
  [AppShell.tsx:1678](../src/features/shell/AppShell.tsx#L1678).
- The architecture doc says the browser names a mode "and nothing else":
  [architecture.md:84](../docs/architecture.md#L84).

### What the providers accept (checked September 22, 2026; no model turn was run)

- **Claude Code 2.1.278.**
  - `--model <model>` takes an alias or a full name. The binary's family aliases are `sonnet`,
    `opus`, `haiku`, and `fable`.
  - `--effort <level>` accepts `low, medium, high, xhigh, max`. An unknown value prints *"Unknown
    --effort value … ignoring it and using the default effort"* and is not an error. This was run
    with an empty prompt, so no model was called.
  - The CLI changelog says the CLI falls back when a model lacks a level (`xhigh` falls back to
    `high`). The API rejects effort on Haiku 4.5.
  - The pinned Docker worker (`claude-code@2.1.226`, [Dockerfile:5](../docker/Dockerfile#L5))
    already has `--effort` (listed in the changelog before 2.1.186) and the `fable` alias (added in
    2.1.170).
- **Codex CLI 0.154.0 App Server.** From `codex app-server generate-ts` and `generate-json-schema`:
  - `ThreadStartParams.model?`, `ThreadResumeParams.model?`, `TurnStartParams.model?` and
    `TurnStartParams.effort?` exist. `effort` is documented as *"Override the reasoning effort for
    this turn and subsequent turns"*. `ReasoningEffort` is a string, schema: *"A non-empty reasoning
    effort value advertised by the model"*.
  - `model/list` takes `{ cursor?, limit?, includeHidden? }` and returns `{ data: Model[],
    nextCursor }`. `Model` includes `model`, `displayName`, `hidden`, `isDefault`,
    `supportedReasoningEfforts: { reasoningEffort, description }[]`, and `defaultReasoningEffort`.
  - This account's live list: `gpt-6-astra` (default), `gpt-5.6-sol`, and `gpt-5.6-terra` with
    `low…ultra`, and `gpt-5.5` with `low…xhigh`. Efforts differ by model.
- **A provider session keeps its last model.**
  - Codex: in an isolated, signed-out `CODEX_HOME`, a thread started on `gpt-5.5` at effort `high`
    came back from `thread/resume` without a `model` as `gpt-5.5` / `high`. A fresh thread defaulted
    to `gpt-6-astra`.
  - Claude: changelog 2.1.144 says *"Resumed sessions now keep the model they were using."*

---

## Desired behavior

The composer gets one compact **Model** control for the agent being addressed. The control names a
**model** and an **effort** from the choices the executing machine lists for that agent's provider.
Either one can be left at **Default**.

**Default is today's behavior.** A turn that names neither sends exactly the same arguments as
today: the `CODEAI_*_MODEL` setting when one is set, otherwise the CLI's own choice, and never an
effort.

### Where the choice lives

The choice is device state, like mode. It is stored for each session view and each agent in the
existing device workspace (`code-ai:device:v1:workspace`) and sent with each turn. There is no new
session field, no new format version, and nothing in the transcript. The reasons:

- AGENTS.md gives mode to browser memory, and model and effort are also settings for one turn.
- Both providers accept a different model and effort on any turn of a provider session. Claude
  reads `--model` / `--effort` on each `--resume` call, and Codex reads `model` / `effort` on each
  `turn/start`. Nothing forces the choice to be fixed for a provider session.
- Keeping the choice with the session would need a participant schema change and a session version
  bump. Stories 63 and 65 are already dealing with version skew, and no requirement says another
  device must see the choice.
- It is stored per agent (participant id) rather than per provider. Two Claude agents in one session
  often do different work, and changing the addressed agent changes the control.

### The server owns the choices

`ProviderHealth` gains the allowlist: `models`, each with the efforts it accepts, and `efforts`, the
efforts allowed when the model is Default. Health is already checked on every turn, so the check
that validates a turn and the list the browser shows come from the same place.

- **Claude — a fixed list in `claudeInvocation.ts`.** The family aliases `fable`, `opus`, `sonnet`,
  `haiku` each resolve to the newest model in that family, so the list does not go stale.
  - Fable, Opus, and Sonnet, and Default, allow `low, medium, high, xhigh, max`.
  - Haiku allows no effort, because Haiku 4.5 rejects it. For the same reason Default allows no
    effort when `CODEAI_CLAUDE_MODEL` names a Haiku model.
  - If `claude --help` does not list `--effort`, every effort list is empty. The modes are
    unaffected, because preflight already has that help text.
  - There is no new setting.
- **Codex — the App Server's own list.** The readiness handshake adds `model/list`
  `{ includeHidden: false, limit: 50 }` to its first batch of requests.
  - Each entry becomes `{ id: model, label: displayName, efforts: supportedReasoningEfforts[].reasoningEffort }`.
  - `efforts` for Default is the set of efforts every listed model supports. Any of them is valid on
    whatever model the thread is actually on.
  - Entries that are out of bounds are dropped. Only the first page is read.
  - The request is sent before the first batch with its rejection caught, but it is not part of the
    awaited batch. Once readiness passes, the handshake waits at most 300 ms more for it. If
    `model/list` fails, is unsupported, or is slow, the provider offers Default only. That never
    makes Codex unavailable or slower than the grace period.
- **Docker — the choices its workers accept.** Docker health checks the engine, not the providers,
  and the installation default already applies to both executions.
  - Docker Claude gets the fixed list with its efforts, because the pinned worker documents
    `--effort`. It never depends on a local Claude.
  - Docker Codex gets the local App Server's list, or Default only when local Codex is unavailable.
    The Docker adapter reads it through the same 10 s cache the executor snapshot uses, so a Docker
    turn does not run a fresh local Codex handshake.
  - A model the older pinned worker (`codex@0.152.0`) does not know fails that turn with the
    provider's error.
  - One helper builds Docker's per-provider health, and the health route, the Docker settings
    route, and the Docker adapter all use it.
- **Another machine — that machine's own choices.** The executor snapshot's `providers` include the
  two optional fields, the gateway forwards the turn body unchanged, and the executor checks it
  against its own list. The machine contract accepts the fields within bounds.
  - Update the home machine first. An older home rejects a newer executor's snapshot as not
    matching the machine contract, and that executor then shows as offline.

### Wire, validation, and provider arguments

1. The request gains optional `model` and `effort`. The schema only checks shape: bounded token
   strings that can never start with `-`.
2. After the existing health check, the route checks membership:
   - `model` must be the `id` of one of the addressed provider's `models` for the session's
     execution.
   - `effort` must be in the named model's `efforts`, or in the top-level `efforts` when no model is
     named.
   - Otherwise the answer is **400**, for example `Codex does not offer model "gpt-9" on this
     machine.`, sent before any reservation, message append, or runner.
3. `runConversation` puts both values on `AgentProcessRun`. The model is
   `input.model ?? the installation default`.
   - **Claude:** `--model <model>` in its current position, plus `--effort <effort>` when an effort
     is named.
   - **Codex:** `model` on `thread/start` / `thread/resume` and on `turn/start` (as today), plus
     `effort` on `turn/start` only.
   - **Docker:** the runner already spreads its input, so both values reach the worker's runner.

### Default after an explicit model

A provider session keeps its last model and effort when a turn names none. Default therefore means
**no override**:

- A new agent starts on the machine default.
- An agent that already ran on an explicit choice keeps that choice.
- An installation that sets `CODEAI_*_MODEL` is the exception: that model is sent on every Default
  turn.

The Default entry's title says this. This device remembers the last choice for each agent, so the
case only comes up when the user switches back to Default or uses another device.

### The control

- **Flat shell.** In `.composer-actions`, between the mode radiogroup and the hint, add a `<details>`
  menu styled like **More**.
  - Its summary reads `Default`, `Opus`, `Opus · High`, or `Default · High`.
  - The menu holds a **Model** radiogroup (Default plus the models) and an **Effort** radiogroup
    (Default plus the efforts for the chosen model). The Effort radiogroup is absent when that list
    is empty.
  - The control is disabled while a turn runs, like mode. It is absent when the provider lists no
    models and no efforts.
  - Choosing a model that does not allow the current effort resets the effort to Default.
  - A stored choice the provider no longer lists is shown and sent as Default, the same fallback
    mode uses.
  - At 390 px the mode hint gives up its space, so nothing overlaps.
- **VR.** VR gets no new control. VR's Send runs the same `send()`, so a VR turn uses this device's
  choice for the addressed agent.

### Concrete changes

1. `src/shared/types.ts`: `ProviderModel`, `ModelSelection`, `ProviderHealth.models` / `efforts`,
   `AgentMessageRequest.model` / `effort`, `AgentProcessRun.model` / `effort`.
2. `src/shared/protocol.ts`: `agentModelIdSchema` and `agentEffortSchema`, added as optional fields
   of `agentMessageRequestSchema`. Put the list bounds in `src/shared/limits.ts`, together with the
   two patterns (`MODEL_ID_PATTERN`, `MODEL_EFFORT_PATTERN`) that the device workspace parser reuses.
3. `src/shared/machineSchema.ts`: add optional, bounded `models` and `efforts` to
   `providerHealthSchema`, reusing the two schemas. The exported `providerModelSchema` is also the
   bounds check of the Codex parser.
4. `src/server/agents/claudeInvocation.ts`: `CLAUDE_MODEL_CHOICES`, `CLAUDE_EFFORTS`,
   `claudeModelChoices(effortSupported, defaultModel)`, the named flag class `CHOICE_CLAUDE_FLAGS`, and
   `buildClaudeArgs({ …, effort })`. `claudePreflight.ts` reports `effortSupported`, and
   `ClaudeProviderAdapter.checkHealth` adds the choices.
5. `src/server/agents/codexInvocation.ts`: a pure, bounded `codexModelChoices(value)` parser in the
   style of `codexMcpServerNames`. `codexPreflight.ts` sends `model/list` with its first batch,
   waits at most 300 ms for it after readiness, and never fails readiness because of it.
6. `src/server/agents/providerRegistry.ts`: `dockerProviderHealth(config, engine, localCodex)`
   builds both Docker providers' health. `cachedLocalProviderHealth(config)` (moved from
   `localExecutorSnapshot.ts`) is the 10 s Local health cache. The Docker adapter and
   `src/app/api/execution/docker/route.ts` use the cache; `src/app/api/health/route.ts` reuses the
   Local checks it already runs.
7. `claudeProcessRunner.ts` and `codexProcessRunner.ts`: resolve the model as
   `input.model ?? options.model` and pass `input.effort` as described above.
8. `conversationService.ts` passes the values through, and `agent/message/route.ts` checks
   membership (400). The membership rule lives in `src/shared/modelChoices.ts`
   (`offeredEfforts`, `offeredModelSelection`), which the route and the browser both use, so the
   check and the Default fallback cannot drift apart.
9. `workspaceViews.ts`: `DeviceViewState.modelSelections?: Record<participantId, ModelSelection>`,
   parsed and bounded like `defaultMode`. `AppShell.tsx` reads it from `view`, checks it against the
   addressed provider's health, writes it through `workspace.updateView`, and adds it to the body in
   `send()`. `ConversationDrawer.tsx` and `InstructionComposer.tsx` render the control. Effort labels
   sit next to `AGENT_MODE_LABELS` in `src/features/agents/toolActivity.ts`: `xhigh` reads
   "Extra high", and unknown values show as sent.
10. Fixtures: the `fake-claude.mjs` help lists `--effort`, with a variant that does not.
    `fake-codex.mjs` answers `model/list` (one hidden entry, two models whose efforts differ), with a
    mode where that method is missing.
11. Docs:
    - [architecture.md](../docs/architecture.md): add an ownership row "Model and effort for a turn —
      the browser names one of the machine's choices, and the server resolves it". Update the "a
      supported mode and nothing else" sentence.
    - README configuration: `CODEAI_*_MODEL` is the Default the composer can override.
    - README machine section: update the home machine before its executors.
    - AGENTS.md "Now": add an in-flight line for this story.

### Type contract

```ts
// src/shared/types.ts — also src/shared/protocol.ts and src/shared/machineSchema.ts
export interface ProviderModel {
  /** Sent back as `model`; the server passes it to the provider unchanged. */
  id: string;           // 'opus', 'gpt-5.5' — /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/
  label: string;        // 'Opus', 'GPT-5.5' — at most 80 characters
  /** Efforts this model accepts, in provider order; empty means effort cannot be named. */
  efforts: string[];    // each /^[a-z][a-z0-9_-]{0,31}$/, at most 8
}

export interface ProviderHealth {
  available: boolean;
  authenticated: boolean | 'unknown';
  supportedModes: AgentMode[];
  message?: string;
  /** Server-owned models a turn may name. Absent or empty: only Default. At most 50. */
  models?: ProviderModel[];
  /** Efforts a turn may name while the model is Default. At most 8. */
  efforts?: string[];
}

/** Device-only. Absent fields mean Default. */
export interface ModelSelection { model?: string; effort?: string }

export interface AgentMessageRequest {
  // …existing fields…
  /** Omitted means Default. Must be an `id` in the addressed provider's `models`, or 400. */
  model?: string;
  /** Omitted means Default. Must be in the named model's `efforts` (or `efforts`), or 400. */
  effort?: string;
}

export interface AgentProcessRun {
  // …existing fields…
  /** Already validated. Undefined model means the installation default; undefined effort sends none. */
  model?: string;
  effort?: string;
}

// src/features/shell/workspaceViews.ts
export interface DeviceViewState {
  // …existing fields…
  /** Keyed by agent participant id; at most 16 entries. */
  modelSelections?: Record<string, ModelSelection>;
}
```

---

## Acceptance criteria

### Choices
- [x] Claude health lists `fable`, `opus`, and `sonnet` with five efforts each, `haiku` with none, and
      `efforts` of all five. With help text that lacks `--effort`, every effort list is empty and
      the supported modes are unchanged.
- [x] Codex health lists the fake's visible `model/list` entries and leaves out the hidden one. Out
      of bounds entries are dropped. `efforts` is the set both models support. When `model/list` is
      missing or fails, Codex is still available and lists no `models` or `efforts`
      (`codexProcessRunner.test.ts`, preflight case).
- [x] Docker Claude offers the fixed list with efforts, even without a local Claude. Docker Codex
      has the same choices as Local, and offers Default only when local Codex is unavailable
      (`dockerSettings.test.ts`).
- [x] A Codex that never answers `model/list` is still available within the grace period and offers
      Default only. With a Haiku `CODEAI_CLAUDE_MODEL`, Default offers no effort.
- [x] An executor snapshot with choices parses. One without them still parses. Malformed or
      oversized choices are rejected (`machineClient.test.ts`).

### Wire and validation
- [x] The schema accepts `model` and `effort` when omitted or well formed. It rejects an empty value,
      one too long, one with a leading `-`, or a non-string, and still rejects every other policy
      field (extend `agentModes.test.ts`, "accepts only the three mode names").
- [x] The route answers 400 for a model the addressed provider does not list, for an effort the
      named model does not allow, and for an effort not in `efforts` when the model is Default. It
      makes no reservation, appends no user message, and creates no runner (`sessionRoutes.test.ts`).
- [x] A listed model and effort reach the runner's input on both Local and Docker sessions.

### Provider arguments
- [x] **Default is unchanged.** Claude's arguments and Codex's `thread/*` and `turn/start` params are
      exactly today's, with and without `CODEAI_*_MODEL` set. Add explicit assertions next to the
      existing ones.
- [x] Claude receives `--model sonnet --effort low` for that choice. An effort alone adds only
      `--effort`, keeping the installation model when one is set. A chosen model wins over
      `CODEAI_CLAUDE_MODEL`.
- [x] Codex receives the chosen `model` on `thread/start`, on `thread/resume`, and on `turn/start`,
      and `effort` only on `turn/start`.
- [x] The "probes every flag" test in `agentModes.test.ts` builds arguments with a model and an
      effort and puts `--model` and `--effort` into a named class. No mode depends on either flag.
- [x] `DockerProcessRunner` gives the inner runner the same `model` and `effort`
      (`dockerProcessRunner.test.ts`).

### Control
- [x] The composer shows the control only when the provider lists choices. Its summary follows the
      selection, the effort list follows the model, and the control is disabled while a turn runs.
      Covered by a `renderToStaticMarkup` test in the style of `workspaceTabs.test.ts`.
- [x] A selection persists per session view and agent across reload. A stored selection the
      provider no longer lists shows and sends as Default. The parser bounds and drops malformed
      entries (`workspaceViews.test.ts`).
- [x] Sending uses the addressed agent's selection, and a handoff to another agent uses that agent's
      selection. In `e2e/canvas.spec.ts` the `/api/agent/message` request body carries the chosen
      `model` and `effort`, and has neither field under Default.
- [x] At 390×844 no item in the composer row overlaps another.

### All
- [x] `npm run lint`, `npm test`, and `npm run test:e2e` pass.
- [x] The architecture doc and README describe the choice, what Default means, and the update order
      for machines.

## Out of scope

- Showing or recording which model and effort answered a turn.
- A Default that moves a provider session that already ran back to the machine default. That would
  need an explicit default value, and Claude has none unless `CODEAI_CLAUDE_MODEL` is set.
- A choice that follows the agent across devices, which would need durable per-agent state and a
  session format change.
- A VR control. VR turns use this device's choice.
- Other provider settings: fast mode, service tier, reasoning summary, `[1m]` variants,
  `opusplan` / `best`, a model list configured by a setting, choosing a model when the Arena creates
  a session.
- Asking the Docker worker's own Codex for its model list.
- Where a new agent starts. Here it starts at Default. [Story 70](STORY-20260924-remember-turn-choices.md)
  starts it at this device's last choice for its provider and keeps a chosen Default as the agent's
  own.

## How to verify

1. `npm run lint && npm test && npm run test:e2e`.
2. Run `npm run dev`, then `curl -s localhost:3023/api/health | jq '.providers.claude, .providers.codex.models'`.
   Claude shows the four aliases. Codex shows this account's `model/list`, and each model lists its
   efforts.
3. Restart with `CODEAI_DEBUG_AGENT=1`. On a Claude agent choose **Sonnet · Low** and send an Ask.
   The spawn log shows `--model sonnet --effort low`. Switch to **Default** and send again. The log
   shows neither flag (or only the `CODEAI_CLAUDE_MODEL` value), and the answer still arrives.
4. On a Codex agent choose a non-default model and **High**, then send. The thread's rollout turn
   context (`~/.codex/sessions/…`) records that model and effort.
5. Change the choice for one agent, add a second agent, and address it. The control shows that
   agent's own choice. Reload, and both choices are still there.
6. With an attached executor, open one of its sessions. The control lists the executor's choices,
   and a turn with a chosen model runs there.

## What shipped

- **Wire.** `model` and `effort` are optional, shape-checked fields of the turn request
  ([protocol.ts](../src/shared/protocol.ts#L41)); the patterns and list bounds are in
  [limits.ts](../src/shared/limits.ts#L9). After the health check, the route answers 400 for an
  unlisted model or effort before any reservation, append, or runner
  ([route.ts](../src/app/api/agent/message/route.ts#L134)), using the shared rule in
  [modelChoices.ts](../src/shared/modelChoices.ts). An effort named without a model reads, for
  example, `Claude does not offer effort "high" for its default model on this machine.`
- **Claude.** The fixed aliases and efforts ([claudeInvocation.ts](../src/server/agents/claudeInvocation.ts#L49)),
  `--effort` appended after `--model` when named, and `CHOICE_CLAUDE_FLAGS` as the third flag class
  of the probe test ([claudeInvocation.ts](../src/server/agents/claudeInvocation.ts#L41)). Preflight
  reports `effortSupported` from the help text it already reads
  ([claudePreflight.ts](../src/server/agents/claudePreflight.ts#L52)). Default offers no effort when
  `CODEAI_CLAUDE_MODEL` names a Haiku model.
- **Codex.** `model/list` `{ includeHidden: false, limit: 50 }` is sent with the first readiness
  batch, rejection caught, but is not awaited with it; after readiness passes it gets at most 300 ms
  more ([codexPreflight.ts](../src/server/agents/codexPreflight.ts#L121)).
  `CODEAI_FAKE_CODEX_MODE=silent-model-list` proves a Codex that never answers stays available. The parser
  drops hidden, duplicate, and out-of-bounds entries and reads only the first page
  ([codexInvocation.ts](../src/server/agents/codexInvocation.ts#L112)). The runner sends
  `input.model ?? options.model` on `thread/*` and `turn/start`, and `effort` on `turn/start` only
  ([codexProcessRunner.ts](../src/server/agents/codexProcessRunner.ts#L497)).
- **Docker.** `dockerProviderHealth(config, engine, localCodex)` gives Docker Claude the fixed list
  with efforts (the pinned worker documents `--effort`) and Docker Codex the Local Codex `models` and
  `efforts` ([providerRegistry.ts](../src/server/agents/providerRegistry.ts)). The Docker adapter and
  the Docker settings route read Local Codex through `cachedLocalProviderHealth`, the 10 s cache
  moved there from `localExecutorSnapshot.ts`, so a Docker Claude turn runs no local check and a
  Docker Codex turn reuses a recent one.
- **Machines.** The snapshot schema accepts the two optional fields within bounds
  ([machineSchema.ts](../src/shared/machineSchema.ts#L13)). A remote session's control lists that
  executor's Local choices, which are also its Docker choices.
- **Browser.** `DeviceViewState.modelSelections` is keyed by agent participant id (UUIDs, like
  `addressedAgentId`) and bounded to the 16 newest well-formed entries
  ([workspaceViews.ts](../src/features/shell/workspaceViews.ts#L125)). `AppShell` shows and sends
  only what the provider lists ([AppShell.tsx](../src/features/shell/AppShell.tsx#L289)), and
  `send()` reads the turn agent's own selection, so a handoff or an Execute plan turn uses that
  agent's choice ([AppShell.tsx](../src/features/shell/AppShell.tsx#L1084)). The menu is
  `ModelMenu` in [InstructionComposer.tsx](../src/features/conversation/InstructionComposer.tsx#L17);
  it closes on Escape, on a press outside (`useMenuDismiss`, shared with the add-agent menu), and
  when a turn starts. Its panel spans the composer and opens above it
  ([globals.css](../src/app/globals.css#L326)). Effort labels: `low`, `medium`, `high`,
  `xhigh` ("Extra high"), and `max`; anything else, such as Codex's `minimal` or `ultra`, reads as
  sent ([toolActivity.ts](../src/features/agents/toolActivity.ts#L59)).
- **Fixtures.** `fake-claude.mjs` documents `--model` and `--effort`; `CODEAI_FAKE_HELP=no-effort`
  leaves out `--effort`. `fake-codex.mjs` answers `model/list` with one hidden and two visible
  models whose efforts differ; `CODEAI_FAKE_CODEX_MODE=no-model-list` answers "Method not found".
- **Docs.** [architecture.md](../docs/architecture.md), the README's **Model and effort**,
  configuration, and machine sections, and AGENTS.md (the "Now" line and the safety-boundary
  sentence, which named only the mode).

## Verification record

September 22, 2026, offline only; no real provider turn was run.

- `npm run lint`: passes.
- `npm test`: every file passes.
- `npm run test:e2e`: every test passes in installed Chrome, including
  `sends each agent's own model and effort, keeps them across a reload, and fits a phone`
  ([canvas.spec.ts](../e2e/canvas.spec.ts#L1110)).
- A production build started against the fake Claude and Codex lists the four Claude aliases and
  the fake Codex models on `/api/health`, and the same choices under `executions.docker`.
- After review fixes (Codex grace period, Docker choices and cache, Haiku Default, menu dismissal,
  newest-entry cap): `npm run lint` passes, `npm test` passes 76 files / 502 tests, and
  `npm run test:e2e` passes 77 of 77.
- Pending before **Shipped**: **How to verify** steps 2–6 against the real Claude Code and Codex
  CLIs, including an attached executor.
