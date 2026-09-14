# Story 47 — Converse and steer agents without leaving VR

**Status:** In progress · **Type:** Full-stack (XR input and a validated transcription path) · **Depends on:**
[Story 45](STORY-20260905-application-vr-shell.md), [Story 46](STORY-20260905-vr-workspace-panels.md).

**Vision slice:** [immersive workspace epic](EPIC-20260905-immersive-workspace.md), the conversation
and participant controls of [inside a session](../docs/vision.md#inside-a-session).

## Motivation

A read-only transcript makes the headset an observer. The essential loop is to write an instruction,
correct it, send it to the intended agent, and steer or stop the resulting work in VR.

## Implementation (where the code is)

- [ConversationTools.tsx:41](../src/features/shell/immersive/ConversationTools.tsx#L41) renders
  icon navigation between chat/composer/agents, paged speech review, contextual correction tools,
  and measured microphone activity. [workspaceIcons.ts:39](../src/features/shell/immersive/workspaceIcons.ts#L39)
  shares canvas icons across the workspace with labels allocated on hover.
  [conversationControls.ts:4](../src/features/shell/immersive/conversationControls.ts#L4) defines
  the shell-owned state/action contract.
- [InlineConversationInput.tsx:18](../src/features/shell/immersive/InlineConversationInput.tsx#L18)
  connects the full-width raster field to native Quest and physical text input.
  [nativeKeyboardEditing.ts:21](../src/features/shell/immersive/nativeKeyboardEditing.ts#L21)
  translates the guarded native buffer at the retained draft selection;
  [immersiveTextEditing.ts:8](../src/features/shell/immersive/immersiveTextEditing.ts#L8) owns
  grapheme deletion, measured wrapping, and cursor positions.
- [ConversationList.tsx:21](../src/features/shell/immersive/ConversationList.tsx#L21) renders the
  scrollable, incrementally loaded history list; [conversationListModel.ts:10](../src/features/shell/immersive/conversationListModel.ts#L10)
  sorts activity and formats relative update times. [useImmersiveScroll.ts:10](../src/features/shell/immersive/useImmersiveScroll.ts#L10)
  shares wheel/controller/drag handling with chat and suppresses selection after dragging.
- [AppShell.tsx:970](../src/features/shell/AppShell.tsx#L970) guards sends synchronously during
  attachment preparation and preserves the draft until success;
  [1275](../src/features/shell/AppShell.tsx#L1275) captures cancellation identity.
- [useVoiceDraft.ts:7](../src/features/conversation/useVoiceDraft.ts#L7) scopes speech operations
  to the mounted Compose view; [voiceCapture.ts:6](../src/features/conversation/voiceCapture.ts#L6)
  owns microphone/context cleanup and the bounded [worklet:2](../public/voice-capture.js#L2).
- [voiceEditing.ts:5](../src/features/conversation/voiceEditing.ts#L5) defines token selection,
  explicit spoken spelling, replacement, and the draft limit.
- [voice/route.ts:19](../src/app/api/voice/route.ts#L19) authorizes and bounds WAV uploads;
  [transcription.ts:26](../src/server/voice/transcription.ts#L26) calls loopback Whisper with
  bounded responses and cancellation. [voice.ts:1](../src/shared/voice.ts#L1) owns the audio contract.
- [ConversationHistory.tsx:16](../src/features/shell/immersive/ConversationHistory.tsx#L16) owns
  continuous scrolling, bottom following, and stable older reading positions;
  [conversationHistoryModel.ts:1](../src/features/shell/immersive/conversationHistoryModel.ts#L1)
  lays out the full loaded record using shared proportional wrapping.
  [conversationHistoryResource.ts:1](../src/features/shell/immersive/conversationHistoryResource.ts#L1)
  draws only visible bubbles/lines into a fixed texture.
- [ImmersiveWorkspace.tsx:97](../src/features/shell/immersive/ImmersiveWorkspace.tsx#L97) owns the
  session header and in-panel conversation list/Back; [workspaceLayout.ts:1](../src/features/shell/immersive/workspaceLayout.ts#L1)
  migrates default placement and hides Evidence. [WorkspacePanel.tsx:1](../src/features/shell/immersive/WorkspacePanel.tsx#L1)
  delays and fades muted tooltips.

## Desired behavior

### Native Quest keyboard bridge

Replace the in-panel keyboard from the previous follow-up with Quest's familiar system keyboard.
Keep the canonical draft and clicked caret in `InlineConversationInput.tsx`; use a separate guarded
DOM buffer so Quest's documented first-input replacement cannot erase existing text. The guard is
an explicit headset experiment: it must turn Backspace on an otherwise empty native buffer into an
observable value change, and it must not leak into the draft.

- [x] Clicking within existing text records that caret and opens the native Quest keyboard through
  a focused DOM input when `XRSession.isSystemKeyboardSupported` is true.
- [x] Native typed or dictated text is inserted at the recorded caret. Native edits to that text
  update only the inserted range, preserving the surrounding draft.
- [x] Backspace from an empty native buffer deletes the complete grapheme before the recorded
  caret; repeated Backspace is re-armed without adding a visible character. A selected range, when
  available, is deleted first.
- [x] Browsers without the WebXR system keyboard retain normal textarea/physical keyboard editing.
  Disable, navigation, send, and exit remove focus and transient input state without losing drafts.
- [x] Remove the superseded in-panel keyboard and its texture allocation. Pure regressions cover
  insertion, replacement, native buffer editing, repeated deletion, Unicode, and the draft limit;
  browser checks cover caret handoff, focus, cleanup, and explicit Send.
- [ ] Physical Quest verifies keyboard opening, typing, native speech, first and repeated
  Backspace, prediction/composition, dismissal, and reopening. Until then the guarded Backspace
  bridge is experimental and the story remains In progress.

### Superseded headset editing experiment and history selection follow-up

Headset feedback invalidates the earlier assumption that passing the full textarea value enables
editing existing text with Quest's system keyboard. Meta documents a fresh native buffer for each
keyboard display and no individual key events. Do not present another textarea assignment as a fix.
This extended the same conversation slice in `InlineConversationInput.tsx:18`,
`ConversationTools.tsx:41`, and `useImmersiveScroll.ts:10`.

- [x] History selection works with the XR pointer event lifecycle while deliberate scrolling and
  cancellation do not open a conversation.
- [x] Remove the floating Edit message button from the normal conversation composer.
- [x] Selecting the input opens an in-panel keyboard that edits the whole draft, including existing
  text after reopening. It supports ray caret placement, wrapped-line navigation, Backspace,
  Select all, Undo, capitals/symbols, and newlines; only Send submits. Closing restores chat.
  Native XR does not open Quest's unseedable system buffer.
- Superseded by the native Quest keyboard bridge above after further headset feedback.
- [x] Focused regressions cover the reported interaction failures and resource cleanup. Physical
  Quest acceptance remains pending until the user verifies the revision on the headset.

### Existing draft editing and composer polish

The native keyboard append buffer prevents deletion of existing text. Correct that behavior in
`InlineConversationInput.tsx:1`, widen its surface around the voice/Send controls, and fix tooltip
occlusion in `WorkspacePanel.tsx:16`.

- [x] Focusing a populated input exposes the existing draft for editing and deletion instead of
  treating it as an immutable prefix. Empty edited values clear the draft; native and physical
  keyboard limitations are stated accurately and regressions cover refocusing and replacement.
- [x] The input fills the panel's content width; microphone and Send sit inside it, with text
  padding reserving their area.
- [x] Tooltips draw above other controls while retaining their delay, fade, and noninteractive behavior.
- [x] Focused/browser checks pass for editing, layout, tooltip layering, and existing voice flows.

### Conversation history list revision

Extend the in-panel history view within the same session-navigation slice. The list implementation
lives in `ConversationList.tsx:1`, with sorting/activity labels in `conversationListModel.ts:1`;
`AppShell.tsx:1422` supplies host-owned session modification times.

- [x] Conversation rows show a relative last-updated time and sort newest to oldest across machines.
- [x] The list scrolls with wheel, controller thumbstick, and trigger-drag without selecting a row
  at drag release. Rendering stays bounded as history grows.
- [x] Load more appears after the initially loaded choices, appends another batch without resetting
  the scroll position, and disappears when every available conversation is shown.
- [x] Back is at the upper left of the list header and restores the active chat and reading position.
- [x] Focused/browser checks cover ordering, times, scrolling/selection, incremental loading,
  navigation, and resource cleanup; headset comfort remains physical acceptance.

### Inline composer and panel controls revision

Continue the same conversation slice with a conventional chat layout. The existing code anchors
above own header controls, scrolling, draft/voice actions, and device layout migration.

- [x] History uses a history icon at the upper right, beside Agents; both replace the panel body
  and allow returning to chat. The header leaves room for the conversation title.
- [x] Latest floats at the lower right of the scroll viewport and appears only away from bottom.
- [x] Chat includes an inline editable message field with microphone and Send. It shares the
  desktop draft, supports native text entry, preserves explicit speech review/correction, and
  keeps the conversation visible during ordinary composition. Session changes/close/exit clean up input.
- [x] Conversation defaults to the right of the centered canvas; repository changes stay hidden
  on the left. Existing default layouts migrate and deliberate placements are preserved.
- [x] Bottom panel buttons toggle visibility and indicate which panels are open.
- [x] Focused/browser checks cover input, send/voice recovery, header navigation, conditional
  Latest, toggle behavior, migration, and resource bounds. Physical keyboard/readability acceptance
  remains pending on Quest.

### Conversation navigation and comfort revision

The next headset feedback requests clear session identity, continuous conversation scrolling,
an in-panel conversation list with Back, Evidence hidden by default, a centered diagram with
conversation to its left, and less intrusive tooltip timing/contrast. This extends the same
immersive-workspace conversation slice; preserve existing session/draft/action ownership.

- [x] The conversation header identifies the active session and its machine/project context.
- [x] Full loaded history scrolls continuously with a thumbstick and wheel/drag input; multiple
  messages share one viewport. Streaming follows the bottom only when already at the bottom,
  preserves an older reading position, and offers Latest. Rendering remains bounded.
- [x] The conversation-list icon replaces this panel's contents with session choices; Back
  restores the active conversation and reading position. No separate list panel is needed.
- [x] Default/reset placement puts conversation left and canvas center, with Evidence closed.
  Older default layouts migrate without losing explicitly moved panel positions.
- [x] Tooltips have a short hover delay, subtle contrast, and a smooth fade, including toolbar
  and disabled-control labels. Leaving the target cancels a pending tooltip.
- [x] Focused model/browser checks verify scrolling, identity, list/back navigation, layout
  migration, tooltip timing, and bounded resources. Headset comfort remains physical acceptance.

### September 11 usability revision

The initial implementation feels like a terminal surrounded by text buttons on the headset.
Keep this story In progress until physical acceptance; revise the implemented interface now:
use conversational message bubbles and proportional body text, a quiet icon toolbar with hover
labels, and contextual editing tools instead of showing every operation at once. Preserve
explicit speech review and Send, session ownership, readable errors, and bounded resources.
Recording must show actual microphone activity and elapsed time immediately. Panel movement and
reselecting Compose must preserve recorded/unapplied speech. Live partial transcription remains
a separate change to the current complete-WAV transcription protocol; do not imply a static
recording state is a live transcript.

- [x] Chat uses distinct user/agent bubbles, readable proportional text, and quiet metadata.
- [x] Common VR navigation/actions use icons with discoverable labels; correction tools appear
  only when requested, with Send and active-run cancellation easy to reach.
- [x] Voice shows measured audio activity and elapsed recording time; dragging/resizing panels and
  reselecting Compose preserve speech. Exit/session changes still release the microphone.
- [x] Focused browser regressions and visual inspection verify the revised chat/composer,
  correction actions, speech preservation, and aggregate texture budget.

1. Add a readable in-world composer with clear focus and explicit **Send**. The user's initial
   input baseline is **controllers plus voice on Quest 3S**. Provide labelled start/stop dictation,
   append/replace draft or selected text, delete/clear, undo, and review controls. Prove that paths,
   identifiers, and multiline instructions can be corrected without a required keyboard; define a
   spelling/correction interaction as part of the implementation instead of accepting bad transcripts.
2. Validate microphone capture and transcription during a real immersive session first. Record the
   selected engine/service, language, configuration, latency, audio retention, and whether audio
   leaves the headset/home. Prefer the existing local-first topology; do not silently depend on a
   third-party speech service or read provider credentials. Any server transcription endpoint uses
   the paired route gate with bounded audio size/duration and cancellation/cleanup.
3. Dictation has intentional start/stop, visible recording/transcribing/error states, and correction
   before Send. Stop microphone tracks on exit/revocation/error; no always-on capture or automatic
   send. Denied/unavailable voice preserves the draft, explains recovery, and permits retry/exit;
   if an optional physical keyboard is available it can continue editing. Voice failure is a real
   degraded input state, not claimed to be full controller-only text entry.
4. A physical keyboard is an optional convenience if verified in XR: focus, caret, insert/delete,
   spaces/newlines, and shortcuts must affect only the focused draft. The later headset-editing
   follow-up adds the guarded native keyboard bridge; hand tracking remains deferred. The voice
   journey does not depend on a keyboard.
5. Reuse the per-view draft and existing send path. Display the target session, agent, provider,
   mode, and attachment summary before submission. Keep drafts attached to their session across
   focus changes and exit; switching sessions cannot redirect a pending submission.
6. Select/add agent participants and make one primary through the same permitted actions as DOM, and
   choose supported Ask/Plan/Agent modes with server-owned availability. Loading/busy states and
   failures are readable; unsupported modes remain unavailable.
7. Show streaming text, delivery/error/queued state, and **Cancel** for the explicitly selected run.
   Preserve draft input on send failure and prevent duplicate submission. Cancellation follows run
   identity even if focus changes; it does not clear another session's draft or cancel its work.
8. Virtualize readable conversation history so older messages remain reachable beyond Story 44's
   newest twelve entries; keep bounded rendered resources, stable reading position, and a return to
   latest action. Stream updates cannot steal keyboard focus or move an older reading position.

## Acceptance criteria

Implementation decisions, September 11, 2026: use conversation-panel chat/composer/agents views
with compact icon navigation, the existing shell draft and command owners, and explicit review of recorded speech before editing
the draft. Controller word selection, deletion, undo, and a spoken spelling mode support exact
paths/identifiers; no keyboard is required by the design. Capture bounded mono PCM with an
AudioWorklet and send WAV only to the paired home origin. A configured loopback whisper.cpp server
performs transcription; no browser speech service or provider credentials are used. Default
language is English, configurable on the home machine. Missing transcription setup has a visible
recovery state. DOM currently supports selecting/adding agents and making one primary; VR exposes
that same roster contract, without introducing new removal/configuration APIs.

ADB reports no connected headset. Implementation and automated verification can proceed, but
microphone/XR compatibility, transcription quality/latency, controller correction, and comfort
remain physical acceptance requirements and must not be marked passed without headset evidence.

- [ ] On Quest 3S the user dictates/corrects a multiline instruction containing a path/identifier
  and sends it with controllers and voice, without another device or a required keyboard.
- [x] Recipient/mode and attachment summary are visible; roster actions reuse the existing policies.
- [x] Drafts survive session switching, failed sends, and VR exit; duplicate clicks produce one turn.
- [x] Streaming and older history use a bounded raster viewport and stable focus/position in browser
  checks. Physical readability remains part of the Quest acceptance criterion above.
- [x] Cancel targets the captured run; switching focus during send/cancel cannot change its target.
- [x] Automated voice input, denied access, failed transcription, stop, and correction are verified;
  failures preserve drafts and offer recovery, with the actual transcription/data path documented.
- [x] Optional physical-keyboard input, if implemented, affects only its focused draft. Microphone
  resources and any bounded server audio are cleaned up on exit, error, cancellation, and revocation.
- [x] `npm run lint`, `npm test`, `npm run build`, and `npm run test:e2e` pass.
- [ ] Physical input smoke evidence supplements automated semantic-action checks, including
  capture during XR, correction quality, latency, and seated readability on Quest 3S.

## Out of scope

Permission answers and session creation are Story 48; attachment selection/creation and drawing
are Story 49. Hand tracking, terminal emulation, code editing, automatic voice
commands, and provider changes are outside this story. Dictation must not acquire a dependency on
future software-model sketch anchors.

## How to verify

1. Test editing/submission with long text, newlines, failure, duplicate select, and switching focus
   while sending. Verify canonical message contents and captured session/machine/participant IDs.
2. With fake providers, change participants/modes, stream output, read beyond twelve messages, and
   cancel one of two running sessions while the other retains its draft and work.
   Scroll through multiple messages with wheel/trigger-drag and the focused panel's thumbstick;
   open the conversation list and Back, then choose another machine's session. Confirm the header,
   stable older reading position, bottom following, hidden Evidence defaults, and delayed/fading labels.
3. On paired Quest 3S, perform the entire dictate/correct/send/cancel sequence with controllers
   and voice, including spelling an identifier, microphone denial, and transcription failure. Test
   native Quest and physical keyboard entry separately. Run checks and record input/transcription setup.

## Technical reference

Meta recommends runtime capability checks and on-headset verification in its
[Browser specifications](https://developers.meta.com/horizon/documentation/web/browser-specs/).
Its [WebXR system keyboard guide](https://developers.meta.com/horizon/documentation/web/webxr-keyboard/)
documents editing-session limitations and `visible-blurred` while the keyboard is shown. The
native system buffer cannot be seeded with the full draft. The guarded native buffer retains the
canonical draft/caret outside Quest and translates value changes into insertions and grapheme
deletions. Verify guard restoration, native speech, controller caret placement, and the chosen voice
path on the exact Quest 3S browser used for acceptance.

## Verification record

September 12, 2026:

- Replaced the temporary in-panel keyboard with a native Quest system-keyboard bridge. A ray click
  records the visible draft caret, while Quest receives only a guarded insertion buffer. Typed,
  corrected, predicted, or dictated buffer text replaces that retained range without exposing the
  surrounding draft to Quest's documented first-input replacement.
- An invisible word-joiner makes an empty-buffer Backspace observable; deletion uses complete
  grapheme boundaries and re-arms the guard. The transaction model distinguishes empty composition
  from deletion, commits erased replacements once, keeps literal command-like words as text, and
  preserves the guard at the draft limit. The temporary keyboard component and texture were removed.
- Passed the production build, TypeScript, all 319 unit tests in 54 files, all 29 VR browser cases,
  and whitespace checks. Eighteen native-bridge cases cover insertion, native revision, range
  replacement, repeated/Unicode deletion, composition cancellation, literal words, and limits.
  Browser checks cover ray caret handoff, native focus/buffer changes, dismissal, cleanup, ordinary
  textarea editing, explicit Send, and resource bounds. Automated value events cannot prove that
  Quest's private IME accepts guard restoration; physical typing, native speech, prediction,
  composition, and repeated Backspace remain required acceptance.

September 11, 2026:

- Headset follow-up: history activates on a matching trigger release, tolerates small controller
  drift, and uses the actual panel-plane hit. It no longer depends on the XR library's 300 ms
  synthetic-click deadline. Dragging/cancellation and wheel scrolling cannot activate a row.
- Removed the floating Edit message button. Selecting the input opens a compact in-panel keyboard
  with direct caret placement, wrapped-line navigation, whole-draft deletion/replacement, bounded
  Undo, capitals/symbols, and explicit Send. Closing restores chat. Speech tools are confined to
  speech review. Native XR never focuses the textarea or opens Quest's fresh system buffer.
- Passed production build, TypeScript, all 302 unit tests in 53 files, and all 29 VR browser cases.
  Five new regressions drive the installed XR pointer/ray implementation; five exercise full-draft
  Unicode edits and measured cursor layout. The focused keyboard browser case also passed after
  adding native-session focus and ray-caret checks. Inspected the keyboard screenshot; allocation
  stays under the existing texture ceiling and exit releases resources. A second-controller review
  issue was fixed by keeping keyboard presses per pointer. Physical Quest acceptance remains pending.

- Existing-draft revision: removed the app's immutable native prefix; browser input values now
  replace the full draft, including deletion to empty. An Undo snapshot before the first edit in
  each focus session recovers prior text after native replacement or clearing. The input fills
  the content width around microphone/Send with reserved text padding. Tooltips render last with
  depth testing disabled, retaining their delay/fade and noninteractive behavior.
- Passed production build, TypeScript, all 292 unit tests, and all 29 VR browser cases. Regressions
  cover refocusing/backspace, select-all clearing, simulated native replacement, Undo recovery,
  input width, and tooltip depth/render ordering. Inspected the overlapping-tooltip screenshot.
  Meta still documents first-key replacement and exposes no WebXR method to seed the native
  keyboard buffer: this fixes the app-side restriction, not a verified native keyboard limitation.
  Full native cursor editing/deletion on Quest remains unaccepted.

- History-list revision: session rows show relative host modification times and sort newest first
  across machines. The fixed-size scroll surface initially exposes 20 choices, with Load more at
  the end appending the next batch without changing the reading offset. Back now sits at the
  upper left. Wheel/controller/drag input is shared with chat; drag release cannot select a row.
- Passed 292 unit tests in 51 files, all 49 browser tests, production build, TypeScript, and whitespace
  checks. The new 27-conversation fixture covers cross-machine order, timestamps, drag suppression,
  Load more, preserved offsets, older-session selection, top-left Back, and texture reuse. Increased
  list typography after inspecting the screenshot; a fresh build and both focused history/list
  browser cases passed afterward. Physical headset readability remains pending.

- Inline composer revision: History and Agents now sit at the upper right. Latest floats over
  the lower-right history viewport only away from bottom. The chat remains visible above a real
  text input, microphone, and explicit Send. Native Quest entry appends through a fresh buffer to
  protect existing drafts; physical keyboards edit the full value. Header navigation pauses while
  speech is pending. Layout version 4 moves default chat right and Evidence left, and bottom panel
  icons toggle visibility with an open-state highlight.
- Passed 290 unit tests, all 48 browser tests, production build, TypeScript, and whitespace checks.
  After caret/cap protection and speech-navigation cleanup, a fresh build and all 28 VR browser
  tests passed. Browser cases exercise ray-focused typing, explicit Send, native overwrite protection,
  header/Back restoration, toggle-close cleanup, conditional Latest, and bounded GPU resources.
  Inspected inline-input and scrolling screenshots. Quest native keyboard behavior and comfort
  remain physical acceptance; the story stays In progress.

- Conversation navigation revision: added session/project/machine headers, a continuous full-history
  viewport, and an in-panel conversation list with Back. Older reading offsets survive streaming
  and list navigation; bottom readers follow output. Defaults now place chat left and canvas center,
  with repository changes right/closed; version 3 migrates old defaults and preserves moved panels.
  Tooltips wait 450 ms, use muted colors, and fade over 150 ms. Removed the obsolete transcript pager.
- This revision passes all 288 unit tests in 50 files, all 46 browser cases, production build,
  TypeScript, and diff whitespace checks. New browser coverage exercises real ray-drag/wheel scrolling,
  texture reuse, header identity, list/Back scroll restoration, cross-machine selection, and tooltip
  delay/fade cancellation. Fixed the session-loading transition exposed by navigation and voice tests.
  Inspected Chrome chat/list screenshots. Physical Quest readability and controller comfort remain
  pending; this story stays In progress.

- Usability revision: the user reports that recognition works on the headset, but the initial
  terminal-like text and button grid are difficult to use, with inadequate feedback during
  recording. Replaced common text actions with icons and hover labels; added user/agent bubbles,
  54px logical sans-serif chat text with a shared 16-line page budget, contextual editing, and
  measured audio levels/duration. Send returns to Latest; Cancel stays available in chat.
- Revised implementation passes all 286 unit tests and all 44 browser cases, plus the production
  build and TypeScript check. Browser regressions cover speech surviving panel movement/resize,
  measured microphone activity before Stop, disabled-icon labels, correction error visibility,
  and the existing resource ceiling. Inspected chat/composer/recording screenshots from Chrome.
  Transcription remains complete-clip after Stop; live partial text is not implemented. Updated
  UI readability and comfort on Quest remain unaccepted.

- `npm run lint` passed. `npm test` passed all 284 tests in 49 files. New tests cover WAV format,
  duration/byte bounds, exact spelling/replacement, overflow, paired authorization, loopback-only
  configuration, cancellation, revocation, and bounded transcription responses.
- `npm run test:e2e` built production into `.next-e2e` and passed all 43 browser cases. Five new
  cases exercise real AudioWorklet capture with Chrome's fake microphone and semantic XR adapter:
  ray-selected recording; dictated/spelled multiline text; duplicate sends and failed draft
  persistence across machines/reload; denied/unavailable voice; late permission/transcription;
  microphone loss/exit; roster/mode parity; and cancellation alongside a second active run.
  Existing streaming/history and aggregate 4,194,304-pixel resource checks pass.
  After the final UI state cleanup, a fresh production build and all six focused VR input/streaming
  cases passed again. Next.js regenerated its normal development declaration after verification.
- Built whisper.cpp revision `02612981545f58188a44de99b8a4710793714629` in a temporary directory,
  downloaded `base.en`, and ran its loopback server with four CPU threads. The real application
  WAV encoder/transcription helper returned the expected text from the bundled 11-second JFK
  reference clip in 615 ms. This proves protocol integration, not headset speech accuracy.
  The temporary server was stopped after verification. Setup is documented in the README;
  no persistent voice service or live CodeAI configuration was installed.
- English is the initial configurable default. Audio travels headset → paired HTTPS home →
  loopback Whisper, stays in memory, and is not sent to an executor or third-party service.
  Upload timeout: 15 seconds; inference deadline: 90 seconds; audio limit: 60 seconds/1,920,044
  bytes; one admission at a time. The documented engine supports disconnect cancellation.
- `adb devices -l` returned no attached headset. Quest 3S capture/XR compatibility, actual
  microphone quality and latency, identifier correction, and comfort remain unverified.
  The initial voice revision did not include keyboard input; the later inline-input revision adds it.
  This story remains In progress.
