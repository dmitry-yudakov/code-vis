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
   │  paired HTTPS + HttpOnly device credential (remote mode)
   │  fetch / NDJSON stream
   ▼
device authorization at every route handler (src/server/devices)
   │
   ▼
route domain operations (src/app/api/**)
   │
   ├── src/server/repository   checkout discovery, fixed read-only git reads, bounded context files
   ├── src/server/storage      durable projects/sessions, writer lock, per-run temp attachments
   ├── src/server/runs         bounded scheduler, checkout locks, run registry, permission brokers
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
| Projects, session membership, repository bindings | Host store |
| Arena session summaries and run attention | Derived server snapshots |
| Arena finished-item read markers | Versioned browser device state |
| Checkout discovery and opaque checkout ids | Server |
| Provider executable, tool list, allowlist, sandbox, model flags | Server |
| Mode selection (`ask` / `plan` / `agent`) | Browser names it, server resolves it |
| Pairing challenges and device credential digests | Separate host device-auth record |

The browser can name a supported mode and nothing else. An unknown or unsupported mode is a 400.
This is why the client never sends flags, prompts-with-tools, or paths outside the selected
repository: every one of those is derived server-side from `src/server/config.ts` plus the resolved
policy in `src/server/agents/agentPolicy.ts`.

## Browser snapshots and device state

The public client routes share `src/app/(shell)/layout.tsx`, which owns one persistent `AppShell`
across client transitions. The shell derives its top-level destination from the pathname: `/` is
the focused workspace, `/arena` is Active, `/arena/inbox` is Inbox, and `/arena/archived` is the
recoverable archive. Those URLs own navigation and browser history only; project selection, open
session views, drafts, panels, and canvases remain device state and survive route transitions.

`src/features/conversation/sessionStore.ts` contains pure snapshot/canvas/export helpers. It
does not persist conversation content. `AppShell` lists snapshots by project (or **No project**) with
`GET /api/sessions`, hydrates one complete snapshot with `GET /api/sessions/[sessionId]`, and sends
annotation, sketch, pin, roster, and main-agent operations to dedicated routes. Stale overwrite
revisions return 409 and trigger a refetch instead of silently replacing another client's work.

The Arena polls one bounded `GET /api/arena` projection across all projects. It carries separate
active and archived card summaries, safe pending-permission details, and brief terminal run
outcomes, never full transcripts or private provider-session handles. The browser derives card and
Inbox presentation from that snapshot, keeps the last good response on refresh failure, and stores
only bounded finished-item read ids under `code-ai:device:v1:arena`. Live permission obligations
cannot be dismissed locally. Revisioned archive/restore routes reject every live run reservation,
including the pre-activation interval hidden from normal discovery.

The selected checkout preference uses `code-ai:device:v1:active-checkout`; focus, next recipient,
mode, panels, viewport, and drafts remain React state. Legacy `code-ai:web2:v1:*` conversation keys
are untouched and unread.

In paired mode, `DeviceAccessGate` checks the bounded `/api/auth/status` bootstrap route before it
mounts `AppShell`, preventing catalog and Arena polls from starting on an unpaired browser. The
credential itself is a host-only HttpOnly cookie and therefore is neither browser device state nor
available to client JavaScript. An authenticated header menu lists public device summaries and can
revoke a device or sign out the current one.

Export (`codeai-<session>.json`) includes the roster and per-entry author/provider/role metadata
plus diagram and mark state — never provider session ids, credentials, or server paths.

## Personal-device trust boundary

`local` remains the default access mode. `paired` requires an exact HTTPS public origin and the
dedicated `start:remote` custom server, which terminates TLS, rejects another Host, and stamps every
request with a process-random internal transport marker. Thus accidentally running ordinary
`next start` with paired configuration fails closed instead of treating HTTP as remote transport.
Mutation routes additionally require the browser `Origin` to equal the configured public origin.

`src/server/devices/deviceAuthStore.ts` owns `CODEAI_DATA_DIR/device-auth-v1.json`, independently of
canonical project/session records. `device:pair` writes one salted digest for an 80-bit,
ten-minute, single-use challenge. A successful exchange consumes it and creates a one-year opaque
device credential; the record stores only the device id/label, timestamps, salt, and digest. The
file is atomically replaced as `0600`, the data directory is `0700`, failed guesses are bounded,
and malformed state fails closed. The one personal owner has one authorization scope.

Every private route handler calls the same durable authorization check before parsing request data
or touching repositories, sessions, providers, or the run registry. This includes read snapshots,
NDJSON reattachment, new turns, cancellations, and permission decisions. Only bounded auth status
and pairing-code exchange are unauthenticated; neither returns challenges, cookies, or digests.

## Host-owned session store

`src/server/storage/sessionStore.ts` owns `CODEAI_DATA_DIR/session-store-v2` (the data-dir
default remains `~/.code-ai/web2`):

```text
session-store-v2/
  manifest.json       # version + durable host id/label
  writer.lock         # owner token, pid, hostname, heartbeat
  projects/<uuid>.json # one durable project per file
  sessions/<uuid>.json # one complete private session per file
  archived-sessions/<uuid>.json # one recoverable archived session per file
```

The store opens lazily. A live lock excludes a second process; stale takeover uses an owner token
so the old process cannot remove its successor's lock. The process-wide instance and mutation
queue are pinned on `globalThis`, because Next route handlers are compiled into separate bundles.
Every session write flushes a same-directory temporary file before atomic rename. Archive and
restore first persist their lifecycle marker, then atomically rename the record between sibling
directories; startup finishes a transition interrupted between those steps. Store directories are
`0700`; manifest, lock, and session files are `0600`.

Each project and session has a monotonic revision. A project contains its repository bindings; a
session contains an optional project id, its independent repository bindings, participants,
messages, canvases, annotations, pins, private provider sessions, and cursors. Public snapshots
strip session ids, host-bound session state, cursors, and idempotency keys. Missing/corrupt store
identity fails closed; the whole `session-store-v2` directory is the backup/restore unit. A valid
`session-store-v1` is copied forward once and then ignored; it is never modified (a direct
`conversation-store-v1` upgrade also remains supported). Older
`threads.json` and browser records are not imported or modified.

## The streamed agent route

`POST /api/agent/message` is the one turn-executing endpoint.

1. Validate the request against `src/shared/protocol.ts`, load the canonical session, and
   resolve its participant, primary repository binding, host-bound session, and mode. The request
   contains neither a checkout id nor transcript.
2. Refuse unavailable/foreign/stale repository bindings and foreign-host sessions before provider
   spawn. Reserve the session, provider session, checkout access, and bounded queue position in
   `src/server/runs/runRegistry.ts`; conflicts are 409 and queue overflow is 429 before persistence.
3. Append the user message idempotently, then activate its reservation. The machine executes up to
   `CODEAI_MAX_CONCURRENT_RUNS` eligible turns (default 2): Ask/Plan are checkout readers, Agent is
   an exclusive writer, and a waiting writer blocks later readers on that checkout without blocking
   eligible work elsewhere.
4. When the scheduler starts the turn, build the historical prompt delta from the current canonical
   record and a bounded per-run temporary directory outside the repository (`code-ai-run-*`) holding
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

`GET /api/agent/runs` discovers queued, running, needs-you, and recently finished descriptors.
`GET /api/agent/stream` reattaches a detached browser by run id; `POST /api/agent/cancel` ends
queued or executing work; `POST /api/agent/permission` resolves a pending approval card.

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
shell, in the selected repository checkout, with bounded output
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

- one queued or executing turn per session and per concrete provider session;
- a bounded in-memory queue and 1–8 execution slots on this machine; no durable process/queue
  recovery across a server restart;
- one Arena across the machine plus one selected project, with several device-local tabbed session
  views and one focused view;
- a session may be loose and may bind zero or several repositories; the repository sidebar follows
  a device-selected binding while turns continue to use the primary binding;
- paired personal devices see committed host content after refetch/reload, but there is no live
  multi-view synchronization or presence;
- Agent mode edits the real working tree: no worktree isolation, no apply/discard checkpoint;
- a capability restriction, not an OS or container boundary — the CLI runs as the desktop user.

The direction past the current shell — sessions spread across execution machines — is in
[vision.md](vision.md), with the record-level engineering
notes in [multi-project-session-environment.md](multi-project-session-environment.md) and the names
in [vocabulary.md](vocabulary.md).

## Configuration

`src/server/config.ts` resolves every setting as
`CODEAI_<NAME> ?? CODEAI_WEB2_<NAME> ?? default`, treating an empty assignment as unset on either
name. Validation runs on whichever raw value is selected, so an invalid neutral value fails rather
than falling back. See [.env.example](../.env.example) and the
[README](../README.md#configuration).
