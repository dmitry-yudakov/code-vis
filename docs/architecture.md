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
browser (src/features/**, server snapshots + device-only React state)
   │  fetch / NDJSON stream
   ▼
route handlers (src/app/api/**)
   │
   ├── src/server/projects     project discovery under CODEAI_PROJECTS_ROOT
   ├── src/server/repository   fixed read-only git reads, bounded context files
   ├── src/server/storage      host session store, writer lock, per-run temp attachments
   ├── src/server/runs         single active run + permission broker
   └── src/server/agents       provider policy → claude / codex app-server child
                                     │
                                     ▼
                          local agent CLI, user's own login
```

`src/shared/` holds everything that crosses the boundary — wire schemas, limits, participant
helpers, plan delimiters, and types. It must stay free of Node and DOM dependencies.

## Client/server split

The browser owns presentation and device selection. The server owns session content and
capability.

| Concern | Owner |
|---|---|
| Transcript, Mermaid artifacts, marks, pins, roster | Host session store |
| Focused canvas, next recipient/mode, panels, drafts | Browser memory |
| Provider session ids and transcript cursors | Private fields in the host store |
| Project discovery and the opaque project id | Server |
| Provider executable, tool list, allowlist, sandbox, model flags | Server |
| Mode selection (`ask` / `plan` / `agent`) | Browser names it, server resolves it |

The browser can name a supported mode and nothing else. An unknown or unsupported mode is a 400.
This is why the client never sends flags, prompts-with-tools, or paths outside the selected
project: every one of those is derived server-side from `src/server/config.ts` plus the resolved
policy in `src/server/agents/agentPolicy.ts`.

## Browser snapshots and device state

`src/features/conversation/sessionStore.ts` contains pure snapshot/canvas/export helpers. It
does not persist conversation content. `AppShell` lists snapshots by checkout with
`GET /api/sessions`, hydrates one complete snapshot with `GET /api/sessions/[sessionId]`, and sends
annotation, sketch, pin, roster, and main-agent operations to dedicated routes. Stale overwrite
revisions return 409 and trigger a refetch instead of silently replacing another client's work.

The selected checkout preference uses `code-ai:device:v1:active-checkout`; focus, next recipient,
mode, panels, viewport, and drafts remain React state. Legacy `code-ai:web2:v1:*` conversation keys
are untouched and unread.

Export (`codeai-<session>.json`) includes the roster and per-entry author/provider/role metadata
plus diagram and mark state — never provider session ids, credentials, or server paths.

## Host-owned session store

`src/server/storage/sessionStore.ts` owns `CODEAI_DATA_DIR/session-store-v1` (the data-dir
default remains `~/.code-ai/web2`):

```text
session-store-v1/
  manifest.json       # version + durable host id/label
  writer.lock         # owner token, pid, hostname, heartbeat
  sessions/<uuid>.json # one complete private session per file
```

The store opens lazily. A live lock excludes a second process; stale takeover uses an owner token
so the old process cannot remove its successor's lock. The process-wide instance and mutation
queue are pinned on `globalThis`, because Next route handlers are compiled into separate bundles.
Every session write flushes a same-directory temporary file before atomic rename. Store directories
are `0700`; manifest, lock, and session files are `0600`.

Each session has a monotonic revision and contains project attachments, participants,
messages, canvases, annotations, pins, private provider sessions, and cursors. Public snapshots
strip session ids, host-bound session state, cursors, and idempotency keys. Missing/corrupt store
identity fails closed; the whole `session-store-v1` directory is the backup/restore unit. A valid
`conversation-store-v1` is copied forward once and then ignored; it is never modified. Older
`threads.json` and browser records are not imported or modified.

## The streamed agent route

`POST /api/agent/message` is the one turn-executing endpoint.

1. Validate the request against `src/shared/protocol.ts`, load the canonical session, and
   resolve its participant, primary attachment, host-bound session, and mode. The request contains
   neither a project id nor transcript.
2. Refuse unavailable/foreign/stale attachments and foreign-host sessions before provider spawn,
   then refuse if a run is already active — `src/server/runs/runRegistry.ts` permits **one global
   active run**. This is a deliberate current constraint, not an oversight.
3. Append the user message idempotently, then build the historical prompt delta from the canonical
   host record.
4. Build a bounded per-run temporary directory outside the project (`code-ai-run-*`) holding
   diagram attachments plus git status/diff snapshots from `src/server/repository/`.
5. Compose the prompt in `src/server/conversation/prompt.ts`: mode contract, participant identity
   and role contract, the historical-context JSON delta, and the current request as one JSON
   value. Historical text is data, never framing.
6. Spawn the provider adapter (`claude` directly, `codex` as an `app-server` stdio child) and
   stream NDJSON events back to the browser: tool activity, text deltas, permission requests,
   and the result.
7. Parse the answer in `src/server/conversation/responseParser.ts` — Markdown plus zero or more
   fenced Mermaid blocks, validated by `src/features/diagram/mermaid/mermaidPolicy.ts`, plus
   evidence comments.
8. Commit the assistant message, user delivery state, and participant cursor in one revision before
   emitting the durable assistant event. Remove the temporary directory, always.

`GET /api/agent/stream` reattaches a detached browser to a live run; `POST /api/agent/cancel`
ends one; `POST /api/agent/permission` resolves a pending approval card.

**A run outlives the page that started it.** Closing the tab or reloading only detaches the
browser. Reopening the session replays activity, any pending approval, and the answer. A
finished run stays reattachable for five minutes.

## Permissions

In Agent mode every side effect raises a permission card. `src/server/runs/permissionBroker.ts`
correlates the provider's approval request to the active run/session/turn, sanitizes it, and waits
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
- one selected project and one selected session in the browser shell;
- the shell shows one checkout and one session, while the data model accepts zero or more host-scoped
  attachments; attachment management/rebind UI is not implemented;
- clients see committed host content after refetch/reload, but there is no live synchronization,
  presence, authentication, or remote-client authorization;
- Agent mode edits the real working tree: no worktree isolation, no apply/discard checkpoint;
- a capability restriction, not an OS or container boundary — the CLI runs as the desktop user.

The direction past the current shell — the arena, several open sessions, repository management, and
sessions spread across machines — is in [vision.md](vision.md), with the record-level engineering
notes in [multi-project-session-environment.md](multi-project-session-environment.md) and the names
in [vocabulary.md](vocabulary.md). None of it is implemented.

## Configuration

`src/server/config.ts` resolves every setting as
`CODEAI_<NAME> ?? CODEAI_WEB2_<NAME> ?? default`, treating an empty assignment as unset on either
name. Validation runs on whichever raw value is selected, so an invalid neutral value fails rather
than falling back. See [.env.example](../.env.example) and the
[README](../README.md#configuration).
