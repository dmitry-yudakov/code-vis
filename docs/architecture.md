# Architecture — CodeAI

**Scope:** the Next.js application at the repository root. The superseded Socket.IO analyzer,
React Flow client, and VS Code extension are archived and documented separately in
[legacy/docs/architecture.md](../legacy/docs/architecture.md); nothing here imports them.

---

## Shape

One private npm package, one Next.js 16 App Router application, no separate backend process.
Route handlers under `src/app/api/` are the only server surface; they spawn local agent CLIs as
child processes and read the selected repository with fixed git invocations.

```text
browser (src/features/**, localStorage)
   │  fetch / NDJSON stream
   ▼
route handlers (src/app/api/**)
   │
   ├── src/server/projects     project discovery under CODEAI_PROJECTS_ROOT
   ├── src/server/repository   fixed read-only git reads, bounded context files
   ├── src/server/storage      thread registry (~/.code-ai/web2), per-run temp attachments
   ├── src/server/runs         single active run + permission broker
   └── src/server/agents       provider policy → claude / codex app-server child
                                     │
                                     ▼
                          local agent CLI, user's own login
```

`src/shared/` holds everything that crosses the boundary — wire schemas, limits, participant
helpers, plan delimiters, and types. It must stay free of Node and DOM dependencies.

## Client/server split

The browser owns presentation **and** conversation content. The server owns capability.

| Concern | Owner |
|---|---|
| Transcript, Mermaid artifacts, marks, pins, selection | Browser `localStorage` |
| Thread identity, roster, provider session ids, transcript cursors | Server registry |
| Project discovery and the opaque project id | Server |
| Provider executable, tool list, allowlist, sandbox, model flags | Server |
| Mode selection (`ask` / `plan` / `agent`) | Browser names it, server resolves it |

The browser can name a supported mode and nothing else. An unknown or unsupported mode is a 400.
This is why the client never sends flags, prompts-with-tools, or paths outside the selected
project: every one of those is derived server-side from `src/server/config.ts` plus the resolved
policy in `src/server/agents/agentPolicy.ts`.

## Browser-local persistence

`src/features/conversation/conversationStore.ts` stores one revisioned blob per project under the
`code-ai:web2:v1:` key prefix — a compatibility identifier kept from the `web2` package name so
existing conversations keep loading. It holds threads, messages, participants, diagram artifacts
(Mermaid source), sketches, vector marks, viewport, pins, and the active selection.

- Multiple tabs merge by immutable participant/message id through `storage` events rather than
  overwriting one another's blob.
- One invalid thread retains its last valid copy; it does not block unrelated conversations.
- Conversations retain up to 2,000 messages; at that boundary the UI names the thread and offers
  recovery/export instead of failing opaquely.
- Composite PNGs, repository files, and diffs are never persisted.

Export (`codeai-<thread>.json`) includes the roster and per-entry author/provider/role metadata
plus diagram and mark state — never provider session ids, credentials, or server paths.

## Server-owned thread and provider session registry

`src/server/storage/threadRegistry.ts` keeps the minimal durable record under `CODEAI_DATA_DIR`
(default `~/.code-ai/web2`), written atomically with user-only permissions:

- thread identity and timestamps, permanently bound to one opaque project id;
- the participant roster and the main-agent pointer;
- each agent participant's **private** provider session id;
- per-participant transcript cursors.

A CodeAI thread id is never reinterpreted as a provider session id. Older single-provider records
migrate in place without changing ids, content, or provider sessions.

## The streamed agent route

`POST /api/agent/message` is the one turn-executing endpoint.

1. Validate the request against `src/shared/protocol.ts` and resolve the thread, participant, and
   mode.
2. Refuse if a run is already active — `src/server/runs/runRegistry.ts` permits **one global
   active run**. This is a deliberate current constraint, not an oversight.
3. Build a bounded per-run temporary directory outside the project (`code-ai-run-*`) holding
   diagram attachments plus git status/diff snapshots from `src/server/repository/`.
4. Compose the prompt in `src/server/conversation/prompt.ts`: mode contract, participant identity
   and role contract, the historical-context JSON delta, and the current request as one JSON
   value. Historical text is data, never framing.
5. Spawn the provider adapter (`claude` directly, `codex` as an `app-server` stdio child) and
   stream NDJSON events back to the browser: tool activity, text deltas, permission requests,
   and the result.
6. Parse the answer in `src/server/conversation/responseParser.ts` — Markdown plus zero or more
   fenced Mermaid blocks, validated by `src/features/diagram/mermaid/mermaidPolicy.ts`, plus
   evidence comments.
7. Remove the temporary directory, always.

`GET /api/agent/stream` reattaches a detached browser to a live run; `POST /api/agent/cancel`
ends one; `POST /api/agent/permission` resolves a pending approval card.

**A run outlives the page that started it.** Closing the tab or reloading only detaches the
browser. Reopening the conversation replays activity, any pending approval, and the answer. A
finished run stays reattachable for five minutes.

## Permissions

In Agent mode every side effect raises a permission card. `src/server/runs/permissionBroker.ts`
correlates the provider's approval request to the active run/thread/turn, sanitizes it, and waits
for one allow/deny decision. While a card is pending the run's timeout clock is paused. An
unanswered card is auto-denied after `CODEAI_APPROVAL_TIMEOUT_MS`. A denial is reported to the
model as a decision — the run continues. Cancelling resolves pending cards as denied before
terminating the child.

Ask and Plan never prompt: they run under a server-owned read-only profile plus a fixed git/gh
read allowlist. A command matching no rule is auto-denied and shown as a denial in the timeline.

## Repository access

`src/server/repository/gitRepository.ts` runs a fixed set of read-only git invocations without a
shell, in the selected project's directory, with bounded output
(`CODEAI_MAX_GIT_CONTEXT_BYTES`). It backs the repository sidebar (status, changed files, diffs)
and the per-run context snapshots. Agent mode's writes go through the provider's own tools under
approval, not through this module.

## Diagrams

Mermaid source is the canonical stored artifact. Diagrams are immutable: a revision is a new
artifact, never a patch. `mermaidPolicy.ts` normalizes and validates source on both sides of the
boundary (the browser before storing, the server before accepting); `mermaidRenderer.ts` is
browser-only and produces the SVG. Annotations are vector marks held beside the artifact in
`src/features/diagram/annotations/`, exported as a composite PNG only for attachment.

## Current constraints

These are real and deliberate, and they bound what can be built next:

- one active agent run across the whole application;
- one selected project and one selected thread in the browser shell;
- a thread is bound to exactly one project, and a project id is a hash of its local checkout path,
  so nothing is portable between machines;
- conversation content lives only in that browser's `localStorage` — no server-side transcript,
  no cross-device sync;
- Agent mode edits the real working tree: no worktree isolation, no apply/discard checkpoint;
- a capability restriction, not an OS or container boundary — the CLI runs as the desktop user.

The exploratory direction past the first three — several open workspaces, threads with zero or many
projects, and sessions spread across machines — is recorded in
[multi-project-session-environment.md](multi-project-session-environment.md); it is not
implemented.

## Configuration

`src/server/config.ts` resolves every setting as
`CODEAI_<NAME> ?? CODEAI_WEB2_<NAME> ?? default`, treating an empty assignment as unset on either
name. Validation runs on whichever raw value is selected, so an invalid neutral value fails rather
than falling back. See [.env.example](../.env.example) and the
[README](../README.md#configuration).
