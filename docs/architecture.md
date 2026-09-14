# Architecture — CodeAI

**Scope:** the Next.js application at the repository root. The superseded Socket.IO analyzer,
React Flow client, and VS Code extension are archived and documented separately in
[legacy/docs/architecture.md](../legacy/docs/architecture.md); nothing here imports them.

---

## Shape

One private npm package, one Next.js 16 App Router application, no separate backend process.
Route handlers under `src/app/api/` are the only server surface; they spawn local agent CLIs as
child processes and read the selected repository with fixed git invocations.

```text
browser (src/features/**, server snapshots + device-only React state)
   │  paired HTTPS + HttpOnly device credential (remote mode)
   │  fetch / NDJSON stream
   ▼
device authorization at every route handler (src/server/devices)
   │
   ▼
route domain operations (src/app/api/**)
   │
   ├── src/server/repository   checkout discovery, fixed read-only git reads, bounded context files
   ├── src/server/storage      durable projects/sessions, writer lock, per-run temp attachments
   ├── src/server/runs         bounded scheduler, checkout locks, run registry, permission brokers
   ├── src/server/agents       provider policy → claude / codex app-server child
   └── src/server/machines     bounded registry + allowlisted same-origin gateway
              │               opaque bearer over separately trusted HTTPS
              ▼
       attached CodeAI executor route handlers (never its transitive registry)
              │
              └── its own storage, repository, scheduler, policy, and provider process
                                     │
                                     ▼
                          local agent CLI, user's own login
```

`src/shared/` holds everything that crosses the boundary — wire schemas, limits, participant
helpers, plan delimiters, and types. It must stay free of Node and DOM dependencies.

## Client/server split

The browser owns presentation and device selection. The server owns session content and
capability.

| Concern | Owner |
|---|---|
| Transcript, Mermaid artifacts, marks, pins, roster | Host session store |
| Focused canvas, next recipient/mode, panels, drafts, Flat/Spatial layout, transient XR state | Browser memory |
| Provider session ids and transcript cursors | Private fields in the host store |
| Projects, session membership, repository bindings | Host store |
| Arena session summaries and run attention | Derived server snapshots |
| Attached executor identity, credential, and cached Arena projection | Home machine registry |
| Arena finished-item read markers | Versioned browser device state |
| Checkout discovery and opaque checkout ids | Server |
| Provider executable, tool list, allowlist, sandbox, model flags | Server |
| Mode selection (`ask` / `plan` / `agent`) | Browser names it, server resolves it |
| Pairing challenges and device credential digests | Separate host device-auth record |
| Machine challenge and inbound credential digests | Separate executor machine-auth record |

The browser can name a supported mode and nothing else. An unknown or unsupported mode is a 400.
This is why the client never sends flags, prompts-with-tools, or paths outside the selected
repository: every one of those is derived server-side from `src/server/config.ts` plus the resolved
policy in `src/server/agents/agentPolicy.ts`.

## Browser snapshots and device state

The public client routes share `src/app/(shell)/layout.tsx`, which owns one persistent `AppShell`
across client transitions. The shell derives its top-level destination from the pathname: `/` is
the focused workspace, `/arena` is Active, `/arena/inbox` is Inbox, and `/arena/archived` is the
recoverable archive. Those URLs own navigation and browser history only; project selection, open
session views, drafts, panels, and canvases remain device state and survive route transitions.

`src/features/conversation/sessionStore.ts` contains pure snapshot/canvas/export helpers. It
does not persist conversation content. `AppShell` lists snapshots by project (or **No project**) with
`GET /api/sessions`, hydrates one complete snapshot with `GET /api/sessions/[sessionId]`, and sends
annotation, sketch, pin, roster, and main-agent operations to dedicated routes. Stale overwrite
revisions return 409 and trigger a refetch instead of silently replacing another client's work.

The Arena polls one bounded `GET /api/arena` projection containing the local machine and every
explicitly attached executor. Remote projections are fetched concurrently with a 1.5-second
timeout. They carry separate active and archived card summaries, safe pending-permission details,
and brief terminal run outcomes, never full transcripts or private provider-session handles. A
validated projection is cached in the home registry; failure produces cached Offline cards with
live runs and actions removed. The browser derives cross-machine card and Inbox presentation,
stores only bounded finished-item read ids under `code-ai:device:v1:arena`, and cannot dismiss a
live permission locally. Revisioned archive/restore routes reject every live run reservation,
including the pre-activation interval hidden from normal discovery.

