# Story 138 — Let an agent archive a completed session with permission

**Status:** Shipped · **Type:** Full-stack · **Depends on:** [Story 135](STORY-20261107-queue-project-sessions.md), [Story 123](STORY-20261103-conversation-titles.md)

## Motivation

Let explicitly authorized, completed conversations release queued repository work without requiring
the user to archive each one. Keep the coding turn focused: completion is a separate background
decision, following [the Arena work loop](../docs/vision.md#the-arena).

## Current behavior (where the code is)

- `src/server/conversation/conversationTitle.ts:39` runs a fresh, bounded, tool-free metadata request.
- `src/app/api/agent/message/route.ts:333` executes a turn and finalizes checkpoint recovery before
  the scheduler releases its session and checkout ownership.
- `src/server/runs/runRegistry.ts:527` exposes completion; `:633` releases archive-gated successors.
- `src/server/storage/sessionStore.ts:593` owns serialized revision-checked durable archiving.
- `src/features/session-launch/SessionSetupDialog.tsx:140` holds new-session settings;
  `src/features/conversation/ConversationDrawer.tsx:224` holds conversation actions.
- `src/features/shell/AppShell.tsx:861` reconciles externally archived conversations.

## Desired behavior

An unchecked-by-default **Allow agent to archive** checkbox belongs to each session. Offer it in
new-session settings and the open conversation's session settings. Persist it on the executing
machine; do not remember it as a device default or inherit it into New chat/continuations. The
checkbox alone authorizes this behavior. Natural-language requests and model output cannot enable it.
It remains editable while a turn runs. Enabling during a turn allows its eventual check; disabling
invalidates any pending decision immediately after the preference save.

After a successfully saved reply and confirmed execution cleanup, run one fresh temporary inference
using the replying provider and the turn's explicit model/effort (retained with check metadata for
retries), or the provider's configured defaults when absent, with tools/customizations/instructions disabled and no
provider-thread reuse. The main prompt, transcript and activity remain unchanged. Give the checker
all saved user/assistant text, delivery/lifecycle state and attachment-presence information, framed
as data. Ask for exactly `ARCHIVE` or `KEEP_OPEN`; required verification, unanswered questions,
blockers and outstanding user review mean KEEP_OPEN. It judges supplied evidence, not the files.
Never silently truncate context: over 64 KiB of serialized context leaves the session open.

Use a 30-second timeout, 1 KiB output bound and at most two background archive checks per process;
overflow, malformed output, tools, authentication errors and timeouts leave the conversation open
with concise retry feedback. No background check holds a checkout or session execution slot. The
ordinary conversation remains usable while checking. A new message, permission change, restore,
manual archive or newer check invalidates an old decision. Permission changes compare the previous
permission value, so live transcript revisions do not prevent revocation.

Store permission/check metadata only in format 15 sessions; unaffected sessions keep their existing
format. A check has a unique id and saved final-message id. Save its result separately from chat
content without changing the last-activity timestamp. A successful decision uses the existing
archive lease and revision-checked store move, with permission/check identity checked inside the
same serialized mutation. Only a successful archive notifies `sessionArchived`; persist the final
reply before advancing the queue. Restore clears the previous check, retains history/resources and
does not undo any work a successor already performed. Failed checks/archives offer explicit retry;
server restarts do not rerun decisions automatically. A retained checking state is retryable.

Show checking/kept-open/failure feedback with the permission control. Identify **Archived by agent**
in Archived with the saved reply preview and existing Restore. Loaded conversations receive a toast
with Restore when automatically archived. Desktop and phone use shared MUI controls.

## Acceptance criteria

- [x] Session permission defaults off, persists/reloads, is editable during work, compares previous
      value, remains scoped to its session and is included in creation retry fingerprints.
- [x] A separate, fresh, bounded, tool-free check runs only after successful turn delivery/cleanup;
      the working prompt, chat history, provider thread and activity receive no housekeeping text.
