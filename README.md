# CodeAI

A local-first Next.js application for working on a repository through a persistent local-agent
conversation and a canvas with Flat, desktop Spatial, and immersive WebXR projections. Choose
Claude Code or Codex as the first main agent, then add more provider/role participants to the same
session. Conversation is the command/history channel, and once a diagram exists the canvas becomes
the primary workspace. Each message runs in one of three modes — **Ask**, **Plan**, or **Agent** —
subject to the selected provider's supported modes.

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
is offered as one checkout. Otherwise marked, non-hidden repositories are discovered breadth-first
up to `CODEAI_REPOSITORIES_DEPTH` (default 1, maximum 10). Projects are durable bodies of work you
create in the header; sessions may belong to a project or remain under **No project**, and may bind
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
a launcher and the active session's permissions. Choose an existing machine, project (or No project),
provider, and mode to create a local-execution session. A repository-free session can attach an
existing checkout as primary here before sending an agent instruction.

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
and archive requires confirmation. New opens the existing launcher. Inspecting a background
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

- **Flat shell.** The side panel gains a **Reports** tab beside Changes and History. It lists every
  retained report, newest first, with its time, kind, note or latest error, a thumbnail, and where it
  was captured. A report captured while another project was open can show that project's
  conversation or canvas; the row says so, and nothing is attached on its own. **Attach next** adds
  a report to the session's next message; the composer shows it as a chip you can remove, and you
  can explain it or send it alone (`Investigate the attached CodeAI report.`).
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
provider model choices) and shows that executor as **Offline** until the home is updated. An
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
`/arena/inbox`, and `/arena/archived`. Header controls and Arena tabs use client navigation, so
refresh, bookmarks, and browser Back/Forward preserve the top-level destination without encoding
device-local tabs, drafts, or panel state in the URL.

The header **Arena** control opens an overview of active sessions, grouped first by execution
machine and then by project.
Cards show Idle, Running, Needs you, Queued, or Failed state plus their repositories, agents, and
latest activity. An inactive session can be archived from its card, or from inside it with
**More → Archive session**, and later restored intact from the **Archived** view; a session with a
reserved, queued, executing, or permission-blocked turn cannot be archived. Use **New session**
there to choose a project, provider, and initial mode before opening an empty session; creation
never sends a prompt automatically.

The header **Inbox** follows you into every session and aggregates all online attached machines. It
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

New sessions default to **Plan** because their initial participant is the `coder` preset. Arena
creation may set another supported initial mode as device-local state before the empty session opens.

Independent sessions can execute at the same time. Each machine runs two eligible turns by default
and visibly queues additional work; `CODEAI_MAX_CONCURRENT_RUNS` sets a limit from 1–8. Ask and
Plan turns may share a checkout, while Agent takes an exclusive checkout execution lock and keeps
its slot while an approval is pending. Every tab owns its own status, preview, activity,
permissions, cancellation, and reload recovery.

## Conversation modes

Every message carries a mode. The browser sends only the mode name; the server resolves it to a
fixed provider policy. A session can change modes and recipients; later turns resume only the
addressed participant's private provider-owned session.

| | Ask (wire fallback; reviewer/tester/custom default) | Plan (orchestrator/coder default) | Agent |
|---|---|---|---|
| Purpose | Q&A, review, diagrams | An approvable implementation plan | Building in the working tree |
| Provider policy | server-owned read-only profile | server-owned read-only profile | provider approval profile |
| Side effects | never | never | only after you approve each one |
| Prompts you | never | never | permission cards in the chat |
| Budget per message | 20 turns / 5 min | 20 turns / 5 min | 200 turns / 30 min |

**Ask** is the read-only conversation plus the git allowlist below. **Plan** has identical
capability and differs by contract: the turn ends with a delimited plan and the message gains an
**Execute plan** button. Executing sends an ordinary follow-up turn in Agent mode that resumes the
same session, so the executing agent keeps all of the research context. Nothing auto-executes.

**Agent** runs with the provider's server-owned approval policy. Every side effect raises a permission card in the
conversation with **Allow** / **Deny**; the floating canvas control shows a pending badge so
full-screen users notice. Deny does not kill the run — the model is told and continues. An
unanswered card is auto-denied after `CODEAI_APPROVAL_TIMEOUT_MS` (default 10 minutes), and
the run's own timeout clock is paused while a card is pending. Cancelling resolves pending cards as
denied before terminating the child.

Agent mode edits **the real working tree** of the session's primary repository, exactly like the corresponding
terminal agent. Review the result with `git diff`. Worktree isolation and apply/discard checkpoints are
deliberately out of scope for now.

