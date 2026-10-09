# CodeAI

A local-first Next.js application for working on a repository through a persistent local-agent
conversation and a canvas with Flat, desktop Spatial, and immersive WebXR projections. Choose
Claude Code or Codex as the first main agent, then add more provider/role participants to the same
session. Conversation is the command/history channel, and once a diagram exists the canvas becomes
the primary workspace. Each message chooses **Ask**, **Plan**, **Agent**, or **Auto**; Native adds **Accept edits** and
**Full access** — subject to the selected provider's supported modes.

**CodeAI** is the working product name until a naming decision replaces it. The superseded
static-analysis server, React Flow client, and VS Code extension are archived under
[legacy/](legacy/README.md); they are not built, started, or imported by this application.

## Requirements

- Node.js 20.9 or newer and npm (Next.js 16 sets the floor)
- at least one current local agent CLI: `claude` and/or `codex`
- the chosen CLI authenticated as the desktop user (`claude` or `codex login` if needed)
- one trusted local repository, or a directory containing trusted repositories

Provider credentials remain owned by the installed CLI. CodeAI inherits the launch environment but
does not read, copy, or persist login material.

## Start

```sh
npm install
cp .env.example .env.local
# Edit CODEAI_REPOSITORIES_ROOT in .env.local.
npm run dev
```

Open <http://localhost:3023>. If the configured root itself contains a common repository marker, it
is offered as a checkout alongside marked, non-hidden descendants discovered breadth-first
up to `CODEAI_REPOSITORIES_DEPTH` (default 1, maximum 10). A new marker on the root does not hide
existing nested checkouts. Projects are durable bodies of work you create in the header; sessions
may belong to a project or remain under **No project**, and may bind
none, one, or several discovered repositories.

Useful commands, all run from the repository root:

```sh
npm run dev       # Next.js development server on 3023
npm start         # production server on 3023, after npm run build
npm run start:remote # paired personal-device HTTPS server, after npm run build
npm run start:managed # the same server, able to rebuild and restart itself; see below
npm run device:pair # print a ten-minute, single-use personal-device pairing code
npm run machine:pair # print a ten-minute, single-use execution-machine pairing code
npm run machine:attach -- https://executor.example:3023 CODE # attach from the home machine
npm run machine:list # list attached executors and their last-seen time
npm run machine:detach -- MACHINE_ID # detach and revoke an executor credential
npm run machine:peers # on an executor, list authorized home machines
npm run machine:revoke -- HOME_MACHINE_ID # on an executor, revoke a home machine
npm test          # offline suite with fake Claude and Codex executables
npm run test:watch # the same suite in watch mode
npm run lint      # strict TypeScript check
npm run build     # production build
npm run test:e2e  # production build + Playwright/installed Chrome canvas workflow
```

## Personal devices

Normal development and production startup remain local and need no sign-in. To open the same
machine-owned Arena from your own tablet, phone, laptop, or headset, opt into paired HTTPS access.
CodeAI terminates TLS itself in this mode; the certificate must name the configured host and must
already be trusted by every device. Certificate creation and trust distribution are deliberately
operator-owned—do not commit the private key (`.cert/` is ignored).

For a temporary development preview on a trusted LAN, allow the hostname or IP used in the remote
browser and restart the dev server:

```sh
CODEAI_ALLOWED_DEV_ORIGINS=192.168.100.10 npm run dev
```