- [x] ARCHIVE saves a recoverable archive and advances queued work; KEEP_OPEN preserves follow-ups.
- [x] Revocation (including off/on), new messages/runs, duplicate checks, manual archive/restore,
      failures, invalid output, overflow, long context and restart preserve ownership and history.
- [x] Desktop/phone settings, state feedback, explicit retry, agent archive attribution and Restore
      work through canonical snapshots, including attached-executor route/schema contracts.
- [x] Focused unit/route/provider/browser checks, TypeScript, isolated build, both-theme desktop/phone
      screenshot inspection and independent review pass. Record unverified real-provider/device cases.

## Out of scope

Durable queue recovery, autonomous commits/deployment, changing agent permissions, a generic agent
tool server, independent verification of model claims and new physical headset acceptance.

## How to verify

First reproduce missing permission/check behavior with failing focused tests. Exercise session
schema/store/creation, background classification and races, provider metadata isolation, message
routes and queue promotion. In an isolated production browser, enable in setup and an existing
conversation, observe completion followed by archive/queue advancement, revoke during checking,
send a follow-up, test KEEP_OPEN/failure/retry, reload, and Restore with the final answer intact.
Inspect light/dark desktop/phone screenshots. Do not rebuild/restart the running installation.

## Verification — November 12, 2026

All **2,140 unit tests in 173 suites** pass with inherited installation-specific `CODEAI_*` settings
removed. Some existing provider-customization fixtures require disposable `/var/tmp` directories,
so the full run needed filesystem permission outside the workspace. The affected suites also pass
individually. The old conversation-archive rendering fixture now supplies the existing DraftSource
contract so its 24 checks exercise the actual component. Source TypeScript and `git diff --check`
pass; no dependencies, build settings or production configuration changed.

The isolated production bundle passes webpack `compile` and `generate`:
`env -u TURBOPACK CODEAI_DIST_DIR=.next-e2e/agent-archive npx next build --webpack
--experimental-build-mode compile`, followed by the same command with `generate`. This uses the
existing documented build fallback. Compilation needed network permission for existing Google
fonts. The running application's build directories and process were left alone.

All **41 distinct production-browser cases** pass across `agent-session-archive`,
`queued-session-setup`, `compact-session-setup` and `conversation-titles`. The 13 new journeys cover
both-theme desktop/phone consent creation/reload, unchecked conversational instructions, failed
permission saves and retry, KEEP_OPEN, enabling while working, revocation during inference,
completed follow-ups while an old check is pending, failed-decision retry, a deliberately delayed
pre-archive snapshot, automatic queue advancement and final-answer recovery through Restore.
Light/dark 1280px desktop and 390px phone setup/conversation screenshots were inspected. Inspection
caught inherited field-label styles stacking the checkbox vertically; the corrected MUI styles and
an alignment regression pass. The new header control shares the existing desktop/phone action sizing.
Chrome and the isolated server on port 3034 required process/network permission. As in the existing
browser suites, caught network errors reach the report fixture without failing the journeys.

Independent review identified the format-15 worktree journal mismatch, a dropped latest-reply check,
late-snapshot resurrection and a same-reply retry after renewed permission/Restore. Each is fixed
with regression coverage; the two same-reply cases were observed failing before the fix. The initial
background suite also failed before the module existed. Final review found no remaining concrete
issue. Unchecked sessions never take an archive lease; checks do not affect their follow-up admission.
Coverage includes real disposable Git worktree creation/replay, stale permission/check identities,
new run reservations before append, timeout, invalid output/tools, capacity overflow, whole-context
limits, failed archive/retry and successful scheduler progress.

Provider processes use fixture CLIs. Real signed-in Claude/Codex classification quality, a live
Docker daemon, attached-executor TLS and physical phone/Quest runs remain unverified. Attached
operation policy and snapshot schemas, plus both provider invocations and Docker's separate
metadata lease/mount behavior, have automated coverage. Completion checks and queued turns require
the executing server to stay running; interrupted checks offer explicit Retry after restart. No
rebuild, restart, deployment, staging or commit of the running installation was performed.

