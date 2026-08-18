# Story 20 — Add Codex as a safe first-class web2 provider

**Status:** Shipped · **Type:** Full-stack ·
**Depends on:** [Story 19](STORY-20260806-web2-conversation-modes.md) ·
**Epic:** [web2 operational collaboration](EPIC-20260806-web2-operational-collaboration.md)

---

## Motivation

`web2` can currently run one local Claude Code agent. The next useful boundary is not two
agents talking at once; it is proving that the conversation, mode, permission, and canvas
contracts genuinely work with a second provider.

Codex should be available through the user's existing Codex CLI login, with no platform API
key owned by Cartograph. It must feel like the same product: the user chooses a provider when
creating a conversation, Ask and Plan stay read-only, Agent asks before side effects, streamed
activity and cancellation work, and the provider session survives later turns.

This foundation deliberately ships before multi-agent roles. A safe, well-tested Codex adapter
is independently useful and removes provider-protocol risk from
[Story 23](STORY-20260817-web2-multi-agent-roles.md).

## Implementation (where the code is)

- Provider, health, adapter, and separate provider-session contracts live in
  [web2/lib/shared/types.ts](../web2/lib/shared/types.ts#L43). The v2 atomic registry persists
  them and migrates v1 Claude state in
  [threadRegistry.ts](../web2/lib/server/threadRegistry.ts#L64).
- Strict browser requests require a provider only when creating a thread and reject it on a
  message turn: [protocol.ts](../web2/lib/shared/protocol.ts#L43). The message route resolves the
  immutable server-side provider through the registry:
  [POST /api/agent/message](../web2/app/api/agent/message/route.ts#L42).
- Claude and Codex implement the common registry in
  [providerRegistry.ts](../web2/lib/server/providerRegistry.ts#L38); per-provider readiness is
  additive in [GET /api/health](../web2/app/api/health/route.ts#L40).
- The Codex stdio handshake, thread start/resume, bounded streaming, activity, one-shot approvals,
  and interrupt flow are in
  [codexProcessRunner.ts](../web2/lib/server/codexProcessRunner.ts#L95). Server-owned configuration,
  read-only/no-network modes, per-thread MCP disabling, and effective-policy validation are in
  [codexInvocation.ts](../web2/lib/server/codexInvocation.ts#L9).
- Provider selection, capability-aware modes, provider status, and immutable browser persistence
  are implemented in [AppShell.tsx](../web2/components/AppShell.tsx#L77),
  [ThreadPicker.tsx](../web2/components/ThreadPicker.tsx#L7), and
  [conversationStore.ts](../web2/lib/client/conversationStore.ts#L77).
- Offline App Server coverage, including ignored-isolation overrides, approvals, timeout, interrupt,
  malformed streams, and resume, is anchored in
  [codexProcessRunner.test.ts](../web2/test/codexProcessRunner.test.ts#L45) and its
  [fake Codex fixture](../web2/test/fixtures/fake-codex.mjs#L1).

## Desired behavior

### 1. Provider is a thread property; Cartograph thread is not a provider session

The user chooses **Claude** or **Codex** when creating a conversation. That choice is immutable
for Story 20 and visible in the thread UI and export. Existing persisted conversations migrate
to Claude without losing messages or canvas state.

The server assigns its own Cartograph thread id and stores a separate provider session id once
the provider starts one. A missing provider session follows Story 18's existing recovery UX;
it never causes Cartograph to reinterpret its own thread id as a provider id.

The minimal contract for this story is intentionally single-agent:

```ts
export type AgentProvider = 'claude' | 'codex';

export interface ProviderSessionRef {
  provider: AgentProvider;
  sessionId?: string;
  started: boolean;
}

export interface ServerThread {
  id: string;                 // Cartograph-owned
  projectId: string;
  createdAt: string;
  updatedAt: string;
  agent: ProviderSessionRef;  // provider-owned session identity
}

export interface ChatThread {
  // existing fields
  provider?: AgentProvider;   // absent in v1 localStorage means 'claude'
}
```

Story 23 replaces the single `agent` reference with participants and authored messages; Story
20 must not add addressing, relay, or role-prompt behavior early.

### 2. Formal provider adapter and capability contract

Keep `AgentProcessRunner` as the per-turn execution seam, and add a provider registry/factory
that owns runner creation, preflight, provider policy mapping, and capabilities. The message
route resolves the adapter from the server thread; the browser cannot select a different
provider or send executable paths, flags, sandbox settings, or approval policies per message.

Provider health is additive rather than global:

```ts
export interface ProviderHealth {
  available: boolean;
  authenticated: boolean | 'unknown';
  supportedModes: AgentMode[];
  message?: string;
}

export interface AgentProviderAdapter {
  readonly id: AgentProvider;
  checkHealth(): Promise<ProviderHealth>;
  createRunner(): AgentProcessRunner;
}
```

`GET /api/health` returns health per provider. The app remains usable when one provider is
missing, and disables only that provider or its unsupported modes. Claude remains the default
for old data and keeps its current behavior.

### 3. Codex uses App Server over local stdio

Use `codex app-server` with its default newline-delimited stdio transport, not `codex exec` and
not the experimental WebSocket transport. App Server is the Codex protocol intended for rich
clients that need authentication, conversation history, approvals, and streamed agent events.
See the official [Codex App Server documentation](https://learn.chatgpt.com/docs/app-server).

For v1, spawn one App Server child for each active Cartograph turn. The adapter:

1. sends `initialize` and `initialized` with Cartograph client metadata;
2. calls `thread/start` or `thread/resume`, storing the returned Codex thread id;
3. calls `turn/start` with the prompt, project `cwd`, model override, sandbox, and approval
   policy resolved by the server;
4. maps `item/agentMessage/delta`, item lifecycle notifications, and `turn/completed` into the
   existing `AgentProcessEvent` contract;
5. maps supported approval server requests through the existing `PermissionBroker`;
6. sends `turn/interrupt` on explicit cancellation, waits for the interrupted terminal state,
   then closes the child; and
7. treats premature exit, malformed/oversized JSONL, protocol errors, missing sessions,
   unauthenticated state, and timeouts as the existing public `AgentErrorCode` categories.

The parser is strict about required fields but ignores unknown notification methods and extra
fields so a minor Codex upgrade does not break every run. Implementation should generate the
version-matched TypeScript or JSON schemas (`codex app-server generate-ts` or
`generate-json-schema`) as a development/reference step; generated output is checked in only
if the implementation actually imports it.

### 4. Mode and approval parity is a release gate

| Mode | Codex sandbox | Approval behavior | Ship gate |
|---|---|---|---|
| Ask | read-only | no user prompts; network off | required |
| Plan | read-only | no user prompts; network off | required |
| Agent | least privilege that can request escalation | every side effect reaches Cartograph before it happens | conditional |

Ask and Plan use the same server-generated prompt, repository snapshot, attachment manifest,
and response/artifact validation as Claude. A denial is model-visible and does not end the run.
Only one-turn `accept` and `decline` decisions ship; `acceptForSession`, exec-policy amendments,
and persistent grants remain disabled.

Codex Agent mode is advertised only after a real integration test proves all of the following:

- safe repository reads proceed without a card;
- a proposed file write produces a Cartograph permission card before the working tree changes;
- unsafe commands and network escalation produce sanitized, correctly scoped cards;
- denial/cancellation leaves the denied side effect unapplied; and
- approval applies only the displayed request and the run continues.

If the installed App Server cannot satisfy that contract, Codex ships with Ask and Plan only;
the UI reports Agent as unsupported. Silent `workspaceWrite` is not an acceptable fallback.

### 5. Ambient Codex customization fails closed

Cartograph reuses the user's official Codex authentication, but does not implicitly grant every
capability configured in their terminal. The adapter applies server-owned overrides that
disable MCP servers, apps/connectors, plugins, skills, hooks, web search, subagents, and custom
commands unless a later story deliberately adds one. It records and validates effective
instruction/configuration sources during preflight; unexpected executable integrations make
the affected modes unavailable with an actionable error.

No token, cookie, API key, or auth file is copied into Cartograph storage or sent to the
browser. If authentication cannot be reused while the capability surface is isolated, Codex is
reported unavailable rather than weakening the safety boundary.

### 6. Images, activity, and copy stay provider-neutral

The composite canvas PNG is sent as a Codex local-image input while the existing prompt still
names the bounded manifest, Mermaid/vector sources, and repository snapshot. Temporary
attachment directories remain readable but are not writable by Ask/Plan.

Command, file-change, reasoning, and other useful App Server item events map to today's bounded
tool-activity/status UI. Absolute paths, raw provider request ids, credentials, and unbounded
command output never reach the browser. User-facing copy says the selected local provider and
does not promise Claude-specific behavior for Codex.

## Acceptance criteria

- [x] `AgentProvider`, provider-session, provider-health, and thread-create contracts are
  server-owned and validated; the browser cannot override a thread's provider during a turn.
- [x] Existing server-registry and localStorage threads migrate to Claude with their ids,
  messages, canvases, modes, and provider-session continuity preserved.
- [x] New-conversation UI offers only healthy providers, records the immutable choice, and
  displays it in the conversation and export.
- [x] Claude runs through the provider registry with no regression in Ask, Plan, Agent,
  approvals, cancellation, reload reattachment, or missing-session recovery.
- [x] Codex App Server communicates only over a spawned local stdio child; no listener port is
  opened and `codex exec` is not used for web2 conversations.
- [x] Codex Ask and Plan stream text/activity, produce validated Mermaid artifacts, accept the
  same canvas attachments, remain read-only with network disabled, and resume the stored Codex
  thread on a later message and after a browser/server reload.
- [x] Codex approval requests are correlated to the active Cartograph run/thread/turn, sanitized,
  routed through `PermissionBroker`, resolved exactly once, and auto-denied on timeout/cancel.
- [x] Codex Agent is enabled only if the approval-parity test above passes; otherwise only Codex
  Ask/Plan are exposed with an actionable reason.
- [x] Explicit cancellation sends `turn/interrupt`, reaches a terminal interrupted state, clears
  pending approvals, and leaves no orphan App Server process.
- [x] Provider preflight distinguishes missing binary, unauthenticated login, incompatible
  protocol/capabilities, and unsupported modes without making a healthy provider unusable.
- [x] Ambient MCP/apps/plugins/skills/hooks/web search/subagents/custom commands are disabled or
  detected fail-closed, while Codex auth is reused without Cartograph copying or persisting
  credentials.
- [x] Unknown App Server notifications and additive fields are tolerated; malformed, oversized,
  or incomplete protocol messages produce bounded existing error events.
- [x] Offline fake-App-Server tests cover initialize, start, resume, streaming, activity,
  approvals, denial, timeout, interrupt, crash, malformed JSONL, and missing session.
- [x] README/config docs explain provider selection, `CODEAI_WEB2_CODEX_BIN`, optional model
  configuration, login ownership, capability isolation, and mode availability.
- [x] `cd web2 && yarn test`, `yarn lint`, and `yarn build` pass.
- [x] A real authenticated Codex CLI smoke run records Ask → Plan → later resume; Agent is
  recorded too only if its permission gate passes.

## Out of scope

- Multiple agents or humans in one conversation, authored transcript deltas, roles, addressing,
  and relay — [Story 23](STORY-20260817-web2-multi-agent-roles.md).
- Provider API keys, Cartograph-managed billing, or remote execution.
- Codex WebSocket transport, a persistent shared App Server daemon, or exposing App Server on a
  network interface.
- Persistent approval grants, `acceptForSession`, or browser-authored sandbox/config overrides.
- Codex-specific features such as native review mode, goals, skills, MCP, plugins, apps, web
  search, subagents, and dynamic tools.

## How to verify

1. Run `cd web2 && yarn test`, `yarn lint`, and `yarn build` with the fake Claude and Codex
   fixtures; run the no-orphan child-process assertion after cancellation and timeout cases.
2. Start web2 with an authenticated `codex` CLI. Send an Ask message with a canvas attachment;
   confirm the local image reaches Codex, text streams, the Mermaid diagram validates, and the
   artifact records the attached canvas as its parent. Claude registry behavior remains covered
   by the existing full fake-CLI regression suite.
3. In Codex Plan, request a plan, restart the page/server, then send a follow-up; confirm the
   stored Codex thread resumes and the working tree remains unchanged. The shipped smoke used
   Codex CLI `0.147.0` and the default `gpt-5.6-sol` model.
4. If Codex Agent is advertised, request one file edit: verify the tree is unchanged before the
   card, denial changes nothing, approval applies only that request, cancellation interrupts the
   turn, and no App Server child remains.
5. Enable a disposable ambient MCP/plugin/skill configuration and confirm preflight disables or
   rejects it while no raw configuration or credential reaches the browser.

---
