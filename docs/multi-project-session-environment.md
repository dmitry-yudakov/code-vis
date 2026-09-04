# Engineering notes — sessions, machines, and records

**Status:** Chapter of [vision.md](vision.md) · **Date:** August 20, 2026 · **Scope broadened:**
August 26, 2026 · **Rewritten in the agreed vocabulary:** August 29, 2026 ·
**Not an implementation spec**

These are the engineering notes behind the arena: what the durable records have to look like for one
person to work with many ongoing sessions across machines and devices, what is cheap to loosen now,
and what is deliberately deferred. The product picture is in [vision.md](vision.md); the words are
fixed in [vocabulary.md](vocabulary.md).

The original memo assumed one machine and one repository per conversation. Both assumptions are too
tight. Sessions already run on a laptop, a desktop, and sometimes a cloud machine at the same time,
and a piece of work is not always a repository: it may span several, or be a brainstorm between a few
people and agents over concepts and drawings with no repository at all. The near-term goal is not to
build all of that — it is to stop the current data shapes from forbidding it.

**Vocabulary note.** This document uses the vocabulary of [vocabulary.md](vocabulary.md) — *session*,
*machine*, *device*, *view*, *repository*, *checkout*. Story 34 aligned the session names in code;
`hostId`, `ProjectAttachment`, and `projectId` remain until the machine UI and Story 35's
project/repository split give them their final shapes.

## Three loosened boundaries

**A session may have zero, one, or several repositories.** A repository becomes something a session
*works in* rather than the session's identity. Zero is a legitimate session — brainstorming,
diagramming, planning — and it must not be a degenerate case bolted on later. Several is how
"compare these two implementations" or "this change spans the client and the API repo" stops
requiring two disconnected conversations.

**Sessions run on machines; people watch from devices.** The machine that executes an agent and
touches files is not the same thing as the screen the user is looking at. One user has several
machines (laptop, desktop, cloud) and several devices (browsers, a headset), and any device should be
able to see and address any reachable machine's sessions. Today the two are fused: the browser talks
to the one Next.js server on `localhost`, which is also the only executor.

**A session may hold more than one person.** Already anticipated by
[Story 21](../stories/STORY-20260806-web2-team-environment.md), and the real cost sits there —
identity, authorization, multi-writer synchronization, and sandboxing. Machine-owned session storage
is pulled earlier for continuity across machines and devices, but it does not make a team surface;
the records should merely stop asserting that exactly one human exists in the meantime.

