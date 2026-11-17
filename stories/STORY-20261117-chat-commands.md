# Story 146 — Use chat commands to start and archive sessions

**Status:** Shipped · **Type:** Frontend-only · **Depends on:** Stories 86, 112 and 138

## Motivation

Operate consecutive project conversations from the keyboard: discover commands by typing `/`,
archive the finished conversation, and immediately compose the next one without a modal.
This advances the conversation workbench described in `docs/vision.md`.

## Current behavior (where the code is)

- `src/features/conversation/chatCommands.ts:13` parses standalone commands and filters completions.
- `src/features/conversation/InstructionComposer.tsx:386` handles commands with retained drafts
  and attachments through failures, plus keyboard/mouse completion in the focused input.
- `src/features/conversation/ConversationDrawer.tsx:215` exposes New chat and Archive controls.
- `src/features/shell/AppShell.tsx:2310` opens inline setup after a fresh owner snapshot confirms
  the focused project's final session was archived. Archival and Undo share existing owners.
- `src/features/session-launch/SessionSetupDialog.tsx:37` shares setup between inline and modal
  presentations, focusing the message or Retry after a frozen failure.
- `src/features/session-launch/useSessionLauncher.ts:88` retains setup drafts and captures inline
  navigation ownership; inline first-message submissions open the resulting conversation.

## Desired behavior and invariants

Typing a standalone leading `/` opens filtered command suggestions. Arrow keys navigate,
Tab or Enter completes a partial command, and Enter executes a complete command. Escape dismisses
suggestions; Shift+Enter and input method composition retain normal text editing.
`/autoclose` enables automatic archiving by default; explicit `on` and `off` arguments
enable or disable the same session permission setting.
`/new` uses New chat; `/archive` and `/close` use the guarded, recoverable archive action.
Commands stay local; ordinary text, paths and provider commands continue to reach the agent.
Failed commands retain their text and evidence, and repeated submissions cannot duplicate actions.

After the focused project's final active conversation is successfully archived, show the existing
session launcher inline with its first-message field focused. Retain setup drafts, exact retry,
machine/project routing, queue controls, Undo, and the existing modal flows elsewhere.
Background archival must not pull the user away from another workspace.
Archive reconciliation chooses navigation after processing the complete snapshot, so batched
archives cannot select another removed tab. Late archive responses cannot overwrite newer Restore
revisions. A saved project Files/maximize layout is revealed through the existing show-canvas action,
retaining its tabs. A sibling created elsewhere prevents automatic setup even if absent from this
browser's loaded histories. Frozen setup failures focus Retry for keyboard recovery.

## Acceptance criteria

- [x] Accessible filtered suggestions support mouse and keyboard selection, dismissal and completion.
- [x] `/autoclose` defaults to on and accepts on/off arguments without agent turns, preserving recovery.
- [x] New/archive/close invoke existing guarded actions; failure keeps the command for retry.
- [x] Final manual or agent archival opens non-modal project setup with focus; another active
      session or navigation elsewhere prevents that transition.
- [x] Existing drafts, attachments, Undo, setup recovery and background runs remain usable.
- [x] Focused unit/browser checks, TypeScript, isolated build, both-theme desktop/phone visual
      inspection and independent review pass.

## How to verify

Run the command and conversation/session-launch unit checks and `e2e/chat-commands.spec.ts`, plus
existing archive, New chat and setup regressions against an isolated production build.
Use `/`, arrows, Tab and Enter; archive the last session and type/submit the next message without
clicking. Inspect light/dark desktop/phone suggestions and inline setup. Record actual results here.

## Verification results

Initial verification: all **163 focused unit checks** passed in `chatCommands`, `composerMenus`, `conversationArchive`,
`newChat`, `sessionLaunch`, `agentSessionArchive`, `draftLifecycle`, `workspaceTabs`,
`workspaceViews` and `panelLayout`. The new command tests failed before the parser existed.
`npm run lint`, `git diff --check` and the normal production build with
`CODEAI_DIST_DIR=.next-e2e/chat-commands` pass. Next added this isolated build's generated type
directories to `tsconfig.json` through its normal mechanism.

**88 distinct production-browser cases pass:** all 19 new command cases, 23 agent-archive cases,
four New chat cases, 27 session-setup cases and 15 title-tab cases. These cover keyboard-only
continuation, click completion, dismissal, multiline editing, command failures/evidence,
live-turn guards, inline setup retry/Undo, multiple active sessions, another-device creation,
navigation during pending archival, project-scope draft recovery, retained maximized files,
archive-stream/response ordering, batched archives and newer Restore revisions. The existing
phone tab-archive assertion now expects the inline message field. One old Arena test selector
was narrowed to the session href because both project and session links start with “Open”.

Three wider focus cases fail on both this change and an independently built, unchanged HEAD copy
in `/tmp`: `same-project empty gear launch focuses once, and title-tab return keeps keyboard focus`,
`title-bar tabs keep overflow selection visible, wrap arrows and reopen closed views`, and
`archiving a background tab keeps the current session, Git status and keyboard focus`.
They remain unchanged. The project-archive picker case initially missed its popover during the
wider run; both subsequent targeted repetitions pass, as does unchanged HEAD.

All eight command/inline-setup screenshots were visually inspected at 1280px and 390px in light
and dark themes. The phone inspection caught a covered setup pane; the final checks prove that
its focused field is in the viewport and receives pointer hits. Independent review found no
remaining defects after the archive scope, layout and revision fixes.

Real provider decisions, physical phone keyboards, attached-executor transport and Quest behavior
were not rerun. The running application has not been rebuilt or restarted.

## November 17 command simplification

The final command list uses `/autoclose`, `/new`, `/archive` and `/close`. The redundant
`/autoarchive` command is removed from parsing and completion. `/autoclose` without an argument
remains equivalent to `/autoclose on`; `/autoclose off` disables it.

- [x] One auto-close command is offered, with omitted arguments enabling it.
- [x] Updated focused checks pass; the complete reviewed story is ready for the requested commit.

After simplification, all **162 focused unit checks** and **42 production-browser cases** in
`chat-commands` and `agent-session-archive` pass, alongside TypeScript, `git diff --check` and the
isolated production build. Updated desktop/phone command screenshots were inspected. The parser
regressions failed before the redundant command was removed and now pass with `/autoclose`
defaulting to on. The complete Story 146 change is committed at the user's request.
