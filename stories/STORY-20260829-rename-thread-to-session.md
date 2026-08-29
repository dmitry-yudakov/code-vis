# Story 34 — Rename the unit of work from thread to session

**Status:** Shipped · **Type:** Full-stack (types, wire, routes, store records, UI strings, tests) ·
**Depends on:** [Story 26](STORY-20260826-loosen-project-host-bindings.md) (host-owned conversation
store, shipped 2026-08-26) and [Story 27](STORY-20260826-session-keyed-host-bound-runs.md)
(run-id addressed runs, shipped 2026-08-28)

**Vocabulary context:** [vocabulary.md](../docs/vocabulary.md) · step 1 of the naming work behind
[the arena vision](../docs/vision.md)

---

## Motivation

[vocabulary.md](../docs/vocabulary.md) settled the product's nouns on 2026-08-29. The unit a person
opens and the arena lists is a **session**: a conversation, its canvas, its participants, and the
repositories it works in. *Conversation* narrows to one thing inside it — the message transcript.

The code calls that unit a *thread*, which is the one word the vocabulary rejects outright: in
Slack, Gmail, and Discord a thread is a reply branch *inside* a conversation, and in OpenAI's
Assistants API it is the conversation object. Both meanings are ones this product's users hold, and
neither is what we mean. Keeping the word also blocks the feature it usually names — branching a
conversation.

This was worth a story rather than a commit because the word was not only a type name. `threadId`
appeared 123 times and sat on four boundaries at once:

- the wire,
- the URL space (`/api/threads/[threadId]/...`),
- **persisted records**,
- and the **store layout on disk** (`conversation-store-v1/threads/<id>.json`).

The last two mean the rename needs a stated data policy, not a find-and-replace. It is also cheapest
now: the store is three days old, and every story after this one writes new code in the right words.

A second, smaller correction rode along. `markSessionStarted` already used *session* for a
provider's private Claude/Codex handle. Once the user-visible unit became a session, that name meant
two things in one file, so provider-side names were qualified.

---

## Shipped behavior (where the code is)