The selected checkout preference and loose-session workspace scopes are machine-qualified under
the `code-ai:device:v1:*` records; focus, next recipient, mode, panels, flat viewport, Spatial
surface/camera/placements, and drafts remain React state. Spatial coordinates are finite, clamped,
count-bounded, and reconciled against live canvas ids. Canonical project and session records do not
gain layout or a home-machine routing field. An immersive session, head/controller poses, temporary
diagram scale, and transcript scroll position are still more ephemeral: they are never written to
`localStorage`, restored after reload, or added to a wire record. Legacy
`code-ai:web2:v1:*` conversation keys are untouched and unread.

In paired mode, `DeviceAccessGate` checks the bounded `/api/auth/status` bootstrap route before it
mounts `AppShell`, preventing catalog and Arena polls from starting on an unpaired browser. The
credential itself is a host-only HttpOnly cookie and therefore is neither browser device state nor
available to client JavaScript. An authenticated header menu lists public device summaries and can
revoke a device or sign out the current one.

Export (`codeai-<session>.json`) includes the roster and per-entry author/provider/role metadata
plus diagram and mark state — never provider session ids, credentials, or server paths.

## Personal-device trust boundary

`local` remains the default access mode. `paired` requires an exact HTTPS public origin and the
dedicated `start:remote` custom server, which terminates TLS, rejects another Host, and stamps every
request with a process-random internal transport marker. Thus accidentally running ordinary
`next start` with paired configuration fails closed instead of treating HTTP as remote transport.
Mutation routes additionally require the browser `Origin` to equal the configured public origin.

`src/server/devices/deviceAuthStore.ts` owns `CODEAI_DATA_DIR/device-auth-v1.json`, independently of
canonical project/session records. `device:pair` writes one salted digest for an 80-bit,
ten-minute, single-use challenge. A successful exchange consumes it and creates a one-year opaque
device credential; the record stores only the device id/label, timestamps, salt, and digest. The
file is atomically replaced as `0600`, the data directory is `0700`, failed guesses are bounded,
and malformed state fails closed. The one personal owner has one authorization scope.

Every private route handler calls the same durable authorization check before parsing request data
or touching repositories, sessions, providers, or the run registry. This includes read snapshots,
NDJSON reattachment, new turns, cancellations, and permission decisions. Only bounded auth status
and pairing-code exchange are unauthenticated; neither returns challenges, cookies, or digests.

## Execution-machine trust boundary

An executor uses the same explicit `paired` HTTPS listener, but machine authorization is separate
from browser-device authorization. `machine:pair` creates a ten-minute, single-use challenge in
`machine-auth-v1.json`. The pairing route accepts a bounded identity exchange only through the
listener's internal TLS marker and returns a one-year opaque credential once; the executor stores
only its salt and digest. Attached-machine credentials can authenticate the shared allowlist of
executor domain routes without a browser `Origin`, but only through that verified transport;
browser auth, the Arena aggregator, and another gateway stay personal-device-only.

The home stores at most eight exact HTTPS origins and outbound credentials in
`machine-registry-v1.json`. It fetches only `/api/machine/snapshot`; that projection cannot expose
the executor's own attachments. Browser operations use `/api/machines/<id>/…`, whose gateway admits
an explicit project/session/repository/run/stream/permission matrix, strips cookies, origins and
authority-bearing response headers, rejects redirects, bounds buffered bodies, and streams NDJSON
without buffering. The credential and origin stay server-side. Remote domain routes then resolve
their own checkout, provider policy, capability set and scheduler exactly as a direct local call
would.

Both records are atomically replaced as `0600` beneath a `0700` data directory and malformed state
fails closed. A clean home-side detach revokes the executor digest; executor-local `machine:peers`
and `machine:revoke` cover a home that removed an attachment while the executor was unreachable.

## Host-owned session store

`src/server/storage/sessionStore.ts` owns `CODEAI_DATA_DIR/session-store-v2` (the data-dir
default remains `~/.code-ai/web2`):

```text
session-store-v2/
  manifest.json       # version + durable host id/label
  writer.lock         # owner token, pid, hostname, heartbeat
  projects/<uuid>.json # one durable project per file
  sessions/<uuid>.json # one complete private session per file
  archived-sessions/<uuid>.json # one recoverable archived session per file
```

