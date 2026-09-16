# Story 48 — Answer permissions and control the active session in VR

**Status:** In progress · **Type:** Frontend-only · **Depends on:**
[Story 45](STORY-20260905-application-vr-shell.md), [Story 46](STORY-20260905-vr-workspace-panels.md),
[Story 47](STORY-20260905-vr-conversation-input.md).

**Vision slice:** the first, complete single-session milestone of the
[immersive workspace epic](EPIC-20260905-immersive-workspace.md).

## Motivation

An Agent-mode conversation cannot be completed in VR if every approval requires returning to the
browser window. The user chose a fully operational single session before the multi-session Arena.

## Implementation (where the code is)

- [SessionTools.tsx:14](../src/features/shell/immersive/SessionTools.tsx#L14) renders the launcher,
  repository attachment, paged permission details, explicit decisions, retry, and device sign-out.
- [sessionControls.ts:4](../src/features/shell/immersive/sessionControls.ts#L4) defines captured
  permission identity and client-only shell actions; no shared wire schema changed.
- [usePermissionDecisions.ts:9](../src/features/shell/usePermissionDecisions.ts#L9) owns shared DOM,
  Arena, and XR decisions, synchronous duplicate guards, bounded outcomes, and confirmed refresh
  before an explicit retry. It keeps uncertain results when the executor cannot be reached.
- [AppShell.tsx:541](../src/features/shell/AppShell.tsx#L541) creates sessions;
  [897](../src/features/shell/AppShell.tsx#L897) projects stream/Arena requests;
  [1331](../src/features/shell/AppShell.tsx#L1331) cancels captured runs;
  [1559](../src/features/shell/AppShell.tsx#L1559) supplies the existing authorized actions to XR.
- [ImmersiveWorkspace.tsx:159](../src/features/shell/immersive/ImmersiveWorkspace.tsx#L159) routes
  controller/semantic session actions and preserves the shared composer while session tools open.
- [immersive.spec.ts:1290](../e2e/immersive.spec.ts#L1290) covers real-route fake-provider approvals
  and denial, remote creation/decision failures, captured identity, stale requests, and revocation.

## Desired behavior

1. From the immersive shell, start an empty session in an existing project (or without a project),
   choose its available machine/provider/mode and existing repository bindings, then work in it.
   This is a simple session launcher, not a surrounding multi-session Arena.
2. Show active-session run state and permission requests as readable in-world cards. Each names the
   session, machine, agent/provider, requested tool/action, and the available sanitized explanation.
   Long details are scrollable; a clipped label must not be the only basis for an approval.
3. **Allow** and **Deny** require deliberate controller selection and use existing authorized
   routes. Merely opening, focusing, or moving a card cannot answer it. Bind decisions to captured
   machine/run/request identity, disable repeat submission while pending, and retain the result.
4. Handle a decision already made by another device, a finished/cancelled run, rejection, and a
   disconnected executor by refreshing the canonical status and showing the outcome. No inferred
   approval, client-owned authority, or retry against a different request is allowed.
5. Agent questions are readable and answerable through the Story 47 composer. Permissions stay
   separate from voice dictation: a transcribed instruction does not itself approve a tool action.
   Run cancellation, errors, and retry controls remain available alongside the permission surface.
6. Clear/revoke device access through the existing gate; loss of authorization removes private
   content and prevents further commands. Re-entry after reauthorization follows Story 45.

## Acceptance criteria

Implementation scope, September 16, 2026: add Session tools to the conversation panel, with a
simple local-execution launcher using the selected machine's existing projects/providers/modes.
Project bindings are inherited through the existing create route. Repository-free sessions can
attach an existing checkout as primary in VR before sending; the server's primary-repository
requirement for agent turns remains unchanged. Docker setup and execution selection remain in the
existing desktop setup flow. Permission details use bounded paged text with the complete sanitized
summary reachable. Decisions retain captured machine/session/run/request identity and an explicit
outcome; no automatic retry or selection of the next request after answering.

- [x] A new empty or repository-free session can be created and instructed entirely in VR (attach
  an existing primary checkout before an agent turn, as required by the existing server contract).
- [x] The user can inspect, allow, and deny active-session permissions without exiting or losing a draft.
- [x] Commands capture the target identity; focus changes and duplicate selection cannot retarget
  or duplicate a permission decision or cancellation.
- [x] Already-answered, expired, offline, unauthorized, and failed decisions show accurate outcomes.
- [x] A controller-only path operates the decision controls; speech input cannot implicitly approve.
- [ ] A real Quest 3S Agent-mode turn completes through at least one approval and a separate denial.
- [x] `npm run lint`, `npm test`, `npm run build`, and `npm run test:e2e` pass, including stale and
  cross-device decision cases through the existing fake-provider/route harness.

## Out of scope

Cross-session attention, a spatial Arena, and several visible session views belong to Story 52.
Machine pairing/provider setup remain pre-session setup; no new permission policy is introduced.

## How to verify

1. With fake providers, create a session inside XR, start an Agent turn, inspect a long request,
   allow it, and deny another. Verify the same machine/run/request identities reach existing routes.
2. Answer from another authenticated browser first; repeat with cancellation, machine loss, and
   revocation during an open card. Check that stale controls cannot authorize another action.
3. Run the automated checks and repeat the normal approval/denial journey on Quest 3S using
   controllers and voice for instructions. Record usability and headset/browser versions.

## Verification record

September 16, 2026:

- Implemented Session tools in the conversation header. The launcher selects an existing machine,
  project or No project, provider, and supported mode. Local execution remains server-owned;
  existing project bindings are inherited, and a repository-free session can attach a discovered
  primary checkout before sending. Creation and attachment failures preserve the view and draft.
- Permissions retain the full sanitized summary in a ten-line paged raster viewport. Each request
  names its session, machine, agent/provider, and tool. Allow/Deny are explicit ray controls; opening
  a card or transcribing speech cannot decide it. Results remain on the selected card until the user
  chooses another request. DOM and XR share a command owner with bounded device-local outcomes.
- Failed delivery requires explicit Refresh status. The captured executor's run discovery must
  confirm that exact session/run/request is still pending before rearming; a failed refresh keeps
  the uncertain outcome. 404/409 retain the server's stale/expired explanation, and 401/403 refresh
  the existing device gate. Device sign-out has a deliberate second selection.
- Browser coverage includes in-XR creation and checkout attachment through real routes, separate
  fake-provider Agent turns with ray-selected Allow and Deny, duplicate creation/decision/cancel
  selection, remote target identity through navigation, complete long-detail paging, 503 recovery,
  cross-device resolution, 404/409/401, drafts across tools, and explicit device revocation.
- Inspected launcher and permission screenshots and enlarged session-detail text. Physical Quest
  3S readability, controller selection, and a real Agent approval/denial journey remain unverified;
  this story stays **In progress**. Story 49 is the next implementation slice.
- The full browser run exposed cross-file host-state interference: a concurrent Docker test changed
  the newest project selected by the canvas reload test. Playwright now uses one worker because the
  files share a host store and scheduler (including host-wide cancellation cleanup). The pairing
  test also targets the exact page heading rather than matching projects with “Arena” in their names.
- Final verification: `npm run lint` passed; `npm test` passed 388 tests in 61 files; the production
  build passed. The E2E production pipeline was run as `CODEAI_DIST_DIR=.next-e2e npm run build`
  followed by `npx playwright test`; all 63 browser tests passed with the final one-worker config.
  `git diff --check` passed. Review found and corrected retry recovery and cancellation identity
  gaps before final verification; no additional blocking findings remained.