Claude currently supports all three modes. Codex supports Ask and Plan by default. Codex Agent is
a release gate: set `CODEAI_CODEX_AGENT=1` only after the installed App Server has passed the
real write, command, network-escalation, denial, and cancellation approval matrix documented in
[docs/experiment-log.md](docs/experiment-log.md). Without that opt-in, the UI reports Codex Agent as
unsupported rather than silently granting workspace writes.

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

The **Model** menu beside the mode selector chooses the model and effort for the addressed agent's
next turn. It lists only what the executing machine offers for that agent's provider: Claude's
family aliases (`fable`, `opus`, `sonnet`, `haiku`) with `low` to `max` effort (none for Haiku or a
Haiku `CODEAI_CLAUDE_MODEL` default, and none at all when the installed `claude --help` lacks
`--effort`), and whatever Codex App Server's `model/list` returns, each model with its own efforts.
Docker Claude offers the same aliases with their efforts; Docker Codex offers its Docker worker's
own `model/list`, recorded when the worker was provisioned or updated, and otherwise what the
machine's local Codex lists. The server rejects any other model or effort with 400.

The choice is remembered on this device for each agent in each session, like mode; it is not part
of the session and another device does not see it. VR turns use this device's choice. **Default**
means no override: a new agent starts on the machine's default (`CODEAI_CLAUDE_MODEL` /
`CODEAI_CODEX_MODEL` when set, otherwise the CLI's own), and an agent that already ran on an
explicit choice keeps it, because a provider session keeps its last model and effort. A machine that
sets `CODEAI_*_MODEL` sends that model on every Default turn.

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

Optional **Docker** execution is being implemented in Story 57. Turn on **Enable Docker** in Arena
to save this machine's preference without restarting; the UI shows when setup is still needed. See the
[Docker setup and verification guide](docs/docker-execution.md) for its release status, provider-owned
login, direct-edit scope, network restrictions, and cleanup. Select Local or Docker directly when
creating a session in a project or Arena. Sign in once with `npm run docker:login -- claude` or
`npm run docker:login -- codex`; new Docker conversations share that provider's login, settings and
history in persistent Docker storage, separate from the host provider setup. Existing individual
Docker homes retain their history in place. When Claude Code or Codex publishes a new version,
**Update** it in Arena's Docker section, or run `npm run docker:upgrade -- <provider> <version>`:
the new CLI is checked offline before turns use it, and **Roll back** returns to the previous one.
The conversation shows an execution badge and offers
**Continue in Docker/Local**, opening a fresh session on the same repositories with a recap ready
to review and send. Docker sessions persist execution and
one fixed primary checkout. Agent is autonomous inside the container; its dependency installs and
build outputs also change the host checkout. Ask/Plan mount the entire checkout read-only.
Dependencies may need reinstalling when switching between macOS and Linux. The Local contract
below and its Codex Agent gate remain in force for Local sessions.

Every run uses a server-owned provider profile. The browser can name a supported mode and nothing
else: provider, executable, tool list, allowlist, permission mode, model flags, environment
variables, sandbox, and settings all stay server-owned. An unknown or unsupported mode is a 400.

Claude is spawned without a shell in the primary repository's checkout directory with:

- safe mode (repository hooks, skills, MCP, and custom commands stay disabled), strict empty MCP
  configuration, and slash commands disabled, in every mode;
- the fixed git/gh allowlist, and in Ask/Plan the `Read,Glob,Grep,Bash` tool list with plan
  permissions;
- a bounded turn count, timeout, output size, and one global active process;
- native session persistence (`--session-id` first, `--resume` later).

