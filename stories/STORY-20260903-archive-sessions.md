# Story 39 — Archive inactive sessions from the Arena

**Status:** Shipped · **Type:** Full-stack ·
**Depends on:** [Story 38](STORY-20260903-arena-and-inbox.md) (the host-wide Arena and Inbox,
shipped)

**Vision context:** step 6, “The arena,” in [vision.md](../docs/vision.md#sequence). This is a
maintenance slice for the shipped local Arena; it does not advance the multi-device sequence.

---

## Motivation

The Arena deliberately shows every canonical session, including abandoned experiments and failed
conversations. Closing a workspace tab changes only device layout, so old work accumulates in
the overview and makes current work harder to scan. A person needs a safe way to remove a session
from the active Arena without destroying its transcript, diagrams, annotations, or private provider
continuation state.

---

## Shipped implementation (where the code is)

- Store lifecycle:
  [src/server/storage/sessionStore.ts](../src/server/storage/sessionStore.ts#L220) (~line 220) —
  maintains private active and archived directories, revision-checked archive/restore moves,
  startup transition recovery, and project detachment across both collections.
- Archive and restore routes:
  [src/app/api/sessions/[sessionId]/archive/route.ts](../src/app/api/sessions/%5BsessionId%5D/archive/route.ts#L15)
  (~line 15) and
  [src/app/api/sessions/[sessionId]/restore/route.ts](../src/app/api/sessions/%5BsessionId%5D/restore/route.ts#L13)
  (~line 13) — validate revisions and return bounded Arena summaries.
- Run admission: [src/server/runs/runRegistry.ts](../src/server/runs/runRegistry.ts#L336) (~line 336)
  — exposes live-session detection that includes the pre-activation reservation window.
- Arena lifecycle UI: [src/features/arena/Arena.tsx](../src/features/arena/Arena.tsx#L42) (~line 42)
  — renders Active, Inbox, and Archived views with confirmation, live-run exclusion, and restore.
- Workspace and undo orchestration:
  [src/features/shell/AppShell.tsx](../src/features/shell/AppShell.tsx#L1055) (~line 1055) —
  removes archived sessions from device state, refreshes the Arena, and offers a timed undo.
- Coverage: [test/sessionStore.test.ts](../test/sessionStore.test.ts#L347) (~line 347),
  [test/sessionRoutes.test.ts](../test/sessionRoutes.test.ts#L183) (~line 183), and
  [e2e/canvas.spec.ts](../e2e/canvas.spec.ts#L436) (~line 436) exercise persistence, conflicts,
  run exclusion, UI archive/undo/restore, and workspace reconciliation.

---

## Desired behavior

### Concrete changes

1. An idle or terminal active session can be archived from its Arena card after confirmation.
   Archiving removes it from active cards, Inbox attention, session pickers, and open workspace tabs.
   A short-lived notification offers immediate undo.
2. Running, queued, permission-blocked, and pre-activation reserved turns make archiving fail with a
   conflict. The server enforces this even if a client bypasses the disabled UI.
3. Arena gains an **Archived** view. Archived cards retain project, repositories, participants, and
   last activity, show when the session was archived, and offer **Restore** rather than opening the
   inactive session.
4. Restoring returns the complete session to its original project (or No project), makes it active,
   and leaves opening it as a separate user action.
5. The host store keeps archived records under `session-store-v2/archived-sessions`. Archive and
   restore are revision-checked, serialized, crash-safe transitions using the existing writer lock,
   validated record writes, and same-filesystem rename.
6. Deleting a project detaches both active and archived sessions so restoration cannot produce a
   dangling project reference.

### Type contract

```ts
interface DurableSession {
  // existing version 3 fields
  archivedAt?: string; // present only while stored in archived-sessions
}

interface ArenaSnapshot {
  sessions: ArenaSessionSummary[];
  archivedSessions: ArenaSessionSummary[];
  runs: RunDiscovery;
}
```

The summary exposes `archivedAt` only for archived records. Provider-session ids and transcripts
remain absent from Arena responses.

---

## Acceptance criteria

- [x] The store creates a private `archived-sessions` directory and atomically archives/restores a
      complete validated record with `archivedAt`, monotonic revisions, and stale-revision conflicts.
- [x] Active list/get/mutation paths do not see archived records; archived listing does not see
      active records; store bounds cover active plus archived sessions.
- [x] Archive routes reject any live reservation or run and return revisioned summaries without
      leaking transcripts or provider-session ids.
- [x] Arena has Active, Inbox, and Archived views; confirmed archive removes a session from active
      cards/attention and its device workspace, offers immediate undo, and Restore returns it to the
      active Arena.
- [x] Project deletion detaches archived as well as active sessions and reports the combined count.
- [x] Focused store, route, Arena-model/component, and browser tests cover archive, restore,
      conflicts, run exclusion, visibility, and workspace reconciliation.
- [x] `npm run lint`, `npm test`, and `npm run test:e2e` pass.

## Out of scope

- Permanent deletion, bulk archive, automatic retention, retention settings, search, and export from
  the Archived view. A later purge story can build on this recoverable lifecycle.
- Archiving projects or participants, changing native Claude/Codex history, or cancelling work as an
  implicit side effect of archiving.
- Opening or mutating an archived session before it is restored.

## How to verify

1. Create idle and failed sessions, archive them from their cards, and confirm they disappear from
   Active and Inbox and appear under Archived with an archive time.
2. Restore one and confirm it returns under its original project with its conversation and canvas
   intact, without opening automatically.
3. Start or queue a turn and confirm its Archive control is disabled; submit the archive request
   directly and confirm the server returns 409 while the canonical session remains active.
4. Archive a project session, delete the project, restore the session, and confirm it appears under
   No project with its repository bindings intact.
5. Restart CodeAI and confirm archived records remain archived and restorable.
6. Run `npm run lint`, `npm test`, and `npm run test:e2e`.