- **Durable and public records:** `DurableSession`, `PublicSession`, and `SessionSnapshot` live in
  [types.ts:91](../src/shared/types.ts#L91) and [types.ts:243](../src/shared/types.ts#L243); the old
  source alias is gone.
- **Record schema:** [sessionSchema.ts:173](../src/shared/sessionSchema.ts#L173) pins `version: 2`,
  validates `sessionId` container references, and converts a strictly validated v1 record at the
  upgrade boundary ([sessionSchema.ts:323](../src/shared/sessionSchema.ts#L323)).
- **Store and migration:** [sessionStore.ts:184](../src/server/storage/sessionStore.ts#L184) owns
  `session-store-v1/` and its `sessions/` records. The copy-forward migration validates the old
  manifest and every record, carries the host identity, writes under the new store lock, removes a
  partial destination on failure, and never changes the old store
  ([sessionStore.ts:592](../src/server/storage/sessionStore.ts#L592)).
- **Wire and routes:** [protocol.ts:40](../src/shared/protocol.ts#L40) carries `sessionId`; handlers
  live under `src/app/api/sessions/` and use `[sessionId]`.
- **Runs:** [runRegistry.ts:40](../src/server/runs/runRegistry.ts#L40) records
  `{ runId, sessionId, participantId }` while retaining the run vocabulary.
- **Browser:** [AppShell.tsx:71](../src/features/shell/AppShell.tsx#L71) holds session state,
  [SessionPicker.tsx:7](../src/features/conversation/SessionPicker.tsx#L7) renders the picker, and
  [sessionStore.ts:42](../src/features/conversation/sessionStore.ts#L42) hydrates public snapshots.
- **User-visible strings:** the unit is a session, including `Session ${n}`; Conversation remains
  the transcript panel label.
- **Tests:** [sessionStore.test.ts](../test/sessionStore.test.ts) covers fresh records, complete v1
  migration, byte-preserving rollback, and invalid-record cleanup; API and UI coverage use session
  names and routes.

---

## Desired behavior

### A. One word in the code and on the wire

1. `DurableConversation` → `DurableSession`; `ChatThread` → `SessionSnapshot`; the `ServerThread`
   alias is deleted rather than re-pointed — it exists only for source compatibility with a name this
   story removes.
2. `threadId` → `sessionId` everywhere: wire payloads, stream events, store operations, run records,
   browser state, and route params.
3. Store operations rename to their session forms — `listSessions`, `getSession`, `createSession`,
   `appendUserMessage`, `completeAssistantMessage`, … — keeping their current semantics, revision
   discipline, and idempotency keys unchanged. This story changes no behavior.
4. Provider-side names are qualified so the word *session* is never ambiguous in one scope:
   `markSessionStarted` → `markProviderSessionStarted`, and `ProviderSessionRef`
   ([types.ts:52](../src/shared/types.ts#L52)) keeps its already-qualified name.
5. Routes move to `/api/sessions` and `/api/sessions/[sessionId]/…`. The `/api/threads` paths are
   removed, not aliased: the client and server ship together and nothing else consumes them.

### B. Persisted records: a new store, upgraded once, old data never touched

6. The store root becomes `<dataDir>/session-store-v1/` with the same layout — `manifest.json`,
   `writer.lock`, `sessions/<uuid>.json` — and a record `version: 2` whose only difference from
   version 1 is the renamed fields.
7. On first open, if `session-store-v1/` does not exist and `conversation-store-v1/` does, the store
   performs a one-time upgrade under its own writer lock: read each valid v1 record, rename its
   fields, write it as v2 into the new store with the same ids and revisions, and carry the host
   identity from the old manifest so `hostId` values stay meaningful.
8. The old directory is **left exactly as it is** — never rewritten, never deleted. It is the
   rollback. Story 26's clean-cutoff posture applied to prototype data; this store now holds real
   conversations, so the upgrade copies rather than discards, and a failed upgrade leaves the user
   with their working v1 store and a clear error.
9. The upgrade is all-or-nothing and fails closed: a record that does not validate as v1 aborts the
   upgrade with the offending file named, leaving no partial `session-store-v1/`. A store that
   already exists at v2 is never re-upgraded, and a v1 store beside an existing v2 store is ignored.

### C. What the user reads

10. The unit is a **session** in every user-visible string: "New session", "New session with…",
    "Close session", "Session agents", the picker's empty state, and the default title
    `Session ${n}`.
11. **Conversation stays** — as the name of the message transcript and its panel only: the
    "Conversation" panel label, its aria-label, and the resize handle keep their wording.
12. Nothing else is renamed for the user in this story: canvas, diagram, sketch, repository,
    project, and agent strings are untouched.

### D. Deliberately unchanged

13. `runId`, `runRegistry`, and the run vocabulary — already correct, and never user-visible.
14. `participant` — the right data-model word for a human or an agent.
15. `hostId` — the code name the vocabulary keeps; *machine* is a UI word, and no user-visible host
    string exists yet.
16. `checkoutId` and `ProjectAttachment` — Story 35 owns the project/repository split, and renaming
    them here would mean renaming them twice.

### Type contract

```ts
// src/shared/types.ts
export interface DurableSession {          // was DurableConversation
  version: 2;                              // was 1
  revision: number;
  id: string;
  title: string;
  attachments: ProjectAttachment[];        // Story 35 renames these
  participants: ServerParticipant[];
  primaryAgentId: string;
  messages: ChatMessage[];
  pinnedDiagramIds: string[];
  annotations: Record<string, DiagramAnnotation>;
  sketches: SketchCanvas[];
  createdAt: string;
  updatedAt: string;
}

export interface SessionSnapshot extends PublicSession { /* was ChatThread */ }

// records that reference their container
interface SketchCanvas    { sessionId: string; /* was threadId */ }
interface DiagramArtifact { sessionId: string; /* was threadId */ }

// src/shared/protocol.ts — every event and operation payload
{ sessionId: string }                      // was threadId
```

---

## Acceptance criteria

- [x] `grep -ri "thread" src/ e2e/ test/` returns nothing outside `legacy/`, except where quoting a
      provider's own vocabulary.
- [x] `DurableSession`, `SessionSnapshot`, and `sessionId` are the only names for the unit across
      types, schema, store, routes, wire, and browser state; `ServerThread` no longer exists.
- [x] Routes answer at `/api/sessions` and `/api/sessions/[sessionId]/…`; no `/api/threads` route
      remains.
- [x] A fresh install with no store creates `session-store-v1/` at record `version: 2` and never
      looks for a v1 store again.
- [x] An install holding a v1 store upgrades it once on first open: every session, message,
      annotation, sketch, pin, participant, and provider-session binding survives with its id,
      revision, and `hostId` intact.
- [x] `conversation-store-v1/` is byte-identical after the upgrade, and a second start does not
      re-run it.
- [x] An invalid v1 record aborts the upgrade, names the file, leaves no partial `session-store-v1/`,
      and leaves the v1 store readable by the previous build.
- [x] The UI says session for the unit and conversation only for the transcript; no string says
      thread.
- [x] `markProviderSessionStarted` is the only session-started operation, and no scope holds both
      meanings of the word.
- [x] `npm run lint`, `npm test`, and `npm run test:e2e` pass; tests are renamed with the code rather
      than kept as thread-named fixtures.

## Out of scope

- **Projects, repositories, and repository-free sessions** — [Story 35](STORY-20260829-projects-and-repositories.md).
- **The canvas becoming one surface holding diagrams and sketches** (today one canvas *is* one
  diagram) — its own story; [vocabulary.md](../docs/vocabulary.md) records the intent.
- **The arena, views, layout, workspace, machine, and Inbox** — no record or UI for any of them yet.
- **Any behavior change.** If a turn, a permission, a reload, or a run behaves differently after this
  story, that is a bug in the rename.

## How to verify

1. `npm run lint` — strict TypeScript check.
2. `npm test` — includes complete and failing copy-forward migration fixtures, route behavior,
   provider resume behavior, and the application-owned vocabulary audit surface.
3. `npm run test:e2e` — production build plus the seven browser flows, including starting and
   closing a session.
4. `rg -l -i thread src test e2e` — only Codex adapter/preflight/fixture files may remain because
   the provider calls its native object a thread.
