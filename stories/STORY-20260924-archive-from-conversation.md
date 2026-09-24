# Story 69 — Archive the open conversation from inside it

**Status:** In progress · **Type:** Frontend-only ·
**Depends on:** [Story 39](STORY-20260903-archive-sessions.md) (archive and restore, shipped),
[Story 48](STORY-20260905-vr-session-permissions.md) (VR Session tools),
[Story 62](STORY-20260920-simplify-flat-shell.md) (the header's More menu)

**Vision context:** a maintenance slice for the shipped Arena, in step 6, "The arena," of
[vision.md](../docs/vision.md#sequence). It adds a second way to reach Story 39's archive and does
not change the lifecycle.

---

## Motivation

The user asked: *"how can we close/archive a conversation from within a conversation? both desktop
and vr"*. Closing works from inside a conversation: the tab's × on the desktop, and Session tools →
Back in VR. Closing only changes this device's layout. Archiving, which takes a finished
conversation out of the Arena, is offered only on Arena cards. So finishing a conversation means
leaving it, finding its card, and archiving it there. In VR the Arena panel preselects the current
session only when it first opens, so a person who has browsed rows since has to find it again.

---

## Current behavior (where the code is)

- Archive handler: [AppShell.tsx:1371](../src/features/shell/AppShell.tsx#L1371) (~line 1371).
  `archiveArenaSession` posts the revision-checked archive, closes the session's workspace tab,
  drops it from the session list, and offers **Undo archive** for ten seconds. It takes an
  `ArenaSessionSummary`, but it only reads `id`, `revision`, `title`, and `projectId`.
- The server refuses (409) an archive while a turn is reserved, queued, running, or waiting for
  approval: [archive/route.ts:26](../src/app/api/sessions/%5BsessionId%5D/archive/route.ts#L26).
- Flat Arena card and Inbox Archive buttons, with `window.confirm`:
  [Arena.tsx:162](../src/features/arena/Arena.tsx#L162) (~line 162).
- The header's **More** menu offers Export session but not Archive:
  [AppShell.tsx:1902](../src/features/shell/AppShell.tsx#L1902) (~line 1902).
- VR Arena Archive → Confirm archive:
  [ArenaTools.tsx:126](../src/features/shell/immersive/ArenaTools.tsx#L126) (~line 126).
- VR Session tools, inside the conversation panel. Its home view holds two full rows: New session,
  Permissions, Cancel run; then Retry (or Repository), CodeAI (or Attach primary), and Forget this
  device:
  [SessionTools.tsx:232](../src/features/shell/immersive/SessionTools.tsx#L232) (~line 232).
  Its controls come from [AppShell.tsx:1724](../src/features/shell/AppShell.tsx#L1724) (~line 1724).

---

## Desired behavior

### Concrete changes

1. **Desktop.** The More menu shows **Archive session** under Export session while a session is
   open. It uses the Arena card's confirmation text. When the person confirms, the menu closes and
   Story 39's archive runs unchanged: the tab closes, the next open tab takes focus, and **Undo
   archive** is offered. The button is disabled while this session has a turn preparing, queued,
   running, or waiting for approval, while its machine is offline, and while its archive request is
   in flight. Its tooltip says why.
2. **VR.** Session tools' home view gets **Archive session** in the slot Cancel run uses. Cancel
   run needs a live turn and archiving needs none, so the slot shows Cancel run while this session
   has a turn and Archive session otherwise. The Arena, Forget this device, and Build & restart
   already swap an action and its confirmation in one slot, and this follows them. The first
   selection turns the slot into **Confirm archive** and shows *"Archive “title”? You can restore
   it from the Arena's Archived list."* Only the second selection archives. A confirmation belongs
   to the session it was shown for. If the session changes, a turn starts, or the machine goes
   offline, the confirmation is withdrawn. Asking to forget the device withdraws it too.
3. **After a VR archive**, the Arena panel opens and takes focus, so the next session is one
   selection away. The conversation panel shows the next open session, or the Conversations list
   when none is left.
4. Both surfaces call the existing `archiveArenaSession` with the open session's machine and
   record. It takes the four fields it reads rather than a whole Arena summary. No route, store,
   or schema changes.
5. **What counts as live.** It includes a turn this device runs, and a turn the Arena poll reports
   for this session on its machine. A turn started on another device reaches this device only
   through the Arena poll.
6. **Which revision is sent.** Nothing refetches an open session that another device changed, so
   its local revision can be stale. The archive sends the higher of the local revision and the
   Arena summary's. Revisions only grow, so the higher one is current.

---

## Acceptance criteria

- [x] Desktop: More → Archive session asks for confirmation. Declining sends nothing. Accepting
      archives the open session, closes its tab and the menu, and offers Undo archive.
- [x] Desktop: Archive session is disabled while the open session's turn is live, and while its
      archive request is in flight.
- [x] VR: with no live turn, the Cancel run slot shows Archive session. With a live turn, it shows
      Cancel run and there is no Archive session control. A turn seen only through the Arena poll
      counts as live.
- [x] VR: Confirm archive does nothing before Archive session has been selected. Archive session
      shows the confirmation text, and Confirm archive then sends exactly one archive request with
      the session's current revision, including one only the Arena poll has seen.
- [x] VR: after the archive, the Arena panel is open and focused in the view that replaces the
      archived one, even when the archive resolves before that view renders.
- [x] VR: a confirmation is withdrawn when a turn starts. It never archives a session other than
      the one it was shown for.
- [x] `npm run lint`, `npm test`, and `npm run test:e2e` pass.

## Out of scope

- Reopening the tab on Undo archive. Story 39 leaves opening a restored session to the person, and
  this story keeps that.
- Archiving from the conversation panel's Conversations list, bulk archive, or permanent deletion.
- Any server, route, or store change. Story 39 already enforces run exclusion and revisions.
- Waiting for this device's pending session writes (a pin or drawing save) before archiving. A
  write that lands first makes the archive fail with a conflict, and choosing Archive session again
  succeeds. Confirming takes far longer than the 250 ms drawing save delay.

## How to verify

1. `npm run test:e2e -- e2e/canvas.spec.ts e2e/immersive.spec.ts -g "archive"`.
2. In the app, open a finished conversation and use More → Archive session. Check that it
   disappears from the tabs and the Arena, shows under Archived, and that Undo archive brings it
   back.
3. In the headset, open Session tools in a finished conversation, then select Archive session and
   Confirm archive. Check that the Arena panel comes forward and the session is under Archived.

---

## What shipped

- **One rule and one command, used by both shells**
  ([AppShell.tsx:1672](../src/features/shell/AppShell.tsx#L1672)):
  - `sessionLive` covers this device's turn and any turn the Arena poll reports for the session.
  - `canArchiveSession` also requires an online machine and no archive already in flight
    (`archivingSessionId`, [AppShell.tsx:150](../src/features/shell/AppShell.tsx#L150)).
  - `archiveOpenSession` sends the higher of the local and Arena revisions
    ([AppShell.tsx:1679](../src/features/shell/AppShell.tsx#L1679)) to the unchanged
    `archiveArenaSession`, which now takes only the four fields it reads
    ([AppShell.tsx:1373](../src/features/shell/AppShell.tsx#L1373)).
- **Desktop.** The More menu button confirms, closes the menu through `headerMenuRef`, and archives
  ([AppShell.tsx:1938](../src/features/shell/AppShell.tsx#L1938)).
- **VR controls.** `sessionTitle`, `canArchive`, `onArchive`, and the `archive` / `confirm-archive`
  actions ([sessionControls.ts:91](../src/features/shell/immersive/sessionControls.ts#L91)).
- **VR Session tools.** The shared slot
  ([SessionTools.tsx:247](../src/features/shell/immersive/SessionTools.tsx#L247)), the confirmation
  and its reset ([SessionTools.tsx:62](../src/features/shell/immersive/SessionTools.tsx#L62)), and
  the archive on the second selection
  ([SessionTools.tsx:195](../src/features/shell/immersive/SessionTools.tsx#L195)).
- **Arena forward.** Session tools reports the archived view's key. The workspace opens the Arena
  once a different view is shown
  ([ImmersiveWorkspace.tsx:90](../src/features/shell/immersive/ImmersiveWorkspace.tsx#L90)), because
  each view keeps its own layout.
- **Docs.** [README.md](../README.md#L206) in the Session tools and Arena paragraphs.
- **Tests.** [canvas.spec.ts:856](../e2e/canvas.spec.ts#L856) runs against the real e2e server with
  the fake Claude. [immersive.spec.ts:1010](../e2e/immersive.spec.ts#L1010) uses routed fixtures for
  a local turn, a turn seen only through the Arena poll, a newer revision from the Arena, and an
  Arena poll held open while the archive returns.

## Verification record

September 24, 2026, on this machine:

- **Tests first.** Both new tests failed before the implementation: the desktop menu had no Archive
  session, and the VR slot never showed it.
- **Review.** An independent review found two bugs in the first version. Each got a failing test
  before its fix:
  - the archive sent the local revision, which a change from another device leaves stale, so every
    retry failed with a conflict;
  - the Arena was brought forward in the archived view's layout whenever an Arena poll was already
    in flight, because the archive then resolved before the next view rendered.

  It also found that a second desktop archive could be sent while the first was in flight. That is
  fixed and tested too.
- **Mutation checks.** Each rule was broken in turn, and the matching test failed:
  - Archive enabled during a live turn;
  - no confirmation;
  - the menu left open;
  - a local turn not counted as live;
  - an Arena-seen turn not counted as live;
  - Confirm archive without the first selection;
  - the confirmation surviving a turn;
  - no confirmation text;
  - the stale local revision sent;
  - a second archive while one is in flight;
  - the Arena opened by the archived view's callback;
  - the Arena opened before the view changes;
  - the Arena not brought forward at all.
- **Stability.** The four archive tests passed three times in a row.
- **Suites, on the final code:** `npm run lint` passes, `npm test` passes 87 files / 691 tests, and
  `npm run test:e2e` passes 89 of 89.
- **Pending:** How to verify step 2 in the running app, and step 3 on the Quest 3S, for the user.
