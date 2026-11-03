# Story 112 — Close tabs directly and archive after the final reply

**Status:** Shipped · **Type:** Frontend-only · **Depends on:** [Story 109](STORY-20261016-session-header-actions.md), [Story 107](STORY-20261013-chronological-chat.md)

[Story 115](STORY-20261026-compact-reply-actions.md) refines Archive into an icon beside Copy and
the reply timestamp, preserving the guards and Undo below.

## Motivation

The user finds the prominent Archive action beside the session tabs confusing. They want a
browser-style × on the tab and Archive at the bottom of the final chat message. This refines
the [workbench shell](EPIC-20260925-workbench-shell.md) and the
[arena's device views](../docs/vision.md).

## Where the code is

- [WorkspaceTabs.tsx:22](../src/features/conversation/WorkspaceTabs.tsx#L22) — tab selection,
  keyboard navigation, and the separate Archive / Session actions controls.
- [ConversationDrawer.tsx:142](../src/features/conversation/ConversationDrawer.tsx#L142) — renders
  saved replies directly or through their canonical chronological activity entry.
- [ChatMessage.tsx:32](../src/features/conversation/ChatMessage.tsx#L32) — assistant message content
  and end-of-message actions.
- [AppShell.tsx:2321](../src/features/shell/AppShell.tsx#L2321) — shared archive guards and command,
  executing-machine routing, latest revision, and Undo.

## Desired behavior

1. Each tab has an accessible × to close that tab. Remove the header Archive button and the
   separate Session actions menu. Retain All sessions and + New.
2. Closing preserves history and drafts. Closing a background tab retains the focused tab;
   closing the focused tab selects and focuses its neighbour. The last close focuses All sessions,
   and the empty state survives reload. Delete still closes the selected tab.
3. A quiet Archive action sits below the latest completed assistant message's content, once only,
   including chronological canonical replies. Empty chats, failed replies, and chats ending in a
   user message have no such action. Earlier replies do not offer it.
4. Keep the existing shared archive command, machine routing, newest revision, error feedback and
   Undo. Pending archives and live/preparing/reconnecting turns protect the relevant close action;
   offline execution disables Archive. Arena, More and VR retain their existing archive controls.
5. Retain status badges, overflow scrolling, arrow-key navigation, readable titles and accessible
   controls in both themes at desktop and phone widths. No new dependencies or persistence changes.

## Acceptance criteria

- [x] Tabs show × controls with accessible session-specific labels; the header has no Archive or Session actions.
- [x] Closing focused/background/last tabs preserves focus, drafts, history and saved empty state without archiving.
- [x] Archive appears once below only the final completed assistant reply, including canonical activity rendering.
- [x] Live/pending/offline guards, latest-revision archive, error recovery and Undo retain their behavior.
- [x] Focused unit/browser checks, TypeScript, isolated production build, screenshot inspection and independent review pass.

## Out of scope

Session deletion, automatic archive policy, server execution, VR presentation, deployment and restart.

## Follow-up — Archive from the tab × (November 3, 2026)

**Status:** Shipped

The user now expects the tab's × to mean **Archive this session**. It should use the existing
archive command for that specific session, including background tabs, rather than only hide its
device view. This supersedes the × behavior above. Delete retains its existing close-only shortcut.

Where the code is:

- [WorkspaceTabs.tsx:81](../src/features/conversation/WorkspaceTabs.tsx#L81) owns the tab archive
  control and asynchronous focus restoration.
- [AppShell.tsx:2327](../src/features/shell/AppShell.tsx#L2327) owns per-session guards, revision
  selection and the archive command.
- [AppShell.tsx:1970](../src/features/shell/AppShell.tsx#L1970) owns successful removal, error
  feedback and Undo. Story 115 now places the other Archive control in the conversation header.

- [x] Every tab's × says “Archive this session” and archives that session without confirmation.
- [x] Success removes the session from tabs and All sessions, retains neighbour/current/last-tab
      focus (New session when All sessions is disabled), and offers Undo; restored sessions retain
      their conversation and device draft.
- [x] Failure retains the tab, draft and focus and allows retry. Pending requests, local and
      machine-reported turns, preparation/reconnection and offline machines disable tab archive.
- [x] Background and overlapping archives use their own session/revision and pending state;
      finishing an archive respects newer tab selection and composer/control focus.
- [x] Delete still closes a view without archiving; overflow, saved layouts and empty-state
      persistence continue to work.
- [x] Focused unit/browser checks, TypeScript, isolated build and independent review pass.

Verify with the commands below, plus `e2e/desktop-workspace.spec.ts`'s activity-bar navigation
checks. Inspect the existing desktop/phone screenshots in both themes. Do not restart the app.

Verification: the updated rendering checks failed before implementation. All **90 focused unit
checks**, TypeScript, the isolated production build into `.next-e2e`, and **20 distinct browser
checks** pass. The browser coverage includes all title-bar and New chat cases, automatic archive,
Arena/Inbox/More archive, and light/dark activity-bar navigation. The latter retains its original
close-only empty-view journey with Delete. Desktop and phone screenshots were inspected in both
themes. Independent review found and verified fixes for delayed responses stealing composer focus
and the disabled All sessions focus target after the final archive. Its final review has no
remaining findings. Browser tests use fake providers; real attached transport and physical devices
were not rerun. The running app has not been restarted.

## How to verify

1. `npm test -- test/workspaceTabs.test.ts test/workspaceViews.test.ts test/conversationArchive.test.ts test/newChat.test.ts test/chronologicalUi.test.ts test/panelLayout.test.ts`
2. `npm run lint`
3. `CODEAI_DIST_DIR=.next-e2e npm run build`
4. `CODEAI_DIST_DIR=.next-e2e npx playwright test e2e/title-bar-tabs.spec.ts e2e/new-chat.spec.ts`
5. Run the existing desktop More archive/Undo and new-chat journeys; inspect light/dark desktop
   and phone screenshots. Review the final diff independently.

## Verification record — October 20, 2026

- New tab-close and reply-archive rendering assertions failed against the previous implementation
  and pass after the change. All **57 focused unit checks**, TypeScript and the isolated production
  build into `.next-e2e` pass.
- All **eight title-bar browser checks** and **four New chat browser checks** pass against the
  production fixture server. Coverage includes background/focused/last-tab close, keyboard close,
  overflow, saved drafts and empty state, canonical replies after reload, archive failure/retry,
  pending guards, Undo, approval-blocked turns, machine-only queued turns, offline state and latest
  revision routing.
- Independent review caught background tab close clearing the current Git status badge. Its new
  browser regression fails against the earlier build and passes after limiting the reset to the
  focused tab. Follow-up review found no remaining concrete issues.
- Light/dark screenshots of the header and final reply were inspected at 1440px and 390px.
- Six additional production-browser checks pass for automatic archive, Arena/Inbox/More archive,
  toast/Undo and background layout journeys: **18 browser checks total**. The automatic-archive
  fixture now expects no header Archive button. Browser fixtures use fake providers; no real
  provider, VR, production attached transport or running-installation restart is part of this
  desktop change.