The store opens lazily. A live lock excludes a second process; stale takeover uses an owner token
so the old process cannot remove its successor's lock. The process-wide instance and mutation
queue are pinned on `globalThis`, because Next route handlers are compiled into separate bundles.
Every session write flushes a same-directory temporary file before atomic rename. Archive and
restore first persist their lifecycle marker, then atomically rename the record between sibling
directories; startup finishes a transition interrupted between those steps. Store directories are
`0700`; manifest, lock, and session files are `0600`.

Each project and session has a monotonic revision. A project contains its repository bindings; a
session contains an optional project id, its independent repository bindings, participants,
messages, canvases, annotations, pins, private provider sessions, and cursors. Public snapshots
strip session ids, host-bound session state, cursors, and idempotency keys. Missing/corrupt store
identity fails closed; the whole `session-store-v2` directory is the backup/restore unit. A valid
`session-store-v1` is copied forward once and then ignored; it is never modified (a direct
`conversation-store-v1` upgrade also remains supported). Older
`threads.json` and browser records are not imported or modified.

Session records accept version 3 (implicit local execution) and version 4 (required `execution:
'local' | 'docker'`). Reads do not migrate either format; mutations, public snapshots, and exports
preserve the version and execution metadata. New sessions remain version 3. Docker sessions keep
their fixed single-primary-repository binding and are readable here, but the message route
rejects their turns before provider work because this checkout has no Docker runtime.

## The streamed agent route

`POST /api/agent/message` is the one turn-executing endpoint.

1. Validate the request against `src/shared/protocol.ts`, load the canonical session, and
   resolve its participant, primary repository binding, host-bound session, and mode. The request
   contains neither a checkout id nor transcript.
2. Refuse unavailable/foreign/stale repository bindings and foreign-host sessions before provider
   spawn. Reserve the session, provider session, checkout access, and bounded queue position in
   `src/server/runs/runRegistry.ts`; conflicts are 409 and queue overflow is 429 before persistence.
3. Append the user message idempotently, then activate its reservation. The machine executes up to
   `CODEAI_MAX_CONCURRENT_RUNS` eligible turns (default 2): Ask/Plan are checkout readers, Agent is
   an exclusive writer, and a waiting writer blocks later readers on that checkout without blocking
   eligible work elsewhere.
4. When the scheduler starts the turn, build the historical prompt delta from the current canonical
   record and a bounded per-run temporary directory outside the repository (`code-ai-run-*`) holding
   diagram attachments plus git status/diff snapshots from `src/server/repository/`.
5. Compose the prompt in `src/server/conversation/prompt.ts`: mode contract, participant identity
   and role contract, the historical-context JSON delta, and the current request as one JSON
   value. Historical text is data, never framing.
6. Spawn the provider adapter (`claude` directly, `codex` as an `app-server` stdio child) and
   stream NDJSON events back to the browser: tool activity, text deltas, permission requests,
   and the result.
7. Parse the answer in `src/server/conversation/responseParser.ts` — Markdown plus zero or more
   fenced Mermaid blocks, validated by `src/features/diagram/mermaid/mermaidPolicy.ts`, plus
   evidence comments.
8. Commit the assistant message, user delivery state, and participant cursor in one revision before
   emitting the durable assistant event. Remove the temporary directory, always.

`GET /api/agent/runs` discovers queued, running, needs-you, and recently finished descriptors.
`GET /api/agent/stream` reattaches a detached browser by run id; `POST /api/agent/cancel` ends
queued or executing work; `POST /api/agent/permission` resolves a pending approval card.

**A run outlives the page that started it.** Closing the tab or reloading only detaches the
browser. Reopening the session replays activity, any pending approval, and the answer. A
finished run stays reattachable for five minutes.

## Permissions

In Agent mode every side effect raises a permission card. `src/server/runs/permissionBroker.ts`
correlates the provider's approval request to the active run/session/turn, sanitizes it, and waits
for one allow/deny decision. While a card is pending the run's timeout clock is paused. An
unanswered card is auto-denied after `CODEAI_APPROVAL_TIMEOUT_MS`. A denial is reported to the
model as a decision — the run continues. Cancelling resolves pending cards as denied before
terminating the child.

Ask and Plan never prompt: they run under a server-owned read-only profile plus a fixed git/gh
read allowlist. A command matching no rule is auto-denied and shown as a denial in the timeline.

