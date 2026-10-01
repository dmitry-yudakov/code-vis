# Story 81 — Paste or drop an image into the conversation on the desktop

**Status:** In progress · **Type:** Full-stack · **Depends on:** nothing. It follows the attachment
paths of [Story 63](STORY-20260921-report-evidence-in-conversation.md) (reports) and
[Story 71](STORY-20260925-compact-composer.md) (the composer's chips).

---

## Motivation

The user, on September 30, 2026:

> I want to be able to paste a screenshot into the chat - on desktop

and, about how it should behave:

> it's more important to show them as a chip in the conversation and send the screenshot to the
> server in the next message. […] nothing is pasted in the text - just an attachement chip appears.
> on mac it's possible to take a screenshot and drag it into the chat input shortly after

Today the only pictures a turn can carry are ones CodeAI made itself: a canvas's composite PNG and a
headset report's JPEG. A screenshot of a failing page, a design, or a terminal has to be saved to a
file inside the repository and named in the message.

---

## Current behavior (where the code is)

- **The composer:** [InstructionComposer.tsx:382](../src/features/conversation/InstructionComposer.tsx#L382),
  a `<textarea>` with no paste or drop handling: an image on the clipboard does nothing, and a
  dropped file is the browser's to open. Its chips
  ([:359](../src/features/conversation/InstructionComposer.tsx#L359)) show attached canvases and reports.
- **Pending attachments:** canvas ids and report ids are device state per session view
  ([workspaceViews.ts:45](../src/features/shell/workspaceViews.ts#L45)), saved to `localStorage`.
- **Sending:** `send` in [AppShell.tsx:1205](../src/features/shell/AppShell.tsx#L1205) builds the
  request; a canvas's PNG travels in it as a data URL
  ([protocol.ts:22](../src/shared/protocol.ts#L22)), and the draft is cleared only once the answer
  arrived.
- **The message route:** [route.ts:31](../src/app/api/agent/message/route.ts#L31) accepts at most
  6 MB, validates attachments before reserving a run, and appends a user message that records
  metadata only ([types.ts:407](../src/shared/types.ts#L407)).
- **The run directory:** [tempAttachments.ts:53](../src/server/storage/tempAttachments.ts#L53) writes
  each canvas's files and `diagram-attachments.json`;
  [conversationService.ts:81](../src/server/conversation/conversationService.ts#L81) adds reports
  and the repository context, and [prompt.ts:66](../src/server/conversation/prompt.ts#L66) names them.
- **Providers:** local Codex receives every `.png` and `.jpg` of the run directory as a
  `localImage` ([codexProcessRunner.ts:156](../src/server/agents/codexProcessRunner.ts#L156)); Docker
  Codex only the `.png` ones
  ([dockerProcessRunner.ts:53](../src/server/execution/dockerProcessRunner.ts#L53)). Claude reads the
  files from the directory it was given with `--add-dir`
  ([claudeInvocation.ts:28](../src/server/agents/claudeInvocation.ts#L28)).
- **Session format:** a new field on a user message needs a new session version, written only by
  the first message that uses it ([sessionSchema.ts:218](../src/shared/sessionSchema.ts#L218),
  [sessionStore.ts:612](../src/server/storage/sessionStore.ts#L612)).

---

## Desired behavior

Pasting an image into the composer, or dropping one on it, adds a chip with its thumbnail to the
next message and puts nothing in the text. Sending gives the image to the addressed agent for that
turn, and the transcript states that the message carried it.

### Design decision: the image is the turn's, not the session's

An image follows the canvas composite's path, not the report's: its bytes travel in the message
request, live in the run directory for that one turn, and are removed with it. The message keeps
metadata only. This needs no new storage, no route that serves stored images, and no per-session
ceiling. The cost is stated under *Out of scope*: the transcript shows a statement, not the picture,
and Retry cannot bring the image back once the composer no longer holds it.

### Concrete changes

1. **Paste.** The composer's text field takes image files from a paste when the clipboard holds no
   plain text. (A spreadsheet or a document copies its selection as text *and* a picture; that paste
   stays text.)
2. **Drop.** Files dropped on the composer are taken there instead of being opened by the browser.
   Images are attached; anything else raises a toast. The composer shows that it is a drop target
   while a file is dragged over it, and takes no drop while a turn runs. Anywhere else in CodeAI, with
   the conversation open or closed, a dragged file is refused, so a drop that misses the composer
   never replaces CodeAI, and the images waiting in it, with the file.
3. **Bounds.** Up to `MAX_IMAGES_PER_MESSAGE` (4) images wait per session; a fifth raises a toast
   before it is decoded, also when two pastes race for the last place. An original over 32 MB is
   refused before it is decoded. The message route's 6 MB still bounds the whole request: four
   images at the bound leave about 1.8 MB for canvas composites, and a larger request is refused
   with its draft kept.
4. **Prepare in the browser.** Every image is decoded and drawn again onto a canvas, so what is
   sent is a fresh PNG or JPEG holding nothing of the original file but its pixels. The long edge
   is at most 2048 px. PNG is kept when it fits `MAX_IMAGE_BYTES` (768 KiB); otherwise JPEG, on
   white, at 0.9 then 0.75; otherwise the image is scaled to three quarters and tried again, up to
   four sizes. An image that cannot be decoded or made to fit raises a toast and adds nothing.
5. **Pending state.** Prepared images are browser memory per session, never `localStorage`: they
   are too large for the device record. A reload drops them.
6. **Chips.** Each image shows its thumbnail, `Image N`, its format, its size in pixels and bytes,
   and a remove button. An image alone is enough to send; the message text is then
   `IMAGE_ONLY_INSTRUCTION`.
7. **Wire.** `imageAttachments: [{ dataUrl }]` on the message request, sent only when there are
   images; absence is `[]`.
8. **Route.** Before reserving a run it refuses a fifth image, and an image that is not base64, not
   framed as the PNG or JPEG it declares (that format's signature and end marker: a mislabelled or
   cut-short image, not damage inside, which the browser cannot produce and the provider decodes),
   or over `MAX_IMAGE_BYTES`. The user message records
   `imageAttachments: [{ mediaType, bytes }]`. A repeated message id compares them too.
9. **Session format 8.** Version 8 is version 7 whose user messages may carry `imageAttachments`.
   Only the first such message upgrades its session; no upgrade lowers a version.
10. **Run.** Turn preparation writes `image-N.png` or `image-N.jpg` and `image-attachments.json`
    into the run directory. The prompt names the images and their files. Codex receives them as
    `localImage`, in Docker too, where `.jpg` files are now passed as well; Claude reads the files.
    Docker Codex thereby also receives a report's screenshot (`report-N.jpg`), as local Codex
    already did.
11. **Transcript.** A user message states `N image(s) attached`, flat and in VR.
12. **Retry.** Retry restores the text as before. When the message carried images and none are
    waiting in the composer, a toast says to attach them again.
13. **What clears them.** A delivered turn removes the images it sent. A failed or cancelled send
    keeps them with the draft. Execute plan and Continue turns never carry them.

### Type contract

```ts
// src/shared/limits.ts
export const MAX_IMAGES_PER_MESSAGE = 4;
export const MAX_IMAGE_BYTES = 768 * 1024;

// src/shared/types.ts
export type ImageMediaType = 'image/png' | 'image/jpeg';
export interface ImageAttachmentRequest { dataUrl: string }
export interface ImageAttachmentRecord { mediaType: ImageMediaType; bytes: number }
// UserMessage.imageAttachments?: ImageAttachmentRecord[]        (version 8 sessions only)
// AgentMessageRequest.imageAttachments?: ImageAttachmentRequest[]
// DurableSession.version / PublicSession.version: 3 | 4 | 5 | 6 | 7 | 8
```

`src/shared/sessionSchema.ts` and `src/shared/protocol.ts` hold the matching schemas.

---

## Acceptance criteria

- [x] Pasting an image into the composer adds a chip with its thumbnail and no text; pasting text,
      or text together with an image, stays an ordinary text paste.
- [x] Dropping an image on the composer adds the same chip, and a dragged file marks the composer
      as a drop target; a dropped file that is not an image raises a toast.
- [x] The page stays where it is: a real file drag through Chrome's own pipeline (CDP
      `Input.dispatchDragEvent`) is offered a copy and dropped on the composer, and is offered
      nothing elsewhere, with the conversation open or closed, so its drop never happens. Headless
      Chrome does not open an unhandled file, so How to verify step 5 is the check that one would.
- [x] While a turn runs, the composer takes no drop and still keeps the file from opening.
- [x] An image chip can be removed, and an image alone enables Send.
- [x] A fifth image, also from two pastes racing for the last place, and an undecodable image each
      raise a toast and leave the pending images unchanged; with four waiting, a fifth is not even
      decoded. A drop of an image beside another file attaches the image and says why.
- [x] An original over 32 MB, and an image that cannot be made to fit, each raise a toast. The
      second check replaces the browser's encoder with one whose every result is too large.
- [x] What is sent is a re-encoded PNG or JPEG of at most 2048 px and `MAX_IMAGE_BYTES`; a
      transparent image sent as JPEG is drawn on white, behind its pixels. With an encoder that
      answers PNG for JPEG at full size and fits only JPEG 0.75, an image is sent as a JPEG at three
      quarters of its size.
- [x] The route refuses, before reserving a run, more than four images and any image that is not
      base64, mislabelled, cut short, of another type, or too large.
- [x] The accepted message records `mediaType` and `bytes` per image, and the image bytes appear
      nowhere in the session record.
- [x] The first message with an image upgrades only its session to version 8; a message without one
      leaves the version alone, and a record below version 8 that holds `imageAttachments` is invalid.
- [x] The run directory holds `image-N.png|jpg` and `image-attachments.json` during the turn and is
      removed after it; the prompt names the images and the manifest.
- [x] Docker Codex is given the run directory's `.jpg` images as well as its `.png` ones.
- [x] The transcript states the images of a message, flat and in VR.
- [x] A failed or cancelled send keeps the images with the draft; a delivered turn removes them;
      an Execute plan turn neither carries nor removes them (Continue where you stopped takes the
      same path).
- [x] Retry of a message that carried images says to attach them again when none are waiting, and
      nothing when some are.
- [x] `npm run lint`, `npm test`, and `npm run test:e2e` pass.
- [ ] A check in the running app with a real screenshot and a real Claude and Codex turn. The
      automated checks synthesize the paste and the drop and run the fake Claude; no real clipboard,
      no macOS screenshot drag, and no real provider has seen an image yet.

## Out of scope

- **Opening an image on the canvas and drawing over it.** The user's next idea: pressing a chip
  shows the screenshot on the canvas, where it can be marked like a sketch, and the marked picture
  is what is sent. It needs a canvas kind with a picture behind the ink, and is its own story.
- **Keeping the image.** The transcript does not show the picture, and the image is not available
  to a later turn, a Retry after a reload, or another device. Durable images need session-owned
  storage like a report's, a route that serves them, and a ceiling per session.
- **Other ways in.** A file picker in the **+** menu, and attaching in VR.
- **Other files.** SVG, PDF, and text files. (A GIF or WebP that the browser can decode is sent as
  one still frame, re-encoded.)
- **Images in an agent's answer.**

## How to verify

1. `npm run lint && npm test && npm run test:e2e`. The checks are `test/imageAttachments.test.ts`
   (browser helpers, the wire, the route, the session format) and `e2e/images.spec.ts` (paste, drop,
   refusal elsewhere, chips, bounds, send, failure, Retry, Execute plan, in Chrome with the fake
   Claude).
2. `npm run dev`, open a session with a repository, and take a screenshot to the clipboard.
3. Focus the composer and paste: a chip with the thumbnail appears and the text is unchanged.
   Remove it, then paste again.
4. Send with no text. The message reads `IMAGE_ONLY_INSTRUCTION` and states `1 image attached`;
   the agent's answer describes the screenshot.
5. Drag an image file, or on macOS the screenshot thumbnail, onto the composer: the same chip.
   Drag another and release it on the transcript instead: CodeAI stays in the tab, and no chip is
   added.
6. Paste a copied spreadsheet range: it arrives as text, with no chip.
7. Repeat step 4 with a Codex agent, and in a Docker session.

## What shipped

- **Browser preparation.** [imageAttachments.ts](../src/features/conversation/imageAttachments.ts):
  `pastedImageFiles` takes a paste's images only when the clipboard holds no plain text
  ([:30](../src/features/conversation/imageAttachments.ts#L30)), `carriesFiles` recognizes a file
  drag ([:36](../src/features/conversation/imageAttachments.ts#L36)), and `prepareImage` refuses an
  original over 32 MB, then draws the image again and tries PNG, JPEG 0.9, and JPEG 0.75 (on white,
  behind the pixels) at up to four sizes, never taking a PNG a browser returned for JPEG
  ([:57](../src/features/conversation/imageAttachments.ts#L57)). `IMAGE_ONLY_INSTRUCTION` and the
  transcript's statement live there too.
- **Composer.** [InstructionComposer.tsx](../src/features/conversation/InstructionComposer.tsx): a
  file drag over the composer is always cancelled, and offered a copy and marked as a drop target
  unless a turn runs ([:356](../src/features/conversation/InstructionComposer.tsx#L356)); a paste of
  images puts nothing in the text ([:374](../src/features/conversation/InstructionComposer.tsx#L374));
  each image is a chip with its thumbnail ([:411](../src/features/conversation/InstructionComposer.tsx#L411)).
- **Pending images, the page-wide refusal, and the send.** [AppShell.tsx](../src/features/shell/AppShell.tsx):
  images per session in browser memory, with a ref the send reads synchronously
  ([:865](../src/features/shell/AppShell.tsx#L865)); `addImages` counts the waiting images before
  preparing one and again after, so a fifth is never decoded and two racing pastes cannot both take
  the last place ([:877](../src/features/shell/AppShell.tsx#L877)); a window listener refuses a file
  drag or drop that no handler took, whether the conversation is open or closed
  ([:905](../src/features/shell/AppShell.tsx#L905)); `send` takes no images on an Execute plan or
  Continue turn ([:1293](../src/features/shell/AppShell.tsx#L1293)) and removes the sent ones only
  after a final answer ([:1455](../src/features/shell/AppShell.tsx#L1455)); Retry's toast
  ([:1119](../src/features/shell/AppShell.tsx#L1119)); VR lists them as `Image N` and counts them for
  Send ([:2014](../src/features/shell/AppShell.tsx#L2014)).
- **Wire and route.** `imageAttachmentSchema` checks shape only
  ([protocol.ts:42](../src/shared/protocol.ts#L42)); the route decodes the images before it reserves
  a run ([route.ts:60](../src/app/api/agent/message/route.ts#L60)), compares them on a repeated id
  ([:133](../src/app/api/agent/message/route.ts#L133)), and records `{ mediaType, bytes }`
  ([:249](../src/app/api/agent/message/route.ts#L249)).
- **Run directory and providers.** `decodeImageAttachments` refuses a fifth image, another type, and
  an image over `MAX_IMAGE_BYTES` or not framed as the format it declares
  ([tempAttachments.ts:129](../src/server/storage/tempAttachments.ts#L129)); `writeImageAttachments`
  writes `image-N.png|jpg` and the manifest, user-only
  ([:152](../src/server/storage/tempAttachments.ts#L152)). Turn preparation calls it
  ([conversationService.ts:94](../src/server/conversation/conversationService.ts#L94)), the prompt
  names the images ([prompt.ts:74](../src/server/conversation/prompt.ts#L74)), and Docker Codex now
  takes `.jpg` files as well as `.png` ones
  ([dockerProcessRunner.ts:55](../src/server/execution/dockerProcessRunner.ts#L55)), which also
  brings it report screenshots.
- **Session format 8.** The record schema, the version, and the version gate
  ([sessionSchema.ts:154](../src/shared/sessionSchema.ts#L154),
  [:250](../src/shared/sessionSchema.ts#L250), [:312](../src/shared/sessionSchema.ts#L312)); the store
  compares images on a repeated id and raises the version for the first image ahead of Auto and of
  a report ([sessionStore.ts:604](../src/server/storage/sessionStore.ts#L604),
  [:616](../src/server/storage/sessionStore.ts#L616)).
- **Transcript.** [ChatMessage.tsx:50](../src/features/conversation/ChatMessage.tsx#L50) and
  [immersiveTranscript.ts:61](../src/features/diagram/spatial/immersiveTranscript.ts#L61).
- **Fixtures and checks.** `fake-claude.mjs` lists the run directory's image files in its answer
  ([:185](../test/fixtures/fake-claude.mjs#L185)). `test/imageAttachments.test.ts` covers the
  browser helpers, chips, the wire and its bounds, the route, the run directory, the prompt, and
  the store. [images.spec.ts](../e2e/images.spec.ts) has four tests:
  - paste, drop, the drop-target mark, refusal elsewhere, bounds, the race, no decoding past four, a
    mixed drop, send, failure, cancel, a drop during a turn, and Retry with and without waiting
    images ([:171](../e2e/images.spec.ts#L171));
  - a transparent image on white, an original over 32 MB, one that cannot fit, and the encoding
    ladder under a replaced encoder ([:304](../e2e/images.spec.ts#L304));
  - an Execute plan turn ([:339](../e2e/images.spec.ts#L339));
  - real file drags through CDP `Input.dispatchDragEvent`: taken on the composer, refused on the
    transcript and, with the conversation closed, on the canvas ([:369](../e2e/images.spec.ts#L369)).
- **Docs.** README (composer, records, limits), [architecture.md](../docs/architecture.md) (session
  format 8 and **Message images**), and AGENTS.md (the "Now" line and source ownership).

## Verification record

October 1, 2026, offline only; no real clipboard, no headed browser drag, and no real provider has
seen an image.

- `npm run lint`: passes. `npm test`: 97 files, 868 tests pass.
- `npm run test:e2e`: 106 of 106 pass in installed Chrome, including the four in
  [images.spec.ts](../e2e/images.spec.ts).
- **First review** (in-session): fixed a drop beside the composer opening the file, two racing
  pastes silently dropping a fifth image, and an encoded-length check that made the byte check
  unreachable; added tests for the store's repeated-id comparison, Auto with an image, a drop during
  a turn, the white JPEG background, the 32 MB original, an image that cannot fit, and Execute plan.
- **Second review** (an adversarial subagent, 36 mutations of its own, real drags through CDP): no
  defect in the code as written. It found that no test could see a break of every real drop on the
  composer, that the page-wide refusal lapsed while the conversation was closed, that a report with
  an image was untested, and 24 surviving mutations. Fixed: the refusal moved from the composer to
  the shell; a real-drag e2e test; a count before preparing as well as after; tests for report plus
  image, the prompt's injection sentence and one-image case, the wire and record bounds, the header
  and signature lengths, white behind (not over) the pixels, the encoding ladder and the PNG a
  browser may return for JPEG, the drop-target mark, a mixed drop, and Retry with images waiting.
  Corrected claims: the route checks an image's framing, not its completeness; four images at the
  bound leave about 1.8 MB of the route's 6 MB for canvases.
- **Mutations, after both reviews:** 32 unit mutations (the decoder, run directory, store, schemas,
  wire, route, prompt, Docker runner, browser helpers, composer, and VR transcript): all 32 caught.
  E2E, in five builds, each failing at its intended assertion: the guard ignoring an
  already-cancelled drag (`:380`, no chip from a real drop), white over the pixels (`:318`), Retry's
  toast with images waiting (`:295`), no downscale, no JPEG 0.75, and taking a PNG for JPEG (each
  `:335`), any dragleave clearing the mark (`:196`), a drop keeping it (`:382`), a mixed drop
  refusing its image (`:248`), the guard leaving a drop alone (`:200`), and no count after
  preparing (`:228`): 12 of 12. Against the code before the second review's fixes, the new tests
  failed at the closed conversation's canvas drag (`:393`) and at the decode count past four (`:240`).
- **Left as they are:** an executor on an older CodeAI refuses a message with images as "Message
  request is invalid." without naming its age; downscaling uses the canvas's default smoothing;
  pending images of an archived session stay in memory until reload; the VR controls' image labels
  and Send count have no VR-level test; an image still being prepared when Send is pressed waits for
  the next message.
- Pending before **Shipped**: How to verify steps 2–7 in the running app, with a real screenshot,
  a real macOS screenshot drag, and real Claude, Codex, and Docker turns.
