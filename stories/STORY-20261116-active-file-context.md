# Story 144 — Give chat a removable active-file reference

**Status:** Shipped · **Type:** Full-stack · **Depends on:** Stories 131, 140, 141

## Motivation

When discussing an open project file, the user should not have to type its path. The agent needs
the file's identity and may read it if relevant; opening a file must not inject its contents.
This extends the repository/conversation workbench slice of the [Arena vision](../docs/vision.md).

## Where the code is

- `src/features/repository/RepositoryFilesProvider.tsx:38` owns scoped file navigation.
- `src/features/repository/repositoryFileTabs.ts:6` owns tab identity and canonical resolution.
- `src/features/conversation/InstructionComposer.tsx:292` renders removable evidence chips.
- `src/features/shell/AppShell.tsx:1796` captures a draft before asynchronous turn preparation.
- `src/app/api/agent/message/route.ts:45` validates and durably accepts message identities.
- `src/server/conversation/conversationService.ts:149` builds each provider attempt's prompt.
- `src/server/conversation/prompt.ts:67` frames request text separately from supporting data.

## Desired behavior and contracts

The composer shows a compact active-file chip (repository/path and source/diff) with Remove.
Removing excludes that tab until explicitly re-added; other tabs keep their own choice. Hiding
the file pane keeps the reference. Closing the tab selects its neighbour's reference. Unresolved
absolute links never become context. Project navigation into a conversation with no file workspace
seeds its active file once, only for matching bound repositories; later workspace changes stay
independent, preserving Story 141's return behavior.

Each ordinary Send captures at most one reference with its draft, before attachment export.
Execute plan/Continue do not inherit current file context. Retry restores the original reference.
Only checkout id, canonical repository-relative path and file/diff kind cross the wire. The server
checks session bindings and resolves any local secondary repository itself. Docker supports its
mounted primary repository only. Missing/removed files do not block a turn: the reference is a hint,
and the agent can report an unavailable read. No file contents are read or copied for this feature.

The hidden prompt presents JSON data and says to read only when relevant. Every turn explicitly
states its current reference or its absence, so resumed providers do not treat an old hint as current.
Request text remains unchanged. Session format 16 retains the reference for exact request comparison,
queueing, reload and cross-participant history; older records stay readable, unrelated sessions keep
their format, and subsequent metadata updates never lower the version. Existing delivery ownership,
attachment snapshots, retry guards, authorized transport and mode permissions remain unchanged.

Paths are bounded to 4,096 characters; checkout ids to 128. Reject absolute/traversing/.git paths,
backslashes, controls, unknown fields and repositories outside the session. Selected text, new file
read tools, VR context controls, deployment and restarting the running application are out of scope.

## Acceptance criteria

- [x] Active source/Markdown/diff references follow tabs with accessible removal/re-addition,
      neighbour selection, hidden-pane retention and project/session/machine isolation.
- [x] Send captures metadata only; the server validates bindings and delivers a conditional-read
      hint to the provider while preserving exact retry, persistence and queue behavior.
- [x] Context removal/absence replaces stale hints; explicit retry restores the original reference;
      session upgrades and later archive/context/title updates preserve valid records.
- [x] Focused unit/browser regressions, TypeScript, isolated production build, light/dark
      desktop/phone screenshot inspection and independent review pass.

## How to verify

Run focused file-tab, protocol/prompt, store, message-route and conversation tests. Exercise the
actual production browser send path and fake-provider invocation, removal/re-addition, navigation,
diffs, transport failures and attached-machine routing. Re-run affected existing file/project flows.
Use a separate build directory and test server; do not rebuild or restart the running application.

Verified November 16, 2026:

- All 191 focused unit checks pass across active-file context, file tabs, message scheduling,
  session storage/routes, inactivity and agent archiving, conversation history, turn history,
  participants, text evidence, file routes and machine routes. New schema/tab/prompt checks first
  failed before implementation. Coverage includes unsafe/oversized paths, unknown fields, binding
  validation, Docker scope, exact duplicate-versus-altered identity, queued-message edits and
  release, missing-file delivery, Local/Docker read paths, format upgrades and later metadata saves.
- All 40 production-browser cases pass across `active-file-context`, `local-file-links` and
  `project-workspace`. Ten new cases cover real authorized metadata-only fake-provider delivery,
  source/Markdown/diffs, per-tab exclusion/re-addition, hidden panes, failed preflight drafts,
  original-context Retry after reload, project-to-session seeding, fresh reads and independent
  viewers across two sessions, local secondary repositories and mocked executor gateway isolation.
  Existing cases preserve lazy files, canonical aliases, stale-read cancellation, project/session
  return, maximize and attached-project routing.
- `npm run lint`, `git diff --check`, and the isolated production build
  (`CODEAI_DIST_DIR=.next-e2e npm run build`) pass. Four light/dark desktop/phone context screenshots
  were inspected. The context chip remains within the viewport; removing it leaves the page's
  existing width unchanged. The previously recorded phone toolbar overflow remains outside this
  change.
- Independent review caught inherited tab ids reusing another workspace's mounted viewer. Fresh
  ids fix it; the project → two seeded sessions → return browser regression passes. Re-review
  reports no remaining material findings.
- The full offline suite with deployment environment variables removed reports 2,223 passing
  checks and one unrelated existing failure out of 2,224: `test/visualLanguage.test.ts` still
  expects `next/font/google` although Story 139 switched to bundled fonts. Both that test and
  `src/app/layout.tsx` are unchanged from HEAD. The subsequently added Docker binding regression
  also passes in the final focused run. Initial broad runs additionally encountered deployment
  settings and sandbox-only `/var/tmp` restrictions; isolated settings and the normal local test
  permissions resolved those without changing configuration or unrelated code.

Selected text, session-setup/quick-reply context, real provider decisions to read a file, physical
phone use and real attached-executor transport remain unverified or out of scope. Removing a hint
does not erase earlier provider knowledge. File tabs/exclusions remain device-memory state; format
16 persists only sent references. No dependencies, staging, commits, deployment, or running-app
rebuild/restart.
