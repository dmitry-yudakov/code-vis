# Story 120 — Give each module room on phones and maximize any pane

**Status:** Shipped · **Type:** Frontend-only · **Depends on:** Stories 73, 107, 118

## Motivation

The phone conversation loses too much space to navigation, panel margins and the composer.
The user approved reviewing and implementing a compact phone layout and maximize/restore for
Conversation, Canvas, and the side panel on both desktop and mobile. This serves the workbench
shell epic and the repository conversation slice of the vision.

## Where the code is

- `src/features/shell/panelLayout.ts:28` and `usePanelLayout.ts:53` own per-session device layouts,
  docking capacity, focus, sizing and persistence.
- `src/features/shell/AppShell.tsx:2390`, `ActivityBar.tsx:19` own navigation and pane composition.
- `src/features/conversation/ConversationDrawer.tsx:211`, `InstructionComposer.tsx:390`,
  `src/features/diagram/components/CanvasWorkspace.tsx:121` and
  `src/features/repository/RepositorySidebar.tsx:40` own the pane controls and composer.
- `src/app/globals.css:577` currently floats narrow panes beside a vertical rail.

## Desired behavior and contracts

1. Maximize/restore uses one optional pane selection in the existing per-session layout record.
   Maximize leaves underlying open flags, widths, inspector and side tab intact; restoring brings
   them back. Old `focusMode: true` migrates to maximized Canvas. Desktop keeps title/navigation;
   narrow screens hide shell chrome while maximized. Escape restores when no menu/dialog consumed it.
2. Below the existing 740 CSS-pixel docking threshold, show one full-width module above a bottom
   bar: Chat, Canvas, Changes, History, More. Reports and global session navigation remain reachable
   in More. The compact header keeps project, tabs, All sessions and New session on one row.
   Keep VR capability available on capable devices; do not infer hardware from viewport width.
3. Compact the phone composer, retaining readable 14px replies, 16px input, and 40px primary touch
   controls. Execution details remain available on demand. The textarea grows from one line.
   Request content resizing for virtual keyboards where the browser supports it.
4. A hidden conversation's approvals/unread remain accessible in navigation, and while maximized
   on the pane restore control. Provide a direct route to Conversation for pending approvals.
5. Preserve Story 118 desktop minimums/gutters, Story 73 tab focus/storage, Story 107 drafts,
   scrolling and approval recovery, screenshot drawing, and history navigation. No server changes.
   Canvas drawing shortcuts must never act while another module is shown. Automatic dock
   reconciliation must not rewrite the saved layout while maximized.
6. Changes and its diff have bounded, independently scrollable bodies. At narrow widths the
   selected diff replaces the file list, keeping the pane's Restore and the diff's Back in reach
   even with many files or a long patch.
7. Docked, a pane offers Maximize only while another pane is shown: alone it already has the room.
   Below the docking threshold every module keeps it, because it also hides the header and bottom
   bar. A maximized pane always keeps Restore.

The epic permits temporary side-panel maximize as a named exception to its canvas/conversation
visibility rule. Replace Canvas Focus and remove its duplicate New sketch toolbar action to pay
for the Conversation maximize control in the default control budget. New sketch stays in Attach.

## Acceptance criteria

- [x] Each pane maximizes/restores at desktop and narrow widths; saved layouts and legacy focus
      migrate safely, including reload and restoration with an open diff inspector.
- [x] Narrow navigation shows one full-width module, with accessible More/Reports/Arena/Inbox;
      drafts survive navigation and desktop geometry survives widening.
- [x] Compact phone header/composer and readable messages work in both themes without horizontal
      overflow; primary pane/navigation/composer controls retain 40px touch targets.
- [x] Pending approvals can be reached from a maximized non-conversation pane and from narrow
      navigation. Canvas/history/image actions reveal their destination.
- [x] A phone can select the last of 30 changed files and scroll a 150-line patch to the bottom
      while Restore and Back remain visible.
- [x] Focused unit/browser regressions, TypeScript, production build, visual inspection and an
      independent review pass. Record physical-device limitations explicitly.
- [x] Docked, a pane alone shows no Maximize; it appears as soon as another pane opens. Phones keep
      it, and a maximized pane keeps Restore.

## How to verify

Run focused panel-layout/workbench unit tests, `npm run lint`, an isolated production build,
and Playwright mobile/maximize plus affected desktop, canvas, tabs, image and conversation cases.
Inspect light/dark screenshots at 390 and 1440 CSS pixels. Physical iOS/Android keyboard behavior
and headset behavior require their devices; desktop viewport simulation cannot establish those.

Regression coverage first failed against the old layout (seven focused layout failures), then
passed with the implementation. Independent review found and verified fixes for closing a
maximized pane through navigation, Escape after kept-mounted menus/dialogs, following background
chat activity on restore, and long phone file lists/patches. Compact Chat/Canvas now use the same
visual and keyboard order, and their visible labels are included in their accessible names.

Existing browser expectations for vertical phone navigation, floating overlays and Canvas Focus
are updated to module selection/maximize. Stale greeting, pre-inset canvas dimensions and composer
input-variant assertions now match the behavior already implemented by earlier stories.

Verification on October 31, 2026:

- 112 focused unit tests pass across panel layout, workbench controls, composer menus, workspace
  tabs/views, device preferences and conversation archive. `npm run lint` and the isolated
  production build into `.next-e2e` pass. The build used approved network access for existing fonts.
- The affected browser suites exercise layout restoration/reload, drawing and image ink,
  hidden-canvas shortcuts, drafts/stream recovery, permissions, tabs, repository diffs,
  instructions, New chat and both themes. All 100 distinct checks pass: 88 across the affected
  suites and 12 MUI shell/panel fixtures. The 88-case run passed 87 immediately; its screenshot
  return case passed after updating the selector from Conversation to Chat. The six MUI pane
  fixtures also pass after distinguishing Changes navigation from Maximize Changes.
- Light/dark phone/desktop screenshots were inspected, including the bottom of a 150-line phone
  patch with Back and Restore in reach. Independent review confirms no remaining material issues.
- Physical iOS/Android virtual keyboards, safe-area hardware and Quest behavior were not tested.
  The running application was not restarted, deployed, or committed.

Follow-up on October 31, 2026: `canMaximize` ([panelLayout.ts](../src/features/shell/panelLayout.ts))
hides Maximize from a docked pane that is alone. An empty canvas alone then has nothing for its
toolbar to hold, so it drops the bar and the stage takes the row.

- The new unit test first failed without `canMaximize`. Removing the narrow exception, counting one
  pane as enough, and removing the Restore guard each made a test fail; all three were restored.
- 43 focused unit tests and `npm run lint` pass. The final production build passed all 84 browser
  checks that ran across the mobile-panes, canvas, chronological-drafts and MUI suites, with one
  skipped, on its second full run. On the first, `canvas.spec.ts:1780` failed once; it then passed
  three times alone and in the second full run. Its error was overwritten by the rerun, so the cause
  is unknown.
- `npm test` has 39 failures in eight server-side files outside this change. All 39 also fail on a
  clean copy of the previous commit, which has one more failure in `dockerCustomizations.test.ts`.
- No independent review ran for this follow-up. The running application was not restarted.

## Out of scope

Server, provider, VR implementation changes, and the epic's status bar or Arena-in-side-panel work.
No running application restart or deployment.
