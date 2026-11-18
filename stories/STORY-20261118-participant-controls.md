# Story 150 — Clear participant controls and remembered roles

**Status:** Shipped · **Type:** UI

## Outcome

Distinguish choosing an existing participant from drafting a message to one. Make Claude/Codex
selection a single click, and keep the user's role choice for later sessions and participants.

## Behavior

- Session agents groups **Next message to**, **Draft a message**, and **Add participant** with
  separate visual treatments. The selected recipient has a check and filled row; Main remains
  distinct. Selecting a recipient preserves the draft. Handoff actions only prefill editable text.
- Shared MUI provider chips replace desktop provider dropdowns in Add participant, header/welcome
  creation, and inline/dialog setup. Both providers stay visible, with unavailable providers disabled.
  Clicking the selected chip preserves the current model and effort.
- Explicit role choices use the existing versioned device preferences record and defensive parser.
  Add participant and header/welcome choices save immediately; the shared setup draft captures the
  role and remembers it after creation, like its other choices. Reloads and later forms inherit it.
  Before a choice, new sessions remain Coder and additions remain Reviewer. Provider switches and
  changing the recipient leave the chosen role alone. Existing participants keep their saved roles.
- Existing creation and participant APIs own mutations. Role travels through ordinary/CodeAI
  session creation, with captured retry identities and creation settings preserved. No new API,
  provider policy, storage format, automatic sending, or live application restart.

## Acceptance

- [x] Distinct recipient, message-draft and add-participant controls; explicit selected/Main states.
- [x] Visible provider chips with keyboard operation and unavailable-provider feedback.
- [x] Remembered roles across reloads, failed additions and both desktop session-creation forms.
- [x] Existing drafts, per-agent model choices, main-agent changes and exact retries are preserved.
- [x] Focused unit checks, TypeScript and isolated production build pass.
- [x] Browser regression checks, both-theme desktop/phone screenshot inspection and independent review.

## Verification

The new preference-parser and ordinary/CodeAI creation tests failed before implementation.
All 85 focused unit checks pass across preferences, launch delivery, participant routes/roles,
conversation controls, workspace tabs/views and global instructions. TypeScript and the isolated
`.next-e2e/participants` production build pass. Six new production-browser cases pass for grouping,
draft-only handoffs, selecting/making main/adding, failed-add retry identity, role inheritance across
reloads and both creation forms, provider keyboard selection, and selected-chip model preservation.
The final full unit run has **2,300 passing checks** and the unchanged Google-font assertion in
`visualLanguage.test.ts` (Story 139 bundles local fonts). The remaining `ConversationDrawer` test
fixture now supplies its required preference props; all **109 focused checks** pass. TypeScript and
the isolated production build pass. No generated TypeScript configuration changes are retained.

Production-browser verification has **57 distinct passing cases**: the final **25-case** participant,
compact-setup and Arena-project run; **29** session-setup/global-instructions cases across the wider
run and focused startup-error recheck; and **three** existing participant/model journeys in
`canvas.spec.ts`. Light/dark desktop/phone screenshots were inspected. Independent
review found and verified the fix for selected-provider model resets, then found no remaining
source issues. The Main badge inherits its selected row's foreground for readable contrast.

Wider verification also encounters existing failures: three old Docker setup/heading assertions,
Arena's `Idle` versus `Ready` assertion, and title-tab return focus. All five reproduce on an
unchanged HEAD snapshot built separately in `/tmp`. A retained-startup-error case failed once in
the wider run; both same/other-project cases pass in isolation on the changed and unchanged builds.
The wider Docker continuation run was interrupted and is not counted as completed verification.

The running application has not been rebuilt or restarted.
