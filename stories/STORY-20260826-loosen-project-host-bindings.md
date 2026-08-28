# Story 26 — Move conversations to host-owned JSON and loosen project bindings

**Status:** Shipped · **Type:** Full-stack (durable store + protocol + browser hydration) ·
**Depends on:** [Story 23](STORY-20260817-web2-multi-agent-roles.md) (participant model)

**Epic context:** [web2 operational collaboration](EPIC-20260806-web2-operational-collaboration.md) ·
Slice 2 of [the environment memo](../docs/multi-project-session-environment.md#possible-delivery-slices)

---

## Motivation

Before this story, the browser owned the conversation. Messages, diagrams, sketches, annotations,
pins, and selection lived in revisioned `localStorage`; the host stored only a small
thread/participant record needed to resume provider sessions. That was a useful prototype boundary
and the wrong durable boundary for the intended product:

> it's pretty common for me to run agent sessions on my laptop, my desktop and sometimes cloud at
> the same time … it's not impossible that a certain work session involves several repos or no repo
> at all — could be just a brainstorming between few users and agents and discussing some concepts
> and drawing.

Several clients using one host must see the same conversations, and clearing one browser must not
erase them. A local/on-premises installation can meet that need with plain JSON on the host. A
future hosted installation may put the same domain operations behind a cloud database; the browser
must not become authoritative again.

This is a deliberate clean cutoff. Existing `threads.json` and `code-ai:web2:v1:*` browser records
are development data: CodeAI does not import, rewrite, or delete them. The new store starts empty.
There is no temporary browser v2 conversation namespace and no compatibility migration.

This story also adopts the final near-term thread shape while the store is new: zero-or-more
host-scoped project attachments, host-bound provider sessions, and at-least-one rather than
exactly-one human. Run-registry rekeying is split into
[Story 27](STORY-20260826-session-keyed-host-bound-runs.md) so persistence and live-process lifetime
do not land as one oversized change.

---

## Shipped behavior (where the code is)

- **Canonical host store:** [conversationStore.ts](../src/server/storage/conversationStore.ts#L179)
  owns complete per-thread JSON, atomic writes, the writer lock, host identity, revisions,
  idempotent domain operations, and the process-wide store/queue map.
- **Strict records:** [conversationSchema.ts](../src/shared/conversationSchema.ts#L288) validates the
  private durable record and public snapshot, including attachments, host-bound sessions, authored
  messages, canvases, annotations, pins, cursors, and the at-least-one-human roster rule.
- **Host hydration and operations:** [threads/route.ts](../src/app/api/threads/route.ts#L12) lists and
  creates conversations; [thread/route.ts](../src/app/api/threads/%5BthreadId%5D/route.ts#L11)
  returns one snapshot; the adjacent participant, annotation, sketch, and pin routes expose bounded
  domain mutations rather than whole-record replacement.
- **Browser composition:** [AppShell.tsx](../src/features/shell/AppShell.tsx#L121) applies public host
  snapshots and serializes revisioned operations; [conversationStore.ts](../src/features/conversation/conversationStore.ts#L42)
  contains only hydration/export helpers and the device checkout preference, with no conversation
  `localStorage` persistence.
- **Canonical turns:** [message/route.ts](../src/app/api/agent/message/route.ts#L21) resolves the
  primary attachment, rejects unavailable hosts/checkouts/sessions before spawn, idempotently
  appends the user turn, and derives context from [transcript.ts](../src/server/conversation/transcript.ts#L87).
  [conversationService.ts](../src/server/conversation/conversationService.ts#L17) commits the
  assistant message, delivery state, and participant cursor before emitting durable completion.
- **Host configuration:** [config.ts](../src/server/config.ts#L94) resolves the neutral and legacy
  host-label settings, while the manifest preserves the label selected at first store creation.
- **Checkout identity remains scoped:** [projectRegistry.ts](../src/server/projects/projectRegistry.ts#L30)
  still hashes the checkout's real path. Attachments name that host-scoped checkout id; they do not
  claim it is a portable repository identity.

---

## Desired behavior

### A. One canonical JSON conversation per thread

1. Replace `ThreadRegistry` and browser conversation persistence with a server-owned
   `ConversationStore` rooted at:

   ```text
   <dataDir>/conversation-store-v1/
     manifest.json
     writer.lock
     threads/
       <thread-id>.json
   ```

   `manifest.json` holds `{ version: 1, host: { id: uuid, label } }`. Each thread file holds one
   complete durable conversation and has its own `version` and monotonically increasing `revision`.
   Listing scans the bounded `threads/` directory; there is no second index whose update could tear
   away from a thread write.
2. The store is abstracted behind domain operations such as `listConversations`, `getConversation`,
   `createConversation`, `appendUserMessage`, `completeAssistantMessage`, `addAgent`,
   `setPrimaryAgent`, `putAnnotation`, `createSketch`, and `setPins`. Routes and conversation
   services do not know filenames. A future database backend implements these operations rather
   than emulating browser blob replacement.
3. The browser never sends or replaces a whole conversation. Strict operation schemas append or
   mutate server-owned fields; every accepted mutation increments `revision`. Operations that can
   overwrite the same logical value carry `expectedRevision` and return 409 on a stale revision.
   Append/idempotent operations use stable request ids so retries cannot duplicate messages,
   participants, or sketches.
4. Each thread write uses a same-directory temporary file, flushes it before atomic rename, and
   leaves the final file mode `0600`; store directories are `0700`. A failed write leaves either the
   prior valid revision or the complete new revision, never a partial JSON document.
5. The old `threads.json` and every `code-ai:web2:v1:*` key remain untouched and unread. Tests that
   exist only to prove v1/v2/v3 or browser-thread migration are intentionally retired and replaced
   by fresh-store, invalid-store, durability, and retry-idempotency coverage.

### B. One writer process, serialized mutations

6. The filesystem backend acquires `writer.lock` lazily when runtime storage first opens, not during
   module import or `next build`. Exclusive acquisition prevents a second CodeAI process from using
   the same data directory. The lock records an owner token, pid, hostname, and heartbeat; live
   ownership fails with a clear startup/runtime error, while stale-lock recovery is explicit and
   tested. Releasing one process can never remove a successor's lock token.
7. A lockfile excludes other processes; it does not serialize requests inside Next.js. The store
   instance and mutation queue are pinned on `globalThis`, as the run registry already is, so
   separately compiled route bundles share one queue. Correctness is also enforced at the
   filesystem boundary rather than relying on a module-local singleton.
8. Losing or corrupting `manifest.json` while thread files survive is store corruption, equivalent
   to losing the registry identity. CodeAI fails closed and tells the operator to restore the whole
   `conversation-store-v1` directory (or its manifest) from backup; it never silently mints a new
   host id or adopts attachments. The store directory, not selected individual JSON files, is the
   backup and restore unit.

### C. The host, not the browser, owns conversation content

9. Durable thread data includes title and timestamps; attachments; the participant roster, private
   provider-session state, and cursors; authored messages and delivery state; Mermaid artifacts;
   sketches; annotations; and pins. Route responses expose public participants and never expose
   provider session ids or private cursors.
10. `GET /api/threads` lists host conversations and supports the current shell's checkout filter;
    `GET /api/threads/[threadId]` returns one public conversation snapshot. The shell hydrates from
    these APIs, and a reload or another local browser context sees the same data. The same storage
    contract will serve authorized remote clients later, but this story does not expose it to them.
    Live multi-client synchronization and presence are later work; refetch/reload consistency is
    required here.
11. `conversationStore.ts` stops reading and writing conversation `localStorage`. It may retain
    pure validation/merge helpers only if they are still useful for server snapshots. Current
    device state—focused thread/canvas, panel state, viewport, next addressee/mode, and unsent
    drafts—may stay in React memory. A later story may persist such device-specific preferences
    locally, but losing them cannot lose conversation content.
12. `POST /api/agent/message` no longer accepts `projectId` or a browser transcript. After validating
    the thread, addressed agent, mode, health, attachment availability, and concurrency, the server
    idempotently appends the user message and builds transcript context from the canonical record.
    A completed assistant message and the participant cursor are committed to one new revision
    before the final message is advertised as durable to the stream.
13. Annotation, sketch, pin, participant, and primary-agent changes use server operations and return
    the resulting revision/snapshot. Two clients cannot silently replace one another's newer
    conversation blob.

### D. Attachments replace project identity

14. Replace `ServerThread.projectId` and `ChatThread.projectId` with ordered
    `attachments: ProjectAttachment[]`. An empty array is valid; at most one attachment is primary.
    Attachment ids are unique, and `(hostId, checkoutId)` is unique within a thread, so the same
    checkout cannot appear twice under different roles.
15. `createConversation({ checkoutId?, provider, role? })` creates one local primary attachment when
    a checkout is supplied and creates an attachment-free conversation otherwise. The create wire
    schema and current project-picker call site use `checkoutId`; the response carries attachments
    and has no optional legacy `projectId` field.
16. `get(id)`, `addAgent`, and `setPrimaryAgent` take no project id. `projectId` leaves every
    conversation/message/participant schema and query. Repository status/diff routes keep their
    existing checkout-addressing parameter name until the repository API is renamed separately.
17. `primaryAttachment(thread)` is the single default-working-directory selector. Before an agent
    process starts, the message route produces distinct outcomes:

    - 400 when there is no primary attachment: the conversation has no working directory yet;
    - 409 when the primary attachment belongs to another host: that host is unavailable here;
    - 409 when the local checkout id no longer resolves: the conversation remains readable, but its
      project attachment must be rebound before another turn can run.

    None of these paths spawns a provider process. Moving a repository or changing
    `CODEAI_PROJECTS_ROOT` never turns into `Unknown thread`/404. Attachment rebind UI is deferred,
    so the error explicitly names that limitation.

### E. Records name their host and sessions cannot move implicitly

18. The store manifest's host label is chosen at first creation from `CODEAI_HOST_LABEL`, then
    `CODEAI_WEB2_HOST_LABEL`, then `os.hostname()`. Later environment changes do not silently rename
    the persisted host.
19. Every attachment created in this story carries `manifest.host.id`. A provider session is a
    discriminated state: an unstarted session has no provider session id or host id; a started
    session requires both. `markSessionStarted` records the current host id with the returned
    provider session id.
20. Before resuming a started provider session, the conversation service requires
    `session.hostId === manifest.host.id`. A mismatch returns 409 naming that the provider session
    belongs to another host; it never passes the foreign session id to a local provider executable.

### F. Several humans are structurally valid, not yet authorized

21. The durable and public conversation validators require at least one human instead of exactly
    one. Nothing in this story creates another human or decides which human authored a request;
    identity, membership, presence, and permission rights remain in
    [Story 21](STORY-20260806-web2-team-environment.md).
22. Removing `(threadId, projectId)` lookup pairing removes a locality guard, not a real
    authorization mechanism. This is an accepted gap only while the application remains bound to
    its trusted local-user boundary. Host-owned persistence makes shared clients possible later but
    does **not** authorize exposing agent routes beyond localhost; pairing/authentication and secure
    transport must land before phones, laptops, or headsets connect over a network.

### Type contract

```ts
export interface ProjectAttachment {
  id: string;
  hostId: string;
  checkoutId: string;              // current host-scoped path-hash id, not portable identity
  role: 'primary' | 'reference';
}

export type ProviderSessionRef =
  | { provider: AgentProvider; started: false; sessionId?: never; hostId?: never }
  | { provider: AgentProvider; started: true; sessionId: string; hostId: string };

export interface DurableConversation {
  version: 1;
  revision: number;
  id: string;
  title: string;
  attachments: ProjectAttachment[];
  createdAt: string;
  updatedAt: string;
  participants: ServerParticipant[];
  primaryAgentId: string;
  messages: ChatMessage[];
  pinnedDiagramIds: string[];
  annotations: Record<string, DiagramAnnotation>;
  sketches: SketchCanvas[];
}
```

A portable `projectKey` is deliberately absent. It can be added beside `checkoutId` after the
repository-identity policy exists; the current path hash is never relabelled as portable.

---

## Acceptance criteria

- [x] A new `conversation-store-v1` is the only canonical conversation store; legacy server and
  browser records remain untouched and unread, with no migration code.
- [x] One validated, revisioned JSON file per thread holds the complete durable conversation and is
  written atomically with private filesystem permissions.
- [x] A live writer lock excludes a second process, stale ownership is recovered safely, and a
  `globalThis`-shared mutation queue serializes route-bundle writes inside one process.
- [x] Missing or invalid store identity fails closed without minting a replacement host id; backup
  and restore treat the whole store directory as one unit.
- [x] The browser lists and hydrates conversations from the host, writes no conversation content to
  `localStorage`, and another browser sees committed work after refetch/reload.
- [x] Browser requests use strict operation-level mutations with revision conflict handling and
  idempotency; they never replace a server conversation blob.
- [x] The message request carries no project id or transcript; the server persists the user turn,
  builds context from its canonical transcript, and commits the assistant message plus cursor before
  advertising durable completion.
- [x] Conversation creation accepts optional `checkoutId`, returns attachments, and exposes no
  optional legacy `projectId`; other conversation and participant operations are thread-addressed.
- [x] Attachments validate UUIDs, bounded checkout ids, unique ids, unique `(hostId, checkoutId)`
  pairs, known roles, and at most one primary.
- [x] Attachment-free conversations create, persist, list, accept participants, and remain readable;
  turns fail before spawn with the specified missing-working-directory 400.
- [x] Remote-host and stale-local-checkout primaries remain readable and return distinct 409 errors;
  neither is reported as an unknown conversation and neither spawns a process.
- [x] Started sessions require a session id and host id; local resume checks the host id before
  passing a session to the provider.
- [x] Both roster validators accept two humans and reject none without adding multi-human authority.
- [x] Tests that only covered retired registry/browser migrations are removed intentionally. Tests
  that cover current behavior are adapted rather than deleted, including conversation/sketch
  persistence, participants, protocol, modes, and multi-agent roles.
- [x] New tests cover store initialization/validation, atomic write failure, process exclusion,
  stale lock recovery, route-bundle serialization, idempotent operations, revision conflicts,
  host hydration, attachment availability, session host checks, and two-human validation.
- [x] `npm run lint`, `npm test`, and `npm run test:e2e` pass.
- [x] Apart from the explicit fresh-state cutoff, the current product loop works for a newly created
  conversation: create, reload, send, stream, approve, cancel, draw, annotate, pin, export, and view
  repository status/diff.

## Out of scope

- Importing, deleting, or automatically recovering old `threads.json` or browser-local conversations.
- Live multi-client synchronization, presence, unread notifications, or concurrent human edits.
- Persisting device-specific layout, selection, viewport, panels, modes, or drafts.
- Attachment management/rebind UI, a scratch directory for attachment-free conversations,
  multi-attachment prompt policy, and portable project identity.
- Run-record rekeying, run discovery/reattachment changes, and raising concurrency —
  [Story 27](STORY-20260826-session-keyed-host-bound-runs.md) owns the first two while retaining the
  one-run limit.
- Remote clients, LAN/cloud exposure, authentication, authorization, pairing, TLS, or a second host.
- A cloud database implementation. The domain-operation boundary is included; another backend is not.
- Any weakening of Ask/Plan/Agent capability policies or provider allowlists.

## How to verify

Verification completed on 2026-08-26: strict TypeScript, 132 Vitest tests, the production build,
and all three Playwright scenarios passed.

1. `npm run lint && npm test && npm run test:e2e` — all green.
2. Seed an old `threads.json` and `code-ai:web2:v1:*` browser value, start CodeAI, and confirm neither
   appears in the product or changes on disk/in storage.
3. Create a new conversation, add an agent, send turns, draw/annotate/pin, reload, and confirm the
   complete state returns from `conversation-store-v1/threads/<id>.json` with no conversation key in
   browser `localStorage`.
4. Open a second browser context against the same host, refetch, and confirm it sees the first
   context's committed conversation. Make independent operation-level changes and confirm neither
   replaces the other's messages or participants.
5. Attempt to open the same data directory from a second process and confirm it fails with the lock
   owner's diagnostic. Exercise stale-lock recovery, then confirm the first owner's cleanup cannot
   remove the successor's lock.
6. Corrupt `manifest.json` while leaving thread files intact and confirm startup fails without
   rewriting either. Restore the store directory and confirm conversations resume normally.
7. Create an attachment-free thread, a remote-host attachment fixture, a stale checkout fixture, and
   a foreign-host session fixture. Confirm each stays readable and its turn fails with the specified
   400/409 before any provider process starts.
