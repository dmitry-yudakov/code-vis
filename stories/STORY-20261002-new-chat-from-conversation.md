# Story 86 — Start a new chat from the conversation header

**Status:** Shipped · **Type:** Frontend-only · **Depends on:** [Story 70](STORY-20260924-remember-turn-choices.md)

## Motivation

The user wants a New chat icon at the conversation panel's top right that creates an empty
session in the same project with the same settings and closes the previous chat. This improves
the desktop [workbench shell](EPIC-20260925-workbench-shell.md) within the
[arena vision](../docs/vision.md).

## Current behavior (where the code is)

- [ConversationDrawer.tsx:92](../src/features/conversation/ConversationDrawer.tsx#L92) — the
  conversation header shows its title and addressed agent.
- [AppShell.tsx:637](../src/features/shell/AppShell.tsx#L637) — session creation opens a tab and
  initializes device-owned mode and model choices.
- [useWorkspaceViews.ts:79](../src/features/shell/useWorkspaceViews.ts#L79) — closing a tab
  preserves its device view and durable conversation.
- [sessionStore.ts:526](../src/server/storage/sessionStore.ts#L526) — creation from a source
  already copies its project, repositories, and instructions and starts a fresh provider session.

## Desired behavior

1. Add an icon-only **New chat** button at the conversation header's right edge, with an
   accessible name, tooltip, keyboard focus, and existing shell line-icon styling.
2. Create an empty session on the same machine and execution using the current session as its
   source. Preserve the addressed agent's provider and role, selected mode, model and effort,
   and the source's project, exact repositories and global-instructions choice.
3. Open the new chat, then close only the source tab after successful creation. Keep its
   conversation and draft available through the session picker. Failure leaves the tab open
   and shows the existing error notice.
4. Disable New chat during an active or preparing turn, session creation, participant changes,
   or checkout Undo. Repeated activation creates at most one session.
5. Copy the selected mode explicitly, including Auto and Native writing modes; normal creation
   forms retain their existing defaults. Start with no recap, draft, attachments or transcripts.

## Acceptance criteria

- [x] The header exposes an accessible New chat icon with a tooltip and keyboard focus.
- [x] Its placement at narrow widths is verified in the production browser.
- [x] A fresh chat keeps machine, execution, project, repositories, instructions, addressed
      provider and role, mode, model and effort.
- [x] Success closes only the source tab and preserves its record and draft; failure keeps it open.
- [x] Busy states disable the action and repeated activation creates at most one session.
- [x] Focused offline checks and TypeScript checking pass.
- [x] Focused production browser checks pass.

## Out of scope

Archiving or deleting the old session, copying its transcript or full roster, VR controls,
and changes to server permissions or provider policy.

## How to verify

1. Run `npm test -- test/newChat.test.ts test/workspaceViews.test.ts test/devicePreferences.test.ts
   test/sessionRoutes.test.ts test/workspaceTabs.test.ts` and `npm run lint -- --incremental false`.
   Then run `npm run test:e2e -- e2e/new-chat.spec.ts --project=chrome`.
2. Choose an agent's mode, model and effort, then click New chat. Check its empty composer and
   transcript and preserved settings. Reopen the old session and check its history and draft.
3. Repeat with loose/project sessions, Docker, and Auto/Native modes when available.
4. Check the disabled action during a live turn and a pending creation. Simulate a failed
   session-create request and check that the original tab remains open with an error notice.

## Implementation and verification

- [AppShell.tsx:714](../src/features/shell/AppShell.tsx#L714) creates the fresh chat with the
  addressed agent's settings and closes its source view after success. The existing creation
  guard prevents duplicate requests. Source inheritance on the server needs no change.
- [ConversationDrawer.tsx:99](../src/features/conversation/ConversationDrawer.tsx#L99) supplies
  the header button and busy-state handling; `ShellIcon.tsx` and `globals.css` supply its styling.
- October 2, 2026: all 48 focused offline tests passed, including seven header accessibility and
  busy-state checks. TypeScript checking and `git diff --check` passed.
- The isolated New chat changes also passed all 48 focused tests and TypeScript checking in a
  clean copy of HEAD, without the concurrent image-annotation changes.
- The browser check failed before implementation because New chat was absent, as expected.
- October 2, 2026: the production build passed and all four focused production-browser checks
  passed against `.next-e2e`, including Plan, Auto in a loose session, Native Full access,
  preserved settings after reload, narrow header placement, duplicate activation, failed
  creation, and a preparing turn. The tests explicitly return to No project after reload and
  reopen Conversation when the narrow shell brings a repository-free session's repository
  panel forward, following the existing shell navigation behavior.
