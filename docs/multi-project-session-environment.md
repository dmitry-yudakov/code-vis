# Memo — Multi-project, multi-session, multi-device environment

**Status:** Exploration · **Date:** August 20, 2026 · **Scope broadened:** August 26, 2026 ·
**Not an implementation spec**

This memo captures the direction for letting one person work with many ongoing agentic sessions in
one CodeAI environment, across the web and spatial/VR surfaces. It records useful vocabulary, likely
boundaries, and open questions without committing to an implementation story yet.

The original memo assumed one machine, and one repository per conversation. Both assumptions are
too tight. In practice sessions already run on a laptop, a desktop, and sometimes a cloud machine at
the same time, and a piece of work is not always a repository: it may span several, or be a
brainstorm between a few people and agents over concepts and drawings with no repository at all.
The near-term goal is not to build all of that — it is to stop the current data shapes from
forbidding it.

## Product idea

CodeAI should feel like an environment containing several ongoing pieces of work, not an
application that must be closed or globally switched whenever the user changes repository, machine,
or agent conversation.

A person might keep an authentication redesign open beside a production-incident investigation,
compare two implementations in different repositories, leave one agent building on the desktop while
reviewing another agent's diagram on the laptop, or open a thread that has no repository at all and
exists only to think through a design out loud and on a canvas. In 3D, those work areas might be
spatially arranged as tables, walls, islands, or rooms. In 2D, the same environment could appear as
tabs, panes, cards on a zoomable surface, or some combination of them.

The web and 3D experiences should project the same environment state. They do not need to share the
same layout geometry or UI components.

## Three loosened boundaries

**A thread may have zero, one, or several projects.** A repository becomes an *attachment* to a
conversation rather than the conversation's identity. Zero attachments is a legitimate thread —
brainstorming, diagramming, planning — and it must not be a degenerate case bolted on later. Several
attachments is how "compare these two implementations" or "this change spans the client and the
API repo" stops requiring two disconnected conversations.

**Sessions run on hosts; people watch from clients.** The machine that executes an agent and touches
files is not the same thing as the screen the user is looking at. One user has several hosts
(laptop, desktop, cloud) and several clients (browsers, a headset), and any client should be able to
see and address any reachable host's sessions. Today the two are fused: the browser talks to the one
Next.js server on `localhost`, which is also the only executor.

**A conversation may hold more than one person.** Already anticipated by
[Story 21](../stories/STORY-20260806-web2-team-environment.md), and the real cost sits there —
identity, authorization, server-owned transcript, sandboxing. Nothing in the near term needs to pay
that, but the records should stop asserting that exactly one human exists.