## Repository access

`src/server/repository/gitRepository.ts` runs a fixed set of read-only git invocations without a
shell, in the selected repository checkout, with bounded output
(`CODEAI_MAX_GIT_CONTEXT_BYTES`). It backs the repository sidebar (status, changed files, diffs)
and the per-run context snapshots. Agent mode's writes go through the provider's own tools under
approval, not through this module.

## Diagrams

Mermaid source is the canonical stored artifact. Diagrams are immutable: a revision is a new
artifact, never a patch. `mermaidPolicy.ts` normalizes and validates source on both sides of the
boundary (the browser before storing, the server before accepting); `mermaidRenderer.ts` is
browser-only and produces the SVG. Annotations are vector marks held beside the artifact in
`src/features/diagram/annotations/`, exported as a composite PNG only for attachment.

`CanvasWorkspace` keeps Flat as the default and mounts
`src/features/diagram/spatial/SpatialBoundary.tsx` only after Spatial is selected. That lightweight
client boundary checks WebGL and contains dynamic-import/context failures; the R3F, drei, Three.js,
SVG rasterization, and scene modules stay in a separate client-only chunk. The room projects at
most twelve canonical diagrams/sketches as panels. Each current-theme preview is capped at a
2,048-pixel long edge and two million texels; the active texture plus one common peer downscale is
bounded to sixteen million base-level texels, with mipmaps disabled and labelled placeholders for
smaller results. A module-owned ledger disposes object URLs, textures, materials, and geometry on
replacement or unmount. `frameloop="demand"` keeps the settled room idle. None of these derived
pixels or layouts enters the session export or the stable light attachment renderer.

`AppShell` keeps `src/features/shell/immersive/ImmersiveBoundary.tsx` mounted during catalog loading
and across the persistent shell routes. This lightweight boundary probes secure context, device
authorization, and `immersive-vr` support without importing Three.js. A successful probe lazily
prepares a separate R3F renderer and `ImmersiveBridge`, so the explicit Enter VR gesture can request
a session immediately. Flat/Spatial selection is independent; desktop Spatial resources are
suspended while immersive and restored from their existing device state on exit.

The bridge owns one `@react-three/xr` store with controller rays and `local-floor`/`local` reference
space handling. Normal project/machine/session and Arena/Inbox navigation does not replace it.
AppShell supplies records, loading/error status, and explicitly addressed session-opening commands
from its existing Arena polling owner, including each session's modification timestamp. The
conversation-list view replaces the chat within its panel, sorts all machines' choices newest first,
and shows relative update times. It initially exposes 20 choices; Load more appends another 20 from
the available catalog without moving the reading position. One fixed 1024×1024 texture draws only
visible rows. Activity labels refresh each minute. `useImmersiveScroll` shares wheel, thumbstick,
and captured-drag handling with the chat; dragging suppresses row selection. Back in the upper-left
header restores the existing chat scroll state. Canvas
rendering stays in the diagram feature and failures remain local; the opaque environment is a
separate presentation component. Conversation combines continuous scrolling with the shared draft,
agent controls, and local voice input.

The XR resource ledger enforces a 4,194,304-pixel aggregate cap and 2,048-pixel edge cap, with mipmaps
disabled. Story 46 reserves at most 1.1 million texels for the active canvas, 1,048,576 for the
conversation, 786,432 for evidence, and bounded textures for launcher rows, panel chrome, and the
protected tool/status strip. Story 47 uses 96×96 icon textures and allocates hover labels only
after 450 ms of hover, with a 150 ms fade and muted theme colors. Tooltip materials disable depth
testing/writing and render after controls to prevent occlusion. Inline input adds one 1024×256
texture beneath the transcript. Speech review/editing and Agents replace the transcript texture with smaller draft/status surfaces
and contextual controls; browser tests enforce the aggregate cap including recovery surfaces.
Closed panels unmount their content. The conversation stays mounted but hidden during resizing
to preserve its voice operation; other panels release their content for the size menu.
Dragging keeps content visible with its actions disabled. Replaced content releases its resources. System end,
authorization/unmount, page departure, and WebGL loss end immersion; a late entry
result after departure or unmount is also ended. Controller removal/reconnection and temporary
hidden/blurred visibility preserve the XR session; the runtime pauses/resumes rendering and input.
No XR pose, scale, scroll position, paging, or resource enters canonical records or desktop layouts.