The unifying rule the three share is in [Durable records never assume
"here"](#durable-records-never-assume-here).

## Why the identities stay separate

Keeping these apart matters. "Open this repository twice" may mean two different sessions; "show this
session in two places" may mean two views over one session — possibly on two devices; "ask the
reviewer" means addressing one provider session inside the session rather than creating another
project; and "run this on the desktop" is a statement about machines, not about sessions.

The one distinction the vocabulary makes that the memo originally did not: a **project** groups
sessions and repositories, and a **repository** is one of the things a session works in. A
repository's identity and its per-machine **checkout** are two different facts (see
[Repository identity](#repository-identity-is-not-a-path)).

## Tentative model

An eventual contract might resemble:

```ts
interface Workspace {              // user-owned, device-independent
  id: string;
  title: string;
  viewIds: string[];
  createdAt: string;
  updatedAt: string;
}

interface View {                   // one open presentation of a session
  id: string;
  sessionId: string;
  activeCanvasId?: string;
}

interface Layout {                 // per (workspace, device) — never shared between devices
  workspaceId: string;
  deviceId: string;
  focusedViewId?: string;
  webPlacements?: Record<string, WebViewPlacement>;
  spatialPlacements?: Record<string, SpatialViewPlacement>;
}

interface RepositoryBinding {      // today's ProjectAttachment
  id: string;
  hostId: string;                  // which machine provides this checkout
  checkoutId: string;              // current machine-scoped path-hash id
  // repositoryKey is a later portable identity beside checkoutId, not a rename of it
  role: 'primary' | 'reference';
}

interface Machine {                // today's Host
  id: string;                      // minted once per machine; not derived from hostname or path
  label: string;                   // "laptop", "desktop", "cloud sandbox"
  kind: 'local' | 'lan' | 'remote';
}
```

A session then carries `repositories: RepositoryBinding[]` instead of `projectId: string`, and an
agent participant's provider session carries the `hostId` it started on.

The workspace stores identity and user arrangement, not copies of repositories, sessions, or
diagrams. A view references those durable records. Web placement and spatial placement are separate
projections so forcing a useful room-scale layout does not damage a useful desktop layout — and
splitting `Layout` off the workspace entirely is what lets a headset and a laptop show the same
workspace without fighting over geometry.

It remains open whether the same session may appear in multiple views simultaneously. Supporting
that is conceptually clean, but it complicates focus, repository selection, and concurrent edits.

## Repository identity is not a path

`projectRegistry.ts` mints an id as a truncated hash of the checkout's real path
([projectRegistry.ts:30](../src/server/projects/projectRegistry.ts#L30)), and repositories must live
under one configured root. That is a perfectly good *checkout* id and a poor *repository* identity:
the same repository on the laptop and the desktop produces two unrelated ids, so nothing durable can
be said about "the same repository" across machines.

Portable identity candidates — a normalized git remote, a user-declared key held in the workspace, or
a first-commit hash — each have holes (no remote, forks sharing a remote, several worktrees of one
repo). Picking one is not urgent. What is urgent is not *pretending* the current id is portable: call
it a checkout, scope it to a machine, and leave room for a `repositoryKey` beside it, so per-machine
bindings (`repositoryKey`, `hostId`, `realPath`) can be introduced without relabelling existing data.

## Durable records never assume "here"

One rule covers most of what would otherwise need reworking later:

- no machine-local path inside an identity;
- no record that means "the local machine" implicitly — a machine is named or the record is
  machine-free;
- no single global *state slot* standing in for keyed machine/session state — process-wide registry
  and storage services may deliberately be pinned on `globalThis` so Next route bundles share them;
- no browser-local storage holding anything another device must see.

Two of the four are now obeyed. Stories 26, 27, and 34 shipped: canonical session state is a
machine-owned JSON record with repository bindings and a `hostId`
([sessionStore.ts](../src/server/storage/sessionStore.ts)), and runs are keyed by `runId`
in live and recent maps rather than one global active slot
([runRegistry.ts:36](../src/server/runs/runRegistry.ts#L36)) — the process-wide registry itself stays
pinned on `globalThis` deliberately, so Next route bundles share it.

What still breaks the rule: a repository's id is a machine-local path hash, and the single
configured projects root plus "the working directory is the project" assumption remains throughout
the shell and the agent routes.

## What was loosened, and what is left

[Story 26](../stories/STORY-20260826-loosen-project-host-bindings.md) (shipped 2026-08-26) and
[Story 27](../stories/STORY-20260826-session-keyed-host-bound-runs.md) (shipped 2026-08-28) did the
foundation-first half: the changes that buy the broader scope without building remote access.

**Done:**

1. **The machine owns sessions.** One validated, revisioned JSON record per session on the machine
   ([sessionStore.ts](../src/server/storage/sessionStore.ts)), replacing the split
   server registry plus authoritative browser `localStorage` blob, with operation-level writes
   serialized behind a store lock and a `globalThis`-shared mutation queue.
2. **Session → repositories.** `projectId` became an ordered
   `attachments: ProjectAttachment[]` ([types.ts:91](../src/shared/types.ts#L91)); `checkoutId` stays
   honestly machine-scoped.
3. **Repository match is no longer session identity.** The paired `get(id, projectId)` lookups and
   the old project-match locality guard are gone. At that slice the agent routes remained inside
   the trusted localhost boundary; Story 41 now authorizes remote personal devices independently.
   A path hash never authenticates anything.
4. **The machine is named.** `hostId` rides on the records that persist provider sessions and
   checkouts ([types.ts:52](../src/shared/types.ts#L52)), minted once and never silently replaced,
   even though there is only ever one machine and the value is constant.
5. **"Exactly one human" is gone.** The schema now requires *at least* one human
   ([sessionSchema.ts:218](../src/shared/sessionSchema.ts#L218)). This does not build the
   team surface — Story 21 still owns identity, authorization, live sync, and multi-writer policy —
   it only stops baking the restriction into the record shape.
6. **Runs are addressed by run id.** Every live and retained run carries its session and
   participant; every operation including permission attachment resolves by `runId`
   ([runRegistry.ts:36](../src/server/runs/runRegistry.ts#L36)), and the browser discovers runs
   machine-wide before attaching, so a session blocked by another session's turn can name it. A
   reload trusts the canonical record instead of replaying a finished run. The policy is still one
   concurrent turn.

**Left, in dependency order** — the first is specified as
[Story 35](../stories/STORY-20260829-projects-and-repositories.md) (projects, repository bindings,
and repository management); Story 34's vocabulary prerequisite is shipped:

1. **Allow zero repositories — in the record first.** A repository-free session should persist and
   accept participants immediately; what it cannot do yet is run a turn, because agent processes need
   a working directory. Splitting it that way leaves the real question — a per-session scratch
   directory, absent repository sidebar and git context
   ([conversationService.ts:76](../src/server/conversation/conversationService.ts#L76)), and the tool
   policy for a session with no repo — as its own story, where it belongs. That second half is what
   makes brainstorming and drawing sessions first-class.
2. **Repository management in the UI.** The record holds several bindings with primary/reference
   roles; nothing yet adds, removes, rebinds, or switches between them.
3. **A portable `repositoryKey`** beside `checkoutId`, once there is a second machine to need it.
4. **Non-runnable states as normal states.** A remote-machine repository, a missing working
   directory, a stale checkout, and a foreign-machine provider session are distinct conditions; none
   of them should make a session disappear.

Deliberately **still not now:** live multi-device synchronization, a coordinator service,
sandboxing, presence, or a UI for several humans. Story 41's authenticated boundary authorizes one
person's paired devices over its explicit HTTPS listener; it does not authorize Internet or team
hosting, another execution machine, or cloud exposure.

## Mermaid across 2D and 3D

Mermaid remains the canonical agent-authored diagram source for now. A renderer may derive and cache
whatever structure it needs, keyed by the source and renderer/parser version:

```text
Mermaid source
  -> validate/parse
  -> derived diagram structure
     -> current SVG renderer
     -> future custom 2D renderer
     -> react-three-fiber spatial renderer
```

The derived structure is not a second user document and must be disposable. User edits ultimately
need to round-trip to Mermaid source or be represented as explicit annotations rather than silently
diverging from it.

A pragmatic spatial rollout could be:

1. Place any valid Mermaid diagram as an SVG surface in the 3D environment.
2. Render a supported subset—likely flowcharts first—as real spatial nodes, edges, and groups.
3. Fall back to an SVG surface for unsupported diagram types or syntax.
4. Expand the parser/layout vocabulary and later use it for a more beautiful, interactive 2D
   renderer as well.

Stable Mermaid node IDs become important once annotations, selection, evidence, or spatial placement
attach to individual elements. Diagrams without explicit stable IDs may need warnings or generated
session-local identities rather than pretending their anchors survive arbitrary source rewrites.

A repository-free session makes canvases the *primary* artifact rather than a companion to code,
which raises the priority of sketch-first flows and of diagrams that are never validated against a
repo.

## Browser state implications

Story 36 replaces the shell's one selected-session slot with a small workspace state owner. Within
the selected project, it keeps ordered open views and singular focus, while each view retains:

- loading or failure in one view must not block navigation in another;
- each view retains its active canvas, viewport, open panels, drafts, and unread state;
- focus is singular, but "loaded" and "running" are not;
- switching focus must not cancel an unrelated agent turn;
- permission requests and completion notifications must remain visible when their view is not
  focused, including in immersive mode;
- a view whose machine is unreachable is a normal state, not an error — asleep laptops are routine.

The versioned device records now persist layout, selection, viewport, panels, modes, drafts, and
unread counts in `localStorage`; losing them never loses a session. Canonical conversation,
artifact, annotation, participant, project, and repository content remains in Story 26's host JSON.
Cross-project views, durable workspace identity, and remote/offline-machine presentation remain for
the arena and device slices.

## Agent concurrency

There are two distinct promises, both now shipped for one local machine:

1. **Simultaneous visibility:** several sessions stay open and usable while agents run.
2. **Simultaneous execution:** agents in different sessions may run at the same time.

The first is a product requirement and does not require parallel child processes. The second should
be deliberate and bounded — and bounded *per machine*, since capacity is a property of a machine, not
of a user. A cloud machine and a laptop do not share a limit.

The current policy is:

- at most one queued or active turn per session and per provider session;
- several active turns across independent sessions on one machine;
- `CODEAI_MAX_CONCURRENT_RUNS`, default 2 and bounded from 1–8;
- visible queued/running/needs-you states per open session view;
- cancellation, approval, replay, and reattachment keyed by `runId` and session/participant rather
  than a global active slot;
- no concurrent turns against the same provider session unless that provider explicitly supports it.

The scheduler must not weaken Ask/Plan/Agent capability boundaries or allow one session to answer
another session's permission request.

## Persistence and device continuity

Browser-local conversation storage was enough for one desktop prototype but cannot give a second
device the same session. Story 26 moves session, transcript, artifact, and annotation state to
machine-owned JSON behind domain operations. Continuity across devices later adds durable workspace
and saved-view records plus authenticated transport. Three eventual topologies, in increasing cost:

- **Home machine.** One machine — usually the desktop — owns the records; other devices are clients
  of it. Cheapest, reuses today's server, and fails exactly when that machine is asleep or
  off-network.
- **Coordinator.** A small always-on service owns identity, workspaces, sessions, and transcripts;
  machines and devices both connect outward to it, so no machine needs an inbound port. Best fit for
  a laptop + desktop + cloud mix, and the most work.
- **Replication.** Records sync peer-to-peer between machines. Attractive on paper; conflict
  resolution over a live transcript with concurrent agent writes is the most expensive of the three.

No pick is needed yet, and the choice stays cheap as long as the records obey [the rule
above](#durable-records-never-assume-here) — a home machine upgrades into a coordinator when every
record already names its machine and carries its own ids.

Camera pose, controller pose, hover, and other high-frequency presentation state should remain local.
Deliberately saved spatial placement and named viewpoints may be durable. The system should avoid
streaming headset telemetry into the canonical record merely because the renderer can observe it.

The cloud machine is asymmetric in a way worth designing for early: it cannot see the laptop's
working tree. A session whose repositories span two machines is the genuinely hard case, and the
conservative first rule is that an agent turn runs on one machine and may only *act* on that
machine's checkouts; others are read-only context at most.

## Trust

Once another device connects over the network, the trust model changes: secure transport, pairing or
authentication, authorization for agent turns and permission decisions, and stronger agent isolation
become prerequisites. A headset on the LAN is still a remote device relative to the machine that can
modify repositories, and a cloud machine sits outside the desktop trust boundary that today's
"trusted repository, capability restriction rather than a sandbox" stance depends on.

Two properties should not be traded away for convenience: a permission request is answered by an
authenticated human, not by whichever device is connected; and an agent turn's capabilities are
resolved on the machine that executes it, never asserted by the device that requested it.

## Possible delivery slices

1. **Repository promotion** — done: the Next.js product is the root application
   ([Story 24](../stories/STORY-20260820-promote-next-app-archive-legacy.md), shipped 2026-08-21).
2. **Machine-owned sessions and loosened bindings** — shipped 2026-08-26,
   [Story 26](../stories/STORY-20260826-loosen-project-host-bindings.md): fresh machine-owned JSON
   behind domain operations, complete session records, repository bindings, machine-bound provider
   sessions, several-human-valid records, and a clean legacy-data cutoff. The browser stops owning
   durable conversation content.
3. **Run-id addressed runs** — shipped 2026-08-28,
   [Story 27](../stories/STORY-20260826-session-keyed-host-bound-runs.md): live and retained run
   records addressed by run id and carrying session/participant identity, machine-wide run discovery,
   run-id reattachment, a reload that trusts the canonical session record rather than a retained
   stream, and complete permission/cancel/replay routing while the global concurrency limit remains
   one. Keying runs by provider session waits for the independent run registry below, where
   concurrency makes it observable.
4. **Projects, and sessions without or with several repositories** — Story 34's record rename is
   shipped; [Story 35](../stories/STORY-20260829-projects-and-repositories.md) adds
   project records, repository management UI, the repository-free session, and repository surfaces
   that follow the selected one. This precedes the arena because the arena groups sessions by
   project.
5. **Workspace shell — shipped 2026-08-30:**
   [Story 36](../stories/STORY-20260830-multi-session-workspace.md) opens several tabbed session
   views within the selected project, persists their device layout locally, and keeps one agent run
   globally. It tests navigation and host-wide reattachment without taking on concurrency.
6. **Independent run registry — shipped 2026-09-01 in
   [Story 37](../stories/STORY-20260901-concurrent-turns.md):** concurrent runs keyed by provider
   session with a conservative per-machine limit, queueing, and background activity/permissions
   surfaced across sessions. The arena's states are thin until this lands.
7. **The arena — shipped 2026-09-03 in
   [Story 38](../stories/STORY-20260903-arena-and-inbox.md):** a bounded host-wide session snapshot,
   project-grouped state cards, a device-readable Inbox, cross-session permission answers, and
   provider/mode-aware session creation from the overview.
8. **Authenticated devices to one home machine — shipped 2026-09-04 in
   [Story 41](../stories/STORY-20260904-authenticated-devices.md):** pair a user's laptop, phone, or
   headset with the machine that owns the sessions through an explicit HTTPS listener, a
   terminal-issued one-time code, hashed revocable device credentials, and per-route authorization
   for reads, turns, cancellations, streams, and permission decisions. This delivers multi-device
   viewing without adding a second execution machine or a second human.
9. **Second execution machine:** a machine registry, authenticated attachment to another executor,
   and sessions listed and streamed across machines in one workspace. This is where machine
   selection, offline-machine state, and remote routing become real.
10. **Durable workspace and coordinator continuity:** persist workspace/view identity and support the
    selected home-machine or coordinator topology when no single device owns navigation.
11. **Desktop spatial renderer:** place canvases and sessions in R3F with orbit/select/focus and SVG
    fallback.
12. **Immersive WebXR:** controller interaction, room-scale placement, performance limits, secure
    headset access, and restoration of saved spatial views.
13. **Cloud execution:** sandboxed machines running `claude`/`codex` or provider APIs, joinable from
    anywhere.

These may be reordered after a desktop 3D spike, but multi-device persistence and security cannot be
skipped for a real headset or cloud workflow.

## Open questions for a future spec

1. Is a workspace automatically created per user, explicitly named, or both — and is it per user or
   per device by default?
2. Can one session appear in several views, and can one view change its bound session?
3. Story 36 chose tabs for one project's open sessions. What is the smallest useful 2D
   presentation of the arena beyond that strip: a list, cards, split panes, or a zoomable surface?
4. What is the portable identity of a repository, who mints it, and how are two checkouts of one
   repository recognized as the same repository?
5. When a session's repositories span machines, what may a turn on one machine do with the others?
6. Which machine runs a turn when several could, and who chooses — the user, the session, or a
   policy?
7. Can a session move between machines at all, given that provider sessions cannot?
8. Where does a repository-free session's file output go, and can it later be promoted into a repo?
9. What does a view show when its machine is offline: hidden, ghosted, or read-only from the cached
   transcript?
10. Are cross-repository Mermaid edges/annotations allowed, and if so, where do they belong?
11. Can artifacts be copied or referenced across sessions without copying conversation history?
12. What is the default and maximum agent concurrency per machine, and does a waiting permission
    occupy a slot?
13. Which workspace state is local, durable, synchronized live, or saved only on request?
14. How are unsupported Mermaid types presented in immersive mode beyond the SVG-panel fallback?
15. What interaction moves a view versus a node inside its active spatial diagram?
16. How does the user notice a completed turn, failed run, or permission request elsewhere in a large
    2D/3D arena — or on another machine — without creating notification noise?
17. How should the shipped personal-device identity migrate into a coordinator or team identity,
    and what may leave the local machine for a cloud machine?

## Non-decisions

Beyond the shipped one-home-machine HTTPS and pairing slice, this document does not select a state
library, database, synchronization protocol, coordinator transport or hosting topology, identity
provider, 3D layout algorithm, Mermaid parser implementation, WebXR interaction toolkit, or team
deployment model. Those choices belong in executable stories once their journey and constraints
are selected.
