# Story 35 — Make a project a body of work and a repository its own noun

**Status:** Draft · **Type:** Full-stack (new durable record, discovery rename, session bindings, UI) ·
**Depends on:** [Story 34](STORY-20260829-rename-thread-to-session.md) (thread → session) and
[Story 26](STORY-20260826-loosen-project-host-bindings.md) (host-owned store, shipped)

**Vocabulary context:** [vocabulary.md](../docs/vocabulary.md) · step 2 of the naming work behind
[the arena vision](../docs/vision.md), and the record half of "sessions without, and with several,
repositories" in [the engineering notes](../docs/multi-project-session-environment.md#what-was-loosened-and-what-is-left)

---

## Motivation

Today a *project* is a repository: `projectRegistry` hashes a checkout's real path into an id
([projectRegistry.ts:30](../src/server/projects/projectRegistry.ts#L30)), the header picker chooses
one, and a session binds to it. That is the only meaning the product has for the word, and it is not
the meaning anyone arrives with. Claude.ai, ChatGPT, Linear, Motion, and Figma all use *project* for
a **body of work** that groups things — which is why [vocabulary.md](../docs/vocabulary.md) redefines
it that way and gives *repository* its own noun.

This is not cosmetic. Three things the arena needs are impossible while project means repository:

- **A session with no repository at all** — a design argued out on a canvas, a plan, a brainstorm —
  has nothing to belong to, so it is a degenerate case rather than a first-class one.
- **A session spanning two repositories** — "this change touches the client and the API" — has no
  container above the repository to hold both.
- **Grouping** — the arena lists sessions across many pieces of work, and without projects the only
  grouping available is "which folder on this laptop", which is exactly the machine-local fact the
  records are supposed to stop leaning on.

Story 26 already loosened the record: a session carries an ordered `attachments` list, zero
attachments validate ([conversationSchema.ts:178](../src/shared/conversationSchema.ts#L178)), and
`checkoutId` is honestly machine-scoped. What is missing is the container above it and any way for a
person to manage the list.

---

## Current behavior (where the code is)

- **Discovery:** [projectRegistry.ts:30](../src/server/projects/projectRegistry.ts#L30) mints
  `id = hash(realPath)` for marked directories under `CODEAI_PROJECTS_ROOT`, bounded by
  `CODEAI_PROJECTS_DEPTH` ([config.ts](../src/server/config.ts)).
- **Public shape:** `ProjectSummary` [types.ts:1](../src/shared/types.ts#L1) and `ProjectsResponse`
  [types.ts:7](../src/shared/types.ts#L7) (`projects`, `recentProjectIds`, `discoveryDepth`), served
  by `src/app/api/projects/route.ts`.
- **Session bindings:** `ProjectAttachment` [types.ts:56](../src/shared/types.ts#L56)
  (`hostId`, `checkoutId`, `role`); at most one `primary`
  ([conversationSchema.ts:209](../src/shared/conversationSchema.ts#L209)).
- **Creation:** [conversationStore.ts:264](../src/server/storage/conversationStore.ts#L264) attaches
  the one `checkoutId` it is given, or none.
- **Turns:** [message/route.ts:49](../src/app/api/agent/message/route.ts#L49) resolves the primary
  attachment and refuses a session without one — *"This conversation has no working directory yet.
  Attachment management is not available in this version."*
- **Browser:** [AppShell.tsx:68](../src/features/shell/AppShell.tsx#L68) holds one `projectId`, lists
  sessions with `?checkoutId=…` ([AppShell.tsx:226](../src/features/shell/AppShell.tsx#L226)), and
  creates a session with that checkout ([AppShell.tsx:274](../src/features/shell/AppShell.tsx#L274));
  [ProjectPicker.tsx](../src/features/projects/ProjectPicker.tsx) is the header selector.
- **Repository surfaces:** `src/app/api/repository/{status,diff}/route.ts` and the sidebar read the
  single selected checkout.

---

## Desired behavior

### A. Projects become durable records

1. A project is a user-created record in the same store, under the same writer lock and mutation
   queue, at `session-store-v1/projects/<uuid>.json`: an id, a name, timestamps, a revision, and the
   repositories it works in. It is created explicitly ("New project"), renamed, and deleted.
2. Deleting a project never deletes sessions. Its sessions become loose (`projectId` cleared), and
   the UI says so before the delete.
3. A session carries an optional `projectId`. **Loose sessions are legitimate** and are listed under
   "No project" — the product must never require choosing a project before starting to work.

### B. Repositories, and checkouts as their machine-local form

4. `projectRegistry` becomes `checkoutRegistry`, `ProjectSummary` becomes `CheckoutSummary`, and
   `/api/projects` becomes `/api/checkouts`. What it discovers is unchanged: marked directories on
   *this* machine, identified by a path hash. `recentProjectIds` becomes `recentCheckoutIds` and
   keeps Story 28's behavior, now scoped to the attach flow rather than the header.
5. `ProjectAttachment` becomes `RepositoryBinding` — same fields (`hostId`, `checkoutId`, `role`),
   same "at most one primary" and "a checkout may be attached only once per host" rules.
6. A project holds a `repositories: RepositoryBinding[]` list. Creating a session inside a project
   copies that list as the session's own bindings, so the common case is zero-click; the session's
   list is then independently editable.
7. A loose session may bind any discovered checkout directly. Binding a repository a project does
   not know adds it to the project as well, rather than creating a hidden per-session repository.
8. The config names follow the vocabulary through the existing neutral/legacy fallback pattern in
   [config.ts](../src/server/config.ts): `CODEAI_REPOSITORIES_ROOT ?? CODEAI_PROJECTS_ROOT` and
   `CODEAI_REPOSITORIES_DEPTH ?? CODEAI_PROJECTS_DEPTH`. Existing `.env.local` files keep working;
   README and `.env.example` lead with the new names.

### C. What a person can do

9. The header selects a **project** (or "No project"), ordered by `updatedAt`. The session picker
   lists that project's sessions.
10. A session panel lists its repositories with their roles, and can **add, remove, set primary, and
    reorder** them. This is the "attachment management is not available in this version" gap closed.
11. The repository sidebar and diff surfaces follow **the selected repository within the session**,
    defaulting to primary. Switching it changes the working tree, branch, changed files, and diffs
    shown; it does not change which repository a turn runs against — that stays the primary.
12. A session may be created with no project and no repository. It persists, accepts participants,
    holds a canvas and a conversation, and says plainly that it cannot run an agent turn yet, naming
    what would fix it (attach a repository) — see *Out of scope* for the other half.

### D. Records and the version bump

13. Sessions move to `version: 3`: `attachments` → `repositories`, plus the optional `projectId`.
    Projects are new records at `version: 1`. The upgrade reuses the machinery Story 34 builds —
    copy forward under the writer lock, ids and revisions preserved, the previous store untouched as
    the rollback.
14. If Story 34 has not shipped when this one starts, the two renames collapse into a single version
    bump and a single upgrade rather than running two in a row.

### Type contract

```ts
// src/shared/types.ts
export interface RepositoryBinding {        // was ProjectAttachment
  id: string;
  hostId: string;
  checkoutId: string;                       // machine-scoped; repositoryKey comes later, beside it
  role: 'primary' | 'reference';
}

export interface DurableProject {
  version: 1;
  revision: number;
  id: string;
  name: string;
  repositories: RepositoryBinding[];
  createdAt: string;
  updatedAt: string;
}

export interface DurableSession {
  version: 3;                               // was 2
  projectId?: string;                       // absent = a loose session
  repositories: RepositoryBinding[];        // was attachments
  // …unchanged
}

export interface CheckoutSummary {          // was ProjectSummary
  id: string;                               // path hash on this machine
  name: string;
  relativePath: string;
}
```

---

## Acceptance criteria

- [ ] A project can be created, renamed, and deleted; deleting one leaves its sessions intact and
      loose.
- [ ] A session can be created inside a project (inheriting its repositories) or loose, with no
      repository at all, and both persist across a restart.
- [ ] A session's repositories can be added, removed, reordered, and re-rolled between primary and
      reference, with the store's revision and conflict rules enforced.
- [ ] Binding a repository unknown to the session's project adds it to the project too.
- [ ] The repository sidebar, status, and diffs follow the repository selected within the session and
      default to the primary one.
- [ ] A turn still runs against the primary repository only, and the Ask/Plan/Agent capability
      boundaries are unchanged.
- [ ] A repository-free session states why it cannot run a turn and what would fix it, and does not
      error, disappear, or block its canvas and conversation.
- [ ] `projectRegistry`/`ProjectSummary`/`/api/projects` are gone in favor of the checkout names;
      no code uses *project* for a repository.
- [ ] `CODEAI_REPOSITORIES_ROOT` works, `CODEAI_PROJECTS_ROOT` still works, and README plus
      `.env.example` lead with the new names.
- [ ] An existing store upgrades once: every session keeps its id, revision, transcript, canvases,
      and bindings, and lands loose (no `projectId`) unless a project is created for it.
- [ ] `npm run lint`, `npm test`, and `npm run test:e2e` pass, including e2e coverage for a two-
      repository session and a repository-free one.

## Out of scope

- **Running an agent turn with no repository** — the per-session scratch working directory, the tool
  policy for a session with no repo, and the absent-repository sidebar
  ([conversationService.ts:76](../src/server/conversation/conversationService.ts#L76)). That is a
  capability and safety question, not a records question, and it gets its own story.
- **Portable repository identity** (`repositoryKey`): nothing here claims a checkout id identifies a
  repository across machines.
- **Repositories on a second machine**: bindings still carry `hostId`, and a binding whose `hostId`
  is not this machine remains non-runnable.
- **Project instructions and knowledge** — the record leaves room; this story adds no such field.
- **The arena, workspace, views, and Inbox** — later stories.
- **Turns acting on more than the primary repository.**

## How to verify

1. `npm run dev` on an existing store: the upgrade runs once, every session is intact and listed
   under "No project", and the previous store directory is unchanged.
2. Create a project, add two repositories, and start a session in it: both are bound, the first is
   primary, and the sidebar shows the primary's working tree.
3. Switch the sidebar to the second repository: status, changed files, and diffs follow. Run a turn:
   it still runs against the primary.
4. Remove the primary binding and set the other as primary; run a turn and confirm it acts on the
   new one.
5. Create a session with no project and no repository: it opens, takes a sketch and a message
   participant, survives a reload, and explains that it cannot run a turn yet.
6. Delete the project: its sessions remain, now loose, with their transcripts and canvases.
7. Start with only `CODEAI_PROJECTS_ROOT` set, then only `CODEAI_REPOSITORIES_ROOT`: discovery
   behaves identically.
