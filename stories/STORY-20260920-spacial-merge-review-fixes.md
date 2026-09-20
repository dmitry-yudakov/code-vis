# Story 61 — Repair the defects left by merging Docker execution into the VR branch

**Status:** In progress (every box ticked; the real-daemon Docker turn in How to verify is not yet run) · **Type:** Full-stack · **Depends on:** [Story 57](STORY-20260908-local-docker-execution.md), [Story 48](STORY-20260905-vr-session-permissions.md), [Story 52](STORY-20260905-vr-arena-inbox.md)

---

## Motivation

A review of `feat/spacial` before merging found every automated gate green and the branch still
not mergeable. Merge `9930ba2` joined two branches with opposite assumptions: the VR side assumed
"this checkout has no Docker runtime, reject Docker sessions and preserve them", the Docker side
assumed "this checkout runs Docker". Git merged both without a conflict, and a test pins the
contradiction in place. Separately, the VR permission review can hide the command being approved,
and several per-frame and per-token paths exceed a Quest frame budget.

---

## Current behavior (where the code is)

- Leftover guard: [route.ts](../src/app/api/agent/message/route.ts#L48) (~line 48) returns 409 for
  every `execution === 'docker'` session, so the Docker path at ~line 120 is unreachable.
  [sessionRoutes.test.ts](../test/sessionRoutes.test.ts#L202) (~line 202) asserts the rejection.
- Scheduler key: [route.ts](../src/app/api/agent/message/route.ts#L141) (~line 141) interpolates
  `session.execution`, which is absent on version 3 records, producing a literal `undefined`.
- Worker lifetime: [dockerRuntime.ts](../src/server/execution/dockerRuntime.ts#L330) (~line 330)
  starts the worker as `sleep infinity`; nothing stops it when the CodeAI process exits.
- Recovery: [dockerRecovery.ts](../src/server/execution/dockerRecovery.ts#L9) (~line 9) reconciles
  once per process; [scripts/docker.ts](../scripts/docker.ts) never reconciles.
- Git reads: [gitRead.ts](../src/server/repository/gitRead.ts#L45) (~line 45) isolates reads when
  Docker is merely enabled, before a profile exists.
- Provisioning: [dockerRuntime.ts](../src/server/execution/dockerRuntime.ts#L380) (~line 380) writes
  `profile.json` with `wx`, so a changed engine cannot be re-provisioned.
- VR permission review: [SessionTools.tsx](../src/features/shell/immersive/SessionTools.tsx#L47)
  (~line 47) resets the page whenever the permissions array identity changes, which is every
  Arena poll ([useArena.ts](../src/features/arena/useArena.ts#L11), 2 s).
- VR transcript: [conversationHistoryModel.ts](../src/features/shell/immersive/conversationHistoryModel.ts#L23)
  (~line 23) re-wraps every message on every streaming delta.
- VR scroll: [useImmersiveScroll.ts](../src/features/shell/immersive/useImmersiveScroll.ts#L48)
  (~line 48) drives React state each XR frame up to `ImmersiveBoundary`.
- VR canvas: [CanvasReviewTools.tsx](../src/features/shell/immersive/CanvasReviewTools.tsx#L202)
  (~line 202) restarts the texture pipeline on every `session` identity change.
- VR textures: [useTextureResource.ts](../src/features/shell/immersive/useTextureResource.ts#L6)
  (~line 6) disposes a ledger before its replacement commits.

---

## Desired behavior

### Concrete changes

1. A Docker session's turn reaches the Docker provider adapter; the leftover guard and the test
   that pins it are gone, and a route test sends a Docker turn.
2. An absent `execution` is read as Local everywhere, including the scheduler key. Version 3
   records still load without being rewritten; no stored record changes.
3. A Docker worker cannot outlive its turn indefinitely: PID 1 has a bounded lifetime, and a
   best-effort shutdown hook stops owned workers when the CodeAI process exits.
4. Interrupted CLI setup or cleanup no longer blocks a provider until the server restarts.
5. Before provisioning, Local Git reads use host Git even when Docker is enabled.
6. A changed Docker engine has a documented, working recovery path.
7. The VR permission review keeps the page, request, and tab the user chose while the same
   request stays pending.
8. Streaming a token wraps only the streaming preview; scrolling does not re-render the workspace
   tree each frame; a VR stroke does not blank the canvas; replaced textures are disposed once.

---

## Acceptance criteria

- [x] A Docker session turn sent through `/api/agent/message` reaches the Docker adapter, covered
      by a route test that fails with the guard present.
- [x] No scheduler key contains `undefined`; a version 3 session keys identically to a Local one.
- [x] The worker's PID 1 exits after the turn timeout plus a grace period, covered by a test on the
      created container's arguments.
- [x] Process exit stops owned workers on a best-effort basis without delaying shutdown.
- [x] A stale setup or cleanup container whose owner process is dead is cleared without restarting
      the server.
- [x] With Docker enabled and no `profile.json`, status and diff reads succeed through host Git,
      covered by a test.
- [x] A changed engine identity can be recovered by a documented command, not a hand-deleted file.
- [x] In VR, paging a permission reached through Inbox → Inspect survives an Arena poll, covered
      by a test that asserts on the visible page.
- [x] A streaming delta re-wraps only the preview entry, covered by a test.
- [x] Thumbstick scrolling updates `ImmersiveBoundary` only when its derived flags change.
- [x] A VR stroke does not clear canvas resources when the rendered target is unchanged.
- [x] A replaced texture resource is disposed exactly once and never while still bound.
- [x] `npm run lint`, `npm test`, and `npm run test:e2e` pass.

## Out of scope

- Physical Quest 3S and real Docker daemon verification (owned by Stories 51 and 57).
- The inherited `next` advisory and ungated `/_next/image`; they predate this branch.
- Retry after a failed permission decision and the non-resetting `RendererBoundary`.
- The desktop Spatial room still re-rasterizes every panel when the active panel changes.
  `activeId` there is not only a highlight: it exempts the active panel from the aggregate texel
  downscale, lifts a small active panel to the legibility floor, and is baked into the frame
  material, so dropping it from the dependencies would change desktop texture allocation. The
  render cache below still spares those panels a Mermaid render.
- Signal handlers for `start:remote` and `next dev`. Installing one removes Node's default exit,
  which is where signal-swallowing risk lives; the bounded worker lifetime is the guarantee.
- Unit tests pin the pure decisions, not every effect's wiring; there is no effect-running
  renderer in the Vitest setup. The permission review and the canvas pipeline are pinned end to
  end in Playwright. The texture retire/flush hook, the `WorldButton` layout effect, and the Flat
  marks report are not: reverting their wiring alone would leave the unit suite green.
- A theoretical race in the Flat marks report: an undo landing in the few milliseconds between a
  reported edit and the render that carries it back is skipped, and the edit is then restored. It
  needs two discrete inputs inside one scheduler gap, fails toward keeping a mark, and costs one
  repeated undo.
- Quantizing the conversation's local scroll offset to line steps. Painting uses a continuous
  offset, so that would turn smooth thumbstick scrolling into line-height jumps.

## How to verify

`npm run lint && npm test && npm run test:e2e`. Then, with Docker provisioned, create a Docker
session in the Arena and send one Ask turn; it must stream a response instead of returning 409.

## What shipped

- Docker turns: the guard is deleted and `execution ?? 'local'` feeds both the adapter lookup and
  the scheduler key ([route.ts](../src/app/api/agent/message/route.ts#L122)). No schema,
  migration, or stored record changed.
- Worker lifetime: PID 1 is `sleep <turn timeout + 600 s>` (ask/plan 1,500 s, agent 4,200 s) and an
  owner login is bounded at 3,600 s ([dockerRuntime.ts](../src/server/execution/dockerRuntime.ts#L296)).
  An `exit` listener removes still-active workers through a detached `docker rm`
  ([dockerCommand.ts](../src/server/execution/dockerCommand.ts#L45)). It runs when `next start`
  exits on SIGINT/SIGTERM; it cannot run after SIGKILL or for `start:remote`, which installs no
  handler. Leases are kept so the next start still records the interrupted delivery.
- Dead terminals: `removeDeadTerminals` clears setup/cleanup remains whose recorded owner PID is
  dead, at the admission conflict and at lease creation, never a live one
  ([dockerRuntime.ts](../src/server/execution/dockerRuntime.ts#L196)).
- Host Git before provisioning: only `profile.json` decides isolation
  ([gitRead.ts](../src/server/repository/gitRead.ts#L45)).
- Engine replacement: `npm run docker:provision -- --replace-engine` adopts a different engine and
  refuses an unchanged one; every engine-identity check stays. Documented in
  [docker-execution.md](../docs/docker-execution.md). The turn route and `/api/health` share one
  actionable recovery message ([dockerRecovery.ts](../src/server/execution/dockerRecovery.ts)).
- VR permission review: a routed request applies once per key
  ([sessionControls.ts](../src/features/shell/immersive/sessionControls.ts#L17)).
- VR cost: wrapped lines are cached per settled message; the DOM chrome receives three derived
  scroll flags; the canvas pipeline restarts on a render key, not on object identity
  ([canvasReviewModel.ts](../src/features/shell/immersive/canvasReviewModel.ts#L8)); Mermaid renders
  are cached by source before any await; a Flat canvas no longer reports adopted marks back
  ([DiagramCanvas.tsx](../src/features/diagram/components/DiagramCanvas.tsx#L29)), so one VR stroke
  saves once instead of about four times.
- GPU lifetime: a replaced ledger is retired (accounting released at once, so the replacement fits
  the texel budget) and its GPU objects are disposed only after the commit that binds the
  replacement ([resourceLedger.ts](../src/features/diagram/spatial/resourceLedger.ts#L202)). Ordering
  follows React commits rather than timers, because `requestAnimationFrame` pauses in a headset.
  The cost is a real GPU peak of budget plus one generation: one commit for a text or button
  surface, but the whole asynchronous raster for the canvas pipeline (about 1.07 MP with mipmaps),
  because the shown canvas stays bound until its replacement is ready. Logical accounting is
  released at retire time, so `peakLogicalTexturePixels` under-reports that peak; read
  `gl.info.memory.textures` when recording Quest numbers.
- A canvas that failed follows the session again: a failed raster or an over-budget omission
  leaves a dead panel that takes no pointer input, and the old effect retried it only by accident
  on every session change. `canvasCanHeal`
  ([canvasReviewModel.ts](../src/features/shell/immersive/canvasReviewModel.ts)) restores that
  retry for exactly that state; a shown canvas still never restarts.

## Verification record

| Evidence | Result |
|---|---|
| The permission e2e assertion fails without the fix | Proven: with the original `SessionTools.tsx` restored, the test fails at the visible-page assertion after one Arena poll; the old fixture wrapped to exactly one page, so it could never have seen the defect |
| The canvas e2e probe fails against the old wiring | Proven: with the original `CanvasReviewTools.tsx` restored, a per-frame probe finds the active canvas missing from the scene after a stroke; with the fix it never is |
| Each unit test was seen failing first | Reported by the implementing agents with the failing assertion for every fix |
| `npm run lint`, `npm test`, `npm run test:e2e` | Pass on September 20, 2026: strict TypeScript clean, 75 files / 468 Vitest tests, 76 Chrome tests |
| Real Docker daemon | Not run. No container was started; the orphan-write scenario and `--replace-engine` are covered by unit tests against a mocked Docker CLI only |
| Quest 3S | Not run. Frame-cost and texture-lifetime changes are covered by unit tests and the browser e2e suite, not measured on a headset |
