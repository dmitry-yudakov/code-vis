# Story 113 — Quiet message headers and tool results

**Status:** Shipped · **Type:** Frontend-only · **Depends on:** [Story 107](STORY-20261013-chronological-chat.md)

[Story 115](STORY-20261026-compact-reply-actions.md) refines running dots into spinners and moves
reply actions and timestamps into a compact footer, retaining specific omission details with the activity.

## Motivation

The desktop transcript repeats an obtrusive “Native · Auto” badge on messages and gives every
tool a bordered card, written result, and sometimes a long error excerpt. The user wants less
visual noise and green/red result dots with details available on demand. This refines the
conversation in the [workbench shell epic](EPIC-20260925-workbench-shell.md).

## Implementation (where the code is)

- [ChatMessage.tsx:49](../src/features/conversation/ChatMessage.tsx#L49) keeps both message headers
  to author/recipient and time, omitting repeated mode chips.
- [TurnActivity.tsx:48](../src/features/conversation/TurnActivity.tsx#L48) renders named result dots
  and retains full errors and omission notes inside tool disclosures.
- [globals.css:784](../src/app/globals.css#L784) owns compact row spacing and themed status colors.

## Desired behavior

Remove mode chips from desktop message headers; keep the active mode and execution information
in the composer. Show compact, borderless tool disclosures with a result dot, tool/command text,
and a chevron. Success is green, failure/denial red, running amber, cancelled/unknown gray.
Each dot has an accessible result name and hover title. Expansion reveals the written result,
actor, full retained arguments/output/diff/error, timing, exit code and omissions.

Story 107's stable entry identities, chronology, keyboard expansion, scroll behavior, inert
provider output, approval review, and reload persistence still apply. This changes presentation
only; provider policies, stored message modes, approval controls and the VR transcript keep
their existing owners.

## Acceptance criteria

- [x] Desktop user and assistant messages have no repeated mode chip; composer mode stays visible.
- [x] Compact tools have correctly named result dots for all six outcomes in both themes.
- [x] Details and full retained errors are collapsed initially and reveal by pointer or keyboard.
- [x] Long summaries/details fit narrow layouts; tool order, reload, approvals and final delivery work.
- [x] Relevant unit/browser checks, TypeScript, production build, screenshot inspection and independent review pass;
      unrelated stale test assertions are documented below.

## How to verify

Run the focused presentation checks (excluding the stale assertions described below):

```sh
CODEAI_REMOTE_ACCESS=local npm test -- test/chronologicalUi.test.ts test/composerMenus.test.ts test/nativeSecurity.test.ts test/conversationArchive.test.ts test/imageAttachments.test.ts --testNamePattern '^(?!.*uses an outlined MUI instruction field)'
npm run lint
CODEAI_DIST_DIR=.next-e2e npm run build
CODEAI_DEBUG_AGENT=0 CODEAI_WORKTREES_ROOT="$PWD/test-results/worktrees" CODEAI_DIST_DIR=.next-e2e npx --no-install playwright test e2e/chronological-chat.spec.ts e2e/native-security.spec.ts e2e/machines.spec.ts --grep-invert 'shows the isolation reason'
```

Inspect light/dark desktop and narrow screenshots, expand failed tools, and reload.

## Verification

Verified October 23, 2026. The new badge-removal assertion and six accessible-result assertions
failed before implementation and pass afterward. The focused offline run passes **74 tests**, with
one pre-existing composer assertion excluded: it still expects `MuiOutlinedInput-root` although
the composer already uses an unframed textarea. TypeScript and the isolated production build pass.

The production-browser run passes **14 of 15 cases**, including both new presentation cases,
chronological order, reload, large live bursts, approval decisions/review, scrolling, remote
Guarded/Native sessions, and Native writing modes. The remaining pre-existing Native Retry fixture
expects an occupied draft to be appended immediately; Story 107's current behavior asks the user
to select **Replace draft** first (`AppShell.tsx:1351`). No retry behavior was changed here.
Initial test-only failures were corrected: the fake Claude reports denied tools as failed, and
the Native fixture server needs its worktree root isolated from the managed-checkout environment.

Reviewed eight screenshots under `test-results/quiet-message-activity/`: light/dark, 1440/390 px,
collapsed/expanded. Dots and disclosure arrows remain visible, long summaries truncate, and
expanded text wraps. Independent review found one missing separator before the omission note;
it now occupies its own paragraph, and rereview reports no remaining actionable findings.
No real-provider or physical-headset checks were needed for this desktop-only presentation change.
The running application was not restarted; no staging, commit or deployment was performed.
