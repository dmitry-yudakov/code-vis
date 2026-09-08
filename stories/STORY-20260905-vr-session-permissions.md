# Story 48 — Answer permissions and control the active session in VR

**Status:** Draft · **Type:** Frontend-only · **Depends on:**
[Story 45](STORY-20260905-application-vr-shell.md), [Story 46](STORY-20260905-vr-workspace-panels.md),
[Story 47](STORY-20260905-vr-conversation-input.md).

**Vision slice:** the first, complete single-session milestone of the
[immersive workspace epic](EPIC-20260905-immersive-workspace.md).

## Motivation

An Agent-mode conversation cannot be completed in VR if every approval requires returning to the
browser window. The user chose a fully operational single session before the multi-session Arena.

## Current behavior (where the code is)

- [PermissionCard.tsx:7](../src/features/agents/PermissionCard.tsx#L7) renders explicit Allow/Deny
  actions in the DOM; [AppShell.tsx:805](../src/features/shell/AppShell.tsx#L805) routes decisions.
- [AppShell.tsx:470](../src/features/shell/AppShell.tsx#L470) creates sessions with provider/mode
  choices; [1251](../src/features/shell/AppShell.tsx#L1251) cancels the focused run.
- [immersiveTypes.ts:27](../src/features/diagram/spatial/immersiveTypes.ts#L27) currently carries
  only a count and text status, without actionable permission records.

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

- [ ] A new empty or repository-free session can be created and instructed entirely in VR.
- [ ] The user can inspect, allow, and deny active-session permissions without exiting or losing a draft.
- [ ] Commands capture the target identity; focus changes and duplicate selection cannot retarget
  or duplicate a permission decision or cancellation.
- [ ] Already-answered, expired, offline, unauthorized, and failed decisions show accurate outcomes.
- [ ] A controller-only path operates the decision controls; speech input cannot implicitly approve.
- [ ] A real Quest 3S Agent-mode turn completes through at least one approval and a separate denial.
- [ ] `npm run lint`, `npm test`, `npm run build`, and `npm run test:e2e` pass, including stale and
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

Pending implementation and Quest 3S verification.
