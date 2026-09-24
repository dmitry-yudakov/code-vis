# Story 70 — Remember the last mode, model, effort, and provider on this device

**Status:** In progress · **Type:** Frontend-only ·
**Depends on:** [Story 66](STORY-20260922-select-model-and-effort.md) (model and effort choices),
[Story 19](STORY-20260806-web2-conversation-modes.md) (modes)

**Vision context:** a maintenance slice for the **agent** of [vocabulary.md](../docs/vocabulary.md),
"a provider, a role, a mode". It changes where a new session or a new agent starts. It does not
change what a turn may name: the server still owns the choices (Story 66).

---

## Motivation

The user, September 24, 2026:

> pls make the choises of model (for certain provider), effort, mode (ask/plan/agent) and similar to
> be persistent - it's very annoying that they get lost every time

Today every choice belongs to one session view or one agent:

- A mode is kept for the session where it was chosen. Every new session starts at **Ask**.
- A model and effort are kept for the agent they were chosen for. Every new agent starts at
  **Default**, and so does the new session that **Continue in Docker/Local** creates.
- The provider for a new session starts at Claude on every load. The Arena's form starts at the
  first available provider and the first supported mode.

A person who always works in Agent mode on Opus · High has to choose all three again for each
session and for each agent.

---

## Current behavior (where the code is)

