# Story 116 — Jump between user messages and responses

**Status:** Shipped · **Type:** Frontend-only · **Depends on:** [Story 107](STORY-20261013-chronological-chat.md), [Story 115](STORY-20261026-compact-reply-actions.md)

## Motivation

Long conversations require too much scrolling to revisit a prompt or the response where execution
stopped. Add small previous/next icon buttons, following the user's Zed examples and the
[workbench shell](EPIC-20260925-workbench-shell.md)'s concise controls.

## Where the code is

- [ConversationDrawer.tsx:115](../src/features/conversation/ConversationDrawer.tsx#L115) owns desktop scrolling, per-session positions, follow mode and canonical reply rendering.
- [ChatMessage.tsx:34](../src/features/conversation/ChatMessage.tsx#L34) renders user headers and assistant action footers.
- [TurnActivity.tsx:18](../src/features/conversation/TurnActivity.tsx#L18) renders commentary and canonical responses in execution order.
- [runPresentation.ts:39](../src/features/conversation/runPresentation.ts#L39) resolves saved versus live turn records.
- [messageNavigation.ts:8](../src/features/conversation/messageNavigation.ts#L8) selects user and response stops from those same records.
- [MessageNavigation.tsx:8](../src/features/conversation/MessageNavigation.tsx#L8) renders the shared small arrow buttons and named tooltips.

## Desired behavior

Put previous/next user-message buttons in user headers and previous/next response buttons in
response footers. Use compact MUI icon buttons with accessible names, tooltips and disabled
endpoints. Hide a pair when there is only one target of its kind.

A response is the last assistant message before the next user message, or the latest stopped
turn's last assistant message. Prefer the canonical response when present; otherwise include the
last retained assistant activity of a completed, failed, cancelled or interrupted turn. Skip
intermediate commentary, tools and live text from a turn still executing. Support older transcripts
without activity records and consecutive user messages without inventing responses.

Navigation scrolls only the conversation, aligns and focuses the target's start, and uses the
existing position/follow owner. Scrolling back during a live turn must remain stable; new activity
still offers Jump to latest, and switching sessions restores each scroll position. Preserve
timestamp/Archive/Copy order, recovery placement, drafts, approval controls and canonical response
deduplication. No durable session format or VR changes.

## Acceptance criteria

- [x] Compact named icon buttons navigate both directions between user messages and between responses, with disabled boundaries and no useless pairs.
- [x] Response targets include canonical, legacy and stopped-turn fallback messages while skipping intermediate/live activity and handling unanswered prompts.
- [x] Navigation scrolls and focuses the correct message within the conversation, including canonical responses nested inside activity.
- [x] Live updates, Jump to latest, session scroll restoration, drafts and existing reply/recovery actions retain their behavior.
- [x] Focused unit/browser checks, TypeScript, production build, both-theme desktop/phone inspection and independent review pass.

## Out of scope

VR navigation, keyboard shortcuts, provider execution and transcript retention changes.

## How to verify

```sh
CODEAI_REMOTE_ACCESS=local npm test -- test/messageNavigation.test.ts test/conversationArchive.test.ts test/chronologicalUi.test.ts test/newChat.test.ts test/runPresentation.test.ts test/composerMenus.test.ts test/imageAttachments.test.ts -t '^(?!.*uses an outlined MUI instruction field)'
npm run lint
CODEAI_DIST_DIR=.next-e2e npm run build
CODEAI_DEBUG_AGENT=0 CODEAI_WORKTREES_ROOT="$PWD/test-results/worktrees" CODEAI_DIST_DIR=.next-e2e CODEAI_E2E_PORT=3034 npx --no-install playwright test e2e/message-navigation.spec.ts e2e/chronological-chat.spec.ts --output=test-results/message-navigation-final-run
```

Exercise long legacy and canonical replies, stopped commentary without a final response,
unanswered user messages, active streaming and session switching. Inspect both themes at desktop
and phone widths. Check disabled endpoints, keyboard navigation and target focus, unchanged
timestamp/Archive/Copy order, stable reading during activity, and Jump to latest.

## Verification — October 28, 2026

- Target-selection assertions fail with an empty implementation. All **91 selected unit checks**
  pass. One existing composer assertion is excluded: `composerMenus.test.ts:273` expects an
  outlined input while the unchanged composer uses `variant="standard"`; this stale assertion is
  already recorded by Stories 111 and 113. The core navigation/chronological/archive/run/New chat
  selection passes all **57 checks** without exclusions. Route tests need
  `CODEAI_REMOTE_ACCESS=local` to override this machine's paired-access configuration.
- TypeScript and the production build pass. The initial sandboxed build could not download the
  existing Google Fonts; the approved build succeeds. Next.js's generated test-type includes are
  kept as written, per the repository instructions. Build output is excluded from the working diff.
- All **16 production-browser checks** pass: both navigation directions, disabled boundaries,
  canonical deduplication, stopped-activity fallback, legacy commentary skipping, keyboard focus,
  per-session positions/drafts, live updates and existing approval/recovery/copy behavior.
- The bottom-clamped live-prompt regression fails in the pre-fix production build. Protecting the
  programmatic jump and session-return scroll events preserves paused following; after completion
  Jump to latest remains available. The long-turn case separately proves stable older reading.
- Inspected light/dark, 1440px/390px user-header and response screenshots under
  `test-results/message-navigation/`; controls remain visible without horizontal overflow.
- Independent review's scroll-follow and failed-test cleanup findings are fixed; final review
  reports no actionable findings. No real-provider or physical-headset checks were needed for this
  desktop-only change. The running application was not restarted; nothing was staged, committed
  or deployed.
