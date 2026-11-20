# Story 127 — Create projects and project sessions from Arena

**Status:** Shipped · **Type:** Frontend-only · **Depends on:** [Story 97](STORY-20261007-compose-new-session.md)

## Motivation

Arena hides the project picker, leaving no way to create a project there. Starting another session
for a visible project requires opening general setup and finding that project again. This completes
the project/session entry points in [the Arena vision](../docs/vision.md#the-arena).

## Current behavior (where the code is)

- [Arena.tsx:73](../src/features/arena/Arena.tsx#L73) exposes only general New session and groups
  projects that have sessions.
- [arenaModel.ts:102](../src/features/arena/arenaModel.ts#L102) owns attention/recency grouping,
  also used by archive and immersive views.
- [AppShell.tsx:894](../src/features/shell/AppShell.tsx#L894) creates an empty project from the
  conversation's project picker and selects it.
- [useSessionLauncher.ts:84](../src/features/session-launch/useSessionLauncher.ts#L84) opens
  a retained setup draft or chooses defaults from the current workspace.
- [projects/route.ts:23](../src/app/api/projects/route.ts#L23) already creates named projects
  with optional discovered checkout bindings; attached machines use the existing gateway.
- [NewProjectDialog.tsx:13](../src/features/projects/NewProjectDialog.tsx#L13) now owns the Arena
  form, target selection, submission guard, and inline failure recovery.

## Desired behavior

Arena's header has New project. Its compact modal asks for a name, the target machine, and an
optional existing repository. Creating keeps Arena open and displays the project, including when
it has no active sessions; creating from Inbox or Archived reveals it in Active. Each known project
heading in Active has New session opening existing session
setup with the exact machine/project selected. No project also has a shortcut when it has sessions.

The project picker keeps its current selection behavior. Archive and immersive grouping keep
their existing session-only behavior. Existing attention/recency ordering stays ahead of empty
projects. Offline machines cannot create projects or launch sessions.

The shell owns project creation and machine routing; the modal owns its form and inline errors.
Failure retains the form for retry, submission is guarded against duplicates, and controls lock
while pending. A shortcut cannot silently replace a pending setup draft or its frozen creation
identity: reopen it with a concise explanation if its target differs. All existing Story 97
creation, evidence, background launch, and recovery behavior continues through the shared launcher.

## Acceptance criteria

- [x] Create a named project from Arena with or without a repository, keep Arena open, and retain
  the project after reload even with no sessions.
- [x] Each known project opens session setup on its own machine/project, and an empty submission
  successfully opens a session with the project's repository bindings.
- [x] Empty projects follow session groups; attention ordering and archive/immersive behavior hold.
- [x] Offline targets are disabled, switching machine clears the repository choice, errors retain
  input, and duplicate submission is guarded.
- [x] Project shortcuts preserve pending drafts and frozen creation attempts with visible feedback.
- [x] Keyboard focus, Escape/Cancel, long names, narrow layouts, and both themes remain usable.
- [x] Focused unit/browser checks, TypeScript, isolated production build, and independent review pass.

## Out of scope

Filesystem repository creation/cloning, new immersive controls, and running-installation restart
or deployment. Project deletion/renaming were added in the November 20 follow-up below.

## How to verify

Run Arena model/project route/session-launch unit checks, TypeScript, and an isolated production
build. Browser checks create projects with/without repositories, reload, create and open sessions
through project headings, preserve a pending draft, exercise failure/retry and offline/attached
machine routing, and inspect desktop/phone screenshots in light/dark themes. Record checks actually
run and any limits below. The missing New project/project shortcuts must fail before implementation.

## Implementation and verification

November 4, 2026: implemented with the existing project API, same-origin machine routing, shared
session launcher, and MUI controls. No server API, persistence format, or dependency changed.

- The new empty-project unit regression failed before implementation. The production browser
  regression also failed on the missing New project button against the prior build.
- **46 focused unit checks pass** across Arena presentation/routes, project routes, session launch,
  immersive Arena, multi-machine Arena, machine gateway, and device preferences.
- `npm run lint -- --incremental false`, `CODEAI_DIST_DIR=.next-e2e npm run build`, and
  `git diff --check` pass.
- **41 distinct production browser cases pass** across `arena-projects.spec.ts`,
  `arena-inbox.spec.ts`, and `session-setup.spec.ts`. The initial run passed 35 cases; all five
  failures and one added picker regression pass after correcting test locators. Phone navigation
  now uses More, completed-session recovery targets its project instead of a title that can change,
  and the frozen-target notice assertion distinguishes unrelated status text.
- New checks cover real project/session persistence with optional repository bindings and reload,
  empty projects, scoped setup, repository-free creation, retry and duplicate guards, Cancel/Escape
  and focus return, source picker compatibility, Inbox/Archived creation, retained drafts, and frozen
  creation UUID/error recovery. Attached-machine routing and offline transitions use browser fixtures.
- Desktop/phone screenshots in light and dark themes were inspected. New header actions wrap,
  long project names retain their session action, and the compact modal retains visible controls.
- Independent review found recovery-error replacement and creation feedback outside Active; both
  were corrected and covered by browser regressions. Follow-up review reports no material findings.

The running installation was not restarted. Real attached-executor transport, real-provider turns,
and physical phone/Quest checks were not run; the creation UI uses the already-tested API/launcher.

## November 20 follow-up — Manage existing projects

**Status:** Shipped

An accidentally duplicated project needs an obvious removal action, and project names need to be
editable from Arena. This follows the project-management slice of the Arena vision and preserves
Story 35's existing record contracts.

### Where the code is

- `src/features/arena/Arena.tsx:269` — project headings currently expose session creation only.
- `src/features/projects/ProjectPicker.tsx:69` — rename/delete use native prompt/confirm dialogs.
- `src/features/shell/AppShell.tsx:1287` — existing mutations are scoped to the selected workspace.
- `src/server/storage/sessionStore.ts:444` — deletion detaches active and archived sessions,
  preserving their repositories, transcript, and canvases; revision conflicts prevent stale writes.

### Acceptance criteria

- [x] Arena project headings expose Rename and Delete through an accessible project menu in List,
  Tiles, and phone layouts, including empty projects; offline machines disable management.
- [x] Arena and the workspace picker share named rename/delete dialogs with pending guards,
  retained input and inline retryable errors. Blank/unchanged names cannot submit; names retain
  the existing 200-character bound. Escape/Cancel return focus and do not mutate records.
- [x] Deletion explains that repository files remain and conversations move to No project.
  Duplicate projects can be removed independently, retaining active/archived conversations and
  their repository bindings. The focused conversation and its draft survive project removal.
  Deletion waits for active conversations, pending delivery and delivery recovery to finish.
- [x] Mutations address the owning machine, refresh the catalog, and preserve newer navigation.
  Conflicts refresh the dialog's revision without discarding the rename draft; an already removed
  project can finish deletion recovery after a lost response.
- [x] Focused regression checks, TypeScript, isolated production build, both-theme desktop/phone
  screenshot inspection, and independent review pass.

### How to verify

Use production-browser journeys for discovery, persistence/reload, duplicate removal, cancel,
failure/retry, conflicts, pending guards, current-session continuity, attached-machine routing,
offline transitions and List/Tiles/phone layout. Run existing project/store/workspace/gateway
unit checks. Record actual checks and limits here. No repository deletion, project merge/move UI,
new immersive controls, or running-installation rebuild/restart is included.


### Implementation and verification

November 20, 2026: Arena now exposes a MUI project menu in List, Tiles and phone layouts. The
workspace picker opens the same rename/delete dialogs instead of native prompt/confirm. The shell
routes mutations to the project's owning machine and refreshes Arena; conflict recovery updates
only the target revision and keeps the entered name. Delete recovery accepts the project API's
explicit Unknown project response, retaining errors from a detached executor. Deletion waits for
active conversations and pending/uncertain delivery so acknowledgement cannot clear a draft in
its former project scope after migration. Removing the focused project re-resolves the same
conversation under No project, retaining its draft and URL; an empty workspace returns to No project.

- The initial production-browser regression failed on the missing Arena project-actions button
  against the preceding build before implementation.
- **104 focused unit checks pass** across project routes/logo, session store/summaries, workspace
  views, Arena model/subscriptions and the machine gateway.
- **All 15 new production-browser cases pass** in `e2e/project-management.spec.ts`. Coverage includes
  both themes on desktop/phone, keyboard focus/Cancel/Escape, blank/unchanged names, reload,
  duplicate project removal, active/archived session and repository preservation, focused-session
  draft continuity, pending guards, explicit retry, stale revisions, lost DELETE response,
  preservation of newer navigation, executor routing and gateway errors, offline transitions,
  and two delayed-message-acceptance cases with/without a newer draft.
- **51 of 53 existing production-browser cases pass** across Arena projects/tiles, project workspace
  and project logos. The two phone-width logo cases complete their functional assertions and fail
  the existing body-overflow assertion at `e2e/project-logo.spec.ts:68`; both failures reproduce
  against the preceding `.next-e2e` production build with separate fixture data. This is the same
  phone session-toolbar overflow previously recorded for Story 141.
- `npm run lint -- --incremental false`, the normal isolated production build with
  `CODEAI_DIST_DIR=.next-e2e/project-management`, and `git diff --check` pass.
- Light/dark desktop/phone screenshots were inspected; long names wrap without hiding the project
  actions or dialog buttons. Independent review identified pending-send and executor-404 recovery
  issues; both were fixed and covered by browser regressions. Follow-up review has no material findings.

The running installation was not rebuilt or restarted. Tests use isolated fixture data and fake
providers; real attached-executor transport, real-provider turns, and physical phone/Quest use
were not run. No dependency, API, persistence format or repository filesystem behavior changed.