The value is a comma-separated list of hostnames or IP addresses, without schemes, ports, brackets,
or quotes. When `CODEAI_PUBLIC_ORIGIN` is already configured, its hostname is allowed automatically.
This setting only satisfies Next.js's development asset/HMR origin guard; it does not add pairing,
HTTPS, or a WebXR secure context. Use the paired `start:remote` path below for normal
personal-device access, or [Develop against a headset](#develop-against-a-headset) for a
development loop that gives the headset a WebXR secure context without a build or pairing. A secure
context is not authentication; read that section's warning before serving on the LAN.

### Create a trusted LAN certificate with `mkcert`

After [installing `mkcert`](https://github.com/FiloSottile/mkcert#installation), create a local
certificate authority and a certificate for every name or address devices will use to reach the
home machine. Replace the example hostname and IP with yours:

```sh
mkdir -p .cert
mkcert -install
mkcert \
  -cert-file .cert/codeai-cert.pem \
  -key-file .cert/codeai-key.pem \
  codeai.home.example 192.168.1.50 localhost 127.0.0.1 ::1
mkcert -CAROOT
```

`mkcert -CAROOT` prints the directory containing `rootCA.pem`. Securely copy **only** that file to
each tablet, phone, laptop, or headset and install it as a trusted certificate authority using that
device's certificate settings. Never copy `rootCA-key.pem` or `.cert/codeai-key.pem` to another
device. The LAN hostname must resolve to the home machine; alternatively, use the included LAN IP
as `CODEAI_PUBLIC_ORIGIN`. Some managed devices do not permit user-installed certificate
authorities and therefore cannot use this direct home-machine topology.

Set these values in `.env.local` (all also accept the former `CODEAI_WEB2_*` spelling):

```sh
CODEAI_REMOTE_ACCESS=paired
CODEAI_PUBLIC_ORIGIN=https://codeai.home.example:3023
CODEAI_TLS_CERT=/absolute/path/to/codeai-cert.pem
CODEAI_TLS_KEY=/absolute/path/to/codeai-key.pem
CODEAI_BIND_PORT=3023
# CODEAI_BIND_HOST=0.0.0.0 is the default for the dedicated remote server
```

The public origin must be one exact `https://` origin with no path. Its port and
`CODEAI_BIND_PORT` must describe the same listener (when the origin omits a port, the default is
443). Then build and start the dedicated server:

```sh
npm run build
npm run start:remote
```

On the home machine, in another terminal using the same `.env.local`, issue a code and enter it on
the remote device's pairing screen:

```sh
npm run device:pair
```

The code has 80 bits of randomness, expires after ten minutes, works once, and is replaced when a
new code is issued. Five failed attempts invalidate it. Pairing creates a one-year opaque device
credential in a host-only `HttpOnly`, `Secure`, `SameSite=Strict` cookie; only its salted digest is
stored in `CODEAI_DATA_DIR/device-auth-v1.json`. Use **Devices** in the header to see paired-device
summaries, revoke another device, or sign out this one. Revocation is checked on every API request.

Paired mode protects every repository, session, Arena, run, stream, turn, cancellation, and
permission endpoint. It rejects ordinary `npm start`, HTTP, the wrong host, cross-origin mutations,
and missing or revoked credentials before domain work. It is a one-person LAN or private-network
topology—not Internet hosting, a team account, or a relay.

### Quest and immersive WebXR

[Story 45](stories/STORY-20260905-application-vr-shell.md) adds an application-level immersive shell.
[Story 46](stories/STORY-20260905-vr-workspace-panels.md) adds movable panels and a read-only diff surface.
[Story 49](stories/STORY-20260905-vr-review-and-annotations.md) adds checkout review, artifact
comparison, canonical drawing, and marked attachments. The user accepted the complete Story 51
Quest 3S controller-and-voice journey on September 20, 2026. The
[immersive workspace epic](stories/EPIC-20260905-immersive-workspace.md) tracks the full work loop:
movable panels, real 3D diagrams, controllers, voice, and the multi-session Arena.

Use a paired, exact `https://` `start:remote` origin whose certificate the headset trusts. On a
supported browser, **Enter VR** appears in the application header, including in Arena, Inbox,
Flat, Spatial, and empty sessions. Plain LAN HTTP is not a WebXR secure context;
`CODEAI_ALLOWED_DEV_ORIGINS` does not change that. To iterate with hot reload instead, see
[Develop against a headset](#develop-against-a-headset).

The workspace starts with Arena at the far left, Evidence hidden at the inner left, Canvas at the
inner right, and Conversation at the far right. The four non-overlapping positions migrate only
untouched older defaults; deliberate placements remain unchanged. The conversation header identifies the session,
project, and machine. History and Agents sit at its upper right. History replaces the chat with a
scrollable conversation list, newest first, with relative update times. Load more at the end reveals
the next 20 conversations. Back at the upper left restores your chat reading position.
A compact strip below each panel holds grip, size, and close icons; tooltips appear
after a short hover and fade smoothly. Hold the
controller trigger on the grip, then move your hand to reposition the panel. Push or pull to place
it farther away or closer, with 4× depth movement over a 2.0–4.5 m range. Release to save the placement.
The size icon opens a menu with Small,
Medium, Large, and Extra large presets. Panels stay visible while dragging, with content actions
paused until release. The bottom panel buttons toggle visibility and highlight open panels.
The always-accessible tool strip shows session/approval status, **Reset workspace**, **Report**, and
**Exit VR**; see [Report a problem from the headset](#report-a-problem-from-the-headset).
Conversation scrolls continuously with the controller thumbstick, trigger-drag, or mouse wheel.
Repository diffs are paged; Evidence shares the desktop's selected session checkout, changed file,
and refresh action while identifying the machine, checkout, branch, and bounded read-only path.
Canvas sizing is separate from panel placement. Ordinary session and shell-route navigation retains the same XR session. Loading failures
and Offline machines have visible status; a broken canvas or transcript leaves navigation and Exit
usable. Conversation shows user and agent message bubbles with proportional text. An inline message
field sits below the chat, with microphone and Send inside it. Select the field
to type; Enter adds a newline, and Send is explicit. The field spans the content width with text
padding around the microphone and Send buttons. Physical keyboards receive the full draft normally.
In native VR, selecting a position in the field opens Quest's system keyboard. CodeAI remembers the
clicked caret and treats the native field as a separate insertion buffer, so typed text and Quest's
native speech recognition cannot overwrite the surrounding draft. An invisible guard makes
Backspace on an empty buffer observable and re-arms it for repeated deletion. This guard is an
experimental workaround for Quest's documented WebXR editing-session limitation and still requires
physical headset verification, especially for prediction, composition, speech, and repeated
Backspace. Send remains explicit and there is no floating Edit message button.
Speech is reviewed before applying it; History and Agents pause while speech is pending. The input
shows recipient/mode and attachments. Speech tools remain available within speech review for word
correction, spelling, and undo. Agents uses the same participant and mode actions
as desktop. Streaming preserves an older reading position and follows new messages when you are
already at the bottom; Latest floats at the lower right of the scroll viewport only when reading
older content. Latest and Send return to current activity.
Cancel is available while reading an active run. **Session tools** in the conversation header opens
shared setup and the active session's permissions. Setup has Message, Attachments, and Settings
pages, plus agent settings; typing and reviewed dictation use a separate draft. Enter submits here,
while the regular conversation field keeps its newline behavior. An empty launch opens the new
conversation inside XR; content starts in the background and offers an in-world Open action.
**Session tools → CodeAI → New CodeAI session** reaches the managed home installation even while
working in another project. Reports use the existing three-second capture countdown with setup
hidden, and stale captures stay saved without attaching to a later draft. Prepare images/text files
on desktop when the headset has no verified file picker that preserves XR. A repository-free
session can attach an existing checkout as primary here before sending an agent instruction.

**Permissions** shows the session, machine, agent, tool, and complete sanitized details through
**Previous details / More details**. Select **Allow** or **Deny** explicitly; speech only edits drafts.
The card retains its result, and **Next request** deliberately selects another request. If delivery
fails, **Refresh status** checks current state before another explicit attempt. **Retry instruction**
copies the last instruction into the draft for review before Send. **Archive session** takes the
place of **Cancel run** while the session has no live turn; it needs a second selection, **Confirm
archive**, and then brings the Arena panel forward. **Forget this device** requires a second
selection and returns a paired headset to the existing pairing gate.

The Arena panel reuses the shell's single Arena poll and presents Active, Inbox, and Archived views
six summaries at a time. Session identity is machine-qualified, Offline entries cannot be opened,
and archive requires confirmation. New opens shared session setup. Inspecting a background
permission opens its exact machine/session/run/request card; Return restores the prior session and
its untouched draft without ending XR. Story 52's automated multi-machine checks pass; its own
six-summary, two-run Quest 3S acceptance journey remains pending.

The Canvas panel can compare two diagrams or sketches under the shared texture budget. Pen,
rectangle, arrow, eraser, undo/redo, deliberate two-step clear, and text labels use the same durable
marks as Flat; text labels reuse the native Quest input path. Marks are mapped from controller hits
to the artifact viewBox, so moving or resizing the panel does not change saved coordinates or the
composite sent to an agent. Toggle attachment selects the active canvas for the next instruction,
and New sketch creates a blank immutable canvas. A required marked composite that cannot be
exported blocks the send and keeps the draft and attachment available for retry.

Entry always requires a fresh gesture. Deliberate panel placement, size, visibility, and focus
are saved on this device per machine/project/session, separately from desktop layouts. Re-entry
places the layout in front of the current viewer at eye height; **Reset workspace** restores defaults.
Head/controller poses, temporary canvas scale, and transcript scroll position are never saved. Entry preserves the chosen desktop canvas surface, drafts, cameras, and placements;
exit returns to the focused work. Desktop Spatial resources pause while immersive. This foundation
has no AR/passthrough, locomotion, hand tracking, or spatial graph geometry. Authentication and
execution continue through the same paired home origin and existing authorized executor routes.

Controller disconnection and temporary headset visibility loss leave VR open. Reconnect the
controller or return to the session to resume. A real browser/headset session end still requires
**Enter VR** again; graphics failures display an explanation beside that button.

### Local voice input in VR

[Story 47](stories/STORY-20260905-vr-conversation-input.md) implements controller/voice input.
Chrome capture, correction, and command tests pass; **Quest 3S microphone access during XR,
transcription quality, and comfort still require physical acceptance**. No headset was connected
during implementation. The inline field also supports text entry; voice does not require a keyboard.
The guarded native-keyboard bridge and controller caret placement still need physical Quest acceptance.

Voice runs through a local [whisper.cpp server](https://github.com/ggml-org/whisper.cpp/tree/master/examples/server)
on the **home machine**, including when the agent executes on another machine. Set it up before
the headset session. This tested revision includes cancellation on HTTP disconnect:

```sh
git clone https://github.com/ggml-org/whisper.cpp.git whisper.cpp
cd whisper.cpp
git checkout 02612981545f58188a44de99b8a4710793714629
cmake -B build -DWHISPER_BUILD_SERVER=ON -DCMAKE_BUILD_TYPE=Release
cmake --build build --target whisper-server -j 4
bash models/download-ggml-model.sh base.en
./build/bin/whisper-server --host 127.0.0.1 --port 8178 -m models/ggml-base.en.bin -t 4 -nt
```

In CodeAI's home configuration, set `CODEAI_WHISPER_ORIGIN=http://127.0.0.1:8178` and optionally
`CODEAI_VOICE_LANGUAGE=en`, then restart CodeAI using the normal paired `start:remote` setup.
The default language is English. Other language codes or `auto` require a multilingual model
(for example `base` instead of `base.en`) and their own recognition checks. The former
`CODEAI_WEB2_` spellings also work. An unset or unavailable engine produces an in-world recovery
message; **Retry voice** rechecks configuration. Provider credentials are not used.

Choose the microphone in the conversation input, allow the browser's microphone prompt, speak, and
choose **Stop recording**. The level meter reflects captured audio and the timer shows elapsed
recording time; transcription text still appears after Stop. Each clip stops at 60 seconds.
Review the result and choose **Append speech**; open **Speech tools** within the review for **Replace word**,
**Replace draft**, or spelling. **Previous/Next word** selects a word, path, or newline;
**Delete word**, **Clear draft**, **New line**, and **Undo edit** help correct it. **Voice help**
contains the full spelling vocabulary. To enter `App.tsx`, dictate “capital alpha papa papa dot
tango sierra xray”, choose **Spell speech**, review, then append or replace. The spelling operation
rejects unknown words. **Send** is a separate controller action after reviewing the draft, agent,
mode, and attachments. The draft remains available if sending fails or VR exits.

The browser captures mono PCM at 16 kHz through an AudioWorklet and sends at most 1,920,044 bytes
of WAV over the paired HTTPS home connection. Audio leaves the headset for the home machine;
it is never sent to a speech cloud or executor. CodeAI keeps audio only in memory for the request.
Run Whisper without `--convert`, debug, or real-time transcript logging; the documented WAV path
processes audio in memory. Accepted draft text follows ordinary device-draft/session storage.
Closing the conversation panel, changing sessions, Exit, revocation, or capture failure releases the microphone
and abandons late results. Moving/resizing panels or reselecting Compose preserves in-progress
and unapplied speech. Cancelling transcription aborts the upstream request; the tested engine
stops inference on disconnect. Uploads time out after 15 seconds, transcription after 90 seconds,
and only one transcription is admitted per home process. An 11-second reference clip took about
0.6 seconds on the implementation machine using `base.en` and four CPU threads; this is not a
Quest latency or accuracy measurement.

### Report a problem from the headset

**Report** sits in the always-accessible VR tool strip beside **Reset** and **Exit VR**, and is
mirrored as a `Report problem` control on the ordinary page. Pressing it starts a three-second
countdown in the status line (`Capturing in 3…`), time to turn toward a problem that sits beside the
control rather than under your gaze. When the countdown ends the status line clears, CodeAI renders
the workspace from your head pose at that moment, and it sends that image with the retained
diagnostics, the recent error text, and the machine, project, and session selected at that moment
to the home machine. Pressing **Report** again during the countdown cancels it (`Report cancelled`),
and leaving VR cancels it too; neither uploads anything. The status line then confirms
`Report saved`, or `Report ready to send` when the capture was attached to a session (see
[Use reports in CodeAI's own project](#use-reports-in-codeais-own-project)).

Errors report themselves the same way: an uncaught error, an unhandled rejection, a renderer error,
a failed entry or end, and WebGL context loss each forward their message without a screenshot,
rate-limited to one every three seconds and twenty per page so a repeating failure cannot flood the
link. Error text is never written to device storage; it exists in memory until it is sent.

Reports land in `<data directory>/diagnostics/` as `<timestamp>-capture.json` or `-error.json`, each
with a sibling `.jpg` when a view was captured, pruned to the newest 50. Every write prints one line
in the terminal running `start:remote`:

```
[vr-report] ~/.code-ai/web2/diagnostics/2026-09-19T14-33-13Z-error.json — 1 error: TypeError: panel is undefined
```

The captured frame is a single 1024-pixel-wide view from the head pose, shaped by the headset's own
frustum, not the stereo optics it displays. It is meant for layout, legibility, and "what was on screen when this broke", and the
report needs only the paired HTTPS connection the headset already uses — no cable.

### Use reports in CodeAI's own project

When you develop CodeAI with CodeAI, a report is evidence you can hand to the agent. This works in a
**self project** only: one whose primary repository, on this machine, is the checkout CodeAI is
running from. Renaming a project changes nothing, and another checkout named `code-ai` does not
qualify. Sessions in such a project always run Local, because Docker refuses CodeAI's own checkout.

- **Flat shell.** The activity bar gains a **Reports** view beside Changes and History. It lists every
  retained report, newest first, with its time, kind, note or latest error, a thumbnail, and where it
  was captured. A report captured while another project was open can show that project's
  conversation or canvas; the row says so, and nothing is attached on its own. **Attach next** adds
  a report to the session's next message; the composer shows it as a chip you can remove, and you
  can explain it or send it alone (`Investigate the attached CodeAI report.`). The composer's **+**
  menu opens the tab with **Headset report…**.
- **Headset.** A deliberate **Report** taken with a session of a self project selected waits in that
  session's next message, even if you move elsewhere before the upload finishes, and the
  conversation opens for dictation when that session is still active. Anything else is saved and can
  be attached later from **Session tools → CodeAI → Reports**, which lists, previews, refreshes, attaches, and
  removes reports with the controller. Automatic error reports are listed but never attached.
- **What the agent receives.** Sending copies the report's JSON and screenshot into the session's
  own evidence before the message is written, then gives the turn the same files. The prompt treats
  them as untrusted observed data. Codex receives the screenshot as an image; Claude reads it from
  its context directory. The transcript says `1 CodeAI report attached · screenshot`, and **Retry**
  re-attaches a message's reports.

Everything stays on the home machine. The diagnostics directory keeps the newest 50 reports; a report
attached to a message is copied to `<data directory>/attachments/<session id>/reports/`, which is
never pruned and follows its session through restarts and archive/restore. A message carries at
most four reports and a session at most 64 MB of them; older evidence is never deleted to make room.
The first report a session carries upgrades that session's record to version 5, which a CodeAI
build without this feature hides (Story 65) while keeping every other session open.

### Rebuild and restart CodeAI from CodeAI

To fix CodeAI with CodeAI without running `next dev`, whose reloads interrupt a headset, start the
paired server through a parent that can build and swap releases:

```sh
npm run build          # once, so there is a release to serve
npm run start:managed  # the start:remote settings and origin, plus Build & restart
```

In a [self project](#use-reports-in-codeais-own-project), **More → Build & restart CodeAI** in the
flat shell and **Session tools → CodeAI → Build & restart** in the headset start it. The first
activation shows what will happen; a second, separate **Build and restart** starts it. Nothing an
agent writes can press it: an agent may suggest a restart, but only you confirm one.

- **It runs the code you are about to test.** The build compiles the checkout as it is, uncommitted
  changes included, and the new release runs on this machine as you. This gives no agent a new
  capability; Local Agent actions still need their own approvals.
- **It waits for the machine to be idle.** It is refused while any agent turn is queued or running
  on this machine, a peer home's turn here included. While it builds, the current release keeps
  serving for reading, and new turns are refused with *Send again once it is back*. A turn this home
  runs on an attached executor keeps running there, and the page finds it again after the reload.
- **The build leaves your checkout as it was.** `next build` points `next-env.d.ts` and
  `tsconfig.json` at its build directory; both are restored byte for byte when the build ends,
  however it ends. An edit you make to either file while a build runs is lost.
- **The swap.** A build goes into `.next-managed-a` or `.next-managed-b`, whichever is not serving.
  If it fails, takes longer than 20 minutes, or produces no `BUILD_ID`, nothing else changes and the
  menu says *the build failed*. Otherwise CodeAI says it is restarting, stops the old server (open
  connections close after two seconds), and starts the new release. The new release counts only
  once it tells the parent, over a private channel, that Next is prepared and TLS is listening. If it
  does not within two minutes, it is deleted and the previous release starts again: *rolled back*.
  A build reuses the slot of the release before the current one, so while it builds, and after it
  fails, the previous release is whatever else remains, often `.next`. If `start:managed` itself is
  stopped or killed, its server stops too.
- **The browser.** The page expects the disconnect, asks the same origin again with a growing pause,
  and reloads once CodeAI answers. The session and draft come back through their usual owners. A VR
  session ends with the page; enter VR again. The menu then names the release that is serving and
  the last outcome.

**What the previous release covers.** A build slot holds compiled output only.
`scripts/start-remote.mjs`, `next.config.ts`, `public/`, `node_modules`, and `.env*` are read from
the working tree by every release, so a change that breaks one of them breaks the previous release
too. Automatic rollback catches a release that cannot start, not one that starts with a broken page.
For that, the terminal prints the way back after every start and swap:

```
[start:managed] Serving release kunzEL40UlNv1Uwcdqk-f (.next-managed-b). Previous release: 3fQ… (.next-managed-a).
[start:managed] To return to the previous release without the UI, run: kill -USR2 41532
```

`kill -USR2` refuses while agent turns are live, replaces a server that does not answer within five
seconds, and deletes the managed slot it left, so a later start cannot choose it. `.next` is never
deleted; when it is the release left behind, a later start chooses it again until you rebuild or
remove it. The previous release may meet sessions the newer one wrote; it hides only those
([Story 65](stories/STORY-20260921-tolerate-newer-session-format.md)).

**Which release a start serves.** The parent keeps no state. On start it serves the most recently
built of `.next`, `.next-managed-a`, and `.next-managed-b`, by the time of each `BUILD_ID`, and keeps
the next most recent as the previous release. A manual `npm run build` newer than both slots wins.

**When neither release starts,** the parent says so, prints what to do, and exits with a non-zero
code; it never loops. Read the server output above it, fix the cause, run `npm run build`, and start
again; remove a managed slot that keeps being chosen and cannot start. The parent is not a crash
supervisor either: if the server exits by itself, `start:managed` exits with the same code, as
`start:remote` would.

For acceptance, `CODEAI_MANAGED_TEST_FAIL_CANDIDATE=1 npm run start:managed` treats the next new
release as not ready, once, and says so at start. Ordinary `npm run dev`, `npm start`, and
`npm run start:remote` cannot restart themselves and never show the control.

### Investigate an unexpected VR exit

A report usually answers this without USB. Reach for remote debugging when the browser itself
terminated, when nothing reached the home machine, or when you need the original stack.

Connect the headset with USB debugging enabled and authorized (`adb devices` must list it).
Open `chrome://inspect/#devices` in desktop Chrome and inspect the CodeAI tab in Quest Browser,
following [Meta's remote-debugging guide](https://developers.meta.com/horizon/documentation/web/browser-remote-debugging/).
Enable **Preserve log** in the Console, then reproduce the exit. Capture the original browser
exception or graphics error there. For development builds, also check whether a hot reload or
server restart replaced the document; repeat against `start:remote` to exclude development reloads.

In that tab's remote Console, inspect or copy CodeAI's retained report:

```js
console.table(window.__CODEAI_VR_DIAGNOSTICS__().events)
copy(JSON.stringify(window.__CODEAI_VR_DIAGNOSTICS__(), null, 2))
```

The last 256 events include entry, controller/visibility changes, explicit exit, session end,
page departure, renderer errors, and WebGL loss/restoration. Every ten seconds while a session is
bound, a sample records frame timing, application resource counts, renderer texture/geometry/program
counts, and JS heap bytes when the browser exposes them. Frame median/p95 use a bounded histogram
covering the whole session, rather than only its final minutes. Session-end records include peak
application and renderer allocations; the following `teardown-sample` records the post-exit
baseline. This retains the 30-minute Story 51 run plus its lifecycle and ten entry/exit cycles.
The report also identifies the browser.
The device-local history survives reloads when storage is available; it records no conversation,
repository content, credentials, poses, or exception messages. Use one CodeAI tab for a reproduction.

An `exit-requested`, `pagehide`, `renderer-unmounted`, or `webgl-context-lost` before `session-ended`
helps explain an application-initiated exit. An end without those triggers points to the browser
or headset. Controller/visibility changes alone should leave the session running. A new
`pageStartedAt` without an earlier end is evidence of an interrupted document, **not proof of a
crash**: abrupt reloads and process termination can both omit final events. For an actual browser
crash, capture Android Logcat around the failure as described in
[Meta's Android debugging guide](https://developers.meta.com/horizon/documentation/native/android/book-anddebug/).
Frame/resource trends can guide investigation, but these counts and optional JS heap measurements
do not measure total GPU/native memory or prove an out-of-memory failure.

### Develop against a headset

Two development paths give the headset browser a WebXR secure context without `npm run build` or
pairing, and both keep hot reload. The development server runs in local mode, so no device
credential is needed. Both need ADB: enable Developer Mode for the headset in the Meta Horizon
app, connect it over USB, and accept the USB debugging prompt inside the headset.

**Forward the port over ADB.** Browsers treat `localhost` as secure even over HTTP:

```sh
adb devices                     # the headset must show as "device", not "unauthorized"
adb reverse tcp:3023 tcp:3023   # the headset's localhost:3023 reaches this machine
npm run dev
```

Open `http://localhost:3023` in the headset browser. The mapping lasts as long as the ADB
connection; repeat `adb reverse` after the cable or headset restarts (`adb reverse --list` shows
it). For a cable-free loop after the first USB connection, run `adb tcpip 5555`, unplug, then
`adb connect <headset-ip>:5555` before `adb reverse`.

**Serve the development server over HTTPS.** Prefer the ADB path above: after `adb tcpip` it is
also cable-free, and it exposes nothing to the network.

> **This path is unauthenticated.** In local mode CodeAI checks no credential, and `next dev`
> listens on every interface. While port 3023 is open, any host on the network can send agent
> messages and approve its own permission requests, which runs commands as your desktop user. TLS
> here encrypts the traffic; it does not identify the client. Use it only on a network where you
> trust every device, and close the port when you finish. Paired access through
> `npm run start:remote` remains the only supported way to reach CodeAI from another device.

Create the certificate as in
[Create a trusted LAN certificate with `mkcert`](#create-a-trusted-lan-certificate-with-mkcert),
naming this machine's LAN address, and allow that address for development. With explicit key and
certificate paths Next.js uses them directly and never prompts for a password (`npm run devs` is
shorthand for these flags with the `.cert/` paths):

```sh
CODEAI_ALLOWED_DEV_ORIGINS=192.168.1.50 npm run dev -- --experimental-https \
  --experimental-https-key .cert/codeai-key.pem \
  --experimental-https-cert .cert/codeai-cert.pem
```

Push only the public root certificate to the headset and open Android's hidden security settings:

```sh
adb push "$(mkcert -CAROOT)/rootCA.pem" /sdcard/Download/mkcert-rootCA.crt
adb shell am start -a android.settings.SECURITY_SETTINGS
```

In the headset choose **Encryption & credentials**, **Install a certificate**, **CA certificate**,
confirm, and pick the file from Downloads; menu names vary slightly between Horizon OS versions.
Then open `https://192.168.1.50:3023`. Both devices must share the Wi-Fi network and the desktop
firewall must allow port 3023.

## Execution machines

One home machine can attach up to eight other CodeAI executors and show all of their sessions in
one Arena. Each installation keeps its own projects, sessions, repositories, provider login, and
per-machine run scheduler. The browser talks only to the home origin; that server polls and proxies
explicitly allowed operations to the executor that owns the session.

Use distinct `CODEAI_DATA_DIR` values. Run the executor in paired mode at an exact, trusted HTTPS
origin as described above; the home may stay in local mode when its browser is local, or use paired
mode for personal-device access. On the executor, issue a single-use code:

```sh
npm run machine:pair
```

On the home machine, exchange it for an attachment using the origin printed by that command:

```sh
npm run machine:attach -- https://codeai-laptop.example:3023 ABCD-EFGH-JKLM-NPQR
npm run machine:list
```

The home Node.js process must trust the executor's certificate. With a private CA, install its root
in the operating-system trust store or launch the attach command and home server with
`NODE_EXTRA_CA_CERTS=/absolute/path/to/rootCA.pem`. Do not bypass TLS verification. Both servers
must remain reachable at their configured origins; attachment does not add discovery, NAT
traversal, or a relay.

The executor stores only a salted digest in `CODEAI_DATA_DIR/machine-auth-v1.json`. The home stores
the opaque outbound credential and the last valid bounded Arena snapshot in
`CODEAI_DATA_DIR/machine-registry-v1.json`; both records are atomically written as `0600`, so the
home data directory and backups are security-sensitive. Credentials and executor origins never
enter browser state or API responses.

If an executor sleeps, its cached cards remain visible as **Offline** with live actions disabled;
full transcript/canvas reads require it to reconnect. The next successful Arena poll restores it
without re-pairing. Detach by id from the home machine:

```sh
npm run machine:detach -- 01234567-89ab-4def-8123-456789abcdef
```

When reachable, detach also revokes the credential on the executor. If it is offline, the local
attachment is still removed and the remote credential expires automatically; after bringing the
executor back, use `npm run machine:peers` and `npm run machine:revoke -- <home-machine-id>` there
before attaching again. Attachments are direct and non-transitive, and sessions are not moved or
replicated between machines.

Update the home machine before its executors. A home checks each executor's snapshot against its own
machine contract, so an older home rejects a newer executor's snapshot (for example, one that lists
provider model choices, or advertises Auto) and shows that executor as **Offline** until the home is
updated. An
executor's composer lists that executor's own model choices, and the executor checks each turn
against them.

### Upgrading from the `web2/` layout

The application used to live in `web2/`. If you have a working checkout from before that move:

```sh
mv web2/.env.local .env.local   # keep your ignored local settings
rm -rf web2                     # node_modules, .next, and build state are rebuilt at the root
npm install
```

The current host store lives under `~/.code-ai/web2/session-store-v2`. On first open it copies a
valid `session-store-v1` into that store and leaves the old directory untouched as a rollback (a
direct upgrade from `conversation-store-v1` is also supported).
Checkouts using the same `CODEAI_DATA_DIR` share their projects and conversations. This checkout
reads version 3 and version 4 sessions side by side, preserving each record's format on reads and
edits, and writes new sessions as version 4. Local and Docker conversations both continue here;
a version 3 session runs as Local. Version 4 is forward-only: a checkout older than the
compatibility fix reports such a store as invalid. Nothing is lost; open it with a checkout that
reads version 4. After updating an already-running server, restart it to load the new store
reader, then refresh the browser.
A session whose format is newer than this checkout reads costs only that session
([Story 65](stories/STORY-20260921-tolerate-newer-session-format.md)): the store still opens, lists
and the Arena leave the session out, opening it by id answers 409 (*written by a newer CodeAI*),
and the flat shell says how many are hidden. The file is never rewritten, moved, or archived, and
while one exists no project can be deleted here, because the hidden session may still belong to it.
A checkout older than that story still reports the whole store as
invalid, so **every checkout sharing a data directory must include Story 65 before any of them
writes a newer session format.**
The older `threads.json` prototype and browser keys under `code-ai:web2:v1:` are still deliberately
left untouched and are not imported. Environment variables were renamed from `CODEAI_WEB2_*` to
`CODEAI_*`, and **the old names continue to work** — see [Configuration](#configuration).

### Upgrading from the Yarn/Next.js 15 toolchain

The package manager is npm and the framework is Next.js 16. A checkout from before that switch
still has a Yarn-installed `node_modules` and no `package-lock.json`:

```sh
rm -rf node_modules yarn.lock .next .next-e2e
npm install
```

Nothing else changes: same port, same commands (`yarn x` → `npm run x`), same configuration, same
stored data. `next dev` and `next build` now use Turbopack, and `next dev` writes its output under
`.next/dev`, which stays ignored.

## Arena and Inbox

The workspace lives at `/`; the Arena's canonical destinations are `/arena` for active sessions,
`/arena/inbox`, and `/arena/archived`. The activity bar's links and the Arena tabs use client navigation, so
refresh, bookmarks, and browser Back/Forward preserve the top-level destination without encoding
device-local tabs, drafts, or panel state in the URL.

Open session views sit in the title bar beside the project picker. **All sessions** (the chevron)
lists every active session in that project, or the loose-session scope, including closed views and
tabs that do not fit. Choosing one opens its view. Arrow keys wrap through open tabs; Delete or the
single close button closes the focused view and focuses its neighbour. A live turn keeps its view
open. Closing a view preserves its conversation and device draft for reopening.

**Arena** in the activity bar opens an overview of active sessions, grouped first by execution
machine and then by project. The security notice can be dismissed; this device remembers the
choice for this machine and security level. **More → Machine settings** keeps security details,
Docker controls, and global-instructions defaults available. Available Docker provider updates
appear as a count on the More gear, including while a conversation is open.
Cards show Idle, Running, Needs you, Queued, or Failed state plus their repositories, agents, and
latest activity. An inactive session can be archived from its card, or from inside it with
**More → Archive session**. Desktop archiving takes one click without a confirmation dialog;
the toast offers **Undo archive** for ten seconds, and the **Archived** view lets you restore it
intact later. A session with a reserved, queued, executing, or permission-blocked turn cannot be
archived.
Conversations automatically move to **Archived** after more than **48 hours without saved activity**.
Messages, canvas changes, and other saved session changes restart that clock; viewing or keeping a
tab open does not. Existing Arena polling and conversation loading apply the rule on each owning
machine, catching up on the next load after downtime. Restore preserves the complete conversation
and starts a fresh 48-hour window. The threshold is fixed for now. If Docker recovery is unavailable,
Docker conversations stay active until recovery succeeds.
Use **New session** there to open setup, choose the machine/project or repository, execution,
checkout, provider, mode, and model/effort. **Advanced settings** holds the session’s
[Global instructions](#global-instructions) choice. The optional
**First message** field accepts Enter to submit and Shift+Enter for a newline. Attach screenshots
by choosing, pasting, or dropping them, and attach nonempty UTF-8 text files through the same picker.
Files are limited to four, 128 KiB each, 256 KiB per message, and 8 MiB saved per session; PDF,
binary, invalid UTF-8, and unsafe filenames are rejected without discarding valid attachments.
The regular composer accepts the same text files, and Retry restores their exact text.

An empty submission opens an idle conversation. Text or attachments start the first turn in the
background while preserving your current task; an **Open session** toast and Arena lead to it.
Evidence alone supplies a visible fallback instruction. Cancel retains setup in memory; Clear
setup discards it. Setup evidence is separate from the current conversation and is not saved to
browser storage. Retries retain the captured session/message IDs when delivery is uncertain.
A fresh Arena/Inbox snapshot marks an accepted Local instruction without an active or terminal run
as **Execution status unavailable**; deliberate Retry explains that it may already have run.

Under `npm run start:managed`, **More → New CodeAI session** opens the same setup for the home
installation, from any project or executor. It prepares CodeAI’s own project and uses Local
execution. Reports captured in other conversations can be selected there. Missing installation
discovery and maintenance explain why creation is blocked. Background submission preserves the
source conversation, and an empty submission opens the new CodeAI conversation.

**Inbox** in the activity bar follows you into every session and aggregates all online attached machines. It
puts live permission requests first, then
failed and completed turns, and lets you answer a background session's permission without opening
it. Finished-item read markers are bounded device-only state. The Arena polls compact, bounded
executor summaries in parallel; a failed remote refresh leaves its last good cards visible as
Offline, without claiming that cached run or permission state is live.

## Participants, roles, and manual handoffs

A new session starts with one main `coder`. The main designation is only the default
recipient: select any `@participant` for the next message or make that participant main without
moving its provider session. Add Claude or Codex participants with one of five transparent prompt
presets: `orchestrator`, `coder`, `reviewer`, `tester`, or `custom`. Provider and role are
independent, so Claude can review Codex work, two Codex participants can keep separate contexts,
or an orchestrator can be main while a coder and reviewer handle focused turns.

Every send addresses exactly one participant and every message names its author. Each agent owns a
private native provider session. On handoff, the server gives the addressed agent a bounded,
author-labeled JSON delta of the canonical host transcript it has missed. Failed, definitely
undelivered instructions are excluded; ambiguous/cancelled delivery remains visibly labelled.
Quick handoff chips prefill an
editable recipient, prompt, and role-default mode; they never send automatically. Autonomous
agent-to-agent relay, simultaneous turns inside one session, and autopilot are intentionally not
implemented yet.

A new session starts in the last mode chosen on this device, or in **Ask** on a device that has not
chosen one yet. A Docker session never inherits **Agent**, because Docker Agent edits without
individual approvals; it starts in Ask unless Agent is chosen for it. The Arena's and VR's **New
session** forms open at the last mode and provider when that machine can run them, and set the new
session's mode explicitly. A session keeps its own mode once it has one, so changing the mode in one
session does not change another's. A session with no mode on this device, such as one started on
another device, shows the last mode. **Auto**, **Accept edits**, and **Full access** stay with the session they were chosen in. No
session inherits them: the next session starts in Ask, and the **New session** forms do not offer
them.

Independent sessions can execute at the same time. Each machine runs two eligible turns by default
and visibly queues additional work; `CODEAI_MAX_CONCURRENT_RUNS` sets a limit from 1–8. Ask and
Plan turns may share a checkout, while all writing modes take an exclusive checkout execution lock and
keep their slot while an approval is pending. Every tab owns its own status, preview, activity,
permissions, cancellation, and reload recovery.

## Conversation modes

`CODEAI_SECURITY_LEVEL` fixes this machine’s level for the running process: **Guarded** (default)
or **Native**. Set it on the executing computer and restart CodeAI; the browser cannot change it.
Ask and Plan stay read-only at both levels, and Docker keeps its existing contract. The table and
Auto sandbox description below describe Guarded.

Every message carries a mode. The browser sends only the mode name; the server resolves it to a
fixed provider policy. A session can change modes and recipients; later turns resume only the
addressed participant's private provider-owned session.

The mode picker stays available while a turn is queued, working, or waiting for approval, on
desktop and in VR. Choosing a supported mode interrupts the current provider attempt and resumes
the same task automatically with its new permissions; no new message is needed. Completed edits
stay in the checkout. Pending approval cards close without approving them. Entering a writing mode
from Ask or Plan may wait for exclusive checkout access, then saves a checkpoint before continuing.
The original message keeps its starting mode; the final answer shows the mode it finished in.
Changing mode preserves the time and tool-turn budget already used.

| | Ask (wire fallback; reviewer/tester/custom default) | Plan (orchestrator/coder default) | Agent | Auto |
|---|---|---|---|---|
| Purpose | Q&A, review, diagrams | An approvable implementation plan | Building in the working tree | Building in the working tree with fewer interruptions |
| Provider policy | server-owned read-only profile | server-owned read-only profile | provider approval profile | provider sandbox profile |
| Side effects | never | never | only after you approve each one | inside the sandbox without asking; outside it only after you approve each one |
| Prompts you | never | never | permission cards in the chat | permission cards for what leaves the sandbox |
| Budget per message | 20 turns / 5 min | 20 turns / 5 min | 200 turns / 30 min | as Agent |

**Ask** is the read-only conversation plus the git allowlist below. **Plan** has identical
capability and differs by contract: the turn ends with a delimited plan and the message gains an
**Execute plan** button. Executing sends an ordinary follow-up turn in Agent mode that resumes the
same session, so the executing agent keeps all of the research context. Nothing auto-executes.

**Agent** runs with the provider's server-owned approval policy. Every side effect raises a permission card in the
conversation with **Allow** / **Deny**; the floating canvas control shows a pending badge so
full-screen users notice. Deny does not kill the run — the model is told and continues. An
unanswered card waits until you allow, deny, or cancel the turn. `CODEAI_APPROVAL_TIMEOUT_MS`
defaults to `0` (no expiry); a positive value enables automatic denial after that interval. The
run's own timeout clock is paused while a card is pending. Closing or reloading the browser keeps
the request alive while CodeAI and its provider process are running; a server restart ends the
live run. Waiting turns retain a machine execution slot and exclusive checkout access, so other
turns on that checkout wait. Cancelling resolves pending cards as denied before terminating the child.

All writing modes edit **the real working tree** of the session's primary repository, exactly like the corresponding
terminal agent. Review the result with `git diff`. Worktree isolation and apply/discard checkpoints are
outside the current model; writing turns instead save a recovery checkpoint before execution.

### Software-model suggestions

Put `/model` on the first line of a message and name a narrow scope below it, for example:

```text
/model
Explain the parser and its callers in src/server/conversation/responseParser.ts.
```

The agent may return typed entities and relations alongside its normal answer and Mermaid. The
JSON remains copyable in the conversation, labeled as **LLM suggestions** with estimated confidence.
CodeAI validates the whole emission before merging by source identity into temporary memory shared
by sessions on the same executing checkout. Missing or rejected output leaves the ordinary answer
working. Every fact, including its description, is suggested; source references are not independently
verified by this producer.

Accumulation is bounded and clears on server restart or repository eviction. Durable models and
canvas lenses are the next slices; there is no model browser yet. See
[Story 6](stories/STORY-20261003-agent-emitted-software-model.md) for the contract and measured identity
stability.

### Turn checkpoints and Undo

Before every writing turn, CodeAI backs up eligible files without touching the working tree, Git
index or HEAD. After a completed, failed or cancelled turn, **Undo this turn** appears under its
instruction in the conversation and in VR **Session tools**, when eligible files changed. Confirm
the scope to restore the original bytes and permissions, including pre-existing staged, unstaged
and nonignored untracked work. The conversation and provider history stay.

Undo refuses newer checkout edits, even an edit followed by a content revert, and waits for no
active or queued checkout work, repository helper reads, or build. Do not edit files during Undo.
Commits, staging, index flags or a branch/HEAD change during the turn disable recovery: Git history,
the index and other `.git` metadata are never restored. Ignored files (including personal ignores),
private/provider folders, `.env*` except `.env.example`, recognized credential filenames and key/certificate files are
excluded, even if tracked. External actions and writes elsewhere in Full access cannot be undone.
The initial ignored path inventory stays excluded if a turn removes ignore rules. Privacy uses
fixed filename exclusions, including `.codex`, `.claude`, `.aws`, `.ssh`, `.config`, `.docker`,
`.kube`, `.gnupg` and `.azure` directories and files such as `auth.json`, `credentials.json`,
`.npmrc`, `.netrc` and `.pypirc`; it does not recognize secrets in arbitrary source files.

Recovery currently requires **Linux** to prove file-handle paths before reading or restoring data.
Symbolic links are backed up as links, preserving their exact target text without following it.
Undo restores retargeted or deleted links, removes new links, and handles regular-file/link
replacements. Relative, absolute, dangling and directory links work; changes to an external target
are outside recovery. A populated real directory replaced by a link makes Undo unavailable, and
links in the ancestors of covered files remain refused. Link targets must be UTF-8 and fit within 4 KiB.
Writing turns fail before execution if capture cannot finish safely: hard links, special
files, submodules/nested repositories, more than 10,000 eligible paths or ignored inventory entries,
a file over 8 MiB, or eligible content over 128 MiB. Oversized-file errors name the relative path.
Keep generated files ignored; tracked source assets within these limits are backed up normally.
`CODEAI_DATA_DIR` must be outside the checkout.
Checkpoints stay on the executing machine, outside Docker mounts, at
`<dataDir>/turn-checkpoints/<checkpointId>.json`, privately readable by the owner. At most ten
records are retained, bounded by 512 MiB in total and 192 MiB per record. Larger checkpoints can
reduce the retained count. Records expire after seven days and are pruned on subsequent captures.
The small `.summary` files index recovery status; no session-format upgrade is needed.

If the process stops before saving the terminal fingerprint, automatic Undo is unavailable. If
Undo fails or is interrupted, some files may already be restored and automatic retry stays
disabled. The original backup remains until expiry/pruning for manual recovery: each `before.files`
entry holds its relative `path` and `kind`: regular files carry permission `mode` and base64
`content`; symbolic links carry exact `target` text. Private checkpoint version 2 supports links;
existing version 1 regular-file checkpoints remain recoverable. Inspect/copy that backup
before repairing individual files; CodeAI never forces a restore over intervening edits.

At Guarded, Claude supports Ask, Plan, and Agent. Codex supports Ask and Plan by default. Codex Agent and Auto
share a release gate: set `CODEAI_CODEX_AGENT=1` only after the installed App Server has passed the
real write, command, network-escalation, denial, and cancellation approval matrix documented in
[docs/experiment-log.md](docs/experiment-log.md). Without that opt-in, the UI reports Codex Agent as
unsupported, and does not offer Auto, rather than silently granting workspace writes.

### Native writing modes

Native Local turns load the provider's own settings, hooks, MCP servers, skills, plugins, and
commands as in your terminal. CodeAI retains session persistence, turn budgets, cancellation,
attachments, and permission cards for requests the provider sends. Integrations and Codex model
review decisions appear in the activity stream.

Local Native Codex writing turns can delegate to provider-managed subagents. Their command and
file-change approvals appear in the parent conversation's existing permission cards, labelled
**Subagent** with the provider's nickname when available. CodeAI verifies each child's parent
chain and current turn before accepting a decision. Child results stay in the provider workflow;
they do not replace the parent's answer or create separate CodeAI conversations. Stop and mode
changes cancel pending child cards and interrupt verified live descendants as well as the parent.
Guarded also supports requested built-in delegation; Ask/Plan stay read-only and Docker
escalations remain unsupported.

| Mode | Claude | Codex |
|---|---|---|
| Agent | Your permission rules decide; the rest asks you | Read-only sandbox, on-request approval; your configured reviewer may be a model |
| Accept edits | File edits without asking; commands follow your rules | Not offered |
| Auto | Claude's classifier model approves or blocks actions | Workspace sandbox with your network and writable-root settings; your configured reviewer handles escalations |
| Full access | Bypass permissions | Full disk access, no approvals |

Codex Agent and Auto retain `CODEAI_CODEX_AGENT=1`; Auto requires a working Codex sandbox.
Full access is offered without that gate. Claude's extra modes require an installed CLI that lists
the corresponding permission choice. These modes are chosen inside a session: new sessions and
continuations turn Accept edits, Auto, and Full access into Ask. Execute plan still sends Agent.
The composer names Native before sending, message tags show Native · Agent or Native · Auto,
and Arena shows the level read-only.

Local Claude loads its global instructions itself in Native writing modes, regardless of the
machine's switch. An explicitly isolated session disables those modes; Ask and Plan remain
available. The switch still applies to Claude Ask/Plan and Docker. Local Codex continues to load
its own global instructions. Native messages upgrade their session to format 9; earlier builds hide
only those sessions, while image-only sessions remain at format 8.

### Auto

**Auto** is Agent with a sandbox under it
([Story 79](stories/STORY-20260928-sandboxed-auto-mode.md)). What the provider's operating-system
sandbox contains runs without a card. Anything that leaves the sandbox raises the same card as
Agent, with the same timeout. The card shows the whole command or every file, says that it *may run
outside the sandbox*, and ends with the reason the model gave, labelled as such. CodeAI does not
detect dangerous commands itself: the sandbox contains the turn, and you decide what may leave it.

- **Inside the sandbox, without asking:** edits and commands that write in the checkout, and in
  `/tmp`, which build and test tools need. Commands can read the whole disk, as in every mode.
  Codex still asks before a command its own rules treat as destructive, such as `rm -rf`, even
  inside the checkout.
- **Always asks, or is refused:** writes to `.git`, `.codex`, and `.claude` at the checkout's root, so
  a commit asks; any path outside the checkout; and all network access, so a dependency install asks.
- **One action per card.** Allowing a commit allows that commit. The next one asks again.
- **Recovery:** an Auto turn can overwrite or delete eligible files without asking; the turn
  checkpoint offers checkout recovery afterward, subject to the exclusions above.
- **Nor what runs the checkout's files later.** A file an Auto turn writes is contained while the
  turn's own commands touch it. A dev server, a file watcher, a Git hook manager, or you running the
  project afterwards execute it outside the sandbox.
- **Nor a repository inside the checkout.** Only the root's `.git`, `.codex`, and `.claude` are
  protected. A nested repository's own `.git/config`, and a `.claude` or `.codex` directory in a
  subdirectory, are ordinary files to the sandbox. Do not use Auto in a checkout that contains
  another checkout you open in CodeAI: a turn could change that repository's Git configuration, and
  CodeAI's own `git status` there would then run what it names.

Auto is chosen in the composer's mode picker, or in VR's agents row, where the addressed provider
offers it. The picker lists it only there. **Execute plan** still runs in Agent.

Providers:

- **The data directory must be out of the sandbox's reach.** Auto is refused while
  `CODEAI_DATA_DIR` is inside the checkout or a temporary directory, where a turn could rewrite
  CodeAI's own records. The default, under your home directory, is fine.
- **Codex** offers Auto with `CODEAI_CODEX_AGENT=1` when its sandbox can start on this machine. On
  Linux that needs bubblewrap and unprivileged user namespaces; if `codex sandbox` cannot run a
  command, readiness says so and withholds Auto. Its model-free startup check runs in a private
  disposable directory, so sandbox metadata placeholders stay away from the repositories root.
  CodeAI runs the turn on a Codex permission profile of its own and refuses the turn unless App
  Server reports exactly that profile, no network, no
  extra writable directory, and you as the approval reviewer. Codex records the checkout as a
  trusted project in your `~/.codex/config.toml` the first time Auto runs there, as its own CLI
  does; it then also loads that checkout's `.codex/config.toml`.
- **Claude** does not offer Auto yet. Its sandbox could not be verified: on Linux it needs
  `bubblewrap` and `socat`, and on Ubuntu 24.04 and later also the AppArmor profile from Claude
  Code's sandboxing guide. [docs/experiment-log.md](docs/experiment-log.md) records what was tested
  and what remains.
- **Docker** sessions do not offer Auto. Docker Agent is already autonomous inside its container.

The first Auto message upgrades its session's record to version 6, which a CodeAI without Auto
cannot open. That build hides only that session
([Story 65](stories/STORY-20260921-tolerate-newer-session-format.md)); a session that never used
Auto keeps its version.

**A run outlives the page that started it.** Closing the tab, reloading, or a dev-server refresh
only detaches the browser — the agent keeps working, and reopening the conversation reattaches to
the live turn, replaying the activity, any pending approval, and the answer. This matters most
right after you approve something: killing the run there would leave a half-applied change. Ending
a turn early is therefore an explicit act — the **Cancel** button — which resolves pending
approvals as denied and stops the child. A finished run stays reattachable for five minutes.

Building spends turns on research long before the first edit, so Agent gets its own budget
(`CODEAI_BUILD_MAX_TURNS`, `CODEAI_BUILD_TIMEOUT_MS`) rather than the conversation's. If a
message still runs out, the turn ends with an explicit notice and a **Continue** action — the
session is intact, so the agent picks up where it stopped.

### Model and effort

The **Model** menu beside the mode picker chooses the model and effort for the addressed agent's
next turn. It lists only what the executing machine offers for that agent's provider: Claude's
family aliases (`fable`, `opus`, `sonnet`, `haiku`) with `low` to `max` effort (none for Haiku or a
Haiku `CODEAI_CLAUDE_MODEL` default, and none at all when the installed `claude --help` lacks
`--effort`), and whatever Codex App Server's `model/list` returns, each model with its own efforts.
Docker Claude offers the same aliases with their efforts; Docker Codex offers its Docker worker's
own `model/list`, recorded when the worker was provisioned or updated, and otherwise what the
machine's local Codex lists. The server rejects any other model or effort with 400.

The choice is remembered on this device for each agent in each session, like mode; it is not part
of the session and another device does not see it. VR turns use this device's choice. This device
also remembers the last choice for each provider. A new agent, including the first agent of a new
session, starts at it and keeps it as its own, and an agent with no choice on this device follows
it. **Continue in Docker…/Local…** carries the current agent's choice to the new session. Choosing
**Default** for an agent is a choice too: it stays on Default when another agent's choice changes.
**Default**
means no override: a new agent starts on the machine's default (`CODEAI_CLAUDE_MODEL` /
`CODEAI_CODEX_MODEL` when set, otherwise the CLI's own), and an agent that already ran on an
explicit choice keeps it, because a provider session keeps its last model and effort. A machine that
sets `CODEAI_*_MODEL` sends that model on every Default turn.

### Global instructions

Your own instructions for a provider (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`) apply in CodeAI
too, and you decide where. **More → Machine settings → Global instructions** shows, for each
provider on this machine, a switch, the file it resolves to, and the file's text, read-only. Both switches are on
until you change one.

- **At Guarded, Claude** runs in safe mode, which turns its own `CLAUDE.md` loading off together with hooks,
  skills, plugins and MCP. So CodeAI reads the file itself and passes its text with
  `--append-system-prompt` for Guarded Local turns and all Docker turns. Safe mode stays on: the file adds words
  and nothing else. `@path` imports in it are passed as written and not followed. The text travels
  on Claude's command line, so while a turn runs another account on the same machine can read it in
  the process list.
- **At Native, Local Claude** loads its own file in writing modes; the switch still applies to
  Ask/Plan and Docker. Explicitly isolated sessions disable Native Claude writing modes.
- **Local Codex** loads its own `AGENTS.md` whatever CodeAI sends, so the switch cannot turn it off
  there; Machine settings says so. The Codex switch applies to **Docker Codex**, which gets the text in its
  developer instructions.
- CodeAI reads the file the provider reads: `$CLAUDE_CONFIG_DIR/CLAUDE.md`, or
  `$CODEX_HOME/AGENTS.override.md` when it holds text and else `$CODEX_HOME/AGENTS.md`, when the
  variable is an absolute path, and the folders in your home directory otherwise. Your own symbolic
  links are followed, and a file both providers share is shown once.
- The file must be a regular UTF-8 file of at most 32 KiB without NUL bytes. One that is not is
  left out whole, never truncated, and Machine settings and readiness say why.
- Two kinds of link are refused, with the reason shown. One that lives under the repositories root
  (`CODEAI_REPOSITORIES_ROOT`) or a temp directory, because a turn that edits a checkout could
  repoint it at any file you can read and the next turn would be handed that file. And one that ends
  in a provider folder's private files, such as `auth.json`. You can keep the file itself under the
  repositories root: Machine settings marks it, and a turn there can then change what it says, as it can
  change any file in its checkout. On Linux CodeAI proves that the file it opened is the one it
  resolved; on a system where it cannot (macOS), a file under the repositories root is not read.
  `~/.claude` and `~/.codex` themselves stay yours even when the repositories root is your home
  directory.
- Only that one file is passed: nothing it imports, and no other file of the folder.
- The text is framed under CodeAI's own contract: where the two conflict, CodeAI's instructions
  apply. Instructions are guidance, never a boundary. No mode, sandbox, or approval depends on
  them.

A change reaches **Docker Codex's next turn** and **a Claude agent's next provider session**: Claude
keeps the prompt its provider session started with, so an agent that already ran keeps what it
started with.

A session can carry its own choice, made when it is created: **Default** follows the machine's
switch at each turn, **Use** and **Isolate** hold whatever the switch says. The conversation's
**＋** menu and the Arena's **New session** form offer it under **Advanced settings**, and this
device remembers the last choice;
VR sessions follow the machine's switch. An isolated local session refuses a Codex agent, because
local Codex cannot be isolated: use Docker for an isolated Codex. The line under the composer shows
what applies to the addressed agent on this machine: **global instructions**, **isolated**, or
**global instructions unavailable** when they are on but the machine has none it can give. For a
Claude agent that already ran, the line describes its next provider session. For a session on an
executor it shows only a choice the session itself carries. A session made with
**Continue in Docker…/Local…** keeps its source's choice.

Use or Isolate is stored in the session's record at version 7, which a CodeAI without this choice
cannot open. That build hides only that session
([Story 65](stories/STORY-20260921-tolerate-newer-session-format.md)); a session on Default keeps
its version.

In Docker a turn whose choice is on also sees an allowlist of your provider folder, read-only, at
`/user/claude` or `/user/codex`: see
[the Docker execution contract](docs/docker-execution.md#your-global-instructions-and-customizations).
Each machine uses its own switches and its own files; the Arena shows the home machine's.

### Claude Git read allowlist

Claude modes add `Bash`, gated by a fixed server-owned rule set:

```text
Bash(git log:*)    Bash(git show:*)    Bash(git diff:*)    Bash(git status:*)
Bash(git branch:*) Bash(git blame:*)   Bash(git shortlog:*)
Bash(gh pr view:*) Bash(gh pr diff:*)  Bash(gh pr list:*)
```

This is what makes "show me the last 4 commits" or "review PR #12" work without full Bash. A
command matching no rule is denied automatically and shown as a denial in the activity timeline, so
Ask and Plan degrade gracefully instead of erroring. The rules are not browser-configurable.

Known caveat, documented rather than solved: command-level allowlisting is **not argument-level
sandboxing**. Flags such as `git log --output=<file>` can technically write. That stays inside the
trust stance below. `git fetch`/`git pull`/`gh api` are deliberately excluded because, despite
looking read-only, they are arbitrary command execution.

## Safety model

Optional **Docker** execution is being implemented in Story 57. Turn on **Enable Docker** in
**More → Machine settings** to save this machine's preference without restarting; the UI shows
when setup is still needed. See the
[Docker setup and verification guide](docs/docker-execution.md) for its release status, provider-owned
login, direct-edit scope, network restrictions, and cleanup. Select Local or Docker directly when
creating a session in a project or Arena. Sign in once with `npm run docker:login -- claude` or
`npm run docker:login -- codex`; new Docker conversations share that provider's login, settings and
history in persistent Docker storage, separate from the host provider setup. Existing individual
Docker homes retain their history in place. When Claude Code or Codex publishes a new version,
**Update** it in **More → Machine settings → Docker execution**, or run
`npm run docker:upgrade -- <provider> <version>`: the new CLI is checked offline before turns
use it, and **Roll back** returns to the previous one.
The line under the composer names the execution; its menu offers
**Continue in Docker…/Local…**, opening a fresh session on the same repositories with a recap ready
to review and send, or says why it cannot yet. Docker sessions persist execution and
one fixed primary checkout. Agent is autonomous inside the container; its dependency installs and
build outputs also change the host checkout. Ask/Plan mount the entire checkout read-only.
Dependencies may need reinstalling when switching between macOS and Linux. The Local contract
below and its Codex Agent gate remain in force for Local sessions.

Every run uses a server-owned provider profile. The browser can name a supported mode, a listed
[model and effort](#model-and-effort), and whether a session or this machine uses your
[global instructions](#global-instructions), and nothing else: provider, executable, tool list,
allowlist, permission mode, model flags, environment variables, sandbox, settings, and the
instruction file's path and text all stay server-owned. An unknown mode is a 400, and a mode the
addressed provider does not advertise is a 409.

At **Guarded**, Claude is spawned without a shell in the primary repository's checkout directory with:

- safe mode (repository hooks, skills, MCP, and custom commands stay disabled), strict empty MCP
  configuration, and slash commands disabled, in every mode;
- your [global instructions](#global-instructions) as appended system-prompt text, when they are on
  for the turn;
- the fixed git/gh allowlist, and in Ask/Plan the `Read,Glob,Grep,Bash` tool list with noninteractive default
  permissions and user-only setting sources;
- a bounded turn count, timeout, output size, and one global active process;
- native session persistence (`--session-id` first, `--resume` later).

At **Guarded**, Codex is spawned as a local [`codex app-server`](https://learn.chatgpt.com/docs/app-server) stdio
child for each active turn. CodeAI performs the App Server handshake, starts or resumes the
stored Codex thread, and streams the turn without opening a listener port. Ask and Plan use a
read-only sandbox with network disabled; Agent uses the same sandbox and asks before anything that
writes or leaves it; [Auto](#auto) uses CodeAI's own permission profile. Every turn that can ask names you as the
approval reviewer and is refused if App Server reports another one, such as `auto_review` from your
Codex config. Server-owned overrides disable MCP servers, apps,
plugins, hooks, web search, and custom commands; preflight also queries the effective
integration inventory and fails closed if an ambient MCP server or hook remains enabled. Instruction
files local Codex loads from outside the repository, such as your global `AGENTS.md`, and enabled user or
repository skills are your own Codex configuration: readiness reports them as a note instead of
withholding the provider, and [Global instructions](#global-instructions) in Machine settings shows that file. App Server approval requests are correlated to the active turn, sanitized, and
resolved as one-shot allow/deny decisions through the same permission cards.

Guarded enables Codex's built-in subagents; Native keeps your Codex configuration. Ask for them
in the conversation, for example: “Spawn two subagents to review the changes for bugs and test gaps,
wait for both, and summarize their findings.” Applicable repository instructions may also request
delegation. Subagents inherit the turn's permissions; Ask/Plan remain read-only, Agent/Auto
escalations use the same permission cards, and Docker work stays inside its container. Their
activity appears in the conversation while the main agent consolidates their answers. They share
the parent run's execution clock and checkout lease; cancelling the run or completing the parent
turn shuts down its provider process, retained commands and captured workers. CodeAI does not expose separate
subagent chats or add them as session participants.

Codex must support the background-terminal inventory and termination protocol; an older CLI is
refused before the user request is sent. On Linux, CodeAI also tracks observed provider descendants and
stops captured surviving workers after launcher exit, before the run releases its checkout. This covers
worker processes left alive by their sandbox wrappers. SDK interruption and terminal termination
provide graceful stopping; the host fallback force-kills captured workers and its launcher so
TERM handlers cannot replace them during fallback. Docker retains its whole-container cleanup.
If termination or the process inventory is unconfirmed, CodeAI shows “Stopping Codex” and keeps
the checkout and machine slot locked while retrying. An incomplete inventory cannot be cleared
by an empty snapshot after the original launcher has exited. Outside Linux, SDK cleanup retries
while keeping its coordinator alive. Missing child ownership, failed interruption, or discovery
overflow also retains admission; if the coordinator dies before cleanup is confirmed, its exit
cannot release that admission. This path has simulated macOS regression coverage with real worker
processes, but has not been verified on a physical macOS machine.

A checkout need not be a Git repository. CodeAI's own Git reads never adopt a folder as a repository
because of `HEAD`, `config`, `objects`, and `refs` files at its root (`safe.bareRepository=explicit`),
so a turn cannot make them obey a configuration it wrote there.

Status and diff context are generated by fixed, read-only, no-shell Git invocations and placed with
diagram snapshots in a per-run directory under `CODEAI_DATA_DIR/run-attachments`, outside the
repository and outside the system temp directory, which an Auto sandbox leaves writable. It is
always removed after the turn, and what a crashed server left there is removed before the next
server's first turn.

At **Native**, writing turns use the provider's own setup. Claude's isolation flags and appended
global text are omitted. Codex leaves integrations and the approval reviewer to your configuration;
only `request_permissions_tool` and `exec_permission_approvals` stay disabled, because CodeAI
supports one approval request at a time. Its thread still explicitly selects the mode's sandbox and
approval policy. Ask and Plan retain Guarded isolation, with Claude excluding project settings so
that a planted hook, MCP server, or permission rule cannot run there. Device pairing, exact HTTPS
origins, server-owned capability resolution, and CodeAI's credential handling hold at both levels.

This is a capability restriction, **not a separate operating-system or container boundary**. The
selected CLI still runs as your desktop user, and in Agent mode it changes real files once you
approve. Auto adds the provider's sandbox around the commands and edits of one turn; the CLI itself
still runs as you, and an action you approve runs outside that sandbox. Use CodeAI
only with repositories you trust. Paired access is for your own devices over trusted HTTPS; CodeAI
is not designed for Internet-facing hosting, multi-user use, or untrusted repositories.

## Authentication and billing (bring your own)

The Local process inherits the environment of whatever started CodeAI, unchanged. Whatever the
selected local CLI already uses — a subscription login, compatible endpoint environment, or API
key — applies to CodeAI runs exactly as it does in the terminal. CodeAI adds no provider
credentials or endpoint variables and never persists any. **Billing follows the login and
environment of whoever starts CodeAI.**

## How sessions and data work

- `session-store-v2` is the canonical store. Its manifest gives this installation a durable
  host id and label; projects and sessions are separate validated, revisioned JSON records containing repository bindings,
  roster, messages, Mermaid artifacts, sketches, annotations, and pins. Provider session ids and
  transcript cursors live in the same private record but are removed from every route response.
  Active session files live under `sessions/`; recoverable archived records move atomically to
  `archived-sessions/` with an archive timestamp.
- Writes are operation-level and serialized. A process-owned `writer.lock` excludes a second
  CodeAI process from the same data directory; session files are flushed and atomically renamed with
  user-only permissions. Revision-bearing overwrite operations reject stale clients with 409,
  while stable request ids make append retries idempotent.
- Projects group sessions and repository bindings. Sessions carry an optional project id and their
  own repository list, editable except for fixed managed-worktree bindings. A session can be loose or repository-free; the
  canvas, roster, and conversation record remain available, while a turn clearly asks for a primary
  repository.
- The browser lists and hydrates snapshots from `/api/sessions`. A versioned device record in
  `localStorage` restores open/focused session views, drafts, unread counts, active canvases,
  addressee/mode, repository selection, flat and spatial cameras, spatial panel placements, and
  per-view panels. It writes no
  transcript, canvas, roster, annotation, project, or repository-binding content there. Reloading
  or a second browser context sees committed host content after refetch, with its own layout.
- A second device record, `code-ai:device:v1:preferences`, keeps the last mode, the last provider
  and Global instructions choice for a new session, and the last model and effort for each provider. Execution is not remembered:
  Docker Agent edits without individual approvals, so Docker stays an explicit choice for each new
  session, and a Docker session never inherits Agent as its mode.
- Later turns resume the addressed participant's host-bound native provider session and receive
  only the bounded canonical transcript delta missed since its last complete turn. The server
  defaults to 40 entries / 24 KB and never accepts a browser-supplied transcript.
- If the provider's native session is missing, visible history is retained and the UI offers an explicit
  new-session continuation with a visible bounded recap.
- CodeAI reports attached to a message are the one kind of evidence kept outside the record:
  `<data directory>/attachments/<session id>/reports/`, user-only, referenced by bounded metadata in
  the message. The pending reports for a session's next message are device state, like its draft.
- An image pasted or dropped into a message is kept nowhere: it exists in that turn's run directory
  and is removed with it. The message records only each image's type and size.
- Export includes the roster and expanded author/provider/role metadata for every entry, plus
  diagram/mark state, without provider session ids, credentials, or server paths.

Local `.env*`, `.next`, `node_modules`, coverage, and TypeScript build state are ignored. The
tracked `.env.example` contains no secrets.

### Session worktrees

New session on the desktop, in Arena, and in VR offers **Use current checkout** by default and
**Create a worktree** for an eligible repository with Local or Docker execution. Loose Local sessions can also select a
checkout directly. A managed worktree starts from the source’s latest committed HEAD on a unique
`codeai/session-<sessionId>` branch. Staged, unstaged, untracked, ignored, and private local files
remain in the source; no setup, install, stash, or commit runs during creation. The conversation and
Arena identify its live branch and source. Provider cwd, repository reads, model accumulation,
and Undo use that worktree; its project continues to reference the original repository.

Checkout listing offers worktree creation from lightweight filesystem checks, without Git or
Docker probes on each Arena poll. Submission independently performs full, fresh source validation;
unsupported configuration or missing objects can still refuse creation before anything is changed.

Managed creation currently requires Linux, one ordinary primary Git checkout on the executing
machine, a committed HEAD, and contained Git metadata/objects. Linked source worktrees, submodules,
filters, included/custom checkout configuration, shallow/partial/promisor clones, and alternates
are unavailable. Hooks are suppressed and creation is offline. Docker provisioning preserves Local
worktree availability. CodeAI's isolated Git helper receives the registered worktree's common Git
metadata read-only. Docker Ask/Plan do likewise; Docker Agent additionally writes the selected
worktree's own Git metadata and the shared objects, refs and logs directories. Source files, its
index/HEAD and Git configuration are protected. Git branch refs and objects remain shared, and Undo
does not restore Git history/index. Repository-wide Git administration stays outside the Docker
worker. Only CodeAI-managed worktrees receive these extra mounts; arbitrary linked worktrees remain
unsupported. Docker still refuses sources overlapping CodeAI's installation, data or provider storage.
Continue in Docker/Local keeps the exact managed worktree. An ordinary-source writer waits while a
linked Docker worker or directly bound Git helper holds its metadata; separate linked workers can
coexist. Helpers reading a managed worktree alongside an existing Local source writer pin the
verified common Git directory through a read-only local Docker volume. Local checkpoints and turns
can therefore start independently after provisioning too. If the daemon cannot access this machine's
directory descriptor, the helper refuses the read; idle-source reads keep their existing direct bind.

`CODEAI_WORKTREES_ROOT` defaults to `~/.code-ai/worktrees` (the former
`CODEAI_WEB2_WORKTREES_ROOT` spelling is accepted). It must be separate from the installation,
data directory, provider folders, and ordinary checkouts; symlinked or changed parents are refused.
Only the executing machine’s durable allowlist under `CODEAI_DATA_DIR/worktrees/` resolves managed
checkouts outside ordinary discovery. Their path hashes remain machine-local checkout identities.
Local managed sessions use format 10, Docker managed sessions format 11; ordinary records retain
their existing format versions. Older builds hide format 11 sessions individually.

Creation can run alongside Local turns at the verified source checkout or its ready managed
worktrees, including a turn waiting for approval. It captures committed HEAD once; unfinished edits
and concurrent later commits do not alter that baseline. Read-only Git helpers and managed Docker
Ask/Plan workers can coexist with creation. Writing Docker turns, Undo, unverified or overlapping
nested/enclosing checkout scopes, competing creation and maintenance still block it. Newly accepted
turns on affected checkouts wait briefly until creation finishes. A new Docker worker still cannot
start until an ordinary-source writer finishes because its common-metadata bind needs a stable root.
A durable intent holds the request UUID, original commit/bindings, generated identities, and Git
linkage. **Retry** after a lost
response or failed session save finishes that same creation; changed choices use a new request UUID.
Startup admission reconciles unfinished intents. Ambiguous partial state is retained and unavailable,
with no force removal or reset. The journal and saved sessions share the 1,000-session host limit.
The browser never supplies paths, branch names, or Git flags.

Managed repository bindings are fixed. **New chat** shares the exact existing worktree and starts
fresh provider history; use **New session → Create a worktree** for an independent task. Closing,
archiving, Restore, cancellation, and restart retain its worktree and branch. Missing or moved
checkouts keep their conversation and canvas readable. Build & restart still builds the installation.
The existing status/file-diff surfaces describe current uncommitted work; full committed branch-to-base
review, explicit integration, cleanup, and moving an existing conversation to a worktree are follow-ups.
There is no automatic merge, commit, push, discard, or worktree deletion.

## Canvas workflow

Ask a normal question. Markdown-only answers are complete answers. Zero or more fenced Mermaid
blocks become immutable diagram artifacts; one invalid diagram does not hide prose or siblings.
The first valid diagram opens on the canvas.

The canvas supports pan, wheel/buttons zoom, fit/reset, pen, rectangle, arrow, text, eraser,
50-step undo/redo, confirmed clear, Mermaid source export (diagrams only), and canvas/marks JSON
export. Focus mode fills the application viewport while retaining tools, status, and the
instruction composer.

The activity bar at the left edge picks the side panel's view: **Changes** (with the working
tree's change count), **History**, and, in CodeAI's own project, **Reports**. Pressing the shown
view closes the panel. **Arena** and **Inbox** follow, and the gear at the bottom holds **More**:
the theme, Export session, Archive session, and Build & restart where offered. The header ends with
two layout icons. **Conversation** opens and closes the conversation and, while it is closed,
carries pending approvals or unread replies as a badge. **Canvas** hides the canvas so the
conversation takes the width, centred for reading; closing the conversation brings the canvas
back, so the two are never hidden together. The choice is per session view on this device.
Opening a diagram or starting a sketch from the conversation shows the canvas again. Below 688px
the panels overlay a canvas that always shows.

Once a diagram or sketch exists, **Flat / Spatial** switches between two projections of the same
session artifacts. Spatial lazily loads a local WebGL room containing the active canvas plus the
newest canvases, up to twelve, in chronological order. It is a view-only comparison surface:
select, focus, orbit, pan, dolly, or arrange panels there, then use **Open in Flat** to draw. Its
camera, chosen surface, and bounded placements are disposable per-device view state; canonical
Mermaid, sketches, and marks are unchanged. Unsupported WebGL and context loss return safely to
Flat. This remains an SVG-panel projection rather than the later model-native 3D graph.

On an authorized secure browser with `immersive-vr` support, the application header exposes **Enter
VR** independently of the canvas. The shell lazily prepares its renderer and uploads only the active
canvas and optional comparison, a bounded scrolling conversation viewport, diff pages, the conversation list, and labelled controls for open panels. Unsupported, denied,
interrupted, or failed XR entry leaves the desktop workspace available.

**Start a sketch** opens a blank sheet with the same drawing tools — available before any diagram
exists, so a drawing can be the very first thing in a conversation. A sketch has no Mermaid source:
its marks and composite PNG are the whole attachment, and the agent is told to read them as your
own drawing rather than infer structure you did not draw. Because the drawing is itself the
instruction, a sketch turn sends with an empty composer. Sketches share the canvas id space with
diagrams, so selection, ink, pinning, attachment, and history work identically for both.

The active canvas is visibly attached to the next instruction by default. A diagram attachment
contains its immutable Mermaid source, the exact vector-mark snapshot, viewport, and a local
composite PNG when browser export succeeds. Remove its chip for a text-only turn, or attach up to
four canvases: the composer's **+** menu lists the active canvas and the three newest others with
their thumbnails, toggles each one's chip, and leads to **All history…** and **New sketch**. Its
**Mode** picker beside it chooses Ask, Plan, Agent, or Auto where the provider offers it, and the line under the composer names where
the turn runs, **Local** or **Docker**, followed by the mode's hint. Composite failure is
non-fatal.

Paste an image into the composer, or drop one on it, to show the agent a screenshot. Nothing is put
into the text: the image becomes a chip with its thumbnail, up to four per message, and an image
alone is enough to send. A file dropped elsewhere on the page is refused rather than opened in
place of CodeAI. Click a pending image's thumbnail or label to open it on the desktop canvas and
draw over it with the existing tools. **Back to canvas** returns to the diagram or sketch. Each
image keeps its own ink while switching sessions; sending includes the marked picture, and failed
preparation, rejected sends, or cancellation keep the image and ink available to try again.
The browser draws each image again before it is sent, as a PNG or JPEG of
at most 2048 px and 768 KB, so nothing of the original file but its pixels leaves the device. A
paste that also holds plain text, such as a copied spreadsheet range, stays a text paste. The image
belongs to that one turn: the conversation states `1 image attached`, and the picture itself is not
kept, so a reload drops images still waiting in the composer and Retry asks for them again.

A single valid result derived from the still-active attachment becomes active automatically and
leaves **Previous version** one action away. Navigation during a run suppresses auto-activation.
Zero or multiple diagram results preserve the current canvas.

## Configuration

See [.env.example](.env.example). The most useful options are:

- `CODEAI_REPOSITORIES_ROOT` — repository or repositories directory;
- `CODEAI_REPOSITORIES_DEPTH` — nested discovery depth, from 1–10 (default `1`);
- `CODEAI_WORKTREES_ROOT` — managed Local worktree directories (default `~/.code-ai/worktrees`),
  separate from ordinary checkouts, the installation, data, and provider folders;
- `CODEAI_CLAUDE_BIN` / `CODEAI_CLAUDE_MODEL` — local agent executable and optional model; the
  model is the Default that the composer's **Model** menu can override for one turn;
- `CODEAI_CODEX_BIN` / `CODEAI_CODEX_MODEL` — local Codex executable and optional model, also the
  composer's Default;
- `CODEAI_SECURITY_LEVEL` — `guarded` (default) or `native`, machine-wide and read once per process;
  restart after changing it. The former `CODEAI_WEB2_SECURITY_LEVEL` spelling also works;
- `CODEAI_CODEX_AGENT` — explicit release gate for Codex Agent and Auto at both levels; Native Full
  access is independent of this gate;
- `CODEAI_DATA_DIR` — canonical host session store root (tilde expansion is handled in Node). Keep it
  outside every checkout and outside the temp directories, or Guarded Auto is refused; Docker execution also
  needs a path without a comma, because each run's context is mounted from under it;
- `CODEAI_INSTALLATION_ROOT` — which checkout counts as this installation for
  [reports](#use-reports-in-codeais-own-project); defaults to the working directory and exists for
  the end-to-end server, which names a fixture. `start:managed` ignores it and uses its own checkout;
- `CODEAI_HOST_LABEL` — label persisted when a fresh host store is first created;
- `CODEAI_REMOTE_ACCESS` / `CODEAI_PUBLIC_ORIGIN` — opt into paired personal-device access at one
  exact HTTPS origin;
- `CODEAI_ALLOWED_DEV_ORIGINS` — opt specific LAN hostnames or IP addresses into Next.js's
  development-only asset/HMR origin guard;
- `CODEAI_TLS_CERT` / `CODEAI_TLS_KEY` and optional `CODEAI_BIND_*` — dedicated `start:remote`
  listener configuration;
- `CODEAI_APPROVAL_TIMEOUT_MS` — unset or `0` (default) keeps Agent/Auto approval cards pending
  without expiry; `5000`–`3600000` enables auto-denial after that many milliseconds. The executing
  machine owns this setting; remove an existing positive value or set it to `0` for unlimited waits;
- `CODEAI_MAX_CONCURRENT_RUNS` — machine-wide execution slots, from 1–8 (default `2`);
- `CODEAI_AGENT_*` / `CODEAI_BUILD_*` — per-message turn and time budgets for Ask/Plan
  and for Agent and Auto respectively;
- `CODEAI_AGENT_TIMEOUT_MS=0` — disable the Ask/Plan execution timeout for Claude and Codex,
  Local and Docker. Unset or empty keeps the 15-minute default; positive values are
  `1000`–`3600000` milliseconds. The legacy `CODEAI_WEB2_AGENT_TIMEOUT_MS` name also works.
  Claude's maximum-turn limit and provider-owned limits still apply. The existing Codex runner
  does not enforce CodeAI's maximum-turn setting. Writing turns retain their separate
  `CODEAI_BUILD_TIMEOUT_MS` budget. Restart the server after changing the setting;
- `CODEAI_MAX_TRANSCRIPT_MESSAGES` / `CODEAI_MAX_TRANSCRIPT_BYTES` — server-side prompt bounds
  applied to the canonical host transcript;
- `CODEAI_LOG_DIR` — opt-in rotating server console files, for example `./logs`; see below;
- `CODEAI_LOG_MAX_BYTES` / `CODEAI_LOG_MAX_FILES` — bytes per log file and total retained files;
- response, Mermaid, attachment, and Git-context bounds.

**`CODEAI_WEB2_*` compatibility.** Every setting above also accepts its former `CODEAI_WEB2_*`
spelling for this migration, so an environment written for `web2/` starts the root application
unchanged:

```ts
value = process.env.CODEAI_SETTING ?? process.env.CODEAI_WEB2_SETTING ?? defaultValue;
```

The neutral name wins when both are set to a value; an assignment with an empty value counts as
unset on either name, which is how these settings have always behaved. Validation runs on whichever
raw value is selected, so an invalid neutral value fails rather than silently falling back to a
valid legacy one. Repository discovery also accepts `CODEAI_PROJECTS_ROOT` and
`CODEAI_PROJECTS_DEPTH` as compatibility fallbacks, with the repository-named settings taking
precedence. The default data directory keeps its historical `~/.code-ai/web2` spelling. The
old browser prefix `code-ai:web2:v1:` is also left untouched, but current code neither reads nor
writes session records under it.

The health endpoint checks infrastructure and each provider independently, without invoking a
model. Claude flags are checked through `claude --help`; Codex performs a bounded App Server
handshake plus account and effective-capability inventory. A missing, logged-out, incompatible, or
over-capable provider is reported without making a healthy provider unusable.

### Server log files

To let a coding agent investigate server issues from the checkout, add this to `.env.local` and
restart with your usual server command:

```dotenv
CODEAI_LOG_DIR=./logs
CODEAI_LOG_MAX_BYTES=10485760
CODEAI_LOG_MAX_FILES=5
# Optional: include the existing compact agent turn diagnostics.
CODEAI_DEBUG_AGENT=1
```

Log settings are read when the launcher starts. With `start:managed`, stop and run
`npm run start:managed` again after changing them; the in-app Build & restart action replaces only
the child server and keeps the existing log capture settings.

`npm run dev` (including `devs`), `npm start`, `start:remote`, and `start:managed` keep their console
output and also write timestamped stdout/stderr lines to `logs/server.log`. Managed server swaps
and rebuild output stay in the same capture. This records existing console diagnostics, including
startup errors and printed stack traces. It does not add request, browser, or provider transcript
logging. Running Next directly bypasses this capture; standalone `npm run build` keeps console-only
output.

Production output can be sparse, especially while idle. `CODEAI_DEBUG_AGENT=1` adds the existing
agent turn, tool, permission and provider-error diagnostics when turns run. This capture cannot
cover every issue: handled API failures may be returned to the browser without being printed,
and browser-only errors stay in the browser. Broader coverage needs application error and request
instrumentation in addition to these files.

The example keeps at most five files of 10 MiB each. `server.log.1` is the newest archive, followed
by `.2`, `.3`, and `.4`. Restarting appends to the current file; lowering retention prunes excess
archives. Oversized lines are split between characters to keep each file within its byte limit.
If you lower the byte limit, existing history keeps its original size until rotation ages it out;
new output uses the new limit.
Ask the agent to read `logs/server.log` and, if needed, the numbered archives; Git ignore does not
prevent direct filesystem reads. For example:

```sh
tail -n 200 logs/server.log
rg -n 'Error|failed|\[agent' logs/server.log*
```

File logging is disabled when `CODEAI_LOG_DIR` is unset. Relative paths resolve from the project
root; absolute paths and `~/` also work. Settings use the normal Next development/production
environment-file precedence and accept `CODEAI_WEB2_*` aliases. Byte limits are 1 KiB–100 MiB;
file counts are 1–100, including the current file. Use a separate log directory for each concurrently
running server. A filesystem failure disables file capture with one console warning while the
server and its console continue running.
Log paths must use ordinary directories and files; symbolic-link directories or current log files
disable file capture with a warning.
If the console destination closes or fails, the launcher shuts down the server, flushes the log,
and exits with a failure code.

The standard `logs/` directory is Git-ignored. Add any custom directory to your local Git excludes
or `.gitignore`. Files contain the console text you already produce; they may include repository
paths and command details. New directories and files use owner-only permissions. Logging does
not inspect environment values or provider credential files.

## Documentation

- [Architecture](docs/architecture.md) — the current client/server boundary
- [Vision — the arena](docs/vision.md) — the main product direction
- [Vocabulary](docs/vocabulary.md) — the words the product uses, and why
- [The software model](docs/software-model.md) — the model/map north star (a chapter of the vision)
- [Sessions, machines, and records](docs/multi-project-session-environment.md) — engineering notes behind the arena
- [Experiment log](docs/experiment-log.md) — manual real-agent matrix
- [Repository conventions](AGENTS.md) — source ownership and the spec-driven loop
- [Legacy runtime](legacy/README.md) — the archived analyzer, web client, and extension

## Known limitations

- Mermaid diagrams are immutable outputs. Revisions create new artifacts rather than editing source.
- Ink does not snap to Mermaid elements and is not geometrically transferred to a revised diagram.
- A sketch is a fixed-size sheet the agent can read but not draw on; it never becomes a diagram
  artifact, and the agent answers with prose or a new Mermaid diagram instead.
- A pasted or dropped image is sent once and not kept: the conversation does not show it again, it
  cannot be opened on the canvas or drawn over, and a later turn does not see it unless the
  provider's own session remembers it.
- Mermaid subgraphs cannot be generically collapsed; large diagrams use pan/zoom/fit and agent revision.
- All writing modes work directly in the checked-out tree, with a recovery checkpoint and explicit
  Undo afterward. There is no separate working copy or multi-file atomic restore. Review with `git`.
- At Guarded, every Agent side effect prompts, and so does everything that leaves an Auto sandbox;
  there is no "always allow". Guarded Auto is available for Codex only; you answer escalations.
- Native follows your CLI's trust state: a previously untrusted repository may need to be trusted
  in your terminal first. Native writing can plant provider settings that later writing turns load,
  including after switching back to Guarded Agent. Ask/Plan exclude those project settings.
- Full access reaches everything your desktop user can reach, including CodeAI's data directory and
  the provider's credential files. Checkout recovery excludes credentials, private/ignored files
  and writes elsewhere; Full access can also reach the checkpoint storage itself.
- A turn allowed to write CodeAI's own checkout can change `.env.local`, just as it can change the
  application code; either change takes effect on restart. The running process's level stays fixed.
- Older builds hide Native sessions (format 9). A build predating this story can also report its
  machine registry corrupt after caching a Native executor's snapshot. Use this build or detach
  the executor before rolling back; new builds discard an incompatible cached snapshot and retain
  the machine attachment.
- Source excerpts and editor deep links are still outside the experiment.
- Native provider session history remains owned by its CLI; deleting local browser data does not
  delete that history.
- Participant removal, session transfer, editable custom-role instructions, simultaneous turns in
  one session, and autonomous multi-agent relay are not implemented.
- Queues and provider processes are machine-memory state; a server restart leaves canonical
  transcript recovery intact but does not resume queued or executing processes.
- The real-agent experiment matrix is manual and is tracked in
  [docs/experiment-log.md](docs/experiment-log.md).
