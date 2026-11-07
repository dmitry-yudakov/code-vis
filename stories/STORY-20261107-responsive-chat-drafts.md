# Story 133 — Keep chat typing local to the composer

**Status:** Shipped · **Type:** Frontend-only · **Depends on:** Stories 107 and 128

## Motivation

Typing in an existing conversation feels heavy from a browser connected to a remote machine.
Each letter currently renders the workspace and transcript and serializes the entire device
workspace four times. Draft editing itself makes no network request.

## Current behavior (where the code is)

- [AppShell.tsx:313](../src/features/shell/AppShell.tsx#L313) supplies the scoped draft source;
  send and execution continuation read its latest text directly. Only active VR subscribes the shell.
- [useWorkspaceViews.ts:25](../src/features/shell/useWorkspaceViews.ts#L25) keeps the authoritative
  workspace ref, publishes ordinary changes to the shell, and coalesces draft-only saves.
- [ConversationDrawer.tsx:40](../src/features/conversation/ConversationDrawer.tsx#L40) subscribes
  the empty-session starter controls separately from the transcript.
- [InstructionComposer.tsx:348](../src/features/conversation/InstructionComposer.tsx#L348) subscribes
  the controlled textarea, Send availability, and text sizing directly to the draft.

## Desired behavior

Subscribe the desktop composer directly to its session's current draft. Keep one authoritative
workspace reference; ordinary metadata updates still render the shell. Send and continuation must
read the current draft synchronously. Preserve the existing shared VR controls and draft identity
rules, including same-text edits made while acceptance is pending.

Coalesce draft-only persistence after 250 ms of inactivity; flush the latest state on navigation,
page hiding, and unmount. Serialize once per save, retaining both tab storage and the shared seed
for new tabs. Storage failures must not prevent editing or sending. No server format changes.

## Acceptance criteria

- [x] Typing in a long desktop transcript renders the composer without rendering AppShell or
      ConversationDrawer, and does not make an API request.
- [x] Draft storage writes are coalesced and latest text survives immediate reload and navigation.
- [x] Immediate Send uses the latest text; acceptance clears only the submitted generation,
      preserving newer drafts and attachments through rejection, retry and session switching.
- [x] Existing draft migration, separate-browser-tab ownership and shared immersive controls pass.
- [x] TypeScript, an isolated production build, focused unit/browser checks and independent review pass.

## How to verify

Add a production-browser regression that observes React commits and browser storage writes while
typing into a transcript with history; show it fails before the change. Run chronological draft,
conversation URL and relevant shared immersive checks. Record actual results here; physical device
and the user's remote-browser responsiveness require verification in their running installation.

Verified November 7, 2026:

- The new regression failed against the pre-change production build: 45 typed characters caused
  45 surrounding workspace renders. The completed regression counts AppShell directly and proves
  zero AppShell/drawer renders, two storage writes after the typing burst, and no API requests.
- All **128 focused unit checks** pass: draft identity, workspace views/URLs, navigation, composer
  menus, history lifecycle, model choices, Native controls, New chat, and image attachments.
  Run with `CODEAI_REMOTE_ACCESS=local` so the developer's paired-server settings do not affect fixtures.
- All **53 distinct production-browser cases** pass: chronological drafts (23), conversation URLs
  (19), empty-session starters in both themes at three widths (6), execution continuation (1),
  and shared VR typing, native keyboard, dictation/recovery and agent controls (4).
  The continuation fixture once reported a disposed response during teardown; its isolated rerun
  and strengthened latest-unsent-text assertion passed.
- `npm run lint`, the isolated production build, `git diff --check`, and an independent read-only
  review pass. The review's request to count AppShell directly was incorporated.
- The running app was not rebuilt or restarted. The user's remote browser and physical phone/Quest
  responsiveness remain unverified; VR checks used the automated browser adapter.

## Out of scope

Transcript virtualization, changing streamed output, provider execution, and restarting the running app.
