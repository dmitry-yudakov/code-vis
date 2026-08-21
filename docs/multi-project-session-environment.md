# Memo — Multi-project, multi-session environment

**Status:** Exploration · **Date:** August 20, 2026 · **Not an implementation spec**

This memo captures the direction for letting one person work with many repositories and many
agentic sessions in one CodeAI environment, in both the web and spatial/VR surfaces. It records
useful vocabulary, likely boundaries, and open questions without committing to an implementation
story yet.

## Product idea

CodeAI should feel like an environment containing several ongoing pieces of work, not an
application that must be closed or globally switched whenever the user changes repository or agent
conversation.

A person might keep an authentication redesign open beside a production-incident investigation,
compare two implementations in different repositories, or leave one agent building while reviewing
another agent's diagram. In 3D, those work areas might be spatially arranged as tables, walls,
islands, or rooms. In 2D, the same environment could appear as tabs, panes, cards on a zoomable
surface, or some combination of them.

The web and 3D experiences should project the same environment state. They do not need to share the
same layout geometry or UI components.

## Working vocabulary

- **Project** — one repository known to the project registry.
- **Thread** — one user-visible conversation and its canvases, permanently bound to one project.
- **Participant** — a human or agent identity in a thread.
- **Agent session** — one provider participant's private Claude/Codex session. It is working memory,
  not the canonical thread transcript.
- **Canvas** — one Mermaid diagram or user-created sketch belonging to a thread.
- **Workspace** — one open presentation of a project/thread pair. A workspace remembers which
  canvas and supporting repository/conversation surfaces are visible.
- **Environment** — the collection and arrangement of open workspaces, plus focus/navigation state.

Keeping these identities separate matters. “Open this project twice” may mean two different threads;
“show this thread in two places” may mean two workspace views over one thread; and “ask the reviewer”
means addressing one provider session inside the thread rather than creating another project.

## Tentative model

An eventual contract might resemble:

```ts
interface Environment {
  id: string;
  title: string;
  workspaceIds: string[];
  focusedWorkspaceId?: string;
  createdAt: string;
  updatedAt: string;
}

interface Workspace {
  id: string;
  projectId: string;
  threadId: string;
  activeCanvasId?: string;
  webView?: WebWorkspacePlacement;
  spatialView?: SpatialWorkspacePlacement;
}
```

The environment stores identity and user arrangement, not copies of repositories, threads, or
diagrams. A workspace references those durable records. Web placement and spatial placement are
separate projections so forcing a useful room-scale layout does not damage a useful desktop layout.

It remains open whether the same thread may appear in multiple workspaces simultaneously. Supporting
that is conceptually clean, but it complicates focus, attachment selection, and concurrent edits.

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

## Browser state implications

The current shell owns one selected project, one selected thread, and one global `running` flag.
An environment needs state indexed by workspace and thread instead:

- loading or failure in one workspace must not block navigation in another;
- each workspace retains its active canvas, viewport, open panels, drafts, and unread state;
- focus is singular, but “loaded” and “running” are not;
- switching focus must not cancel an unrelated agent turn;
- permission requests and completion notifications must remain visible when their workspace is not
  focused, including in immersive mode.

This likely calls for an environment-level state owner and smaller per-workspace controllers rather
than extending the current `AppShell` with parallel arrays of state.

## Agent concurrency

There are two distinct promises:

1. **Simultaneous visibility:** several projects/threads stay open and usable while one agent runs.
2. **Simultaneous execution:** agents in different sessions may run at the same time.

The first is a product requirement and does not require parallel child processes. The second should
be deliberate and bounded.

A likely server policy is:

- at most one active turn per agent participant/provider session;
- optionally several active turns across independent sessions;
- a configurable global concurrency limit based on machine capacity;
- visible queued/running/waiting-for-permission states per workspace;
- cancellation, approval, replay, and reattachment keyed by `runId` and thread/participant rather
  than a global active slot;
- no concurrent turns against the same provider session unless that provider explicitly supports it.

The scheduler must not weaken Ask/Plan/Agent capability boundaries or allow one workspace to answer
another workspace's permission request.

## Persistence and device continuity

Browser-local storage is enough for one desktop prototype but cannot give a Quest browser the same
environment automatically. Cross-device continuity eventually requires server-owned environment,
thread, artifact, annotation, and saved-view records, or an explicit synchronization/export model.

Camera pose, controller pose, hover, and other high-frequency presentation state should remain local.
Deliberately saved spatial placement and named viewpoints may be durable. The system should avoid
streaming headset telemetry into the canonical workspace merely because the renderer can observe it.

Once another device connects over the network, the trust model changes: secure transport, pairing or
authentication, authorization for agent turns and permission decisions, and stronger agent isolation
become prerequisites. A headset on the LAN is still a remote client relative to the machine that can
modify repositories.

## Possible delivery slices

1. **Repository promotion:** make the Next.js product the root application and establish clean
   feature/server/shared boundaries. This is owned by
   [Story 24](../stories/STORY-20260820-promote-next-app-archive-legacy.md).
2. **Environment shell:** open several project-bound threads at once in the browser, persist their
   arrangement locally, and allow only one agent run globally. This tests navigation without taking
   on concurrency.
3. **Independent run registry:** key active runs by agent session, add a conservative global limit,
   and surface background activity/permissions across workspaces.
4. **Server-owned workspace state:** make environments and required thread/artifact state available
   across browsers, with an explicit migration from local storage and an appropriate security model.
5. **Desktop spatial renderer:** place Mermaid canvases/workspaces in R3F with orbit/select/focus and
   SVG fallback.
6. **Immersive WebXR:** add controller interaction, room-scale placement, performance limits, secure
   headset access, and restoration of saved spatial views.

These slices may be reordered after a desktop 3D spike, but multi-device persistence and security
cannot be skipped for a real headset workflow.

## Open questions for a future spec

1. Is an environment automatically created per user, explicitly named, or both?
2. Can one thread appear in several workspaces, and can one workspace change its bound thread?
3. What is the smallest useful 2D presentation: tabs, split panes, or a zoomable environment canvas?
4. Are cross-project Mermaid edges/annotations allowed, and if so, where do they belong?
5. Can artifacts be copied or referenced across threads without copying conversation history?
6. What is the default and maximum agent concurrency on a typical development machine?
7. Does a waiting permission occupy a concurrency slot?
8. Which environment state is local, server-owned, synchronized live, or saved only on request?
9. How are unsupported Mermaid types presented in immersive mode beyond the SVG-panel fallback?
10. What interaction moves a workspace versus a node inside its active spatial diagram?
11. How does the user notice a completed turn, failed run, or permission request elsewhere in a
    large 2D/3D environment without creating notification noise?
12. What authentication and pairing model is sufficient for a local desktop plus headset before
    any broader team-hosting design exists?

## Non-decisions

This memo does not select a state library, database, synchronization protocol, 3D layout algorithm,
Mermaid parser implementation, WebXR interaction toolkit, or team deployment model. Those choices
belong in executable stories once the first environment journey and constraints are selected.