`immersiveDiagnostics.ts` retains up to 120 device-local lifecycle events and ten-second samples
at `code-ai:device:v1:immersive-diagnostics`, best-effort across reloads. The remote console can read
`window.__CODEAI_VR_DIAGNOSTICS__()`. Samples include application counters, renderer allocation
counts, visibility/controller count, and optional browser heap usage. Page start times distinguish
documents. It records neither content/poses nor arbitrary error messages; native error details
remain in DevTools. Sampling and error listeners are removed when the session finishes. Storage
failure falls back to memory. This adds no Three.js import to the non-lazy boundary.

`workspaceLayout.ts` validates continuous forward angles, bounded distance/height, and four size
presets. `useImmersiveLayout` stores version 4 disposable device views at the existing
`code-ai:device:v1:immersive-layout` key, keyed by machine/project/session; version 1 slot placements
migrate to angles and the closest size preset. Versions 1–3 migrate untouched defaults to conversation
right, canvas center, and evidence left, preserving explicitly moved positions and dropping
the separate Sessions panel. Evidence starts closed, retaining explicit version 3 visibility choices.
Bottom panel buttons toggle visibility and show open state. `WorkspacePanel` owns an icon strip below the frame
with a captured drag handle, Size menu, Close action, and non-interactive ray-hover tooltips.
Toolbar and icon textures are shared across the three panels; tooltip opacity belongs to each control.
`usePanelDrag` follows the
controller ray and converts the result to workspace coordinates; physical push/pull receives 4×
depth gain over 2.0–4.5 m without amplifying lateral or vertical motion.
Drag previews stay in memory, release commits
once, and cancellation discards the preview. Live content does not change focus or placement.
Re-entry and reset place the workspace origin
at the current eye position and horizontal viewing direction, without storing tracking or moving
the camera. The nearer tool/status strip stays outside every closable panel.

AppShell owns the shared repository status/selection and diff hooks. DOM and immersive Evidence
consume the same read-only result and refresh/select actions; Evidence never fetches independently.
Responses are scoped to API origin, checkout, and file, and abandoned requests are ignored.
Diff raster pages wrap monospace text to the available line/column budget.

`ConversationTools` keeps input below the chat; History and Agents occupy the panel's upper right. Its
typed `ImmersiveConversationControls` contract receives drafts, roster, mode, attachment summaries,
and captured send/cancel actions from AppShell. It owns temporary word selection, bounded undo,
speech review, contextual editing, and draft paging. `ConversationHistory` lays out the full loaded
transcript as user/agent bubbles using shared proportional wrapping. It repaints only visible entries
and lines into one fixed 1024×1024 texture, so history length does not increase GPU allocation.
Thumbstick, wheel, and captured trigger-drag input update a continuous scroll offset.
AppShell keeps a synchronous per-session send guard through
attachment preparation and clears an unchanged draft only after a successful final response.
Cancellation captures session/run identity; roster commands keep the existing DOM capabilities.
Streaming preserves older scroll offsets and follows the bottom only when already there. Latest
and Send return to current activity. Latest floats inside the scroll viewport only away from bottom.
Cancel remains available in the chat view, replacing Send during a run.

`InlineConversationInput` owns a bounded raster field, measured wrapping, and ray-to-caret mapping.
When the active `XRSession` reports `isSystemKeyboardSupported`, selecting the field focuses a
one-pixel DOM textarea and opens Quest's system keyboard. `nativeKeyboardEditing` retains the
canonical draft and clicked selection separately; native value changes replace only that selected
range. Native correction, prediction, and dictation can therefore revise their own insertion buffer
without exposing the surrounding draft to Quest's first-input replacement.

The native buffer begins with an invisible word-joiner guard. Removing the guard is interpreted as
Backspace against the retained draft, using grapheme boundaries, then the guard is restored for
another deletion. Explicit empty composition/insertion events do not delete text. Erasing a native
replacement commits its empty range before another Backspace, and literal input such as “Delete” is
always text. The bridge enforces the shared draft cap and strips the guard from canonical state.
This is an experimental browser workaround: automated tests can validate value translation but
cannot prove that Quest's private IME accepts programmatic guard restoration. Physical acceptance
must cover first/repeated Backspace, speech, prediction, composition, dismissal, and reopening.