Codex is spawned as a local [`codex app-server`](https://learn.chatgpt.com/docs/app-server) stdio
child for each active turn. CodeAI performs the App Server handshake, starts or resumes the
stored Codex thread, and streams the turn without opening a listener port. Ask and Plan use a
read-only sandbox with network disabled. Server-owned overrides disable MCP servers, apps,
plugins, hooks, web search, subagents, and custom commands; preflight also queries the effective
integration inventory and fails closed if an ambient MCP server or hook remains enabled. Instruction
files Codex loads from outside the repository, such as a user-level `AGENTS.md`, and enabled user or
repository skills are your own Codex configuration: readiness reports them as a note instead of
withholding the provider. App Server approval requests are correlated to the active turn, sanitized, and
resolved as one-shot allow/deny decisions through the same permission cards.

Status and diff context are generated by fixed, read-only, no-shell Git invocations and placed with
diagram snapshots in a per-run temporary directory outside the repository. It is always removed after
the turn.

This is a capability restriction, **not a separate operating-system or container boundary**. The
selected CLI still runs as your desktop user, and in Agent mode it changes real files once you
approve. Use CodeAI
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
  own independently editable repository list. A session can be loose or repository-free; the
  canvas, roster, and conversation record remain available, while a turn clearly asks for a primary
  repository.
- The browser lists and hydrates snapshots from `/api/sessions`. A versioned device record in
  `localStorage` restores open/focused session views, drafts, unread counts, active canvases,
  addressee/mode, repository selection, flat and spatial cameras, spatial panel placements, and
  per-view panels. It writes no
  transcript, canvas, roster, annotation, project, or repository-binding content there. Reloading
  or a second browser context sees committed host content after refetch, with its own layout.
- Later turns resume the addressed participant's host-bound native provider session and receive
  only the bounded canonical transcript delta missed since its last complete turn. The server
  defaults to 40 entries / 24 KB and never accepts a browser-supplied transcript.
- If the provider's native session is missing, visible history is retained and the UI offers an explicit
  new-session continuation with a visible bounded recap.
- CodeAI reports attached to a message are the one kind of evidence kept outside the record:
  `<data directory>/attachments/<session id>/reports/`, user-only, referenced by bounded metadata in
  the message. The pending reports for a session's next message are device state, like its draft.
- Export includes the roster and expanded author/provider/role metadata for every entry, plus
  diagram/mark state, without provider session ids, credentials, or server paths.

Local `.env*`, `.next`, `node_modules`, coverage, and TypeScript build state are ignored. The
tracked `.env.example` contains no secrets.

## Canvas workflow

Ask a normal question. Markdown-only answers are complete answers. Zero or more fenced Mermaid
blocks become immutable diagram artifacts; one invalid diagram does not hide prose or siblings.
The first valid diagram opens on the canvas.

The canvas supports pan, wheel/buttons zoom, fit/reset, pen, rectangle, arrow, text, eraser,
50-step undo/redo, confirmed clear, Mermaid source export (diagrams only), and canvas/marks JSON
export. Chat and canvas history are drawers. Focus mode fills the application viewport while
retaining tools, status, and the instruction composer.

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
composite PNG when browser export succeeds. Remove its chip for a text-only turn, or use History to
attach up to four canvases. Composite failure is non-fatal.

A single valid result derived from the still-active attachment becomes active automatically and
leaves **Previous version** one action away. Navigation during a run suppresses auto-activation.
Zero or multiple diagram results preserve the current canvas.

## Configuration

See [.env.example](.env.example). The most useful options are:

- `CODEAI_REPOSITORIES_ROOT` — repository or repositories directory;
- `CODEAI_REPOSITORIES_DEPTH` — nested discovery depth, from 1–10 (default `1`);
- `CODEAI_CLAUDE_BIN` / `CODEAI_CLAUDE_MODEL` — local agent executable and optional model; the
  model is the Default that the composer's **Model** menu can override for one turn;
- `CODEAI_CODEX_BIN` / `CODEAI_CODEX_MODEL` — local Codex executable and optional model, also the
  composer's Default;
- `CODEAI_CODEX_AGENT` — explicit Codex Agent release gate; unset means Ask/Plan only;
- `CODEAI_DATA_DIR` — canonical host session store root (tilde expansion is handled in Node);
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
- `CODEAI_APPROVAL_TIMEOUT_MS` — how long an Agent permission card waits before auto-denying;
- `CODEAI_MAX_CONCURRENT_RUNS` — machine-wide execution slots, from 1–8 (default `2`);
- `CODEAI_AGENT_*` / `CODEAI_BUILD_*` — per-message turn and time budgets for Ask/Plan
  and for Agent respectively;
- `CODEAI_MAX_TRANSCRIPT_MESSAGES` / `CODEAI_MAX_TRANSCRIPT_BYTES` — server-side prompt bounds
  applied to the canonical host transcript;
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
- Mermaid subgraphs cannot be generically collapsed; large diagrams use pan/zoom/fit and agent revision.
- Agent mode works directly in the checked-out tree: no worktree isolation, no apply/discard
  checkpoints, and no policy on pre-existing uncommitted changes. Review with `git`.
- Every shipped Agent side effect prompts; there is no "always allow" or `acceptEdits` tier yet.
- Source excerpts and editor deep links are still outside the experiment.
- Native provider session history remains owned by its CLI; deleting local browser data does not
  delete that history.
- Participant removal, session transfer, editable custom-role instructions, simultaneous turns in
  one session, and autonomous multi-agent relay are not implemented.
- Queues and provider processes are machine-memory state; a server restart leaves canonical
  transcript recovery intact but does not resume queued or executing processes.
- The real-agent experiment matrix is manual and is tracked in
  [docs/experiment-log.md](docs/experiment-log.md).
