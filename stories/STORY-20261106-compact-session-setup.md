# Story 130 — Make new-session setup a compact composer

**Status:** Shipped · **Type:** Frontend-only · **Depends on:** [Story 97](STORY-20261007-compose-new-session.md)

## Outcome

Starting a session usually requires only a message, an optional pasted image, and an occasional
switch between Claude and Codex. The desktop launcher previously showed repeated target summaries,
expanded session settings, a separate report section, and an ambiguous Clear setup action.

- Keep the message, attachment chips and a shared-style **+ Attach** menu in one composer surface.
  Files/screenshots and eligible CodeAI reports are reached through that menu; paste/drop and
  preview/remove keep their existing contracts.
- Keep provider and mode directly available. One initially closed **Settings** panel holds
  machine/project/repository, checkout/worktree, execution, model/effort and global instructions.
  Hide the machine selector when the only configured machine is online. Show the project once, with
  multi-machine and non-default execution/worktree context where relevant.
- General setup remembers the machine used to create its last session in browser device
  preferences. An unavailable remembered target remains blocked until explicitly changed.
  Project shortcuts keep their exact target; the managed CodeAI shortcut stays fixed to home
  and does not replace the general machine preference. Existing provider/model/effort memory stays.
- **×** closes and keeps the memory-only draft. **Discard draft** lives inside Settings, appears
  for edited drafts or recovery/conflicting-target state, and explains that it removes the message,
  evidence and setup choices while keeping any created session. It is disabled during uncertainty.
- During submission, replace the form with compact progress and **Close**. After acceptance, the
  existing launcher closes and announces the session with **Open session**. Failure restores the
  draft, **Retry**, and **Open created session** when one exists.

`SessionSetupDialog.tsx` owns presentation; `useSessionLauncher.ts` continues to own the one draft,
creation/message UUIDs, evidence, frozen recovery and late completion. The server and launch
protocol are unchanged. Closing pending setup never cancels work or allows duplicate creation.
The immersive presentation retains its existing layout and uses the shared launcher.

## Verification

- [x] Desktop and phone composition in light/dark themes, image paste, attachment menu, focus,
      close/reopen, discard and initially hidden settings.
- [x] Successful background/empty launches, compact progress, rejected-message retry in the same
      created session, lost creation recovery and frozen target protection.
- [x] General remembered/offline/removed machine behavior, fixed-home CodeAI and explicit project targets.
- [x] Existing model/effort, instructions, reports, worktrees and MUI dialog browser checks.
- [x] Focused unit checks, TypeScript, isolated production build and independent review.

All 40 focused Vitest checks pass (`devicePreferences`, `sessionLaunch`, `composerMenus`,
`creationReceipt`), along with `npm run lint` and `CODEAI_DIST_DIR=.next-e2e npm run build`.
Across the affected suites and follow-up runs, 89 distinct production-browser cases pass. The final
nine-case run includes the expanded host tests, fixed-home shortcut, compact theme/viewport cases,
progress/retry, global instructions and Arena worktree creation. Both-theme desktop/phone
screenshots were inspected, including expanded settings. Independent read-only reviews found no
remaining production issue.

The wider `same-project empty gear launch focuses once, and title-tab return keeps keyboard focus`
case passes initial launch focus and ArrowLeft, then fails when ArrowRight returns to the created
session and its Instruction textarea receives focus. The same failure was reproduced against the
pre-change `.next` build. Its original assertions remain; conversation-tab focus is unchanged.
One deliberate screenshot-difference self-test remains skipped under the ordinary visual-test
configuration. There is no claim that the complete browser suite passes.

The running application has not been rebuilt or restarted for this change. Physical device and
real-provider acceptance are outside these fixture-based checks.
