# Story 63 — Use headset reports as conversation evidence

**Status:** In progress (Part A implemented; Parts B and C follow) · **Type:** Full-stack · **Depends on:** [Story 47](STORY-20260905-vr-conversation-input.md), [Story 56](STORY-20260919-vr-report-from-headset.md), [Story 62](STORY-20260920-simplify-flat-shell.md); Part B also needs [Story 65](STORY-20260921-tolerate-newer-session-format.md) shipped first

**Vision slice:** the complete immersive work loop in the
[immersive workspace epic](EPIC-20260905-immersive-workspace.md) and the intent/context side of the
[bidirectional change loop](../docs/software-model.md#the-bidirectional-change-loop). This story
does not add model entities or a new agent capability; it carries bounded visual and diagnostic
evidence into the existing conversation.

It ships one part per commit, like [Story 62](STORY-20260920-simplify-flat-shell.md). Part A is useful
alone and is all that [Story 64](STORY-20260921-managed-self-rebuild.md) needs from this story.

---

## Motivation

Story 56 gets a difficult headset failure onto the paired home machine, but it stops at a terminal
line and files under the data directory. The user now wants the result to close the development loop:

> if the opened repo is "code ai" and the issue is reported - I'd want to somehow show these reports
> in codeai and be able to use them in conversation - as some kind of attachment maybe?

> Perhaps it'd be handy to be able to make screenshots and be able to attach them in conversation?

The useful journey is one continuous headset interaction: aim at the problem, capture it, dictate an
explanation, send the image and diagnostics to the agent working on CodeAI, and retain exactly what
that turn saw. A project name is not identity, an inbox file that can be pruned is not durable message
evidence, and a browser-supplied filesystem path is not an attachment contract.

A report is evidence about *this CodeAI installation*, whichever project was open when it was
captured: a clipped panel seen while working on another project is still a CodeAI bug. Where a report
was captured is therefore a label, not a permission. What decides whether reports can be seen and
attached is whether the project the user is working in *is* this installation's own checkout.

---

## Current behavior (where the code is)

- Report context is one opaque `view` string and the successful response returns the stored file name:
  [immersiveReport.ts:15](../src/features/shell/immersive/immersiveReport.ts#L15),
  [report/route.ts:12](../src/app/api/immersive/report/route.ts#L12).
- Reports are flat JSON/JPEG pairs named by arrival time and pruned to the newest 50, whether or not
  a conversation later needs one:
  [immersiveReports.ts:11](../src/server/diagnostics/immersiveReports.ts#L11).
- Story 56 explicitly leaves a report-browsing UI out of scope:
  [STORY-20260919-vr-report-from-headset.md](STORY-20260919-vr-report-from-headset.md#out-of-scope).
- The composer, message record, and request schema know only canvas attachments:
  [InstructionComposer.tsx:10](../src/features/conversation/InstructionComposer.tsx#L10),
  [sessionSchema.ts:169](../src/shared/sessionSchema.ts#L169),
  [protocol.ts:26](../src/shared/protocol.ts#L26).
- A message id that was already accepted is refused (`409` for the same content, `400` for different
  content); it is never run again. Retry prefills the old text into the composer and sends it under a
  new message id, without attachments:
  [message/route.ts:102](../src/app/api/agent/message/route.ts#L102),
  [AppShell.tsx:1963](../src/features/shell/AppShell.tsx#L1963).
- A turn writes canvas source, marks, and optional PNG into an isolated temporary directory, then
  removes it after the provider finishes: [tempAttachments.ts:25](../src/server/storage/tempAttachments.ts#L25),
  [conversationService.ts:78](../src/server/conversation/conversationService.ts#L78).
- Codex sends only `.png` files as `localImage` inputs, so the report's JPEG would currently be text
  context at best: [codexProcessRunner.ts:108](../src/server/agents/codexProcessRunner.ts#L108).
- Checkout ids are resolved to contained real paths on the server; this is the authority for deciding
  whether a local project's primary repository is this CodeAI installation:
  [checkoutRegistry.ts:95](../src/server/repository/checkoutRegistry.ts#L95).
- Docker execution refuses any checkout that overlaps the running installation, so a session on
  CodeAI's own checkout is always Local:
  [dockerProfile.ts:48](../src/server/execution/dockerProfile.ts#L48).
- User messages are strictly validated, and an unreadable session file stops the whole store from
  opening, which is why the format change below waits for Story 65:
  [sessionSchema.ts:169](../src/shared/sessionSchema.ts#L169),
  [sessionStore.ts:843](../src/server/storage/sessionStore.ts#L843).
- Sessions are archived and restored but never deleted:
  [sessionStore.ts:432](../src/server/storage/sessionStore.ts#L432).
- The end-to-end server is plain `next start` from the repository root with the repositories root set
  to fixtures, so no fixture checkout can equal the process's working directory:
  [playwright.config.ts:28](../playwright.config.ts#L28).

---

## Desired behavior

### Ground rules for every part

**Self project.** One shared server helper identifies a self project: its primary repository belongs
to the local host and its checkout resolves, through `CheckoutRegistry`, to the same real path as
`config.installationRoot`. Project display name, checkout display name, request origin, and client
claims do not make a project eligible. Remote-executor projects are not eligible in this story.

`config.installationRoot` defaults to `realpath(process.cwd())`. A `CODEAI_INSTALLATION_ROOT` setting
can name it explicitly; it is read from the server's own environment, never from a request, and
exists so the end-to-end server can name a fixture checkout. Unit and route tests inject the config
value. Docker's protected-path check keeps using the real working directory, so the setting cannot
relax it.

**Local execution only.** Because Docker refuses the installation's own checkout, every session in a
self project is Local. This story changes nothing about that and has no Docker acceptance. The
sentence in `docs/docker-execution.md` that says to run a separate installation to work on CodeAI
itself is reworded to say that this applies to Docker execution.

**Report identity.** A report's id is its stored base name, the value Story 56 already returns as
`name` (for example `2026-09-21T18-12-03.123Z-capture`). The server generates it, it contains no
directory, and every route accepts it only when it matches one strict pattern before joining it to
the fixed diagnostics directory. `receivedAt` is parsed from the id, not from the device clock. The
report format stays version 1: existing files need no legacy reader and are attachable like any other.

**Context is a label.** The report gains an optional `context` with the machine, project, and session
that were selected when it was captured. It is informational: no route uses it to authorize anything,
so there is nothing to forge. Eligibility is always "the requesting project is a self project and the
device is authorized".

### Part A — CodeAI shows its reports

When a self project is selected, the flat side panel adds a **Reports** tab beside Changes and History.
It lists every retained report, newest first, with received time, kind, note/error summary, a thumbnail
when a screenshot exists, and where it was captured when that project or session still resolves in the
device's catalog. The inbox never holds more than 50 reports, so the list is not paginated. Selecting
a report opens its bounded details and full screenshot.

The list, detail, and image routes take the project id, re-check the self-project rule on every
request, are device-authorized, return no host paths, and use `Cache-Control: private, no-store`. For a
project that is not a self project the list answers `{ available: false }` rather than an error, and
the tab does not appear. A malformed report file is skipped and counted, not fatal.

A capture made while another project was open can show that project's conversation or canvas. The row
says where it was captured, and nothing attaches such a report automatically.

### Part B — A report becomes durable message evidence

A report's **Attach** action adds its id to the session's device-local pending attachments; pending ids
are keyed by machine/project/session in the existing device workspace state, so changing session cannot
retarget them. A pending report appears as a removable chip beside pending canvas attachments. The user
may type or dictate an explanation, or send the report alone; a report-only turn uses the bounded text
`Investigate the attached CodeAI report.`.

The browser sends report ids, never paths or report bytes, in addition to the existing canvas payload.
For each id the message route checks that the session's project is a self project, enforces the limits
below, and resolves the report: first from the session's own promoted copies, then from the diagnostics
inbox. The existing duplicate-message comparison also compares report ids.

Evidence is written before the message that points at it:

1. Copy the report's JSON and optional JPEG to
   `<dataDir>/attachments/<sessionId>/reports/<reportId>.json|.jpg` at `0700`/`0600`. A copy that
   already exists is reused unchanged.
2. Append the user message with its bounded report metadata, then reserve and start the run as today.

A failure in either step leaves the draft and pending attachment intact and starts no run. A crash
between the steps leaves at most a bounded copy that no message references; the next send of the same
report reuses it. A message therefore never references missing evidence, and no staging directory or
startup recovery is needed.

The durable user message stores bounded report metadata, not image bytes or a filesystem path. The
promoted copy survives inbox pruning, server restart, session archive/restore, and later transcript
reads. The 50-report diagnostic retention applies only to inbox copies.

Limits, in `src/shared/limits.ts`: at most 4 reports per message, and at most 64 MB of promoted
evidence per session. A send that would exceed the session ceiling is refused with a clear message;
older evidence is never deleted to make room.

Turn preparation copies each promoted report into the existing per-run directory as a manifest, JSON,
and optional JPEG. The prompt names the report as user-selected observed evidence and says that its
contents are untrusted data, not instructions. Codex passes the JPEG as a `localImage`; Claude receives
the same bounded directory and explicit file names.

The transcript shows `1 CodeAI report attached` (with screenshot/error indicators) on the user message.
Retry re-adds that message's report ids to the pending attachments along with its text; because the
session's promoted copy is consulted first, the retry works after the inbox copy is pruned.

### Part C — The headset lists, attaches, and captures straight into the conversation

The immersive Session tools add a Reports view with the same ordered summaries, selection, refresh,
preview, and Attach/Remove actions. It is a controller-reachable world-space interaction; the hidden
DOM semantic controls mirror it. No essential report action exists only in the flat shell.

The report upload's response becomes `{ name, summary }`; `name` keeps Story 56's meaning and is the
report id. The deliberate capture records the selected machine/project/session at the moment the frame
is taken, not when Report was pressed. When that project is a self project and a session was selected,
the returned id is added to exactly that session's pending attachments, even if the user has since
moved on, and the status says `Report ready to send`. The conversation opens and focuses only when
that session is still the active one. Otherwise the capture is stored normally, the status says
`Report saved`, and it can be attached later from Reports.

Automatic error reports keep their fire-and-forget behavior: they are retained and listed but never
attached automatically.

### Concrete changes

Part A:

1. Add `installationRoot` to `src/server/config.ts` and one server-owned `resolveSelfProject` helper
   using host id, the primary binding, `CheckoutRegistry.resolve`, and `config.installationRoot`; use it
   in every report route. Set `CODEAI_INSTALLATION_ROOT` to a fixture checkout in
   `playwright.config.ts`.
2. Extend `src/shared/immersiveReport.ts` with the optional `context`, the id pattern, and the public
   summary. Extend `src/server/diagnostics/immersiveReports.ts` to list and read reports by id without
   exposing paths.
3. Add authorized list/detail/image routes under `src/app/api/immersive/reports/`.
4. Add the flat Reports side-panel tab.
5. Reword the Docker sentence in `docs/docker-execution.md`, and add **self project** and
   **installation** to `docs/vocabulary.md`.

Part B:

6. Add `reportAttachments` (defaulting to `[]` when absent) to `AgentMessageRequest`, add optional
   records to `UserMessage`, and introduce durable session version 5 while retaining strict v3/v4
   readers. Validate request ids and extend the duplicate-message comparison beside the existing
   canvas checks.
7. Add report promotion and per-run materialization to `src/server/storage/` and
   `conversationService.ts`; extend the prompt manifest and Codex image discovery to bounded JPEG files.
8. Add pending composer chips, the Attach/Remove actions, transcript summaries, Retry carrying report
   ids, and device-local pending report ids in `AppShell`/workspace state.

Part C:

9. Add the immersive Reports view/actions to `SessionTools` and pass the same shared owners through
   `ImmersiveBoundary`; do not create a second report store in XR components.
10. Return `{ name, summary }` from report uploads, send the capture-time `context`, and notify the
    shared shell owner after the delayed capture succeeds.

All parts:

11. Document the local-only data flow, the retention/promotion distinction, and the headset workflow
    in the README and architecture document; add `<dataDir>/attachments/` to the `src/server/storage/`
    row of the AGENTS.md ownership table.

### Type contract

```ts
// src/shared/immersiveReport.ts — the format stays version 1
interface ImmersiveReportContext {
  machineId?: string;
  projectId?: string;
  sessionId?: string;
}

interface ImmersiveReport {
  // existing version 1 fields remain
  context?: ImmersiveReportContext; // where it was captured; never an authorization input
}

/** The stored base name Story 56 already returns as `name`. */
const IMMERSIVE_REPORT_ID = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z-(capture|error)(-\d{1,2})?$/;

interface ImmersiveReportSummary {
  id: string;
  receivedAt: string; // parsed from the id
  kind: 'capture' | 'error';
  context?: ImmersiveReportContext;
  note?: string;
  errorCount: number;
  latestError?: string; // bounded
  screenshot: boolean;
}

type ImmersiveReportList =
  | { available: false }
  | { available: true; reports: ImmersiveReportSummary[]; skipped: number };

// POST /api/immersive/report
interface ImmersiveReportAccepted { name: string; summary: ImmersiveReportSummary } // name === summary.id

// src/shared/types.ts / src/shared/protocol.ts / src/shared/sessionSchema.ts
interface ReportAttachmentRequest { reportId: string }
interface ReportAttachmentRecord {
  reportId: string;
  receivedAt: string;
  kind: 'capture' | 'error';
  screenshotIncluded: boolean;
  errorCount: number;
}

interface AgentMessageRequest {
  // existing fields remain
  reportAttachments?: ReportAttachmentRequest[]; // protocol parser defaults absence to []
}

interface UserMessage {
  // optional because earlier messages inside a v5 session have no report evidence
  reportAttachments?: ReportAttachmentRecord[];
}
```

Report-bearing sessions use durable session version 5. The reader accepts versions 3, 4, and 5;
versions 3/4 keep their current strict message schema, while version 5 admits the optional attachment
records above. Existing sessions are not rewritten merely by being read. A version 3/4 session is
upgraded to version 5 only in the same locked mutation that first appends report evidence; a version 3
upgrade also materializes its implicit Local execution value. New sessions and unrelated mutations stay
at their existing version until report evidence requires the change.

This is a forward format change, like version 4. A build that includes Story 65 hides a version 5
session individually and keeps everything else open. A build older than Story 65 fails to open the
whole store when it meets one. That is why the upgrade is lazy, why Story 65 ships first, and why
Story 65's README note asks every checkout sharing a data directory to include it.

---

## Acceptance criteria

### Part A

- [x] A project is recognized as CodeAI only by local-host primary binding plus exact resolved-realpath
      equality with `config.installationRoot`; renaming the project does not change eligibility and a
      different checkout named `code-ai` is not eligible.
- [x] In an eligible project the flat Reports tab lists retained reports newest first, including ones
      captured in another project or with no context, shows where each was captured when that still
      resolves, and shows a screenshot preview when present.
- [x] The list, detail, and image routes are device-authorized and `private, no-store`, disclose no
      host path, re-check the self-project rule on every request, answer `{ available: false }` for any
      other project, and reject an id that does not match the pattern before touching the filesystem.
- [x] A malformed report file is skipped and counted rather than breaking the panel. Summary and error
      text are bounded.

### Part B

- [ ] A report can be attached from Reports, removed, and sent with typed/dictated text or by itself. A
      failed send preserves the draft and the selection; switching machine/project/session never
      retargets a pending id.
- [ ] The message route accepts only bounded report ids, resolves every file server-side, and rejects
      an unavailable, non-self-project, over-count, or over-ceiling report before reserving a run. A
      repeated message id is refused as today, and the comparison includes report ids.
- [ ] Sending promotes JSON and optional JPEG at `0600` before the message is appended. A simulated
      failure between copy and append leaves no message, starts no run, and the next send reuses the
      copy. A message never references missing evidence.
- [ ] The evidence survives diagnostic pruning, process restart, and session archive/restore. Retry
      re-attaches the message's reports and succeeds after the inbox copy is pruned.
- [ ] Codex receives each promoted JPEG as `localImage`; Claude receives the same named JSON, image,
      and manifest in its allowed context directory. The prompt treats all report content as untrusted
      observed evidence.
- [ ] The flat transcript states how many reports were attached and whether they contain a
      screenshot/errors.
- [ ] Mixed version 3/4/5 sessions load together; reads do not rewrite old records, and first
      attachment upgrades only its owning session to version 5 without changing prior content. A build
      with Story 65 but without this part hides that session and opens the rest.

### Part C

- [ ] The immersive Reports view lists, previews, refreshes, attaches, and removes through
      controller-reachable controls mirrored by the DOM semantic controls, using the shared owners.
- [ ] A deliberate capture made with a selected session in a self project becomes a removable pending
      attachment for the session selected at capture time, and focuses the conversation only when that
      session is still active. Captures made elsewhere and automatic errors are saved and listed but
      never attached automatically.
- [ ] The upload response carries `name` and `summary`; Story 56's criterion that the response names
      the stored file still holds. The immersive transcript states attached reports as the flat one does.

### All parts

- [ ] `npm run lint` and `npm test` pass; focused tests cover the id pattern, self-project identity,
      authorization, promotion and pruning, the duplicate-message comparison, both provider inputs, the
      limits, and old-session compatibility.
- [ ] `npm run test:e2e`, with `CODEAI_INSTALLATION_ROOT` naming a fixture checkout, covers the flat
      Reports tab, attach → explain → send, and in the emulated headset capture → auto-attach → send and
      later attach from the immersive Reports view.

## Out of scope

- Arbitrary filesystem attachments, pasted/uploaded desktop images, video, stereo capture, and system
  screenshots outside CodeAI's rendered immersive view. They can reuse the attachment presentation
  after a separate input/privacy story.
- Showing reports while a non-self project is selected, or attaching a report to a remote executor's
  session. Reports still reach the paired home machine as Story 56 specifies.
- Docker execution on CodeAI's own checkout, which Docker execution already refuses.
- Carrying canvas attachments through Retry; Retry gains report ids only.
- Editing a captured image, adding drawing marks to it, or turning reports into Mermaid artifacts.
- Third-party telemetry, report synchronization, issue-tracker upload, or cloud retention.
- User-driven deletion/export of promoted evidence. Inbox reports continue to use bounded automatic
  retention; promoted evidence follows its owning session up to the per-session ceiling.
- Rebuilding or restarting CodeAI. [Story 64](STORY-20260921-managed-self-rebuild.md) owns lifecycle.

## What shipped

Each part is its own commit, in order; the bullets below map to the parts.

- **Self project.** `config.installationRoot` is `CODEAI_INSTALLATION_ROOT` or the working directory
  ([config.ts](../src/server/config.ts#L186)); its real path is taken when compared, so a missing path
  never matches. [selfProject.ts](../src/server/repository/selfProject.ts#L12) requires a local-host
  primary binding whose `CheckoutRegistry.resolve` real path equals it.
- **Reports (A).** The id pattern and the summary are in
  [immersiveReport.ts](../src/shared/immersiveReport.ts#L19). Reads by id go through
  [immersiveReports.ts](../src/server/diagnostics/immersiveReports.ts#L44), which checks the id
  before building a path and bounds every read. The three routes share
  [reportAccess.ts](../src/server/diagnostics/reportAccess.ts#L20): id first (400), then the personal
  device, then the self-project rule. The list answers `{ available: false }` with 200; detail and
  image answer it with 404. The flat tab is
  [ReportsPanel.tsx](../src/features/reports/ReportsPanel.tsx), fed by the one owner
  [useImmersiveReports.ts](../src/features/reports/useImmersiveReports.ts); it needs an open
  session, like the rest of the side panel, and rereads the list when shown.

## How to verify

1. `npm run lint && npm test && npm run test:e2e`.
2. Part A: run CodeAI from its own checkout, select a project whose local primary repository is that
   exact checkout, and open Reports. Rename the project and confirm Reports remains; select a
   same-named copy at another path and confirm the tab is absent. Confirm a report captured while
   another project was open is listed and says where it came from.
3. Part B: attach a report, type an explanation, and Send. Confirm the chip and transcript summary,
   then inspect the fake and real-provider context manifests to see the JSON and JPEG. Create more than
   50 later inbox reports, restart CodeAI, archive/restore the session, and Retry the earlier message:
   the screenshot is still readable by the agent after its inbox source was pruned.
4. Part C: in Quest 3S, make a deliberate report, wait for the delayed capture, dictate “the panel at
   the right is clipped”, and Send. Make another report with no session selected, return to the self
   project, attach it from the immersive Reports view, and send it. Trigger an automatic error and
   confirm it is listed but not attached.
5. Repeat against a remote-machine session, a foreign project id, an id that is not a report name, and
   a malformed report file; none reaches a turn.
