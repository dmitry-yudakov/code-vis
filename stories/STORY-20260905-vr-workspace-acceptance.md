# Story 51 — Accept a complete work session on Quest 3S

**Status:** In progress · **Type:** Frontend-only (integration, fixes, and verification) · **Depends on:**
[Stories 45–50](EPIC-20260905-immersive-workspace.md#story-map).

**Vision slice:** first usable release of the
[immersive workspace epic](EPIC-20260905-immersive-workspace.md): one complete session with movable
panels, real 3D diagrams, controllers, and voice. The multi-session Arena follows in Story 52.

## Motivation

Story 44's injected XR adapter proves program behavior but cannot prove that a person can read,
dictate, correct, approve, draw, or work comfortably in a headset. Acceptance must exercise those
actions on the user's Quest 3S with the final scene, rather than extrapolating from desktop or Quest 3.

## Current behavior (where the code is)

- [e2e/canvas.spec.ts:411](../e2e/canvas.spec.ts#L411) tests the current viewer through an injected
  adapter and DOM semantic controls; it does not emulate optics or real controller/text input.
- [resourceLedger.ts](../src/features/diagram/spatial/resourceLedger.ts) records whole-session XR
  frame percentiles and exact application-resource peaks;
  [immersiveDiagnostics.ts](../src/features/shell/immersive/immersiveDiagnostics.ts) retains the
  30-minute run, sampled renderer peaks, and a post-exit baseline on the device.
- [Story 44's verification record](STORY-20260904-immersive-webxr-workspace.md#verification-record)
  has automated results and a pending Quest 3 manual run, not full-workspace usability evidence.

## Desired behavior

1. Maintain a repeatable fixture: one project with a test checkout, a repository-free session,
   conversation longer than twelve entries with code, two diagram revisions, a sketch, staged and
   unstaged diffs, and Story 50's small/large spatial flowcharts. Fake agents produce streaming,
   queued, permission, failure, and completion states deterministically.
2. Complete the entire single-session journey below on Quest 3S using controllers and voice with
   no physical keyboard required. If a physical keyboard path is implemented, test it separately
   as an optional convenience. Neither hand tracking nor a virtual keyboard gates this release.
3. Use the final combined scene for a 30-minute seated work run. Record readability, controller
   target errors, voice corrections, lost focus/panels, discomfort, and every forced exit or need
   for another device. Any essential task that requires leaving immersive VR fails the journey.
4. Record headset/OS/browser, home-machine/transcription setup, refresh rate, scene fixture,
   median/p95 frame intervals, dropped-frame observations, peak textures/geometry/text resources,
   and baseline after teardown. At a selected refresh rate R of at least 72 Hz, target median
   interval <= 1,000/R ms and p95 <= 1.5 times that interval after warm-up. These are proposed
   acceptance budgets, not measured results. Resource ceilings must be documented by Stories
   46/50 for the combined scene before running acceptance; do not multiply Story 44's allowance
   by the number of tools. No monotonic live-resource growth is accepted.
5. Fix integration defects against their owning stories. Keep automated and physical evidence
   distinct; DOM action tests alone cannot tick controller, speech, text clarity, or comfort criteria.

## Acceptance criteria

- [ ] On Quest 3S, create/open an empty session, enter VR, dictate and correct an instruction,
  choose its agent/mode, and send without another device or a required keyboard.
- [ ] Read streaming/history, answer allow and deny requests, and cancel an identified run in VR.
- [ ] Arrange tools, read a diff, explore actual 3D nodes/edges, switch to the marked 2D projection,
  annotate, attach a correction, and inspect the resulting revision without ending XR.
- [ ] The 30-minute seated run has readable essential content and no forced desktop interaction;
  observed discomfort and usability defects are resolved or the release remains unaccepted.
- [ ] Voice failure, lost controller, executor outage, a broken diagram, system interruption, and
  revoked access have the specified recoveries without losing durable work or redirecting commands.
- [ ] Ten entry/exit cycles preserve drafts/layout and return resources to baseline. The combined
  scene passes documented frame and resource budgets with measurements recorded here.
- [x] `npm run lint`, `npm test`, `npm run build`, and `npm run test:e2e` pass; README and architecture
  describe the actual first release and its input/setup requirements.

## Out of scope

Spatial multi-session Arena/Inbox acceptance (52), Quest 2 guarantees, hand tracking, virtual
keyboard, AR, and claims of physical acceptance based on emulation. Story 44's historical Quest 3
record stays separate; shared regression evidence may be linked without inventing a hardware run.

## How to verify

1. Build and use the existing paired trusted-HTTPS origin. Record actual Quest **3S** model and
   versions, installed input setup, transcription/data path, refresh rate, and fixture revision.
2. From an empty session, enter immersive VR, arrange conversation/canvas/evidence, dictate a
   multiline instruction containing a path/identifier, correct a recognition mistake, and send.
   Read old and streaming messages, change recipient/mode, allow one tool request, deny another,
   and cancel a subsequent turn. No external device participates in these normal actions.
3. Inspect the returned diff, manipulate Story 50's spatial graph, compare revisions, switch to
   the 2D projection to draw a correction, and send that attachment with voice instruction.
4. During the 30-minute run, exercise updates and large fixtures. Use a second paired browser only
   for fault injection: resolve a permission first, disconnect the executor, or revoke the headset.
   Also test speech denial/failure, controller loss, broken content, and system interruption.
5. Record metrics and observed task failures. Repeat entry/exit ten times, verify no automatic
   re-entry on reload, and check desktop work/drafts and per-device layout after return.
6. Run the repository checks and retain the exact results below. Ship only after all boxes pass;
   unavailable physical hardware leaves this story pending, not automatically accepted.

## Verification record

| Evidence | Result |
|---|---|
| Quest 3S, OS/browser, refresh rate | Pending |
| Home machine, voice engine/data path, language, optional keyboard | Pending |
| Fixture/build revision and automated commands | 410 Vitest tests and 73 Chrome tests pass; physical fixture/build revision pending |
| Full controller/voice work journey and 30-minute comfort observations | Pending |
| Median/p95 frame interval and missed frames | Pending |
| Aggregate scene caps; peak and baseline resources; ten cycles | Pending |
| Failure/recovery observations and resolved defects | Pending |

September 19, 2026 — acceptance instrumentation is ready, without claiming headset acceptance.

- Frame median/p95 now cover the complete session through a bounded 0.25 ms histogram; the previous
  9,000-frame rolling window represented only about two minutes at 72 Hz. Final partial buckets are
  included on exit, and maximum frame interval remains exact.
- The device-local history now retains 256 entries, enough for 180 ten-second samples from the
  30-minute run plus lifecycle/fault and ten-cycle evidence. Session-end records carry peak logical
  texels/live resources and sampled renderer/heap peaks; `teardown-sample` captures the post-unmount
  baseline. No content, identifiers, poses, audio, or exception text is added.
- `npm run lint`, `npm test` (65 files, 410 tests), `npm run build`, and `npm run test:e2e`
  (73 Chrome tests) pass. Every physical row above remains pending until the Quest 3S acceptance run.
