# Story 26 — Loosen the thread↔project, host, and run bindings

**Status:** Draft · **Type:** Full-stack (server records + wire protocol; client edits are call-site
only) · **Depends on:** [Story 23](STORY-20260817-web2-multi-agent-roles.md) (participant model)

**Epic context:** [web2 operational collaboration](EPIC-20260806-web2-operational-collaboration.md) ·
Slice 2 of [the environment memo](../docs/multi-project-session-environment.md#possible-delivery-slices)

---

## Motivation

The durable records assume there is exactly one of everything: one project per conversation, one
machine, one running turn, one human. None of those hold for how the product is already used:

> it's pretty common for me to run agent sessions on my laptop, my desktop and sometimes cloud at
> the same time … it's not impossible that a certain work session involves several repos or no repo
> at all — could be just a brainstorming between few users and agents and discussing some concepts
> and drawing.

This story does **not** build any of that. It removes the assumptions from the persisted shapes and
the wire protocol while there is little data in the current shape, so that multi-project threads,
repository-free threads, a second host, and concurrent runs become UI and policy work later instead
of migrations. The behavior a user sees is unchanged when the story lands.

The governing rule from the memo: [durable records never assume
"here"](../docs/multi-project-session-environment.md#durable-records-never-assume-here) — no
host-local path inside an identity, no record that implicitly means "the local machine", no
process-global singleton standing in for state a second host would also have.

---

## Current behavior (where the code is)

- **Thread record:** [`ServerThread.projectId: string`](../src/shared/types.ts#L79) (~line 79) — one
  required project, part of the record's identity.
- **Registry file v3:** [threadRegistry.ts:58-72](../src/server/storage/threadRegistry.ts#L58-L72) —
  `validThread` requires `projectId` and **exactly one** human participant (line 70);
  [`create(projectId, …)`](../src/server/storage/threadRegistry.ts#L190) (~line 190).
- **Project-bound lookup:** [`get(id, projectId)`](../src/server/storage/threadRegistry.ts#L219)
  (~line 219) throws `Unknown project-bound thread`; `addAgent` and `setPrimaryAgent` repeat the
  paired `id && projectId` find ([lines 233](../src/server/storage/threadRegistry.ts#L233),
  [271](../src/server/storage/threadRegistry.ts#L271)).
- **Wire schemas:** `projectId` is required on `agentMessageRequestSchema`
  ([protocol.ts:55](../src/shared/protocol.ts#L55)), `createThreadRequestSchema`
  ([:74](../src/shared/protocol.ts#L74)), `addParticipantRequestSchema`
  ([:80](../src/shared/protocol.ts#L80)), `setPrimaryAgentRequestSchema`
  ([:87](../src/shared/protocol.ts#L87)), and as a query parameter on `GET …/participants`
  ([participants/route.ts:15](../src/app/api/threads/[threadId]/participants/route.ts#L15)).
- **Turn entry point:** [message/route.ts:37-38](../src/app/api/agent/message/route.ts#L37-L38) —
  resolves the project from the **client-supplied** id and looks the thread up by the same id.
  [participants/route.ts:53](../src/app/api/threads/[threadId]/participants/route.ts#L53) selects a
  404 by matching the literal error string.
- **Project id is a checkout path hash:**
  [projectRegistry.ts:30](../src/server/projects/projectRegistry.ts#L30) —
  `sha256(realPath).base64url.slice(0, 22)`, so the same repository on two machines has two ids.
- **Sessions carry no host:** [`ProviderSessionRef`](../src/shared/types.ts#L46) (~line 46) is
  `{ provider, started, sessionId? }`; nothing records which machine started the provider session.
- **One global run slot:** [runRegistry.ts:37-46](../src/server/runs/runRegistry.ts#L37-L46) — a
  single `active` record; `start()` returns false whenever anything is running.
- **Browser roster mirror:** [conversationStore.ts:82](../src/features/conversation/conversationStore.ts#L82)
  — `validRoster` also requires exactly one human. Browser threads are stored per project under
  `code-ai:web2:v1:<projectId>` ([:33](../src/features/conversation/conversationStore.ts#L33)).
- **Client call sites that send `projectId`:** [AppShell.tsx:158](../src/features/shell/AppShell.tsx#L158)
  (roster reconcile), [:270](../src/features/shell/AppShell.tsx#L270) (create thread),
  [:386](../src/features/shell/AppShell.tsx#L386) (add participant),
  [:413](../src/features/shell/AppShell.tsx#L413) (set primary agent),
  [:647](../src/features/shell/AppShell.tsx#L647) (send message).

---

## Desired behavior

A thread holds **zero or more project attachments**, each naming the host that provides the
checkout; the server resolves the project from the thread rather than from the client; provider
sessions and runs are keyed by things that stay meaningful when a second host exists; and neither
registry asserts that a thread has exactly one human.

### Concrete changes

**A. Attachments replace `projectId` on the thread record.**

1. Add `ProjectAttachment` to `src/shared/types.ts` and replace `ServerThread.projectId` with
   `attachments: ProjectAttachment[]` (ordered; at most one `role: 'primary'`; an empty array is
   valid).
2. Registry file `version: 3 → 4`. `read()` migrates v3 in memory the way it already migrates v1/v2:
   `projectId` becomes a single primary attachment `{ id: uuid, hostId, checkoutId: projectId,
   role: 'primary' }`. v1 and v2 keep working by chaining into the v3 → v4 step.
3. `create(input: { checkoutId?: string; provider; role? })` — omitting the checkout creates an
   attachment-free thread.
4. Add `primaryAttachment(thread): ProjectAttachment | undefined` beside `serverAgent()` as the one
   place that answers "which checkout does a turn run in".

**B. The project stops being part of thread identity.**

5. `get(id)` takes no project; the paired `id && projectId` finds in `addAgent` and `setPrimaryAgent`
   become `id` finds. The `Unknown project-bound thread` message becomes `Unknown thread`, and
   [participants/route.ts:53](../src/app/api/threads/[threadId]/participants/route.ts#L53) matches
   the new string.
6. `projectId` leaves `agentMessageRequestSchema`, `addParticipantRequestSchema`,
   `setPrimaryAgentRequestSchema`, and the `GET …/participants` query; it stays on
   `createThreadRequestSchema` as **optional** (the project to attach). The repository routes
   (`/api/repository/status`, `/api/repository/diff`) keep their `projectId` unchanged — they
   address a checkout, which is correct.
7. The message route resolves the thread first, then resolves the project from
   `primaryAttachment(thread).checkoutId`. `ProjectRegistry.resolve()` still runs, so the
   containment check under `projectsRoot` is unchanged — it now validates a stored value instead of
   a client-supplied one, which is strictly tighter.
8. `POST /api/threads` returns `attachments` and keeps `projectId` in its payload as the primary
   attachment's checkout id, so the browser store's per-project key keeps working untouched.

**C. Zero attachments is a valid thread, and cannot run a turn yet.**

9. A thread with no attachments persists, lists, and accepts participants. A turn addressed to it is
   rejected with 400 and a message naming the reason ("This conversation has no project attached; an
   agent turn needs a working directory."). Giving those threads a scratch working directory is the
   next story, not this one.

**D. Records name their host.**

10. New `src/server/storage/hostIdentity.ts`: reads or creates `host.json` in `config.dataDir`
    holding `{ version: 1, id: uuid, label }` (label defaults to `os.hostname()`, overridable by
    `CODEAI_HOST_LABEL` / `CODEAI_WEB2_HOST_LABEL` per the existing config convention), `0600` like
    the other data files, cached per data dir.
11. `ProviderSessionRef` gains `hostId`, stamped when a session starts and filled by the v3 → v4
    migration with the local host id. `ThreadRegistry` resolves the host identity lazily and
    internally, so `getThreadRegistry(dataDir)` keeps its signature and no route changes.
12. `hostId` on an attachment is the host that provides that checkout — the local host id for every
    attachment this story can create.

**E. Runs are keyed by agent session.**

13. `RunRegistry.active` becomes a `Map` keyed by `` `${threadId} ${participantId}` ``.
    `start()` takes `participantId` and refuses when (a) that session already has a live run, or
    (b) the number of live runs would exceed `MAX_CONCURRENT_RUNS = 1`. The user-visible "Another
    agent turn is already running." 409 is unchanged.
14. `record`, `subscribe`, `unsubscribe`, `decide`, `cancel`, and `finish` look runs up by `runId`
    (or by thread, for `subscribe`) across the map instead of touching one field. `current` becomes
    `currentRuns` returning the live list; `subscribe(threadId)` keeps its single-run-per-thread
    behavior, which the concurrency limit guarantees.

**F. More than one human is allowed to exist.**

15. `validThread` and the browser's `validRoster` require **at least** one human instead of exactly
    one. Nothing creates a second human; this only stops the validators from rejecting one when
    [Story 21](STORY-20260806-web2-team-environment.md) does.

### Type contract

```ts
// src/shared/types.ts — shared by browser and server
export interface ProjectAttachment {
  id: string;                       // uuid, stable for the life of the attachment
  hostId: string;                   // which machine provides this checkout
  checkoutId: string;               // today's path-hash project id — host-scoped, not portable
  role: 'primary' | 'reference';
}

export interface ProviderSessionRef {
  provider: AgentProvider;
  started: boolean;
  sessionId?: string;
  hostId?: string;                  // optional only for records written before this story
}

export interface ServerThread {
  id: string;
  attachments: ProjectAttachment[]; // 0..n; at most one 'primary'
  createdAt: string;
  updatedAt: string;
  participants: ServerParticipant[];
  primaryAgentId: string;
}
```

`ChatThread` (browser) keeps `projectId` and its per-project storage key in this story — see
[Out of scope](#out-of-scope). A future `projectKey` (portable repository identity) is deliberately
absent: `checkoutId` is named for what it actually is so that a portable key can be added beside it
without relabelling data.

---

## Acceptance criteria

- [ ] `ServerThread` carries `attachments: ProjectAttachment[]`; `projectId` no longer appears on the
  server thread record or in `src/server/storage/`.
- [ ] A v3 registry file migrates to v4 on read with each thread's `projectId` becoming one primary
  attachment stamped with the local host id, and v1/v2 files still migrate through to v4.
- [ ] `ThreadRegistry.get(id)`, `addAgent`, and `setPrimaryAgent` take no project id; no code path
  fails a lookup because a project does not match, and no error message says "project-bound thread".
- [ ] `POST /api/threads` accepts a request with no `projectId` and persists a thread with
  `attachments: []`; with a `projectId` it persists one primary attachment and the response still
  carries `projectId`.
- [ ] `POST /api/agent/message`, `POST/PATCH …/participants`, and `GET …/participants` no longer
  accept or require a project id, and the message route resolves the project from the thread's
  primary attachment through `ProjectRegistry.resolve()`.
- [ ] A turn addressed to an attachment-free thread is rejected with 400 and a message that names the
  missing working directory; no provider process is spawned.
- [ ] `host.json` is created once per data dir with mode `0600`, its label honours
  `CODEAI_HOST_LABEL` (and the `CODEAI_WEB2_` spelling), and a started provider session records the
  host id.
- [ ] `RunRegistry` keys live runs by `(threadId, participantId)`, still admits at most one at a
  time, and replay/permission/cancel/reattach behave exactly as before for a single run.
- [ ] Both roster validators accept a thread with two human participants and still reject one with
  none.
- [ ] New tests cover: v3 → v4 migration, an attachment-free thread's create/persist/reject-turn
  path, session host stamping, two-humans acceptance, and `RunRegistry` keyed start/finish including
  the second-session refusal.
- [ ] `npm run lint` (strict `tsc --noEmit`), `npm test`, and `npm run test:e2e` pass; existing
  tests in `test/threadRegistry.test.ts`, `test/participantRoutes.test.ts`,
  `test/multiAgentRoles.test.ts`, `test/agentModes.test.ts`, and `test/protocol.test.ts` are updated
  to the new shapes rather than deleted.
- [ ] No user-visible behavior change: the app still opens a project, creates a thread, runs a turn,
  streams, approves a permission, and shows the repository panel exactly as before.

## Out of scope

- **Browser storage rekeying.** `code-ai:web2:v1:<projectId>` and `ChatThread.projectId` stay as they
  are. The store must be rekeyed to an environment-scoped record exactly once, together with the
  `AppShell` multi-workspace rework (memo slice 3), or the migration is paid twice.
- **A working directory for attachment-free threads** — scratch dir, absent repository surfaces,
  prompt/context changes, and the tool policy that goes with having no repo. Next story.
- **Attachment management UI**, multi-attachment turns, and cross-host attachments (memo slice 4).
- **Portable project identity** (`projectKey`), project discovery outside one configured root.
- **A second host**: transport, pairing, authentication, remote streaming (memo slice 6).
- **Raising the concurrency limit** past one, and any per-host limit configuration (memo slice 5).
- **Multiple humans in practice** — identity, authorization, presence, server-owned transcript, and
  the billing/sandboxing shifts, all owned by [Story 21](STORY-20260806-web2-team-environment.md).
- Any weakening of capability boundaries. Mode policy, the permission broker, provider-side
  allowlists, and who may answer a permission request are untouched.

## How to verify

1. `npm run lint && npm test && npm run test:e2e` — all green.
2. **Migration on real data:** back up `~/.code-ai/web2/threads.json`, confirm it is `version: 3`,
   start `npm run dev`, open an existing conversation, send a turn. The thread answers normally; the
   file is `version: 4` with one primary attachment per thread and a `hostId` on every started
   session. `host.json` exists beside it with mode `0600`.
3. **Attachment-free thread (API only, no UI yet):**
   `curl -sX POST localhost:3023/api/threads -H 'content-type: application/json' -d '{"provider":"claude"}'`
   returns 201 with `attachments: []`; posting a message to that thread id returns 400 naming the
   missing working directory, and no `claude`/`codex` process starts.
4. **Unchanged product loop:** pick a project, create a thread, ask a question, approve one Agent-mode
   permission, cancel a turn mid-flight, reload the browser mid-run and confirm the run reattaches,
   open the repository panel and a diff.
5. **Concurrency unchanged:** start a turn, then send a second one from another tab — the second is
   refused with "Another agent turn is already running." exactly as today.
