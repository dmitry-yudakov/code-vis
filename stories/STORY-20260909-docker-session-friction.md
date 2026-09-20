# Story 59 — Start and continue Docker sessions without repeated setup

**Status:** Shipped · **Type:** Full-stack · **Depends on:**
[Story 57](STORY-20260908-local-docker-execution.md),
[Story 58](STORY-20260909-docker-ui-enablement.md).

## Motivation

The owner wants minimal friction now, with optional isolation levels deferred. Project session
creation currently silently selects Local, Docker login is repeated per participant, and changing
execution requires manually rebuilding context. This extends the local execution slice of
[the arena vision](../docs/vision.md#the-cloud-chapter).

## Implementation (where the code is)

- `src/server/execution/dockerRuntime.ts:98`: home admission/setup exclusion and legacy cleanup;
  `dockerRuntime.ts:232`: shared home selection, legacy reuse, ownership and login checks.
- `src/server/execution/dockerProfile.ts:43`: stable provider volume identity.
- `scripts/docker.ts:20`: provider-name login before session creation and legacy ID compatibility.
- `src/features/conversation/SessionPicker.tsx:23`: creation form shared by project picker and empty state.
- `src/features/conversation/ConversationDrawer.tsx:69`: distinct execution badge and continuation action.
- `src/features/shell/AppShell.tsx:448`: creates sessions and initializes the new view's composer;
  `AppShell.tsx:491`: bounded recap and original draft preservation.
- `src/features/arena/Arena.tsx:200`: one-time provider login guidance.
- `src/app/api/sessions/route.ts:43` and `src/server/storage/sessionStore.ts:477`: source binding
  validation and revision-checked creation with fresh native provider identity.
- `test/sessionContinuation.test.ts:1`, `test/dockerRuntime.test.ts:1`, `test/dockerCli.test.ts:1`,
  `e2e/docker-execution.spec.ts:171`, and `scripts/test-docker.ts:1`: admission, storage and UI checks.

## Desired behavior

1. New Docker participants share one persistent Docker provider home per CodeAI installation and
   provider. `npm run docker:login -- claude` / `codex` signs in once, without creating a session
   first. Linux binaries remain pinned in the worker image. Host provider folders are not mounted.
2. Existing participant volumes remain usable in place, preserving native history and credentials
   without inspecting or copying provider files. Existing ID-based login and cleanup remain useful
   for those legacy homes. Never delete shared storage through participant cleanup.
3. Login/cleanup must exclude turns using the affected home, including cross-process admission.
   Ordinary independent conversations can still run concurrently. Container cleanup retains homes.
4. The project New session flow and empty project screen offer execution selection and use provider
   readiness for the selected execution. Preserve the current project, allow direct repository
   selection for loose Docker sessions, and explain unavailable Docker with actionable setup.
   New sessions opened from a conversation initially select its execution when enabled.
5. Display a distinct persistent Local/Docker indicator in the conversation. Offer Continue in
   Docker/Local when the target supports the provider and repository. Create a fresh provider
   session with the source session's project and repository bindings, and a bounded visible recap
   in the composer; never send automatically or mutate the source execution/history.
6. Arena explains one-time provider login with short commands and shared Docker provider storage.
   Avoid an isolation-level picker or additional runtime settings in this iteration.

## Acceptance criteria

- [x] New participants reuse provider storage across sessions/restarts; providers/installations stay
      separate, existing participant homes retain ownership checks and native history.
- [x] Provider-name login works before session creation; setup and cleanup cannot overlap affected
      turns or delete active/shared storage through the legacy participant cleanup path.
- [x] Project and empty-state creation expose Local/Docker with correct readiness, binding validation,
      failure feedback and explicit creation options.
- [x] Conversation execution is distinct and continuation opens a new session with the exact source
      bindings and an editable recap, with no automatic turn or source mutation.
- [x] Setup/architecture docs and affected story contracts describe the simplified storage scope.
- [x] Focused server tests, TypeScript, production build, and Docker browser flows pass. Any real
      Docker/provider verification limits are recorded honestly; Story 57's release gates remain.

## Out of scope

Host credential import, host binary mounting, selectable isolation levels, native provider-history
migration between environments, and automatic execution of a continuation prompt.

## How to verify

Run focused Docker/session tests, `npm run lint`, and
`npm run test:e2e -- e2e/docker-execution.spec.ts` (includes production build). Exercise creation in
a project without a host provider, execution badges, both continuation directions, failed creation,
and disabled/unavailable Docker. Use disposable storage for real Docker persistence/setup exclusion
checks; never inspect provider credentials. Keep Story 57's signed-in release matrix separate.

Verified September 9, 2026: all 287 offline tests in 42 files, strict TypeScript, production build,
and all seven Docker browser flows pass. The real `npm run test:docker` suite passes on Linux
Engine 28.5.2 with synthetic provider state, including shared-home reuse, setup exclusion and
restart recovery. See [the experiment log](../docs/experiment-log.md) for image/platform evidence.
The existing offline Git suites now use disposable data directories rather than inheriting the
owner's Docker profile. Stale generated Next route types were refreshed using `npx next typegen`.
Actual signed-in provider login/inference and macOS verification of this storage change remain
in Story 57's release matrix; this story does not claim those checks passed.

September 20, 2026 — scope of that evidence, recorded after a pre-merge review. The Docker browser
flows cover settings, session creation, and continuation; none sends a turn in a Docker session.
That is how a guard merged from the VR branch could reject every Docker turn with 409 while these
flows stayed green. [Story 61](STORY-20260920-spacial-merge-review-fixes.md) removes the guard and
adds a route test that sends a Docker turn. A real-daemon turn remains in Story 57's release matrix.