The unifying rule the three share is in [Durable records never assume
"here"](#durable-records-never-assume-here).

## Working vocabulary

- **Project** — one repository. Its *identity* (which repository this is) and its *checkout* (where
  a given host has it on disk) are two different things; see
  [Project identity](#project-identity-is-not-a-path).
- **Host** — a machine or sandbox that can run agent processes and touch files: this laptop, the
  desktop, a cloud sandbox. Work happens on a host.
- **Client** — a browser, tablet, or headset displaying the environment. A client executes nothing.
  Today one process is both host and client; the concepts should separate before the code does.
- **Thread** — one user-visible conversation and its canvases, with zero or more project
  attachments.
- **Attachment** — a thread's link to one project on one host, optionally primary (the default
  working directory for agent turns) or reference (readable context).
- **Participant** — a human or agent identity in a thread.
- **Agent session** — one provider participant's private Claude/Codex session. It is working memory,
  not the canonical thread transcript, and it belongs to the host that started it — provider
  sessions do not migrate between machines.
- **Canvas** — one Mermaid diagram or user-created sketch belonging to a thread.
- **Workspace** — one open presentation of a thread. A workspace remembers which canvas and
  supporting repository/conversation surfaces are visible.
- **Environment** — the user's collection of open workspaces and navigation state, independent of
  any single device.
- **Layout** — how one client arranges one environment. Per client, not shared.

Keeping these identities separate matters. "Open this project twice" may mean two different threads;
"show this thread in two places" may mean two workspace views over one thread — possibly on two
devices; "ask the reviewer" means addressing one provider session inside the thread rather than
creating another project; and "run this on the desktop" is a statement about hosts, not about
threads.

## Tentative model

An eventual contract might resemble:

```ts
interface Environment {          // user-owned, device-independent
  id: string;
  title: string;
  workspaceIds: string[];
  createdAt: string;
  updatedAt: string;
}

interface Workspace {            // one open presentation of a thread
  id: string;
  threadId: string;
  activeCanvasId?: string;
}

interface Layout {               // per (environment, client) — never shared between devices
  environmentId: string;
  clientId: string;
  focusedWorkspaceId?: string;
  webPlacements?: Record<string, WebWorkspacePlacement>;
  spatialPlacements?: Record<string, SpatialWorkspacePlacement>;
}

interface ProjectAttachment {
  id: string;
  projectKey: string;            // portable identity of the repository
  hostId: string;                // which machine provides this checkout
  role: 'primary' | 'reference';
}

interface Host {
  id: string;                    // minted once per machine; not derived from hostname or path
  label: string;                 // "laptop", "desktop", "cloud sandbox"
  kind: 'local' | 'lan' | 'remote';
}
```

A thread then carries `attachments: ProjectAttachment[]` instead of `projectId: string`, and an
agent participant's session carries the `hostId` it started on.

The environment stores identity and user arrangement, not copies of repositories, threads, or
diagrams. A workspace references those durable records. Web placement and spatial placement are
separate projections so forcing a useful room-scale layout does not damage a useful desktop layout —
and splitting `Layout` off the environment entirely is what lets a headset and a laptop show the
same environment without fighting over geometry.

It remains open whether the same thread may appear in multiple workspaces simultaneously. Supporting
that is conceptually clean, but it complicates focus, attachment selection, and concurrent edits.

## Project identity is not a path

`projectRegistry.ts` mints a project id as a truncated hash of the checkout's real path
([projectRegistry.ts:30](../src/server/projects/projectRegistry.ts#L30)), and projects must live
under one configured root. That is a perfectly good *checkout* id and a poor *project* identity: the
same repository on the laptop and the desktop produces two unrelated ids, so nothing durable can be
said about "the same project" across devices.

Portable identity candidates — a normalized git remote, a user-declared key held in the environment,
or a first-commit hash — each have holes (no remote, forks sharing a remote, several worktrees of one
repo). Picking one is not urgent. What is urgent is not *pretending* the current id is portable:
call it a checkout, scope it to a host, and leave room for a `projectKey` beside it, so per-host
bindings (`projectKey`, `hostId`, `realPath`) can be introduced without relabelling existing data.

## Durable records never assume "here"

One rule covers most of what would otherwise need reworking later:

- no host-local path inside an identity;
- no record that means "the local machine" implicitly — a host is named or the record is host-free;
- no process-global singleton standing in for state a second host would also have;
- no browser-local storage holding anything another device must see.

The current code breaks all four, reasonably, because there is exactly one of everything: ids are
path hashes, the working directory is "the project", `runRegistry` is one global active slot
([runRegistry.ts:37](../src/server/runs/runRegistry.ts#L37)), and the transcript lives in
`localStorage`. Each is a small change now and a migration later.

## What to loosen now

Small, data-shape-first changes that buy the broader scope without building it, specified as
[Story 26](../stories/STORY-20260826-loosen-project-host-bindings.md). Roughly in dependency order:

1. **Thread → attachments.** Replace `ServerThread.projectId`
   ([types.ts:81](../src/shared/types.ts#L81)) with an ordered attachment list, migrating the
   existing value to one primary attachment; registry file version 3 → 4
   ([threadRegistry.ts](../src/server/storage/threadRegistry.ts)). The browser `ChatThread`
   ([types.ts:227](../src/shared/types.ts#L227)) needs the matching revision bump. Cheapest today,
   more expensive per week of accumulated v3 data.
2. **Stop authorizing by project.** `get(id, projectId)` and the "Unknown project-bound thread"
   errors ([threadRegistry.ts:219](../src/server/storage/threadRegistry.ts#L219)) make the project a
   component of thread identity. Authorization belongs to the user and environment; the project is
   content. Drop the paired lookups and make `projectId` optional in the wire schemas
   ([protocol.ts:55-90](../src/shared/protocol.ts#L55-L90)).
3. **Allow zero attachments — in the record first.** An attachment-free thread should persist, list,
   and accept participants immediately; what it cannot do yet is run a turn, because agent processes
   need a working directory. Splitting it that way keeps the migration cheap now and leaves the real
   question — a per-thread scratch directory, absent repository sidebar and git context
   ([conversationService.ts:76](../src/server/conversation/conversationService.ts#L76)), and the tool
   policy for a thread with no repo — as its own story, where it belongs. That second half is what
   makes brainstorming and drawing threads first-class.
4. **Name the host.** Add a host id to records that persist agent sessions and checkouts, even while
   there is only ever one host and the value is constant. It is the field whose absence forces the
   migration later.
5. **Key runs by session, not by a global slot.** Key active runs by `(threadId, participantId)` in
   `runRegistry` while keeping the policy at one concurrent turn. Lifting the limit then becomes a
   policy decision rather than a re-architecture, and a second host does not have to invent a second
   meaning for "active".
6. **Drop "exactly one human".** The registry currently rejects a thread with two human participants
   ([threadRegistry.ts:70](../src/server/storage/threadRegistry.ts#L70)). Allowing several does not
   build the team surface — Story 21 still owns identity, authorization, and shared transcript — it
   only avoids a migration when that story lands.

Deliberately **not** now: portable project identity, a sync protocol, a coordinator service,
sandboxing, presence, and any UI for more than one open workspace. Loosening structure is also not
loosening authority: permission decisions stay bound to an authenticated user on the host that runs
the tool, and every capability boundary in `AGENTS.md` survives untouched.

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

A repository-free thread makes canvases the *primary* artifact rather than a companion to code, which
raises the priority of sketch-first flows and of diagrams that are never validated against a repo.

## Browser state implications

The current shell owns one selected project, one selected thread, and one global `running` flag.
An environment needs state indexed by workspace and thread instead:

- loading or failure in one workspace must not block navigation in another;
- each workspace retains its active canvas, viewport, open panels, drafts, and unread state;
- focus is singular, but "loaded" and "running" are not;
- switching focus must not cancel an unrelated agent turn;
- permission requests and completion notifications must remain visible when their workspace is not
  focused, including in immersive mode;
- a workspace whose host is unreachable is a normal state, not an error — asleep laptops are routine.

This likely calls for an environment-level state owner and smaller per-workspace controllers rather
than extending the current `AppShell` with parallel arrays of state.

## Agent concurrency

There are two distinct promises:

1. **Simultaneous visibility:** several threads stay open and usable while one agent runs.
2. **Simultaneous execution:** agents in different sessions may run at the same time.

The first is a product requirement and does not require parallel child processes. The second should
be deliberate and bounded — and bounded *per host*, since capacity is a property of a machine, not of
a user. A cloud host and a laptop do not share a limit.

A likely policy is:

- at most one active turn per agent participant/provider session;
- optionally several active turns across independent sessions on one host;
- a configurable concurrency limit per host, based on that machine's capacity;
- visible queued/running/waiting-for-permission states per workspace, with the host named;
- cancellation, approval, replay, and reattachment keyed by `runId` and thread/participant rather
  than a global active slot;
- no concurrent turns against the same provider session unless that provider explicitly supports it.

The scheduler must not weaken Ask/Plan/Agent capability boundaries or allow one workspace to answer
another workspace's permission request.

## Persistence and device continuity

Browser-local storage is enough for one desktop prototype but cannot give a second machine or a Quest
browser the same environment. Cross-device continuity requires durable environment, thread,
transcript, artifact, annotation, and saved-view records somewhere other than a browser. Three
topologies, in increasing cost:

- **Home host.** One machine — usually the desktop — owns the records; other devices are clients of
  it. Cheapest, reuses today's server, and fails exactly when that machine is asleep or off-network.
- **Coordinator.** A small always-on service owns identity, environments, threads, and transcript;
  hosts and clients both connect outward to it, so no machine needs an inbound port. Best fit for a
  laptop + desktop + cloud mix, and the most work.
- **Replication.** Records sync peer-to-peer between hosts. Attractive on paper; conflict resolution
  over a live transcript with concurrent agent writes is the most expensive of the three.

No pick is needed yet, and the choice stays cheap as long as the records obey [the rule
above](#durable-records-never-assume-here) — a home host upgrades into a coordinator when every
record already names its host and carries its own ids.

Camera pose, controller pose, hover, and other high-frequency presentation state should remain local.
Deliberately saved spatial placement and named viewpoints may be durable. The system should avoid
streaming headset telemetry into the canonical workspace merely because the renderer can observe it.

The cloud host is asymmetric in a way worth designing for early: it cannot see the laptop's working
tree. A thread whose attachments span two hosts is the genuinely hard case, and the conservative
first rule is that an agent turn runs on one host and may only *act* on that host's attachments;
others are read-only context at most.

## Trust

Once another device connects over the network, the trust model changes: secure transport, pairing or
authentication, authorization for agent turns and permission decisions, and stronger agent isolation
become prerequisites. A headset on the LAN is still a remote client relative to the machine that can
modify repositories, and a cloud host sits outside the desktop trust boundary that today's
"trusted repository, capability restriction rather than a sandbox" stance depends on.

Two properties should not be traded away for convenience: a permission request is answered by an
authenticated human, not by whichever client is connected; and an agent turn's capabilities are
resolved on the host that executes it, never asserted by the client that requested it.

## Possible delivery slices

1. **Repository promotion** — done: the Next.js product is the root application
   ([Story 24](../stories/STORY-20260820-promote-next-app-archive-legacy.md), shipped 2026-08-21).
2. **Loosening slice** — [Story 26](../stories/STORY-20260826-loosen-project-host-bindings.md): the
   data-shape changes in [What to loosen now](#what-to-loosen-now). No new UI, no new capability —
   attachments, host ids, session-keyed runs, and the migrations they need.
3. **Environment shell:** open several threads at once in the browser, persist the arrangement
   locally, still one agent run globally. Tests navigation without taking on concurrency.
4. **Threads without, and with several, projects:** attachment management UI, the repository-free
   thread, and repository surfaces that follow the selected attachment.
5. **Independent run registry:** concurrent runs keyed by agent session with a conservative per-host
   limit, and background activity/permissions surfaced across workspaces.
6. **Second host:** a host registry, authenticated attachment to a remote host, and threads listed
   and streamed across hosts in one environment. The first genuinely multi-device step, and where
   transport security stops being optional.
7. **Durable environment and transcript:** environments, threads, and transcript available to any
   client, with an explicit migration from local storage.
8. **Desktop spatial renderer:** place Mermaid canvases/workspaces in R3F with orbit/select/focus and
   SVG fallback.
9. **Immersive WebXR:** controller interaction, room-scale placement, performance limits, secure
   headset access, and restoration of saved spatial views.

These may be reordered after a desktop 3D spike, but multi-device persistence and security cannot be
skipped for a real headset or cloud workflow.

## Open questions for a future spec

1. Is an environment automatically created per user, explicitly named, or both — and is it per user
   or per device by default?
2. Can one thread appear in several workspaces, and can one workspace change its bound thread?
3. What is the smallest useful 2D presentation: tabs, split panes, or a zoomable environment canvas?
4. What is the portable identity of a project, who mints it, and how are two checkouts of one
   repository recognized as the same project?
5. When a thread's attachments span hosts, what may a turn on one host do with the others?
6. Which host runs a turn when several could, and who chooses — the user, the thread, or a policy?
7. Can a thread move between hosts at all, given that provider sessions cannot?
8. Where does a repository-free thread's file output go, and can it later be promoted into a repo?
9. What does a workspace show when its host is offline: hidden, ghosted, or read-only from cached
   transcript?
10. Are cross-project Mermaid edges/annotations allowed, and if so, where do they belong?
11. Can artifacts be copied or referenced across threads without copying conversation history?
12. What is the default and maximum agent concurrency per host, and does a waiting permission occupy
    a slot?
13. Which environment state is local, durable, synchronized live, or saved only on request?
14. How are unsupported Mermaid types presented in immersive mode beyond the SVG-panel fallback?
15. What interaction moves a workspace versus a node inside its active spatial diagram?
16. How does the user notice a completed turn, failed run, or permission request elsewhere in a large
    2D/3D environment — or on another machine — without creating notification noise?
17. What authentication and pairing model is sufficient for one user's own devices before any
    team-hosting design exists, and what may leave the local machine for a cloud host?

## Non-decisions

This memo does not select a state library, database, synchronization protocol, transport, hosting
topology, identity provider, 3D layout algorithm, Mermaid parser implementation, WebXR interaction
toolkit, or team deployment model. Those choices belong in executable stories once the first
environment journey and constraints are selected. Its only near-term claim is that the loosening
slice is cheaper now than after more data is written in the current shapes.
