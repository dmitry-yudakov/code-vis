# Story 145 — Attach repositories after creating a project

**Status:** Shipped · **Type:** Frontend-only · **Depends on:** [Story 141](STORY-20261115-project-workspace.md)

## Motivation

A project created in Arena without a repository cannot attach one later from Files or Changes.
The project workspace needs the repository management already available in conversations, as part
of the project body-of-work model in [the Arena vision](../docs/vision.md).

## Current behavior (where the code is)

- [AppShell.tsx:1225](../src/features/shell/AppShell.tsx#L1225) saves revisioned project bindings;
  the shared manager is supplied for project workspaces as well as sessions.
- [RepositoryManager.tsx:15](../src/features/repository/RepositoryManager.tsx#L15) already adds,
  removes, orders and selects session repositories.
- [route.ts:30](../src/app/api/projects/[projectId]/route.ts#L30) already accepts revision-checked
  project repository updates and validates discovered checkouts.

## Desired behavior and contracts

Reuse repository management in both project Files and Changes. Save project bindings through the
existing machine-addressed PATCH API. The first repository becomes primary and immediately enables
file/Git browsing; future sessions inherit the project list. Existing sessions keep their own list.
Keep selection and attachment controls concise and distinguish project from session repositories.

Prevent duplicate saves, retain a failed attachment choice with an inline error for retry, and
refresh the project after a revision conflict before the next explicit attempt. Capture the target
project/machine so delayed saves cannot replace the newly opened workspace's catalog. Preserve
Story 141's session-free URLs, navigation and independent workspace state. No new APIs, dependencies,
repository creation/cloning, automatic session rebinding, deployment or running-app restart.

## Acceptance criteria

- [x] Attach a first repository from either Files or Changes on a project created without one;
  browse files and Git changes immediately, persist across reload, and inherit it in a new session.
- [x] Manage existing project bindings and preserve session repository behavior.
- [x] Failed saves retain the chosen repository, prevent duplicates and allow retry; revision
  conflicts reload the project without overwriting concurrent changes.
- [x] Attached-machine saves/reads address the executor; delayed responses do not alter another
  project's workspace. Desktop/phone layouts work in light/dark themes.
- [x] Regression fails before implementation; focused unit/browser checks, TypeScript, isolated
  production build, screenshot inspection and independent review pass.

## How to verify

Run project route/store checks and the project-workspace/repository-panel browser suites against
an isolated production build. New browser cases exercise both attachment entry points, saved
bindings, file/status reads, reload/new-session inheritance, failure/retry, conflict, duplicate
saves and machine/navigation scoping. Record actual results and remaining limits below.

## Verification

Verified November 17, 2026:

- The new first-attachment browser regression failed against the preceding build because the
  project repository controls were absent.
- **97 focused unit checks** pass across project routes, session storage, repository file/status
  routes, workspace URLs and the machine gateway.
- **46 production-browser cases** pass across `project-workspace.spec.ts` and
  `repository-panel.spec.ts`, including 14 new cases. These cover both entry points in both themes
  at desktop/phone widths, real binding persistence and file reads, reload, new-session inheritance,
  existing-session independence, save failure/retry, duplicate prevention, rename/attachment
  conflicts, delayed-save navigation and executor save/read routing through fixtures.
- `npm run lint -- --incremental false`, the isolated production build in
  `.next-e2e/attach-project-repository`, `git diff --check`, and light/dark desktop/phone screenshot
  inspection pass. Next.js's temporary build-directory additions to `tsconfig.json` were removed.
- Independent review found a delayed save's selection callback could reset a different project's
  selected repository. The callback now checks that its manager remains mounted; the held-response
  regression passes, and follow-up review has no remaining material findings. Session edits retain
  their existing relative-mutation queue behavior.

An initial browser run had a test typo and an additional concurrent-attachment case needed its
alert locator scoped away from Next.js's route announcer; both are fixed in the final passing run.
Real attached-executor transport, real providers and physical devices were not exercised. No API,
persistence format or dependency changed. The running application was not rebuilt or restarted.
