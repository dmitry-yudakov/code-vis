# Story 52 — Expand the VR workspace to the Arena and Inbox

**Status:** Draft · **Type:** Frontend-only · **Depends on:**
[Story 51](STORY-20260905-vr-workspace-acceptance.md) and the existing Arena/machine foundation.

**Vision slice:** second milestone of the [immersive workspace epic](EPIC-20260905-immersive-workspace.md),
the breadth of [the Arena](../docs/vision.md#the-arena). The user explicitly chose a fully usable
single session first; this story must not delay that release.

## Motivation

After the session work loop is useful in VR, the surrounding workspace should show several pieces
of work and let the user respond to another session without losing their place.

## Current behavior (where the code is)

- [Arena.tsx:48](../src/features/arena/Arena.tsx#L48) renders DOM session cards/Inbox;
  [useArena.ts:13](../src/features/arena/useArena.ts#L13) polls home/executor snapshots once.
- [AppShell.tsx:1144](../src/features/shell/AppShell.tsx#L1144) opens machine-qualified sessions;
  [1213](../src/features/shell/AppShell.tsx#L1213) routes cross-session permission decisions.
- [workspaceViews.ts:67](../src/features/shell/workspaceViews.ts#L67) and
  [useWorkspaceViews.ts:20](../src/features/shell/useWorkspaceViews.ts#L20) scope device views by
  project/machine. Simultaneous detailed cross-project content needs explicit state ownership.

## Desired behavior

1. Project the existing Arena/Inbox inside the persistent immersive shell: sessions grouped by
   project/machine, the six established states, readable activity, and new-session creation.
   Reuse existing discovery and read-state derivation instead of starting another poller.
2. Keep several session summaries visible around the focused view; opening one changes explicit
   focus without ending XR, cancelling work, or losing another view's draft, reading position,
   artifact selection, or panel layout. Paginate/virtualize summaries and cap detailed views.
3. Surface **Needs you** and **Failed** from elsewhere while the user is working. Completed turns
   become quiet unread activity. Show session/machine/reason before opening a permission detail;
   use Story 48's deliberate controls and captured identities for Allow/Deny, then return to work.
4. Support existing session archive/restore and creation actions, with busy/error state and the
   same existing restrictions. Distinguish read/unread acknowledgements from permission decisions.
5. Show cached Offline summaries honestly; do not invent offline transcript access. Returning
   executors refresh through the existing home gateway. Handle identical session IDs on different
   machines without sharing drafts, actions, or layouts.

## Acceptance criteria

- [ ] Arena/Inbox and session focus operate in one XR session across projects and machines.
- [ ] Several summaries stay visible with bounded resources; inactive detailed views do not each
  acquire a full unbounded scene or another stream/poller.
- [ ] A background permission can be inspected/answered and the original draft/view restored;
  completion stays quiet and machine/run/request identity is preserved under racing updates.
- [ ] Create, archive/restore, Offline/reconnect, and failed actions preserve canonical behavior.
- [ ] Quest 3S testing with six session summaries and two active runs passes the established
  combined-scene budgets and a 30-minute work run without forced exits or lost context.
- [ ] `npm run lint`, `npm test`, `npm run build`, and `npm run test:e2e` pass, including duplicate
  session IDs on distinct machines and stale cross-device approvals.

## Out of scope

Other humans/avatars, a coordinator, cloud execution, room-scale navigation, and a new canonical
workspace/view schema. Hand tracking and virtual keyboard remain follow-up interaction work.

## How to verify

Use two machine identities, at least two projects, six sessions, and two concurrent fake-provider
runs. Switch focus while dictating/reading, answer a background request already resolved on another
device, archive/restore an idle session, and take an executor offline. Assert correct targets and
preserved drafts/layouts. Run repository checks and repeat the combined 30-minute headset journey
from Story 51 with the surrounding Arena active; record Quest 3S metrics and interaction results.

## Verification record

Pending the first single-session release and this story's implementation.