Browsers without the WebXR system keyboard keep the full textarea and ordinary selection behavior.
Enter adds a newline, Escape blurs, and only Send submits. Disable, navigation, and unmount blur and
remove the textarea while retaining the shell draft. No additional keyboard texture is allocated.
The browser's `visible-blurred` lifecycle continues to preserve the XR session.

`useVoiceDraft` scopes an abort controller to one mounted session's chat input. Header navigation
is disabled during capture, transcription, and unapplied speech review. `voiceCapture`
loads `/voice-capture.js` only after deliberate dictation, uses a silent AudioWorklet output and
bounded 16 kHz PCM chunks, reports measured RMS levels and captured duration to the UI, and closes
tracks/context/ports on stop or abandonment. Interaction locking during panel movement does not
change voice ownership. The worklet and
main-thread timer independently enforce 60 seconds. Dictation does not depend on a keyboard or browser speech service.
`/api/voice` is a home-only, paired personal-device route; it is not an executor gateway capability.
It checks the exact mono PCM16 WAV contract, limits streamed uploads and their duration, admits
one request, and calls the configured HTTP loopback Whisper origin with redirects disabled.
Audio remains in memory. Browser abort and the 90-second deadline close the Whisper request;
the documented engine version cancels on disconnect. Authorization is checked again before
returning text. No audio or transcript is added to XR diagnostics. See the README's voice setup
for the tested engine revision and the still-pending physical Quest validation.

The response policy `xr-spatial-tracking=(self)` grants only the same origin. On a personal device,
the shell passes immersive authorization only after the existing pairing and secure-transport gate,
so XR adds no route, credential, or access around the home server. The paired trusted-HTTPS
`start:remote` origin is the supported headset transport; an allowed development hostname over HTTP
does not qualify.

### Remaining immersive workspace work

Story 45 establishes shell ownership and navigation; Story 46 implements bounded movable panels;
Story 47 implements conversation commands and local voice capture/transcription/correction.
Physical Quest 3S entry, readability, controller use, and comfort verification remain pending.
The [immersive workspace epic](../stories/EPIC-20260905-immersive-workspace.md) owns the remaining
working surfaces and headset acceptance.

The first release targets one complete session on Quest 3S: movable tools, controller/voice input,
permission decisions, repository diffs and marks, and derived spatial Mermaid flowcharts. Voice
capture/transcription and correction still need Quest 3S validation of the implemented local path.
Device panel layout remains separate from desktop camera state and
canonical records. Story 52 adds the multi-session VR Arena after that work loop is accepted.
Model-native geometry, lenses, and provenance remain owned by the software-model track.

AR/passthrough is a retained future option in the epic. Keep the virtual environment/background
separate from reusable panels, diagram content, and session commands so that this option remains
open. No AR runtime, room mapping, or anchor persistence is required by the current VR milestones;
those need their own feasibility and interaction scope.

## Current constraints

These are real and deliberate, and they bound what can be built next:

- one queued or executing turn per session and per concrete provider session;
- a bounded in-memory queue and 1–8 execution slots on each machine; no durable process/queue
  recovery across a server restart;
- one Arena across the home and up to eight direct attached executors, while the focused shell uses
  one machine catalog and several machine-qualified device-local tabbed views;
- a session may be loose and may bind zero or several repositories; the repository sidebar follows
  a device-selected binding while turns continue to use the primary binding;
- paired personal devices see committed host content after refetch/reload, but there is no live
  multi-view synchronization or presence;
- Offline executors retain only cached Arena cards, not transcripts/canvases or actionable run
  state; sessions and projects are neither moved nor replicated between machines;
- attachment is direct: there is no discovery, relay, NAT traversal, transitive federation, or
  coordinator-owned continuity;
- Agent mode edits the real working tree: no worktree isolation, no apply/discard checkpoint;
- a capability restriction, not an OS or container boundary — the CLI runs as the desktop user.

The direction past this direct home/executor topology — durable continuity and spatial surfaces —
is in [vision.md](vision.md), with record-level engineering notes in
[multi-project-session-environment.md](multi-project-session-environment.md) and the names in
[vocabulary.md](vocabulary.md).

## Configuration

`src/server/config.ts` resolves every setting as
`CODEAI_<NAME> ?? CODEAI_WEB2_<NAME> ?? default`, treating an empty assignment as unset on either
name. Validation runs on whichever raw value is selected, so an invalid neutral value fails rather
than falling back. See [.env.example](../.env.example) and the
[README](../README.md#configuration).
