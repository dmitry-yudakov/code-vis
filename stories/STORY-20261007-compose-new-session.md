# Story 97 — Compose the first message while creating a session

**Status:** In progress · **Type:** Full-stack · **Depends on:** [Story 63](STORY-20260921-report-evidence-in-conversation.md), [Story 64](STORY-20260921-managed-self-rebuild.md), [Story 70](STORY-20260924-remember-turn-choices.md), [Story 81](STORY-20260930-paste-image-into-chat.md), [Story 92](STORY-20261005-session-worktrees.md), [Story 95](STORY-20261007-docker-worktrees.md)

**Vision slice:** starting and watching parallel work in [the arena](../docs/vision.md#the-arena),
with the same journey in the [immersive workspace](EPIC-20260905-immersive-workspace.md).
The desktop presentation follows the [workbench shell](EPIC-20260925-workbench-shell.md).
This is a separate full-stack story; that epic's presentation-only constraint does not apply here.

## Motivation

Previously, creating a session from Arena meant choosing settings, opening the conversation, and
only then explaining the task and attaching evidence. The user wants to compose that first message
at creation time, press Enter, and leave the agent working while staying in Arena.

The same shortcut should make it easy to report a CodeAI defect while working on something else:
open the bottom-left gear, choose **New CodeAI session**, describe the problem, optionally attach a
screenshot or headset report, and continue the original task. An empty submission instead opens the
fresh session so the user can begin there. Implementation follows the reviewed specification below.

## Where the code is

- [src/features/session-launch/useSessionLauncher.ts:31](../src/features/session-launch/useSessionLauncher.ts#L31) — one memory-only draft and captured attempt, CodeAI preparation, evidence, cancellation, and capture generations.
- [src/features/session-launch/sessionLaunch.ts:52](../src/features/session-launch/sessionLaunch.ts#L52) — explicit target create/send, immutable UUID retry, canonical delivery reconciliation, and stream detachment.
- [src/features/session-launch/SessionSetupDialog.tsx:16](../src/features/session-launch/SessionSetupDialog.tsx#L16) — desktop modal, focus, first message, files/images/reports, settings, and recovery actions.
- [src/features/shell/AppShell.tsx:1667](../src/features/shell/AppShell.tsx#L1667) — navigation guards, source choice preservation, deliberate opening, toasts, gear entry, and shared VR owner.
- [src/features/shell/immersive/SessionSetup.tsx:27](../src/features/shell/immersive/SessionSetup.tsx#L27) — floating controller setup, paged evidence/settings, existing keyboard/dictation controls, and in-world outcome.
- [src/features/shell/immersive/ImmersiveWorkspace.tsx:89](../src/features/shell/immersive/ImmersiveWorkspace.tsx#L89) — setup routing, permission suspension, three-second capture, and stale upload handling.
- [src/app/api/codeai-session/route.ts:20](../src/app/api/codeai-session/route.ts#L20) — personal-device-only managed availability/preparation/creation; server-owned self target.
- [src/server/conversation/codeAiSession.ts:10](../src/server/conversation/codeAiSession.ts#L10) — managed installation discovery, race-safe self-project reuse, and prepared-context validation.
- [src/server/conversation/sessionCreation.ts:9](../src/server/conversation/sessionCreation.ts#L9) — common creation admission; receipt replay precedes provider/checkout validation.
- [src/server/storage/creationRequests.ts:14](../src/server/storage/creationRequests.ts#L14) — ordinary/worktree UUID namespace, normalized identity, active/archive replay, and failure classification.
- [src/shared/textFiles.ts:4](../src/shared/textFiles.ts#L4) — bounded UTF-8 file contracts; session format 12 stores exact text, byte count, and digest.
- [src/server/storage/textFiles.ts:6](../src/server/storage/textFiles.ts#L6) — generated per-run names and exact file/manifest bytes.
- [src/server/storage/sessionStore.ts:703](../src/server/storage/sessionStore.ts#L703) — atomic message/file-cap validation before report promotion and durable acceptance.
- [src/features/arena/arenaModel.ts:102](../src/features/arena/arenaModel.ts#L102) — fresh-snapshot Local execution uncertainty without canonical mutation or automatic retry.

## Desired behavior

### 1. One launcher, two entry points

**Arena → New session** opens a desktop modal replacing the inline form. **Gear → New CodeAI
session** opens the same modal, preconfigured for this installation. The shortcut is offered from
Arena and any conversation, including a conversation executing on another machine, only when the
home server confirms managed mode and a usable installation checkout. It targets the home machine.

The modal has a heading, an optional multiline **First message** input, attachment chips with
preview/remove actions, a compact settings area, Cancel, and one primary action. Focus First
message after the dialog is ready. “Description” means this first message, not a new persistent
session description field or a separate title input. The existing first-message title rule applies.

Keep all existing Arena settings and current/worktree choices. Include model and effort from the
selected executing machine's offers, initially its valid remembered choices. Preserve current
launch-mode filtering (Ask, Plan, Agent); broadening creation to Auto or other Native modes is a
separate decision. Validate instructions, including Native Claude isolation, against that mode.
Show selected machine, project/repository, execution, provider, and mode even when settings are collapsed.
Defaults are device choices, never inferred from the conversation's transcript or permissions.

The CodeAI shortcut fixes home machine, verified self project, and Local execution. It starts at
**Use current checkout** and offers **Create a worktree** only if the existing source capability
allows it. A worktree still belongs to the self project whose primary checkout is the installation;
the current report eligibility rule already checks the project. Explain that the worktree starts
at committed HEAD and excludes current uncommitted changes. Ordinary scheduler checkout exclusion
still applies, so a second writing session in the current checkout may queue behind existing work.

### 2. Submission and navigation

Treat whitespace-only text as empty. Evidence counts as content:

| First message | Evidence | Primary action | Result after confirmed acceptance |
|---|---|---|---|
| Empty | None | **Create and open** | Create an idle session and open/focus its composer. |
| Non-empty | Any or none | **Start in background** | Create and submit one first turn; close the launcher and keep the originating surface. |
| Empty | One or more attachments | **Start in background** | Submit an attachment-only turn with the fallback text below; keep the originating surface. |

Attachment-only text is visible before submission: use the existing report-only instruction when
reports alone are present, otherwise the existing image-only instruction for images alone. Files
alone use `Read the attached text files and explain what matters for this repository.` Mixed
evidence uses `Review the attached evidence and explain what matters for this repository.`
The typed message always takes precedence over the fallback.

Enter in First message invokes the primary action; Shift+Enter adds a newline. Ignore submit during
IME composition, key repeat, attachment processing, recording/transcription, or an outstanding
submission. Enter in a dropdown, attachment action, or another control keeps that control's normal
behavior. The primary button is also a complete mouse, touch, and keyboard path.

For a background launch, preserve the route, Arena section/filters/scroll, selected machine/project,
session/tab, conversation draft and pending attachments, canvas selection/camera, panel layout, and
keyboard focus. Never briefly select the new session to send its message. Remember its chosen mode,
model, and effort in its device view without opening a tab or altering the current view's settings.
Only the explicit **Open session** action opens a tab/selects the new session. A successful empty
launch uses the ordinary open-session path. Header New chat keeps Story 86's existing behavior.

Use an accessible dialog with focus containment, a labeled close action, and focus return to the
invoking control (or its surviving surface when that control disappeared). Escape acts as Cancel
before submission and Close during submission. If the user closes setup or explicitly navigates
elsewhere before an empty creation resolves, suppress automatic opening and show **Session created**
with Open session instead. A delayed result must not override newer deliberate navigation.

Raise an existing action toast: **Session started** or **Session queued**, with **Open session**.
The wording describes scheduler acceptance, not completion. Its action captures machine/project/
session identity rather than current selection and uses the normal offline/archived handling.
Refresh Arena; its card and Inbox remain the durable discovery path after the toast disappears.
Errors use the existing persistent error tone. Accepted work continues if the modal closes, the
user navigates, the toast expires, or the browser stream disconnects.

An empty repository-free session remains valid. Content requires a usable primary repository on
the selected machine; explain the blocker in the launcher and disable Start session until resolved.
Offline machines, unavailable provider/mode/model, invalid instructions, incompatible Docker
bindings, and managed maintenance show actionable blockers without silently changing the target.
Refresh may suggest a supported choice, but must not change a choice that was already submitted.

### 3. Attachments and their ownership

The launcher owns its draft and evidence independently of any open conversation. Support desktop
**Attach files…**, screenshot paste, and file/image drop in the input area. Paste with plain text
continues to insert text, following the existing image-paste policy. Show filename/type/size for
files, thumbnail/prepared size for images, and existing labels for reports. Refuse an invalid
selection individually with a clear error; keep the message and previously valid chips. Processing
blocks submission; removing a chip invalidates its pending preparation result.

**Images:** reuse image preparation and existing limits: up to four, each prepared PNG/JPEG at
most 768 KiB, with the current 2,048-pixel long-edge policy and 32 MiB source limit. The file picker
may feed any image format the existing browser decoder supports; undecodable sources are rejected.
Preserve prepared pixels through launch and retries. No image generation or automatic screenshot
capture is involved on desktop; the user supplies the screenshot. Drawing a new annotation inside
the launcher is outside this story; an already marked screenshot can be attached.

**Files:** first delivery supports non-empty UTF-8 text files, including plain text, Markdown,
source code, JSON, CSV, and logs, independent of extension. Reject invalid UTF-8, NUL-containing
binary data, and unsupported binary formats such as PDF, Office documents, archives, and executables
with “Attach a UTF-8 text file or an image.” Set a limit of four text files, 128 KiB per file and
256 KiB combined, checked before reading and again on the server. Share these constants between
launcher and normal composer. No truncation and no automatic archive extraction. The picker is
labeled **Text files and images** so this supported scope is discoverable.

Send `{ name, text }` for each text file; `name` is a display basename, at most 160 characters,
with no separators, NUL, or control characters. The server verifies UTF-8 byte bounds and content,
computes a digest, and records name, bytes, digest, and exact text on the user message. This bounded
text is durable session evidence. Cap total stored text-file evidence at 8 MiB per session, summing
UTF-8 bytes across its user-message records. Enforce it in the store writer queue before accepting
a new message, after the duplicate-ID check, so simultaneous submissions cannot exceed it and a
replayed accepted message is not counted twice. Reject the whole message with 413 and preserve the
draft when the cap is exceeded; do not partially append files or mutate evidence/message state.
Subsequent turns use the existing bounded transcript context
policy rather than reattaching it automatically. Write the files under generated names in the
private per-run attachment directory, include a manifest linking display names to those files,
and frame file contents as attachment data in the provider prompt. Never use a display name as
a host path or a command. Local and Docker Claude/Codex receive the same text and image evidence
through their existing attachment transport; the chosen mode never becomes broader to read it.

Add the same bounded text-file wire support, chips, and picker to the regular desktop composer so
failed initial turns can be corrected/retried in their session. Older messages default to no text
files. Introduce the next required session format using Story 65's newer-format behavior; update
shared types, wire/store schemas, protocol parsing, transcript formatting, and duplicate-message
comparison together. Regular Retry rehydrates text files from that message's exact durable records
as removable pending chips, applying the same per-message limits and preserving any existing draft
without silently replacing different evidence. Only images need reselection after memory is lost.
Preserve the existing screenshot persistence contract: image records contain
type/size, not durable pixel storage; images awaiting first submission or retry stay in device memory.
Display that limitation when image evidence has been lost after a reload; do not claim it can be recovered.

**Reports:** for a verified self-project target, open the existing bounded report list inside the
launcher and attach up to four report IDs. This works while the source conversation is another
project; loading the target's reports must not switch the source project or its report owner.
Keep the existing personal-device, home-machine, self-project, and promotion/retention checks.
Changing to an ineligible target with reports selected requires explicit removal before submission.
Never silently drop evidence or retarget home reports to an attached executor.

Reports captured while another conversation was open are selectable by the existing capture-context
label. Reusing an already promoted report whose inbox original was pruned is outside this story;
the report picker shows retained diagnostics reports. A screenshot from another conversation can
be explicitly saved/copied there and selected/pasted here. No conversation transcript, diagram,
draft, or pending attachment is copied implicitly, and no new cross-session attachment browser is added.

One launcher draft is retained in browser memory across Cancel/reopen and desktop/VR presentation
changes until success or explicit **Clear setup**. Text, image bytes, and file bytes never go into
localStorage; reload may lose an unaccepted draft. Before changing target settings after submission,
resolve the outstanding request as below. Cancel before submission returns focus and preserves the
draft. Once submission begins, show progress and keep the explicit **Close setup** action: closing hides the
launcher but keeps its owner and recovery result alive, and reopening resumes that attempt.
Do not accept another launcher operation until the outstanding attempt's outcome is known.

### 4. Shared launch owner and failure contract

Extract only what is needed from the existing create/send functions: creating a captured target,
preparing/submitting a captured first message, and opening a resulting session are separate actions.
Desktop and VR use one launch owner and outcome model. Keep the existing two server operations,
session creation followed by `/api/agent/message`; no second provider runner or client execution policy.
The send helper takes explicit session/participant/machine, mode/model/effort, message UUID, text,
and evidence. Its result/stream updates are keyed by that captured session, including when it is
outside the active session catalog. They cannot overwrite another session or manipulate its focus.

Freeze creation settings, first-message content, prepared evidence, a creation request UUID, and
a message UUID at submission. The ordinary creation API gains optional `creationRequestId` for
current-checkout creation as well as the existing required worktree case. Legacy callers that omit
it retain their current behavior. For an ordinary request, persist request ID plus a fingerprint
of normalized creation settings atomically with the created session in the store's writer queue;
check active and archived sessions before capacity checks or creating anything. Same ID/settings
returns the original session; different settings return 409. An archived result is reported as
archived and never restored or started implicitly. Keep a server-generated session ID. Worktree
requests retain their existing journal and immutable recovery behavior, without a second journal.
The shared creation service checks one request-ID namespace across ordinary receipts (active and
archived) and worktree journal intents/results before dispatching either creation branch. Reusing
an ordinary ID for a worktree request, or a worktree ID for an ordinary request, is a settings
conflict (409), never a second creation. This check and request reservation must share the store's
serialized creation boundary so simultaneous requests across both branches cannot pass separately.
Return a completed ordinary/worktree receipt before rerunning capacity, discovery, provider,
Docker, or checkout-availability preflight; a lost-response retry must disclose its saved session
even when it can no longer run. Report archived/unavailable state with that same identity. An
unfinished worktree intent still performs its existing lease and validation recovery before completing.
Message content is not part of the creation fingerprint: it has its own immutable message UUID.
Creation receipts are server-only metadata, excluded from public sessions, Arena summaries, and
provider prompts, and use the same next-format migration as the new file evidence.

| Outcome | Required recovery |
|---|---|
| Validation/preparation fails before create | Retain all valid draft content; fix settings/evidence and resubmit. |
| Create response is lost | Reconcile by retrying the identical creation request ID/settings; return its one saved session. Do not create another. |
| Worktree intent retained; no session response yet | Keep the original UUID/settings and retry/recover that intent through the existing worktree journal. Do not start a fresh worktree attempt merely because the API returned 409 or another error. |
| Session exists; message not accepted | Keep that session ID and draft, show the rejection, with **Retry** and **Open created session**. Retry submits only to that session. |
| Message response is lost/stream disconnects | Read the captured canonical session. Its accepted message UUID proves acceptance. A pre-save active-run conflict keeps delivery uncertain and freezes that same UUID. Retry that same message UUID after the canonical read finds no accepted message; an already-accepted 409 triggers reconciliation, never another turn. |
| Accepted turn fails/cancels | Show its durable failed/cancelled state through Arena/Inbox and offer Open session. Never automatically rerun it; a deliberate regular Retry is a new message ID under the existing delivery rules. |
| Accepted turn after server restart, with no live run or durable terminal result | Show **Accepted; execution status unavailable** and Open session. The existing message UUID proves acceptance; it never permits automatic resend. A deliberate new-ID Retry warns that the earlier turn may have acted before interruption. |

An HTTP status alone does not prove that creation left no durable state. Creation failures expose
whether a receipt/worktree intent was retained; if the helper cannot establish that nothing was
saved, keep the request frozen and reconcile it. Only a confirmed no-receipt/no-intent rejection
permits changing creation settings and assigning a new UUID. There is no automatic abandonment of
worktree intents or deletion of their branches/directories in this flow.

Local restart currently leaves an accepted user message in `sending`; it has no generic recovery
that marks it failed. For a fresh online machine snapshot showing such a latest message and no
active run for that session or durable terminal response, derive **Needs you — Execution status
unavailable** plus an Inbox attention entry and explicit Open session/Retry explanation. This is
a device presentation of uncertain delivery, not a claim that execution failed or completed; do not
rewrite the durable message or restart it. Offline/stale discovery is insufficient to derive this
outcome. Existing Docker interrupted-delivery recovery continues to supply its durable result.

Expose durable acceptance independently of first provider output, including queued turns: use the
existing stream and canonical message/run state, adding an `X-CodeAI-Run-Id` response header after
durable message save and scheduler activation. The message route emits this header and the executor gateway forwards it. Close the successful
launcher once acceptance is confirmed, without waiting for turn completion. An accepted-but-failed
turn is a launch result with an error, not an unknown request. Deduplicate double clicks, Enter,
controller events, reconciliation, and concurrent same-ID POSTs. New creation settings after a
definitive rejection get a new creation ID; a definitive message rejection can be edited under a
new message ID for the already-created session. An uncertain request remains frozen until resolved.

Pre-submit blockers should avoid creating a session for invalid content, but these two operations
are not atomic: preserve and disclose a session created before a later send rejection. Queue
admission, checkout leases, turn checkpoints, maintenance, cancellation, budgets, and provider
capabilities remain server-owned. A live source turn does not disable the shortcut; the scheduler
decides whether the new target queues or conflicts. Build/restart maintenance can reject a new
turn while leaving its session and draft recoverable. Revocation stops commands and removes private
launcher content through the existing device gate. No retry may bypass it.

### 5. Resolve CodeAI independently of the active project

Introduce a small personal-device-only, private/no-store `/api/codeai-session` route:

- **GET** reports launcher availability globally, without a project query. Confirm
  `getCodeAiLifecycle()?.managed` and find the actual installation checkout through the existing
  checkout registry and real-path identity. Return public identity/labels and availability/blocker
  information only, never a filesystem path. Discovery does not create a project or session.
- **POST `{ action: 'prepare' }`**, invoked by the explicit shortcut click, rechecks eligibility
  and returns its fixed home-machine/self-project context. Reuse an existing qualifying local
  project; when several exist, pick the earliest `createdAt`, then UUID. If none exists, ensure one
  named CodeAI with the verified installation checkout as primary, atomically in the project writer
  queue so concurrent openings create at most one. Preparation creates no session or provider run.
  Cancelling afterward can leave this empty project; report browsing needs its existing identity gate.
  Return a prepared context containing project UUID, installation checkout ID, and a fingerprint
  of the project's repository bindings (including primary role and home-machine identity).
- **POST `{ action: 'create', preparedContext, ...settings }`** accepts that expected context,
  provider, permitted instructions, optional role, checkout mode, and creation request ID. The
  expected IDs/fingerprint are assertions to validate, never authority to choose a target. The
  server fixes home machine and Local execution, resolves that exact project's primary checkout,
  compares bindings with the prepared fingerprint, and rechecks managed/installation eligibility.
  A deleted project or changed binding fails with the retained draft; require explicit preparation
  again rather than choosing another project. A project rename alone does not change its bindings.
  Delegate to the same ordinary/worktree creation service used by `/api/sessions`; do not duplicate
  validation. The first message still uses `/api/agent/message` after the session returns.

Include this prepared identity and resolved creation settings in the frozen fingerprint. After
authorization, a repeated creation ID must find its saved receipt/journal result before project
rediscovery or preparing a replacement. Return that exact session (or its archived/unavailable
outcome), with no silent target replacement even if the original project's bindings changed.
Only a new, explicit prepare/launch may choose a different context and creation ID.

Mode/model/effort belong to the captured message and device view, not to creation settings, just
as today. GET availability can be refreshed on gear/Session tools opening; no high-frequency Git
probing or new host polling loop. During managed building/restarting, show the shortcut with its
temporary blocker and retain a prepared draft. If the installation lies outside repository
discovery, show setup guidance and refuse launch rather than treating a named project as CodeAI
or broadening filesystem discovery/mounts. An unmanaged server hides the shortcut. Availability
fetch errors show a retryable check failure, not “unmanaged.”

Every POST uses personal-device authorization and the configured mutation-origin checks, excluding
machine-authenticated executor requests. Do not add this route to the executor gateway allowlist.
Recheck real-path identity at each operation; a renamed project remains eligible, a lookalike does
not. Report authorization and Build & restart authorization remain their existing separate actions.
This shortcut never triggers a build, restart, commit, or deployment.

### 6. VR presentation

**Arena → New session** and **Session tools → New session** open an in-world setup panel backed by
the same launcher owner. **Session tools → CodeAI → New CodeAI session** is the gear equivalent and
is available independently of the active project's report/build controls. Preserve existing session
tools, repository attachment, approval, and return-to-session behavior.

Use the existing immersive visual system and controller-sized controls. The panel has Message,
Attachments, and Settings pages, with current target summary and Create and open/Start session
always reachable. The setup message is its own input: reuse dictation, word correction, Clear,
and Undo editing behavior from the conversation controls with launcher-specific callbacks.
Reuse production `InlineConversationInput` and its Quest native keyboard; add a launcher-specific
submit callback rather than applying Enter-submit globally to the conversation composer. Physical
keyboard Enter/Shift+Enter follows desktop semantics. Controller-only text entry/correction and
explicit submit remain usable where the native keyboard is available. Without voice or a native
keyboard, allow empty or report-only submission and explain that a physical keyboard or desktop
presentation is needed to type. Dictation is
reviewed into the draft and cannot submit, approve, or select a different target by speech alone.
Starting setup never overwrites or consumes the active conversation composer.

Headset evidence primarily uses **Attach report** and **Capture report** for a self-project target.
The latter temporarily hides the setup panel, preserves its draft and original task, uses the
existing three-second aim-before-capture countdown, and restores setup with a removable report chip
after the home machine confirms the report was saved. Capture is explicitly routed to the launcher
attempt that started it, without automatic attachment to the active conversation or automatic
submission. Failure restores setup and keeps the draft; a report without an image remains usable
and is labeled. Cancel, leaving XR, loss of authorization, or Clear invalidate delayed callbacks;
a report arriving for an invalidated launcher is saved only, never attached to a newer attempt.

Text-file selection and screenshot paste are available through the desktop presentation of this
same in-memory draft. An XR file picker is offered only where browser support permits it without
ending XR; unsupported controls are disabled with a reason. Native headset filesystem/clipboard
integration and cross-device transfer of pending files are outside this story. Controller-and-voice
report capture/selection is a complete headset evidence path and must not require leaving XR.

Successful background launch undoes only setup/capture's temporary presentation effects, retaining
the prior Arena or conversation, panels, placements, selected evidence, and view when the user
has not changed them. Never rewind deliberate navigation or panel changes made while a request
was pending, and never move focus on acceptance after setup was closed. It stays in XR. Show a
readable in-world outcome with a
deliberate controller **Open session** action using the captured target. The DOM toast alone is
insufficient. Dismissing/expiry never changes sessions. Empty launch opens the new conversation
inside XR. A failed launch has the same retained attempt and recovery actions as desktop. Opening
a permission elsewhere while setup is open suspends it without consuming its draft; it does not
approve the new session's actions automatically.

## Implementation boundaries

Keep one launcher owner under `src/features/session-launch/` with desktop presentation used by Arena
and AppShell, and a VR presentation under `src/features/shell/immersive/`. Give it explicit launch
and open callbacks. Factor a small shared server creation function out of the existing sessions
route only as needed by the fixed self route; reuse worktree/store/provider/report helpers.
Client components never import server code; shared request/types/limits stay side-effect free.
Body size enforcement must count actual streamed request bytes even without Content-Length:
keep the message's existing 6,000,000-byte whole-request ceiling. The gateway ceiling is 7,000,000
bytes; remote submissions obey the stricter minimum of the two. Files/images individually fitting
their limits do not exempt the combined request.
413 preserves the draft. An older executor rejecting new file fields remains on the captured
machine, displays the incompatibility, and does not silently resend without the files.

Implementation sequence:

1. Add focused failing contract tests for creation reconciliation, fixed self target, bounded files,
   and captured launch/navigation outcomes; extend shared/store schemas and server creation/evidence.
2. Separate captured create/send from opening a view, add the shared launcher owner, and wire the
   Arena modal, regular composer file retry path, gear shortcut, and action toast.
3. Wire immersive setup, independent CodeAI entry, dictation, captured report routing, and in-world
   outcomes; verify navigation/failure parity and update the story to actual implementation.

## Acceptance criteria

- [x] Merge review preserves Story 98's scoped worktree admission, project revision validation,
      and executor-specific blocker details in desktop, CodeAI, and VR setup, alongside durable
      creation replay and same-request retries.
- [x] An older executor's definitive creation-schema rejection explains the required upgrade and
      allows clearing setup, while unknown creation outcomes retain their UUID and frozen choices.
- [x] A definitively rejected first message can change mode/model/effort without changing its
      created session; normal composer file batches retain valid files when another selection fails.
- [x] Arena New session opens an accessible modal, focuses First message, retains existing setup
      settings, and shows machine-validated model/effort defaults and visible target summary.
- [x] Empty/whitespace with no evidence creates and opens an idle session; text or attachment-only
      submission creates one first turn in the background with the documented visible fallback.
- [x] Enter/Shift+Enter, IME, key repeat, disabled/busy states, focus containment, Escape, Cancel,
      Clear setup, narrow viewport, and focus return work in both desktop themes.
- [x] Screenshot picker/paste/drop uses existing preparation and bounds; text-file selection,
      validation, previews/chips, count/byte limits, and invalid-item errors preserve valid content.
- [x] Text files reach Claude and Codex as exact bounded data in Local and Docker; records and
      duplicate comparison agree, older sessions load, newer-format isolation works, and regular
      composer Retry rehydrates exact file evidence. The per-session cap is atomic and rejects
      without partial acceptance; images lost from memory clearly require reselection.
- [x] Report selection from another conversation/project reads only the target self project's
      retained reports, uses explicit chips, and preserves existing promotion/authorization limits.
- [x] Managed gear shortcut works from Arena and any project/machine's conversation; identity is
      the home installation, execution is Local, first-use preparation is race-safe, and names or
      client-supplied paths cannot forge eligibility. Unmanaged/unavailable/restarting cases are clear.
- [x] Background submission never opens/selects a tab, changes the route/project/machine, consumes
      the source draft/evidence, or moves its canvas/panels; Open session targets the saved identity.
- [x] Ordinary and worktree create retries, concurrent duplicate submissions, lost responses,
      archived replay, accepted-message 409, queue rejection, and send failure produce at most one
      session and one initial accepted turn per frozen attempt, with the specified recovery actions;
      reused IDs cannot cross ordinary/worktree branches, including simultaneous conflicting requests.
- [x] A persisted-but-unfinished worktree intent keeps its identity through errors; a Local restart
      shows uncertain accepted execution through Arena/Inbox rather than retrying, inventing a
      terminal state, or waiting forever. Explicit Retry explains possibly sent delivery.
- [x] Toast and Arena/Inbox reveal accepted queued/running/failed work; stream detach and launcher
      closure do not cancel an accepted run, and later source navigation cannot retarget its updates.
- [x] Repository-free empty sessions still open; non-empty launches require a primary repository;
      provider/instructions/model/execution, maintenance, checkpoint, and checkout-lock policies hold.
- [x] VR exposes both general and CodeAI setup independently of the active project's eligibility;
      controller, keyboard, and reviewed dictation use the separate launcher draft and shared outcomes.
- [x] VR captures/selects a report while retaining the original task, attaches to the initiating
      launcher only, rejects stale callbacks, and offers a readable Open session action without
      leaving XR. Empty launch opens the new conversation inside XR.
- [x] Revocation, offline/unknown outcomes, unsupported older executors, absent Content-Length,
      combined over-limit requests, and lost in-memory image evidence have explicit tested behavior.
- [x] Focused unit/route tests, TypeScript, production build, desktop and simulated-XR browser
      journeys pass. Physical Quest 3S verification below is recorded separately and honestly.

- [ ] Physical Quest 3S acceptance: complete the headset journey in How to verify step 7,
      recording versions, readability, comfort, capture, voice fallback, and in-world opening.

## Out of scope

Session description/title fields, automatic copying of another conversation or its attachments,
retrieving pruned reports from another session, image annotation inside setup, PDF/Office/binary file
support, transferring unsent evidence across devices, a native Quest file manager, additional launch
modes, changing permissions/scheduler policy, and automatic rebuild/restart/commit/deploy.

## How to verify

1. Run focused existing creation/worktree, session-store/schema, message-route, image/report,
   transcript/prompt, workspace-view, toast, and immersive suites plus new launcher/file/self-route
   suites. Use red-before-implementation checks for outcome/identity behavior, not tests mirroring markup.
   Run `npm run lint -- --incremental false`, `npm test`, and `npm run build` after integration.
2. In production browser checks, cover both themes and a narrow viewport. From Arena open/cancel,
   create empty, start with text, image, file, report, and mixed evidence; verify exact posted bytes,
   fallback, queue state, list refresh, and toast target. Preserve Arena scroll/section and source
   view/draft/camera/panels. Close the toast and find the new session in Arena; open it deliberately.
3. From a different project's conversation (then an attached-executor conversation), use the
   managed gear shortcut with a fake managed bridge and discovered installation fixture. Confirm
   the home self project/checkout, Local execution, optional worktree, preserved source task, and
   first-use project reuse. Test lookalike/renamed projects, absent discovery, unmanaged server,
   bridge loss, maintenance, personal-device revocation, forged target fields, and machine-auth denial.
4. Inject create response loss before/after durable save, concurrent same-ID create, process reopen,
   archived replay, send rejection, disconnect after acceptance, queued acceptance before output,
   and accepted-run failure. Verify no duplicate session/turn, unchanged captured target, retained
   draft, accurate outcome, and explicit recovery. Reject modified content/settings under reused IDs.
   Test both directions of ordinary/worktree ID reuse and their concurrent race; mutate/delete the
   prepared self-project binding before create and before lost-response retry, and verify no retarget.
   Make provider/Docker/checkout health unavailable after a saved creation and verify replay still
   discloses the original session without repeating creation preflight.
   Fail after persisting a worktree intent but before returning its session; verify settings stay
   frozen and retry recovers that same intent. Restart after a Local user-message acceptance before
   terminal persistence; verify Needs you/Inbox uncertainty and explicit possibly-sent Retry.
5. Check four images/files/reports and each limit boundary; malformed text, binary masquerading as
   text, malicious filename, empty file, corrupted image, pruned report, missing Content-Length,
   combined oversized body, and unsupported executor. With fake providers inspect exact evidence in
   the attachment directory; record one real Claude and Codex image/text-file turn when available.
   Fill the durable file cap, race two appends near it, reopen the store, retry exact file evidence,
   and verify cap rejection leaves the message/evidence unchanged.
6. Through the existing XR semantic-action harness, repeat empty/background launches, dictation
   correction and fallback, separate drafts, report selection/capture countdown and stale completions,
   failure/retry, retained panels, and in-world Open session. Repeat in the controller-only renderer;
   do not assume the optional UI-kit spike supplies production text entry.
   Close or navigate during a pending launch and verify acceptance never rewinds that navigation.
7. On Quest 3S, while working in another project, enter CodeAI setup, dictate a defect, capture and
   preview its report, start in the background, and continue the original task. Open it later from
   the notice/Arena, inspect evidence and an approval, and separately create empty from Arena.
   Record browser/headset versions, readability, comfort, voice-unavailable path, and any unrun step.
   Automated XR checks are the implementation gate; this physical run is tracked as pending
   acceptance when the device is unavailable, following the existing immersive stories.

## Spec review

October 7, 2026: independent read-only review of the draft and its repository contracts, followed
by correction passes and final review, reported **no remaining critical or high findings**.

Corrections covered immediate queued-turn acceptance, one ordinary/worktree creation-ID namespace,
prepared self-project identity, retained worktree intents, Local restart uncertainty, preserving
newer navigation, bounded durable file evidence and exact Retry, and production Quest keyboard reuse.
The implementation now emits and forwards the run-ID acceptance header.

The specification’s local links and line-anchor bounds were checked at the initial handoff.
At the specification commit, the story was Draft and no implementation criteria were claimed.
The implementation and verification record below supersedes that initial status.

## Implementation and verification record

October 7, 2026: implementation and automated acceptance are complete. The story remains
**In progress** for physical Quest 3S acceptance. The reviewed specification was committed as
`35ecd7d` on `feature/session-setup`; implementation changes remain available for Git review.

The shared owner keeps setup separate from the source task. Desktop uses a native modal with a
scrolling body, visible actions, bounded attachment chips, and a model menu that expands within
settings. VR uses the production controller renderer, keyboard and reviewed dictation, paged
settings/evidence, capture generations, and a deliberate in-world Open action. No verified Quest
file picker is advertised; desktop preparation and headset report capture remain the supported paths.

Creation uses one durable UUID namespace for ordinary and worktree sessions. The fixed managed
CodeAI route resolves the home installation on the server, reuses its self project atomically, and
validates prepared bindings before creation. First-turn acceptance is announced through the
run-ID header and canonical message reconciliation; detaching never cancels the accepted run.
Session format 12 retains exact bounded UTF-8 file evidence and private creation receipts, with
regular composer Retry using that evidence. Fresh Local execution uncertainty appears in Arena
and Inbox without changing the durable result or automatically retrying.

Verification:

- `env CODEAI_REMOTE_ACCESS=local CODEAI_SECURITY_LEVEL=guarded npm test` — **1,213/1,213 passed**.
  This includes duplicate/cross-branch creation identity, active/archive receipt races, fixed
  installation identity and authorization, file bounds/exact bytes/digests/atomic capacity,
  message-route delivery into the runner context, both Docker provider context translations,
  streamed request limits with absent or misleading Content-Length, acceptance/reconciliation,
  existing scheduler/checkpoint policies, and fresh-snapshot execution uncertainty.
- `npm run lint` and `env CODEAI_DIST_DIR=.next-e2e npm run build` — passed on the final product
  code. `git diff --check` passes. The dependency manifest and lockfile are unchanged.
- **48 distinct focused production browser journeys passed**, including the 29-check setup/XR
  selection and the 21 existing worktree, image, New chat, title-tab and report regressions
  (two worktree journeys overlap). Failure corrections were rerun: text files now intentionally
  share the image composer; New session buttons use role-specific locators; the narrow invalid-file
  path exposes Retry. Keyboard focus and desktop/narrow model selection checks reproduced the
  reviewed defects before their fixes and pass afterward.
- Setup screenshots in both themes were inspected. Desktop checks bound thumbnail geometry and
  require visible actions; narrow checks retain valid files and focus. XR checks cover reviewed
  voice, disabled unsupported file selection, preserved source draft/panels, late capture upload
  remaining saved without attaching to a successor draft, and empty CodeAI opening inside XR.
- Independent read-only server and client review, followed by correction passes, reports
  **no remaining critical or high findings**. Final corrections address provider-offer routing,
  remembered instruction isolation, capture generations, model-menu clipping, and keyboard
  focus restoration after accepted background submission.

The fixture servers explicitly use Local access and Guarded security so inherited settings from
a running managed installation do not change the tests. Fixture managed-worktree roots are
isolated so running the suite inside a managed worktree does not hide ordinary fixture checkouts.
The managed bridge and attached-executor browser flows use controlled fixtures; they do not
change or rebuild the running installation.

Not run for this story: signed-in Claude/Codex screenshot/text-file turns, a real Docker turn with
these files, the production attached-executor listener, and physical Quest 3S acceptance. Offline
transport and authorization checks do not substitute for those installation/device checks.

## Branch merge review

October 8, 2026: reviewed against `master`, including Story 98's scoped worktree admission and
the Codex resume-history fix. The merge preserves both changes. A deterministic concurrency
regression exposed a deadlock when a competing worktree request waited behind the creation queue.
In-flight worktree requests now reject different UUIDs with a bounded blocker while identical
UUIDs serialize and replay; completed requests still replay before admission. Both creation routes
carry the executor's blocker details and durable creation state into desktop and VR setup.

Recovery fixes recognize the older executor's exact pre-creation schema rejection as an editable
upgrade incompatibility, permit mode/model/effort correction after definitive first-turn rejection
without changing the created session, remember the corrected choices, and retain valid composer
files when a sibling selection is invalid. Unknown outcomes remain frozen with their original UUIDs.

Verification on the combined code:

- All **1,240 unit tests** pass with Local access and Guarded security. The fixture suites require
  disposable `/var/tmp` directories; the initial sandbox-limited run was rerun with that access.
- TypeScript with `--incremental false`, the production build into `.next-e2e`, and
  `git diff --check` pass.
- **59 distinct production Chrome checks** pass: 48 across session setup, worktrees, images,
  New chat, title tabs, reports, global instructions and Docker UI, plus 11 simulated-XR setup,
  voice, permission, report and launch checks. Three initial browser failures were stale Docker
  expectations or an ambiguous notification locator; all three pass after correcting the tests.
- The older-executor regression failed before its fix. Both new browser recovery regressions
  reproduced the locked mode picker and discarded valid file against the pre-fix build, then passed
  against the corrected build. The retry test also checks the remembered replacement choices.
- Independent server and client reviews report no remaining critical or high findings.

Physical Quest 3S acceptance and the real-provider/transport checks listed above remain pending.