## Composer placement follow-up — November 13, 2026

Move the open conversation's permission control from the header gear to a horizontal three-dot
icon button immediately after the model selector inside the chat input. The button toggles the
existing settings panel above the composer, with the other composer pickers' keyboard/focus and
peer-menu behavior. Keep the permission and retry controls usable during a turn; opening/closing
must preserve the draft and saved checkbox choice. New-session setup keeps its checkbox.

Where the code is: `src/features/conversation/InstructionComposer.tsx:456` owns the model selector
row and its optional settings control; `src/features/conversation/ConversationDrawer.tsx:304`
passes the existing archive settings panel into that control.

- [x] Put one named horizontal three-dot icon button after the model selector, removing the header gear.
- [x] Toggle settings with pointer/keyboard, retain drafts/permission and support running turns.
- [x] Focused checks, TypeScript, isolated build, both-theme desktop/phone inspection and review pass.

All **55 focused unit checks** pass across `composerMenus`, `modelMenu`, `newChat`,
`conversationArchive` and `desktopControls`. All **13 production-browser cases** in
`agent-session-archive` pass against the rebuilt isolated bundle. The four theme/viewport journeys
now assert the button's position after the model selector, absence from the header, pointer/Space
show-hide behavior, retained checkbox/draft state and closing when the model picker opens. The
placement regression failed against the previous production bundle because the button was absent
from the composer. Existing running-turn enable/revoke, failed-save/retry, follow-up and Restore
journeys remain green. The four light/dark desktop/phone conversation screenshots were inspected.

Source TypeScript, `git diff --check` and the isolated webpack compile/generate build pass. Read-only
independent review found no concrete issue. This follow-up changes presentation only; the running
application has not been rebuilt, restarted or deployed. Earlier real-provider/device limitations
still apply.

## Inline reveal correction — November 13, 2026

The user's annotated screenshot places the revealed checkbox directly to the right of the
three-dot button, inside the action row. Replace the floating settings panel with an inline reveal.
Keep the existing setting/status/save/retry owner, draft contents and running-turn access. At narrow
widths the expanded controls may wrap within the composer; Send/Cancel must stay reachable. Opening
another picker must not hide this inline choice. Hide secondary default explanation in the existing
tooltip and retain actual check/error feedback and explicit recovery controls.

Where the code is: `src/features/conversation/SessionArchiveSettings.tsx:15` owns the toggle and
inline content; `src/features/conversation/ConversationDrawer.tsx:303` passes it into the composer;
`src/app/globals.css:843` permits wrapping while settings are revealed.

- [x] Reveal the checkbox inline after the three-dot button, with no floating settings panel.
- [x] Keep pointer/keyboard toggles, draft/permission retention, running-turn access and error/retry
      feedback; wrap expanded controls without horizontal overflow on phones.
- [x] Focused checks, source TypeScript, isolated build, both-theme desktop/phone screenshots and
      independent review pass.

All **55 focused unit checks** and **14 distinct production-browser cases** pass. The inline
containment check failed against the earlier floating-panel bundle before implementation. The four
theme/viewport journeys verify desktop placement immediately after the ellipsis, pointer/Space
show-hide, retained draft/permission, persistent visibility while using the model picker, phone
overflow and reachable Send. Failure/retry feedback is also checked at 390px. The final four visual
cases pass again after making the ellipsis glyph clearer; light/dark desktop/phone screenshots were
inspected and match the annotated placement, with an extra row inside the input where phones need it.

Source TypeScript, the isolated webpack compile/generate build and `git diff --check` pass.
Read-only independent review found no concrete issue. The existing save/check/retry owner remains
in place, and the floating wrapper was removed. The working application was not rebuilt, restarted,
deployed, staged or committed.
