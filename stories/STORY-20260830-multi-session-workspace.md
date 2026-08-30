# Story 36 — Keep several session views open on one device

**Status:** Shipped · **Type:** Frontend-only ·
**Depends on:** [Story 35](STORY-20260829-projects-and-repositories.md) (projects and repository-bound sessions, shipped) and
[Story 27](STORY-20260826-session-keyed-host-bound-runs.md) (run-id recovery, shipped)

**Vision context:** step 4, “Several sessions open at once,” in
[vision.md](../docs/vision.md#sequence), and the workspace-shell delivery slice in
[multi-project-session-environment.md](../docs/multi-project-session-environment.md#possible-delivery-slices).

---

## Motivation

CodeAI can retain many durable sessions, but the browser still treats the selected one as a single
replaceable slot. Switching is disabled while an agent runs, a recovered stream is attached to the
focused session rather than the host-wide active run, and draft/layout/canvas state leaks or resets
as focus moves. That makes a second session something to *leave for*, not something that stays open.

The next roadmap slice is navigation without execution concurrency: keep several sessions open and
usable, move focus among them while the one machine-wide turn continues, and make the arrangement
device-local and disposable. Losing browser storage must never lose the durable session record.

---

## Current behavior (where the code is)

- Shell state: [AppShell.tsx](../src/features/shell/AppShell.tsx#L63) (~line 63) owns one
  `sessionId`, composer, attachment list, unread count, repository selection, and run presentation.
- Session navigation: [SessionPicker.tsx](../src/features/conversation/SessionPicker.tsx#L7)
  (~line 7) replaces the selected session and is disabled while the global run is active.
- Run recovery: [AppShell.tsx](../src/features/shell/AppShell.tsx#L914) (~line 914) discovers only
  the focused session's run and aborts the recovery subscription when focus changes.
- Panel layout: [usePanelLayout.ts](../src/features/shell/usePanelLayout.ts#L51) (~line 51) owns one
  set of open panels and persists only two machine-wide widths.
- Canvas camera: [DiagramCanvas.tsx](../src/features/diagram/components/DiagramCanvas.tsx#L88)
  (~line 88) owns zoom and pan in component memory, so leaving a canvas loses its camera.
- Durable/browser boundary: [sessionStore.ts](../src/features/conversation/sessionStore.ts#L38)
  (~line 38) hydrates ephemeral canvas, addressee, and mode selection onto a canonical public
  session snapshot.

---

## Desired behavior

### A. A small workspace state owner

1. Within the selected project (including the “No project” scope), choosing a session opens a
   tab-like **view** instead of replacing the only slot. Focus remains singular; any number of
   sessions may stay open.
2. Views can be focused and closed. Closing a view never deletes or mutates its durable session.
   The global running view stays open until its turn finishes so approval and cancellation remain
   reachable.
3. The device persists each project scope's open order, focused view, draft, pending canvas
   attachments, unread count, selected repository, active canvas, addressee/mode, canvas cameras,
   and panel layout in versioned `localStorage`. Invalid, stale, or unavailable storage falls back
   safely. Canonical messages, canvases, annotations, participants, projects, and repository
   bindings never enter that record.
4. A catalog reload reconciles saved view ids with durable sessions. Missing sessions disappear
   from the arrangement; the first durable session opens only when no valid saved view remains.

### B. Navigation while one turn runs

5. Starting a turn still consumes the one host-wide slot. Its `sessionId` remains explicit in
   browser state, and only its view renders streaming text, tool activity, permissions, cancel, and
   the run ribbon.
6. The user may focus another open session, inspect its transcript/canvases/repository, edit its
   draft, change its local layout, and create a sketch while the turn continues. Starting a second
   turn remains blocked.
7. Background activity is visible on the running view's tab. Completion or approval increments
   that view's unread state when its conversation is not the focused open drawer; focusing another
   session never cancels or detaches the live request.
8. Reload recovery discovers the host-wide active run, opens its durable session if necessary,
   attaches by `runId`, and keeps navigation independent of that subscription.

### C. Per-view canvas and panel placement

9. Repository/conversation/history visibility, focus mode, inspector state, and both panel widths
   restore independently for each view and remain responsive to the current window width.
10. Each canvas's fitted/manual camera state (zoom and pan) restores when its view or canvas is
    revisited. Camera state remains device-only; the attachment's canonical SVG `viewBox` contract
    is unchanged.
11. The open-view strip is keyboard-focusable, exposes tab semantics, truncates long titles, and
    remains horizontally scrollable at narrow widths without shrinking the canvas below its
    existing minimum.

### Device-only contract

```ts
interface DeviceWorkspace {
  version: 1;
  scopes: Record<string, {
    openSessionIds: string[];
    focusedSessionId?: string;
    views: Record<string, {
      composer: string;
      pendingAttachmentIds?: string[];
      unread: number;
      selectedCheckoutId?: string;
      activeDiagramId?: string;
      addressedAgentId?: string;
      defaultMode?: AgentMode;
      canvasViews: Record<string, { zoom: number; pan: { x: number; y: number }; fitted: boolean }>;
    }>;
  }>;
}
```

Panel layout uses a second versioned device record keyed by the same view/session id so the
responsive layout hook can own all geometry transitions without putting browser state in shared
wire types.

---

## Acceptance criteria

- [x] Selecting two existing sessions leaves two visible views; either can be focused or closed,
      and a reload restores their order and focus.
- [x] Each view independently restores its unsent draft, selected repository, active canvas,
      attachment list, unread count, addressee/mode, open panels, focus mode, inspector state,
      widths, and per-canvas zoom/pan.
- [x] Missing/invalid saved ids and malformed or unavailable `localStorage` recover to safe defaults
      without changing or losing any durable session data.
- [x] A turn keeps streaming when focus moves to another view. Only the owning view shows live run
      detail; its tab shows working/approval/unread state and remains reachable.
- [x] A non-running view stays navigable and its draft/sketch/layout remain editable while a global
      turn runs, but its send action cannot start a second turn.
- [x] Reload recovery discovers and reattaches the host-wide active run even when a different view
      had focus, without later focus changes aborting the stream.
- [x] Closing a normal view never deletes its session; the running view cannot be closed until the
      turn completes.
- [x] The view strip has accessible tab semantics, keyboard-operable controls, long-title
      truncation, and narrow-screen horizontal overflow.
- [x] `npm run lint`, `npm test`, and `npm run test:e2e` pass with unit coverage for device-state
      parsing/reconciliation and browser coverage for view persistence plus navigation during a run.
- [x] A failed session-catalog request leaves every persisted project view and its device-only state
      untouched; pruning occurs only after a successful catalog response.
- [x] Persisted panel layouts are bounded without preferring stale entries, and successful
      reconciliation removes layouts only when their session is absent from every saved scope.
- [x] Refreshing a background session preserves fresher in-memory canvas, addressee, and mode state
      over an older persisted device snapshot.
- [x] When one attached active canvas is automatically revised, the new revision replaces that
      canvas in the pending attachment list without discarding other explicitly selected canvases.
- [x] Host-wide run recovery opens the owning session in its canonical project scope rather than
      inserting a foreign session into the currently selected project.
- [x] Provider-session continuation is offered only when a concrete missing-provider session is the
      focused session.
- [x] The workspace tablist exposes only `tab` children to assistive technology; closing remains
      keyboard accessible and does not place unrelated controls inside the tablist.

## Out of scope

- Concurrent turns, queueing, or changing `MAX_CONCURRENT_RUNS = 1`; the independent run-registry
  slice owns that.
- Cross-project views in one strip. This first workspace is scoped to the selected project; a
  running turn keeps project navigation locked while same-project views remain freely navigable.
- The Arena, Inbox, cross-session permission answering outside an open view, notifications, or
  activity aggregation.
- Durable/synced workspace records, named views, multiple devices, a second machine, or allowing
  the same session to appear in two views.
- Split panes, freeform 2D placement, spatial/3D layout, and WebXR. Tabs are the smallest useful 2D
  presentation for proving the state and navigation boundaries.

## How to verify

1. Open two sessions in one project, leave different drafts, canvases/cameras, repository
   selections, and panel arrangements in each, then switch repeatedly and reload. Both tabs and
   all device-only state restore; the host JSON contains none of it.
2. Start a fake-provider turn in one view and immediately focus the other. Edit its draft, open its
   repository/history, and create a sketch. The original tab stays visibly working and receives the
   completed transcript; a second send remains unavailable.
3. Repeat with an approval-producing Agent turn. The background tab announces approval, opens back
   to the permission card, and can be answered by its `runId`.
4. Reload while a turn is active with the other tab saved as focused. The active run is discovered
   host-wide, its view is present, and switching focus after reattachment does not stop it.
5. Corrupt the device workspace/layout keys and include a nonexistent session id. Reload: CodeAI
   opens a valid durable session with default layout and does not write to any durable record merely
   to repair device state.
6. Intercept the selected project's session catalog with a temporary 503. The notice appears without
   a continuation action, the parsed device workspace remains identical, and the draft restores when
   the catalog succeeds again.
7. Load more than 200 panel layouts and refresh a background session with stale persisted selection.
   The newest layouts remain bounded, and the in-memory canvas, addressee, and mode survive hydration.
8. Start a turn in one project, make another project the default reload landing, and reload. Recovery
   switches to the owning project before opening or attaching the running session.
9. Inspect the workspace tablist accessibility tree: it owns only tabs. Arrow keys move among tabs,
   Delete closes a non-running tab and moves focus, and the separate close control follows focus.