- Mode: `storedMode = session?.defaultMode || 'ask'`, where `defaultMode` comes from this
  session's device view:
  [AppShell.tsx:319](../src/features/shell/AppShell.tsx#L319) (~line 319). `setMode` writes only the
  session: [AppShell.tsx:902](../src/features/shell/AppShell.tsx#L902) (~line 902). VR's mode
  buttons call the same `setMode`.
- Model and effort: the displayed selection is `view.modelSelections[agent.id]`
  ([AppShell.tsx:324](../src/features/shell/AppShell.tsx#L324), ~line 324) and the sent one is the
  turn agent's own ([AppShell.tsx:1163](../src/features/shell/AppShell.tsx#L1163), ~line 1163).
  `setModelSelection` deletes the agent's entry when the choice is Default
  ([AppShell.tsx:908](../src/features/shell/AppShell.tsx#L908), ~line 908), and the parser drops an
  empty entry ([workspaceViews.ts:125](../src/features/shell/workspaceViews.ts#L125), ~line 125).
- New-session provider: `useState<AgentProvider>('claude')`
  ([AppShell.tsx:134](../src/features/shell/AppShell.tsx#L134), ~line 134), shown by
  [SessionPicker.tsx:31](../src/features/conversation/SessionPicker.tsx#L31) (~line 31).
- Arena form: `provider` and `mode` start at the first available and supported values
  ([Arena.tsx:118](../src/features/arena/Arena.tsx#L118), ~line 118). Its choice reaches
  `createSession` through [AppShell.tsx:2056](../src/features/shell/AppShell.tsx#L2056) (~line 2056).
- Other device state lives under `code-ai:device:v1:*` keys and is parsed defensively, for example
  [arenaModel.ts:5](../src/features/arena/arenaModel.ts#L5) and
  [useArena.ts:26](../src/features/arena/useArena.ts#L26).

---

## Desired behavior

This device remembers the **last choice** a person made, and anything that has no choice of its own
starts from it. A session's or an agent's own choice still wins, so sessions and agents that were
set up differently keep their settings.

### Concrete changes

1. **Device preferences.** A new key, `code-ai:device:v1:preferences`, holds
   `{ version: 1, mode?, provider?, models?: { claude?, codex? } }`. `src/features/shell/devicePreferences.ts`
   parses it defensively, keeping only a known mode, a known provider, and well-formed selections
   (the Story 66 patterns). `useDevicePreferences` loads it once and saves every change.
2. **Mode.** Choosing a mode in the composer or in VR records it for the session, as today, and as
   the device's last mode. A new session starts in the last mode, or Ask when there is none, and
   keeps it as its own, so a later choice in another session does not move it. A session with no
   mode on this device, such as one started on another device, shows the last mode. A Docker
   session never inherits Agent: Docker Agent edits without individual approvals, so that session
   starts in (or shows) Ask until Agent is chosen for it. A handoff's
   role-default mode stays that session's own and is not recorded, because the person did not
   choose it. The Ask fallback for a mode the provider cannot run is unchanged.
3. **Model and effort.** Choosing a model or effort records it for the agent, as today, and as the
   provider's last choice. A new agent, the first agent of a new session included, starts at its
   provider's last choice and keeps it as its own. An agent with no choice on this device follows
   the last choice. The composer and `send()` resolve the selection through one helper, so what is
   shown is what is sent.
   - Choosing **Default** is a choice of its own. It is stored for the agent as an empty selection,
     so a later choice for another agent does not change it. The workspace parser keeps an empty
     selection.
   - **Continue in Docker/Local** carries the current agent's stored choice, as it already carries
     the mode. It carries the stored choice rather than the one the current execution offers,
     because the other execution may list models this one does not.
   - Story 66's rule is unchanged: whatever the machine no longer lists is shown and sent as
     Default, and the server rejects anything else with 400.
4. **Provider for a new session.** The header's and the welcome screen's **New session with** start
   at the last provider chosen there, in the Arena, or in VR, when that provider is available.
5. **Arena and VR forms.** The Arena's **New session** form and VR's Session tools → New session
   (reached from Session tools or from the VR Arena) open at the last provider (when available) and
   the last mode (when that provider supports it). They record what a session was created with, and
   nothing when creation fails.
6. **Not remembered: execution.** Docker Agent edits the checkout without individual approvals, so
   Local stays the starting execution and Docker stays an explicit choice each time.

### Type contract

```ts
// src/features/shell/devicePreferences.ts
export const DEVICE_PREFERENCES_STORAGE_KEY = 'code-ai:device:v1:preferences';

/** The last choices made on this device. Anything without its own choice starts from these. */
export interface DevicePreferences {
  mode?: AgentMode;
  /** Provider for a new session. */
  provider?: AgentProvider;
  /** Model and effort for an agent of each provider. An empty selection is Default. */
  models?: Partial<Record<AgentProvider, ModelSelection>>;
}

// Workspace views: an empty `modelSelections[agentId]` now means "this agent chose Default".
```

---

## Acceptance criteria

- [x] The preferences parser keeps a known mode, a known provider, and well-formed model selections,
      including an empty one. It drops anything else, and it returns no preferences for malformed
      JSON, a wrong version, or a non-object (`devicePreferences.test.ts`).
- [x] An agent's own selection wins over the provider's last choice. An agent without one uses its
      provider's last choice, and an agent that chose Default stays on Default
      (`devicePreferences.test.ts`).
- [x] The workspace parser keeps an agent's empty selection, keeps a full roster's 32 choices, and
      still drops malformed ids and fields (`workspaceViews.test.ts`).
- [x] A New session form opens at the last provider only when the machine can run it, and at the
      last mode only when that provider supports it; otherwise at a mode it does
      (`devicePreferences.test.ts`). The e2e server offers only Claude, so the provider half is
      covered here and not in the browser.
- [x] Before any choice, a new session starts in Ask at Default and keeps both. After choices, a new
      session opens in the last mode with the provider's last model and effort, and sends them. A
      new agent in an existing session starts at its provider's last choice (`e2e/canvas.spec.ts`).
- [x] A session and an agent keep the choice they started with, or their own, after another session
      or agent changes the device's last choice, and choosing Default for an agent keeps it on
      Default, across a reload. A session with no mode on this device shows the last mode, and its
      agent the last model (`e2e/canvas.spec.ts`).
- [x] A Docker session never inherits Agent (`devicePreferences.test.ts`,
      `e2e/docker-execution.spec.ts`). **Continue in Docker/Local** carries the agent's own model
      through a Docker worker that lists none (`e2e/docker-execution.spec.ts`).
- [x] The Arena form opens at the last mode and records what it creates with (`e2e/canvas.spec.ts`).
      VR's launcher opens at the last mode from Session tools and from the VR Arena, and a failed
      creation records nothing (`e2e/immersive.spec.ts`).
- [x] Every rule above has a test that fails when the rule is removed (mutation runs; see the
      verification record).
- [x] `npm run lint`, `npm test`, and `npm run test:e2e` pass.
- [x] README and the architecture doc describe what is remembered, the order of precedence, and
      that execution is not remembered.

## Out of scope

- Remembering execution (Local or Docker); see concrete change 6.
- Carrying choices to another device. They stay device state, like every other `code-ai:device:v1:*`
  key.
- Remembering the machine, project, or repository in the Arena form, or the provider and role in
  the add-agent menu.

## How to verify

1. `npm run lint && npm test && npm run test:e2e`.
2. `npm run dev`. In a session, choose **Agent** and **Opus · High**. Create a new session from the
   header. It opens in Agent with Opus · High.
3. Add a reviewer agent. It starts at Opus · High. Choose **Default** for it, address the main
   agent, and choose **Sonnet · Low**. Address the reviewer again. It still shows Default.
4. Reload. Both sessions, both agents, and **New session with** keep their choices. Open the Arena's
   **New session** form. It starts at the last provider and mode, and at Local.

## What shipped

- **Preferences.** `code-ai:device:v1:preferences` and its defensive parser, `inheritedMode`,
  `agentModelSelection`, and `launchChoice` live in
  [devicePreferences.ts](../src/features/shell/devicePreferences.ts#L4). `useDevicePreferences`
  saves in the same turn as a change, like the device workspace
  ([useDevicePreferences.ts](../src/features/shell/useDevicePreferences.ts#L28)).
- **Mode.** A session without its own mode shows `inheritedMode(last mode, execution)`
  ([AppShell.tsx:324](../src/features/shell/AppShell.tsx#L324)). A new session is always created
  with a mode of its own: the requested one, else the inherited one
  ([AppShell.tsx:625](../src/features/shell/AppShell.tsx#L625)). `setMode` also records the last
  mode ([AppShell.tsx:919](../src/features/shell/AppShell.tsx#L919)).
- **Model and effort.** The composer and `send()` both resolve
  `offeredModelSelection(agentModelSelection(…))`
  ([AppShell.tsx:330](../src/features/shell/AppShell.tsx#L330),
  [AppShell.tsx:1190](../src/features/shell/AppShell.tsx#L1190)). `setModelSelection` stores Default
  as `{}` and records the provider's last choice
  ([AppShell.tsx:927](../src/features/shell/AppShell.tsx#L927)). The first agent of a new session
  and an added agent are pinned at creation
  ([AppShell.tsx:625](../src/features/shell/AppShell.tsx#L625),
  [AppShell.tsx:968](../src/features/shell/AppShell.tsx#L968)). Continue passes the agent's stored
  choice ([AppShell.tsx:672](../src/features/shell/AppShell.tsx#L672)). The per-view cap is the
  roster maximum, 32 ([workspaceViews.ts:12](../src/features/shell/workspaceViews.ts#L12)), and the
  parser keeps an empty selection
  ([workspaceViews.ts:130](../src/features/shell/workspaceViews.ts#L130)).
- **Provider.** `newProvider` is the stored last provider, and the creation forms fall back to an
  available one as before ([AppShell.tsx:138](../src/features/shell/AppShell.tsx#L138)). The two
  per-machine corrections of the old `newProvider` state are gone.
- **Forms.** The Arena's `openCreate` ([Arena.tsx:128](../src/features/arena/Arena.tsx#L128)) and
  VR's `startLauncher`, called from both ways into the launcher
  ([SessionTools.tsx:73](../src/features/shell/immersive/SessionTools.tsx#L73)), use `launchChoice`.
  Both create through `createChosenSession`, which records the provider and mode only after the
  session exists ([AppShell.tsx:657](../src/features/shell/AppShell.tsx#L657)).
- **Tests.** Unit: [devicePreferences.test.ts](../test/devicePreferences.test.ts) and
  [workspaceViews.test.ts](../test/workspaceViews.test.ts). Browser:
  [canvas.spec.ts:1326](../e2e/canvas.spec.ts#L1326),
  [docker-execution.spec.ts:240](../e2e/docker-execution.spec.ts#L240), and
  [immersive.spec.ts:2348](../e2e/immersive.spec.ts#L2348). The Story 66 test now expects a second
  agent to start at the provider's last choice. The concurrency test chooses Ask for its third
  session, which would otherwise start in Agent, the last mode it chose.
- **Docs.** README (modes, Model and effort, device records), the architecture doc, AGENTS.md's
  "Now" line, and a pointer from Story 66's out-of-scope list.

## Verification record

September 24, 2026, offline, against the fake Claude.

- `npm run lint` passes. `npm test` passes 88 files / 697 tests. `npm run test:e2e` passes 92 of 92
  in installed Chrome. It ran with `CODEAI_REMOTE_ACCESS=local`, because this checkout's
  `.env.local` turns on paired access and `next start` loads it for the e2e server.
- Mutation runs. Each run removed one rule, rebuilt, ran the test, and restored the file:
  - Unit: keeping an empty selection, the provider fallback, the preferred provider, the mode check,
    and the provider allowlist. All five were caught.
  - Browser: the session-mode pin, both model pins, both recordings from the composer, the Arena
    form's opening choice, the Arena's recording, both display fallbacks, the Docker Agent rule, the
    Ask pin before any choice, Continue's stored choice, recording only after success, and both VR
    launcher paths. All fifteen were caught.
- A review subagent's findings are fixed: the Docker Agent inheritance, the unpinned pre-choice
  session, recording before success, the fallback-stuck provider, the 16-entry cap, the same-turn
  save, and the test gaps. Not changed: the Arena form keeps Docker execution across Cancel within
  one visit, as it did before; that is the person's own choice from moments earlier.
- Pending before **Shipped**: How to verify steps 2–4 in the running app, including a Codex choice,
  since the e2e server has no Codex.

