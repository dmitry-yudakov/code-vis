# Story 115 — Compact reply actions and inline tool progress

**Status:** Shipped · **Type:** Frontend-only · **Depends on:** [Story 112](STORY-20261020-tab-close-and-reply-archive.md), [Story 113](STORY-20261023-quiet-message-activity.md)

## Motivation

The reply's labelled Archive button, retained-activity notice and permanent composer status add
noise. Keep the desktop conversation focused on replies and tool activity, refining the
[workbench shell](EPIC-20260925-workbench-shell.md).

## Where the code is

- [ChatMessage.tsx:123](../src/features/conversation/ChatMessage.tsx#L123) — reply footer, timestamp, Copy and Archive.
- [TurnActivity.tsx:18](../src/features/conversation/TurnActivity.tsx#L18) — ordered tools and history notices.
- [ConversationDrawer.tsx:147](../src/features/conversation/ConversationDrawer.tsx#L147) — streaming/waiting presentation and actionable composer feedback.
- [ConversationDrawer.tsx:199](../src/features/conversation/ConversationDrawer.tsx#L199) — restore controls before the checkpoint's user message; [TurnCheckpoint.tsx:7](../src/features/conversation/TurnCheckpoint.tsx#L7) retains confirmation and error presentation.
- [globals.css:784](../src/app/globals.css#L784) — compact activity rows and progress.

## Desired behavior

Move the assistant timestamp below the reply into a compact row ordered timestamp, icon-only
Archive, Copy, with tooltips on the actions. Copy the complete original Markdown, including code/diagram
fences; report success and failure and allow retry. Preserve Story 112's final-reply-only Archive,
shared guards, routing, errors and Undo. User message timestamps stay in their headers.

Running tools show a small accessible spinner where completed tools show their result dot.
Streamed assistant text remains progressive. Remove the permanent status line above the composer.
While waiting for activity, show a compact progress indicator at the end of the timeline; queue
position and recovery status remain available. Keep actionable send-blocking reasons visible.

Remove the generic incomplete-history sentence and tooltip. Preserve specific per-entry
omitted-byte/gap information and visible unsaved-history feedback. Provider
execution, retention, persistence, approvals, scrolling and the VR presentation keep their owners.

Show the existing file-restore controls immediately before the user message that triggered the
checkpoint, including confirmation, restored status and recovery errors. Preserve the latest
checkpoint's message identity, shared desktop/VR recovery owner, live-turn lock, confirmation,
scope explanation and refusal of newer changes. This changes placement only; it does not add
conversation forks or additional recovery points.

## Acceptance criteria

- [x] Assistant replies have a compact timestamp/Archive/Copy footer with named icons and tooltips.
- [x] Copy succeeds with exact Markdown, reports failure without losing content, and can be retried.
- [x] Archive appears once only at the final completed reply; guards and Undo still work.
- [x] Running tool rows show accessible progress, settled outcomes retain named dots, and streamed text remains visible.
- [x] Idle and working conversations have no permanent composer status; timeline progress, queue/recovery and send-blocking feedback remain usable.
- [x] Reply footers are ordered timestamp, Archive, Copy, retaining their tooltips and guards.
- [x] Restore controls appear before the correct user message in normal and canonical-activity rendering, including confirmation, busy, restored and error states.
- [x] No generic shortened-history warning or icon appears; specific omissions/gaps and unsaved feedback remain visible.
- [x] Focused unit/browser checks, TypeScript, production build, light/dark desktop/phone inspection and independent review pass.

## How to verify

```sh
CODEAI_REMOTE_ACCESS=local npm test -- test/chronologicalUi.test.ts test/conversationArchive.test.ts test/runPresentation.test.ts test/sessionStore.test.ts test/nativeSecurity.test.ts test/imageAttachments.test.ts test/turnHistoryStore.test.ts test/turnHistoryConversation.test.ts test/turnCheckpointRoutes.test.ts test/turnCheckpointVr.test.ts
npm run lint
CODEAI_DIST_DIR=.next-e2e npm run build
CODEAI_DEBUG_AGENT=0 CODEAI_WORKTREES_ROOT="$PWD/test-results/worktrees" CODEAI_DIST_DIR=.next-e2e npx --no-install playwright test e2e/chronological-chat.spec.ts e2e/checkpoints.spec.ts e2e/title-bar-tabs.spec.ts --output=test-results/compact-reply-actions-followup-run
```

Inspect both themes at desktop and phone widths. Check timestamp → Archive → Copy order, Restore
files above its user message (also after reload), unchanged restore confirmation/error handling,
and specific omission details without a generic saved-history warning.

## Verification — October 26, 2026

- New footer, spinner, status-removal and retention assertions failed before implementation.
  All **113 focused unit checks**, TypeScript and the isolated production build pass.
- All **35 desktop production-browser checks** pass: exact Markdown copy, denied clipboard
  failure/retry, icon-only Archive and Undo, canonical final rendering, keyboard-accessible history
  description, running-to-completed tool indicators, approvals, delivery/draft recovery, scrolling,
  Native blocked-send feedback and existing tab guards. Both simulated-headset reconnect checks
  also pass: **37 browser checks total**. The pre-existing stale Native Retry fixture is excluded
  as described above.
- Inspected light/dark footer screenshots at 1440px and 390px under
  `test-results/compact-reply-actions/`, plus compact tool screenshots under
  `test-results/quiet-message-activity/`; icons, text and focus remain visible without overflow.
- Independent review found that accumulated preview could suppress waiting progress after
  commentary finished, and the history tooltip needed an accessible description. Both are fixed
  with regressions; the final review reports no remaining actionable findings.
- No provider execution or storage behavior changed. Real-provider and physical-headset checks
  were not rerun. The running application was not restarted; nothing was staged, committed or deployed.

## Follow-up verification — October 27, 2026

The user requested timestamp → Archive → Copy order, restore controls before the user message
that triggered the changes, and removal of the vague history warning. These refinements replace
the previous history icon/tooltip, while specific gaps and omitted-byte notes remain attached
to the affected activity. Unsaved activity still reports its state.

- The new/revised order, recovery-placement and warning-removal assertions fail before the
  changes and pass afterward. All **141 focused unit checks**, TypeScript and the isolated
  production build pass.
- All **21 production-browser checks** pass, including the real temporary-checkout restoration
  journey: placement after reload, confirmation/cancellation, restored bytes, unchanged Git index,
  refusal of later edits and interrupted-recovery feedback. Canonical replies, exact Markdown
  copy/failure/retry, tool progress, Archive/Undo, approvals and tab guards also pass.
- Inspected all four light/dark, 1440px/390px screenshots under
  `test-results/compact-reply-actions-followup/`; Restore files appears above its user message,
  footer actions retain the requested order, and no vague saved-history icon remains.
- Independent review reports no actionable code issues. Its outdated verification-instruction
  finding is corrected above. No real-provider or physical-headset run was needed for these
  desktop presentation changes. The running app was not restarted; changes remain uncommitted.
