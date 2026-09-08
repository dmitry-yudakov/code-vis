# Story 47 — Converse and steer agents without leaving VR

**Status:** Draft · **Type:** Full-stack (XR input and a validated transcription path) · **Depends on:**
[Story 45](STORY-20260905-application-vr-shell.md), [Story 46](STORY-20260905-vr-workspace-panels.md).

**Vision slice:** [immersive workspace epic](EPIC-20260905-immersive-workspace.md), the conversation
and participant controls of [inside a session](../docs/vision.md#inside-a-session).

## Motivation

A read-only transcript makes the headset an observer. The essential loop is to write an instruction,
correct it, send it to the intended agent, and steer or stop the resulting work in VR.

## Current behavior (where the code is)

- [InstructionComposer.tsx:10](../src/features/conversation/InstructionComposer.tsx#L10) owns DOM
  text editing, mode selection, attachment chips, send, and cancel controls.
- [ParticipantControls.tsx:15](../src/features/agents/ParticipantControls.tsx#L15) presents the roster.
- [AppShell.tsx:739](../src/features/shell/AppShell.tsx#L739),
  [957](../src/features/shell/AppShell.tsx#L957), and
  [1251](../src/features/shell/AppShell.tsx#L1251) select the recipient, send, and cancel.
- [immersiveTranscript.ts:117](../src/features/diagram/spatial/immersiveTranscript.ts#L117) projects
  bounded read-only text; [immersiveTypes.ts:61](../src/features/diagram/spatial/immersiveTypes.ts#L61)
  exposes no conversation commands.

## Desired behavior

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
   spaces/newlines, and shortcuts must affect only the focused draft. A virtual keyboard and hand
   tracking are deferred. The initial controller/voice work journey cannot depend on either keyboard.
5. Reuse the per-view draft and existing send path. Display the target session, agent, provider,
   mode, and attachment summary before submission. Keep drafts attached to their session across
   focus changes and exit; switching sessions cannot redirect a pending submission.
6. Select/add/configure/remove agent participants through the same permitted actions as DOM, and
   choose supported Ask/Plan/Agent modes with server-owned availability. Loading/busy states and
   failures are readable; unsupported modes remain unavailable.
7. Show streaming text, delivery/error/queued state, and **Cancel** for the explicitly selected run.
   Preserve draft input on send failure and prevent duplicate submission. Cancellation follows run
   identity even if focus changes; it does not clear another session's draft or cancel its work.
8. Virtualize readable conversation history so older messages remain reachable beyond Story 44's
   newest twelve entries; keep bounded rendered resources, stable reading position, and a return to
   latest action. Stream updates cannot steal keyboard focus or move an older page.

## Acceptance criteria

- [ ] On Quest 3S the user dictates/corrects a multiline instruction containing a path/identifier
  and sends it with controllers and voice, without another device or a required keyboard.
- [ ] Recipient/mode and attachment summary are visible; roster actions reuse the existing policies.
- [ ] Drafts survive session switching, failed sends, and VR exit; duplicate clicks produce one turn.
- [ ] Streaming and older history remain readable with bounded rendering and stable focus/position.
- [ ] Cancel targets the captured run; switching focus during send/cancel cannot change its target.
- [ ] Required voice input, denied access, failed transcription, stop, and correction are verified;
  failures preserve drafts and offer recovery, with the actual transcription/data path documented.
- [ ] Optional physical-keyboard input, if implemented, affects only its focused draft. Microphone
  resources and any bounded server audio are cleaned up on exit, error, cancellation, and revocation.
- [ ] `npm run lint`, `npm test`, `npm run build`, and `npm run test:e2e` pass; physical input smoke
  evidence supplements automated semantic-action checks.

## Out of scope

Permission answers and session creation are Story 48; attachment selection/creation and drawing
are Story 49. Virtual keyboard, hand tracking, terminal emulation, code editing, automatic voice
commands, and provider changes are outside this story. Dictation must not acquire a dependency on
future software-model sketch anchors.

## How to verify

1. Test editing/submission with long text, newlines, failure, duplicate select, and switching focus
   while sending. Verify canonical message contents and captured session/machine/participant IDs.
2. With fake providers, change participants/modes, stream output, read beyond twelve messages, and
   cancel one of two running sessions while the other retains its draft and work.
3. On paired Quest 3S, perform the entire dictate/correct/send/cancel sequence with controllers
   and voice, including spelling an identifier, microphone denial, and transcription failure. Test
   a physical keyboard separately if implemented. Run checks and record input/transcription setup.

## Technical reference

Meta recommends runtime capability checks and on-headset verification in its
[Browser specifications](https://developers.meta.com/horizon/documentation/web/browser-specs/).
Its [WebXR system keyboard guide](https://developers.meta.com/horizon/documentation/web/webxr-keyboard/)
documents editing-session limitations and `visible-blurred` while the keyboard is shown. These
are references for any later keyboard integration, not evidence that speech input works. Validate
the chosen voice path on the exact Quest 3S browser used for acceptance.

## Verification record

Product input priorities confirmed September 5, 2026. Transcription design, implementation, and
Quest 3S verification remain pending.
