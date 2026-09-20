# Story 62 — Show less of the flat shell at once

**Status:** In progress · **Type:** Frontend-only · **Depends on:** [Story 31](STORY-20260828-dock-canvas-panels.md), [Story 38](STORY-20260903-arena-and-inbox.md)

**Vision slice:** the presentation layer owned by the
[shell design-system epic](EPIC-20260828-shell-design-system.md). Nothing here changes a wire
schema, a durable record, or the immersive workspace.

---

## Motivation

The user, after a review of every non-spatial screen on September 20, 2026:

> I feel the UI is too complex and some things could be improved.

The review measured it. A session in its default layout shows 45 visible controls; opening the
conversation makes it 74. The complexity is not the number of features. It is that everything is
visible at the same level all the time, the same fact is shown in several places, set-once controls
live in permanent chrome, and the thing the product is about gets the least room: with both side
regions open a Mermaid diagram has 640 of 1440 pixels and fits at 19% zoom.

---

## Current behavior (where the code is)

- Header: [AppShell.tsx:1562](../src/features/shell/AppShell.tsx#L1562) — brand, project and session
  pickers, VR entry, Arena and Inbox links, Repository and Conversation toggles, Export, the provider
  readiness pill, the device menu, and the three theme buttons, all in one row.
- "VR unavailable" is always rendered on a desktop:
  [ImmersiveBoundary.tsx:122](../src/features/shell/immersive/ImmersiveBoundary.tsx#L122).
- The canvas toolbar repeats the header's conversation toggle as "Chat":
  [CanvasWorkspace.tsx:115](../src/features/diagram/components/CanvasWorkspace.tsx#L115).
- Repository management (reorder, primary, remove, add) is permanently expanded above the changes it
  pushes down: [RepositoryManager.tsx:43](../src/features/repository/RepositoryManager.tsx#L43).
- Rename and delete sit on every project row: [ProjectPicker.tsx:85](../src/features/projects/ProjectPicker.tsx#L85).
- The Arena opens with a display headline, a sentence, and a Docker panel that keeps its setup prose
  after Docker is ready: [Arena.tsx:159](../src/features/arena/Arena.tsx#L159),
  [Arena.tsx:176](../src/features/arena/Arena.tsx#L176). The header's Arena and Inbox links repeat
  the tabs at [Arena.tsx:220](../src/features/arena/Arena.tsx#L220).
- Arena sessions are 210px cards that repeat their machine and label two rows of metadata:
  [Arena.tsx:354](../src/features/arena/Arena.tsx#L354). Groups and sessions are ordered by last
  update, so a session that needs the user can sit below idle ones:
  [arenaModel.ts:88](../src/features/arena/arenaModel.ts#L88).
- The right dock holds the conversation *or* the canvas history, never both, and the conversation
  starts closed on a new device: [panelLayout.ts:33](../src/features/shell/panelLayout.ts#L33),
  [usePanelLayout.ts:145](../src/features/shell/usePanelLayout.ts#L145).
- History names visual artifacts "Diagram 1", "Sketch 3" on 110px cards with no picture:
  [DiagramNavigator.tsx:65](../src/features/diagram/components/DiagramNavigator.tsx#L65).
- Three layout defects: the Arena's new-session Mode control collapses until its labels read
  "AskPlanAgent"; at 390px the header's items overlap and the zoom bar covers the canvas titleblock.

---

## Desired behavior

Four parts, each its own commit, each leaving the suite green.

### Part A — Remove what is repeated or rarely used

1. The header keeps identity and navigation. Theme, Export, and the reason VR is unavailable move
   into one **More** menu. "Enter VR" still appears in the header on a device that supports it. The
   readiness pill appears only when a provider is not ready or carries a notice.
2. The header's Arena and Inbox links are hidden on the Arena, where the tabs already say it.
3. The canvas toolbar loses "Chat". The header toggle keeps the approval and unread badges.
4. The conversation header loses its "Conversation" eyebrow.
5. Session repositories collapse to one line when a session has exactly one repository. With none,
   or with several, the list stays open because it is then the way to attach or switch.
6. Project rename and delete appear on hover or keyboard focus where a pointer can hover, and stay
   visible where it cannot.
7. The Docker panel is one row. Its prose sits behind a disclosure unless setup is needed.
8. The three layout defects are fixed.

### Part B — The conversation is a column; everything else is one side panel

1. A new device opens a session with the conversation open and the side panel closed.
2. Canvas history leaves the right dock and becomes a **History** tab beside **Changes** in the left
   side panel. Opening History no longer closes the conversation.
3. The diff inspector widens the side panel only on the Changes tab.
4. Stored per-view layouts keep working; a stored `historyOpen` is ignored.

### Part C — The Arena is a list ordered by attention

1. No display headline. One compact row carries the machine count, Refresh, and New session.
2. Sessions are one-line rows: state, title, agents and repositories, activity, unread, actions.
3. Within a project, and between projects, order is: needs you, failed, running, queued, idle,
   offline; then most recently updated. The immersive Arena shares the model and the order.
4. A machine heading appears only when more than one machine is attached, or the machine is offline.
5. A row names its execution only when it is Docker.

### Part D — History shows the canvas

1. Each History entry shows a thumbnail: a sketch's marks, or the rendered Mermaid diagram.
2. Diagram thumbnails render one at a time, only once scrolled into view, and are cached per artifact
   and theme. A diagram that fails to render shows its kind mark instead.
3. Pin and Attach stay on every entry; entries lay out as a two-column grid.

---

## Acceptance criteria

### Part A
- [x] A session in its default layout shows at most 32 visible controls at 1440×900 (was 45).
- [x] Theme, Export, and the VR-unavailable reason are reachable from **More**; "Enter VR" still
      renders in the header when WebXR is available.
- [x] The readiness pill is absent when the active provider is ready without a notice.
- [x] "Chat" is gone; the header toggle still shows approval and unread counts.
- [x] One repository shows a collapsed "Session repositories"; zero or several show the list.
- [x] The Docker panel is one row when Docker is off or ready, and shows setup when it is needed.
- [x] The Arena's Mode control shows three separate labels at 1440px; at 390px no header item
      overlaps another and the zoom bar does not cover the titleblock.

### Part B
- [ ] A view with no stored layout opens with the conversation open and the side panel closed.
- [ ] History opens as a side-panel tab while the conversation stays open.
- [ ] Selecting a changed file, then switching to History, does not leave the panel double width.
- [ ] A stored layout written before this story still parses.

### Part C
- [ ] A session that needs the user is the first row of its project, and its project is first.
- [ ] One attached, online machine shows no machine heading; two show both.
- [ ] Eleven sessions fit in one 900px viewport without scrolling past the second screen.
- [ ] The immersive Arena tests still pass with the shared ordering.

### Part D
- [ ] Sketch and diagram entries show thumbnails; a failed diagram falls back to its kind mark.
- [ ] No more than one Mermaid render runs at a time, and none runs for an entry out of view.

### All parts
- [ ] `npm run lint`, `npm test`, and `npm run test:e2e` pass after each part.

## Out of scope

- The immersive workspace and the desktop Spatial surface.
- The uppercase eyebrow labels as a system. Parts A and B remove the ones they touch; a sweep of the
  rest belongs to a visual-language story.
- Renaming canvases. Thumbnails make "Diagram 1" legible; titles from content are a later change.
- The composer's stacked rows (roster, handoff chip, status, attachments, mode).
- Hiding the tab strip while one view is open. It repeats the session picker, but the strip owns a
  keyboard flow — Delete closes a tab and focuses its neighbour — that a disappearing strip would
  strand, and the suite counts tabs to know which views are open. Tried and reverted.

## How to verify

1. `npm run lint && npm test && npm run test:e2e`.
2. `npm run dev`, open a session at 1440×900 in a fresh browser profile: the conversation is open,
   the side panel closed, the header has one **More** menu.
3. Open **History** from the canvas toolbar: thumbnails appear, the conversation stays open.
4. Open `/arena`: rows, no headline, the Docker panel is one row.
5. Repeat step 2 at 390×844: nothing in the header overlaps.
