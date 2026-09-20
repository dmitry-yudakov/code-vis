# Story 58 — Enable Docker execution from Arena

**Status:** Shipped · **Type:** Full-stack · **Depends on:**
[Story 57](STORY-20260908-local-docker-execution.md) (release verification in progress).

## Motivation

Docker's session selector is hidden until an environment variable is set and CodeAI restarts.
The owner should be able to enable this machine's Docker execution from the UI. This extends
the optional local execution slice of [the arena vision](../docs/vision.md#the-cloud-chapter);
it does not change Story 57's container profile or release requirements.

## Implementation (where the code is)

- `src/server/config.ts:110` and `src/server/execution/dockerSettings.ts:10`: saved enablement
  overrides the environment default on each config read; malformed records disable Docker.
- `src/app/api/execution/docker/route.ts:12`: strict, device-authorized, same-origin mutation
  atomically saves the boolean and returns Docker capability health.
- `src/app/api/health/route.ts:13`: health reports enabled state and provider readiness per execution.
- `src/features/arena/Arena.tsx:172`: persistent toggle, readiness, setup guidance and failure feedback.
- `src/features/shell/AppShell.tsx:296`: saves settings and refreshes shared machine health.
- `src/server/execution/dockerRuntime.ts:40`: runtime readiness gates Docker execution.
- `test/dockerSettings.test.ts:1` and `e2e/docker-execution.spec.ts:1`: persistence, precedence,
  authorization, failure handling, readiness refresh and Local-default regression coverage.

## Desired behavior

1. Arena always exposes Docker's enabled state and an Enable Docker checkbox. Saving updates
   the machine immediately and survives browser reloads and application restarts.
2. Store only `{ enabled: boolean }` in `<CODEAI_DATA_DIR>/docker/settings.json`, using an atomic
   private write. A saved choice overrides `CODEAI_DOCKER_ENABLED` and its legacy alias; absent
   settings use the existing environment/default behavior. Malformed or unreadable saved settings
   disable Docker rather than implicitly enabling it through the environment.
3. A device-authorized, same-origin PATCH accepts only the boolean. The browser cannot choose
   images, mounts, networking, credentials or provider flags. Enabling does not provision or log in.
4. Distinguish Off, Setup needed and Ready. Explain terminal provisioning when enabled but
   unavailable, and allow health refresh after setup. Local remains the new-session default.
5. Disable blocks subsequent Docker session/turn requests; already accepted running or queued
   turns retain their configuration. Existing session execution and protected Git reads stay fixed.
6. Show saving/failure feedback. Health and session creation use the saved server setting, with
   no restart and no silent Local fallback. Disabling clears Docker selection in the creation form.

## Acceptance criteria

- [x] Arena exposes a persistent toggle, accurate readiness, setup guidance and refresh.
- [x] The strict authorized API persists a private boolean, honors precedence and fails closed
      on invalid saved settings; all new config reads observe changes without restart.
- [x] Local stays the creation default; disabling clears Docker selection and subsequent Docker
      requests remain gated. Save failures are visible and preserve the displayed saved state.
- [x] Setup documentation describes UI enablement, environment fallback and accepted-turn behavior.
- [x] Focused server tests, Docker browser flows, TypeScript and production build pass.

## Out of scope

Docker installation/provisioning or provider login in the browser, custom runtime settings,
changing existing session execution, or clearing Story 57's real-provider/platform release matrix.

## How to verify

Run `npm test -- test/dockerSettings.test.ts test/dockerExecution.test.ts test/dockerRuntime.test.ts test/deviceAuthRoutes.test.ts`,
`npm run lint`, and `npm run test:e2e -- e2e/docker-execution.spec.ts` (includes a production build).
In Arena, enable Docker, reload, inspect setup guidance, refresh health, and disable it again.
With Docker selected for a new session, disabling must restore Local. Simulate a failed save and
confirm the control reports the error without claiming the setting changed.

Verified September 9, 2026: offline suite, focused settings/device route checks, TypeScript,
production build and all four Docker browser flows pass. The browser run uses the actual settings
API for persistence and disables Docker afterward; readiness transitions and save failures also
have browser fixtures. The setup panel was visually inspected. Story 57's actual Docker and
signed-in provider release matrix remains in progress.

September 20, 2026 — scope of that evidence, recorded after a pre-merge review. The Docker browser
flows cover settings, session creation, and continuation; none sends a turn in a Docker session.
That is how a guard merged from the VR branch could reject every Docker turn with 409 while these
flows stayed green. [Story 61](STORY-20260920-spacial-merge-review-fixes.md) removes the guard and
adds a route test that sends a Docker turn. A real-daemon turn remains in Story 57's release matrix.
