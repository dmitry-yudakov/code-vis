# Story 109 — Make session header actions clear

**Status:** Shipped · **Type:** Frontend-only · **Depends on:** [Story 73](STORY-20261003-title-bar-tabs.md), [Story 69](STORY-20260924-archive-from-conversation.md)

## Motivation

The project header shows an unexplained caret and a detached × labelled “Close focused view.”
The user could not find how to archive completed work and reported that closing appeared to do
nothing. This is a small usability repair to the [workbench shell](EPIC-20260925-workbench-shell.md)
and the [arena's device views](../docs/vision.md). The user requested an Astra design consultation
before implementation; Astra recommended explicit Archive, All sessions, and Close tab controls.

## Where the code is

- [WorkspaceTabs.tsx:16](../src/features/conversation/WorkspaceTabs.tsx#L16) — open tabs,
  keyboard navigation, and the detached close button.
- [SessionPicker.tsx:137](../src/features/conversation/SessionPicker.tsx#L137) — the hidden-label
  native All sessions picker and new-session popover.
- [AppShell.tsx:2318](../src/features/shell/AppShell.tsx#L2318) — current-session archive guards
  and the shared archive command, with revision checks and Undo.
- [workspaceViews.ts:298](../src/features/shell/workspaceViews.ts#L298) — reconciliation currently
  reopens the first available session even after the user explicitly closed every tab.

## Desired behavior

1. Keep the existing scrolling tabs. Replace the detached × with a visible **Archive** button and
   a **Session actions** ellipsis menu containing **Close tab**, with “Keep this session in All
   sessions.” as its secondary text. Archive uses the shared single-click command and Undo.
2. Label the existing native picker **All sessions ⌄**, retaining its scoped list, keyboard
   behavior and focus target. Label the creation trigger **+ New**; narrow screens hide New and
   move Archive into Session actions to leave room for the tab title.
3. Protect both close and archive during active turns (including those reported by the machine),
   preparation/reconnection, and an archive request. Archive also requires an online machine.
   Give disabled actions concise reasons. A menu always belongs to the session that opened it.
4. Closing keeps history and device drafts available. Closing another tab retains neighbour focus;
   closing the last returns focus to All sessions and shows **No open sessions** in this project.
   Preserve that empty list through reload. Only a previously unseen scope auto-opens its first
   available session. Delete continues to close, never archive.
5. Keep the header usable at 390px and 1440px in both themes. No new dependencies, server changes,
   session lifecycle, or persistence format changes.

## Acceptance criteria

- [x] Visible Archive, All sessions, + New, and a clearly named Close tab menu replace the ambiguous controls.
- [x] Header archive uses the existing machine routing, current revision, live/offline/pending guards and Undo.
- [x] Close preserves history/drafts, neighbour and last-tab focus, and does not send an archive request.
- [x] The no-open-tabs state survives reload; first-time project selection still opens an available session.
- [x] Both themes, overflow, 390px layout, keyboard navigation and active-turn exclusions pass focused browser checks.
- [x] TypeScript, focused unit checks, an isolated production build, and an independent Astra review pass.
- [x] Empty projects show a single All sessions label without the disabled native placeholder painting over it, in both themes and at desktop/phone widths.

## Out of scope

- Session deletion, bulk actions, tab reordering, VR controls, provider execution and server policy.
- Restarting or deploying the running installation.

## How to verify

1. `npm test -- test/workspaceViews.test.ts test/workspaceTabs.test.ts test/panelLayout.test.ts`
2. `npm run lint`
3. `CODEAI_DIST_DIR=.next-e2e npm run build`
4. `CODEAI_DIST_DIR=.next-e2e npx playwright test e2e/title-bar-tabs.spec.ts`
5. Run existing desktop archive/Undo, new-chat, auto-archive, and workspace draft/layout journeys.
   Inspect light/dark and narrow screenshots; request a read-only Astra review of the final diff.

## Verification record — October 16, 2026

- Astra inspected the user's screenshot and relevant code before implementation and recommended
  explicit Archive, All sessions, + New and Close tab controls. The implementation keeps Archive
  in the menu on phones, preserving space for the selected tab.
- The new persistence test failed against the original reconciliation: a deliberately closed last
  tab reopened. It now passes without changing the storage format. The new header-action browser
  test failed on the original production build because Session actions did not exist.
- All **38 focused unit checks**, `npm run lint`, `git diff --check`, and the isolated production
  build into `.next-e2e` pass.
- **16 production-browser checks** pass: six title-bar cases plus automatic archive/restore,
  background workspace drafts/layouts, Inbox/Arena/More archive, toast/Undo, and new-chat failure
  recovery and three fresh-chat settings/reload cases. Header cases cover both themes, 390px,
  overflow, keyboard selection, menu dismissal,
  last-tab close/reload, retained drafts, single-click archive/Undo, pending request exclusion,
  approval-blocked fake-provider turns, machine-only queued turns, offline state and newer revisions.
- Light, dark and phone screenshots were inspected. Astra's end-of-work review found no remaining
  concrete issues. Its focus-lifecycle concern prompted deferred menu-trigger focus restoration;
  Escape focus assertions passed both before and after that hardening in this Chrome.
- Browser fixtures use local fake providers. No real-provider execution or physical Quest acceptance
  was needed for this desktop change. The running installation was not restarted or deployed.

## Empty-project header repair — October 20, 2026

- MUI's disabled input text fill made “No sessions yet” paint over the custom All sessions label.
  The scoped disabled-select override keeps that placeholder transparent.
- A rendered-pixel regression fails against the previous production build and passes with the fix
  in light/dark themes at 1440px and 390px. All four header screenshots were inspected.
- All seven title-bar browser checks, 38 focused unit checks, TypeScript, the isolated production
  build, and the read-only subagent review pass. The running installation was not restarted.
