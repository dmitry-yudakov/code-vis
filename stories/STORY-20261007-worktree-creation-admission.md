# Story 98 — Create worktrees alongside unrelated turns and explain conflicts

**Status:** Shipped · **Type:** Full-stack · **Depends on:**
[Story 92](STORY-20261005-session-worktrees.md),
[Story 95](STORY-20261007-docker-worktrees.md),
[Story 96](STORY-20261007-stop-arena-git-helper-churn.md)

**Vision slice:** [The Arena](../docs/vision.md#the-arena) starts work across projects and machines;
[concurrent turns](../docs/vision.md#sequence) should leave unrelated repositories usable.

## Motivation

On October 7, 2026, the owner tried to create a CodeAI session to investigate a failed BookingGood
turn and received `Worktree creation needs an idle machine. Wait for turns, Undo, or maintenance
to finish and retry.` Another CodeAI turn, improving Arena session creation in its managed
worktree, was still active. The failed BookingGood turn had exited and finalized its checkpoint;
it had not left a stuck provider process.

The original refusal was intentional under Story 92, but treated every turn on a machine as a
conflict and does not tell the owner which operation is responsible. This follow-up narrows
creation admission to its affected source repository and Git metadata, and explains the remaining
conflicts. It is independent of [Story 97's Codex resume fix](STORY-20261007-codex-resume-without-history.md).

**Scope decision:** unrelated means disjoint source repositories and Git metadata. A session in
another managed worktree of the requested source is still related. In the observed CodeAI case,
creation will continue to wait for that CodeAI turn, but the error will identify it. Allowing two
operations that mutate the same common Git directory concurrently is outside this release.

## Implementation (where the code is)

- [managedWorktrees.ts:452](../src/server/repository/managedWorktrees.ts#L452) reserves creation
  before fresh journal/source/project planning;
  [managedWorktrees.ts:57](../src/server/repository/managedWorktrees.ts#L57) proves ordinary metadata
  contained, excludes unproved roots and plans managed siblings before atomic scope grant.
  [managedWorktrees.ts:509](../src/server/repository/managedWorktrees.ts#L509) repeats that ownership
  per unfinished intent during reconciliation.
- [runRegistry.ts:215](../src/server/runs/runRegistry.ts#L215) owns the singleton creation gate,
  atomic live-operation conflict snapshot and affected scopes. Its existing checkout read/write
  and turn scheduling paths honor them; maintenance excludes creation and cleanup.
- [sessionStore.ts:567](../src/server/storage/sessionStore.ts#L567) checks the planned project
  revision inside the mutation queue before intent persistence.
- [managedWorktrees.ts:383](../src/server/repository/managedWorktrees.ts#L383) protects a managed
  helper/worker's common Git mount through its lifetime, retaining existing Docker restrictions.
- [gitRead.ts:81](../src/server/repository/gitRead.ts#L81) retains leases until a failed Docker
  helper's termination is confirmed. Creation must preserve this rule.
- [codeAiLifecycle.ts:42](../src/server/lifecycle/codeAiLifecycle.ts#L42) uses maintenance to
  protect build/restart, including parent-requested rollback.
- [worktreeCreation.ts:3](../src/shared/worktreeCreation.ts#L3) defines bounded public conflicts;
  [sessions/route.ts:74](../src/app/api/sessions/route.ts#L74) returns them with HTTP 409 through
  the existing machine gateway.
- [AppShell.tsx:712](../src/features/shell/AppShell.tsx#L712) retains creation errors independently
  of expiring toasts; [worktreeCreationError.ts:5](../src/features/conversation/worktreeCreationError.ts#L5)
  resolves blocker titles/states from the addressed executor's Arena catalog, with stale fallbacks.
- [SessionPicker.tsx:38](../src/features/conversation/SessionPicker.tsx#L38),
  [Arena.tsx:341](../src/features/arena/Arena.tsx#L341), and
  [SessionTools.tsx:43](../src/features/shell/immersive/SessionTools.tsx#L43) own desktop/Arena/VR
  creation choices and retained retry identity.
- [sessionWorktrees.test.ts:213](../test/sessionWorktrees.test.ts#L213) covers scoped persistence,
  real-Git sibling/redirected metadata, fresh planning, project revision and retained cleanup;
  [runScheduler.test.ts:40](../test/runScheduler.test.ts#L40) covers existing/new unknown scopes,
  unrelated eligibility, own reads and restart exclusion.

## Desired behavior

### Concrete changes

1. Replace worktree creation's requirement for an idle machine with one bounded creation
   operation admitted by the existing per-machine scheduler. Keep at most one creation or
   unfinished-intent mutation in progress on that machine. Unrelated turns, repository reads,
   session archives and Undo can continue; creation is not a provider turn and does not consume
   the machine's provider-concurrency slots. No persistent creation queue is introduced.
2. Reserve the single creation/reconciliation operation first, excluding maintenance and other
   journal-mutating creations while its dependency plan is resolved. From within that reservation,
   resolve the requested source/binding and the complete set of known managed-worktree dependencies
   using fresh server-owned checkout/journal records. Then atomically grant the exclusive
   affected scopes against currently live operations: the ordinary source checkout including its
   contained common Git directory, the recorded managed worktrees sharing that directory, and the
   creation/recovery destination.
   Include enclosing/nested path overlaps. Do not trust browser paths or an arbitrary checkout's
   `.git` pointer to establish membership. If a live operation's scope cannot be proved disjoint,
   refuse conservatively rather than guessing.
   Reuse bounded contained-metadata validation for ordinary checkouts before granting independent
   roots. A plain `.git` directory alone is insufficient: nested refs, objects or logs can redirect
   to the source. Unregistered linked/redirected and non-Git roots are conservative affected scopes;
   new unseen checkout roots cannot execute during the held creation. This full validation belongs
   to actual creation/reconciliation; Arena polling keeps its lightweight advisory checks.
   A plan read before the operation reservation must be refreshed or compared in full before
   scope grant; otherwise a newly created sibling and a Local turn on it can escape the planned
   scopes. For an existing intent, plan from its recorded origin, identities and bindings, rather
   than resolving the request again against a changed project. No durable generation counter or
   additional operation store is required.
3. Admission fails promptly when machine maintenance or another creation is held, or a run
   (including reserved, queued and approval-blocked work), Undo, or actual Git/helper read holds
   an affected scope. Unrelated operations are not blockers. Once creation is admitted, newly
   accepted turns on affected scopes may queue under the existing scheduler but must not execute;
   overlapping helper reads and Undo must not acquire a lease until creation releases it.
   Existing turn order and provider/session reservation rules remain intact.
4. Hold the affected scopes through fresh full source validation, baseline capture, immutable
   intent persistence, Git mutation, linkage verification and session save. Internal preflight
   and Git helper reads must operate under the holder's ownership without conflicting with their
   own exclusive lease. Revalidate canonical locations, parent identities, metadata identities
   and exact journal linkage after acquisition and immediately before mutation. Include complete
   dependency membership and source/project bindings in that validation. For a new intent, verify
   the planned project binding/revision inside the existing session-store mutation queue before
   recording the prepared session; a changed binding must refuse before intent/Git mutation or
   release ownership and resolve a fresh plan. A stale advisory listing, dependency snapshot or
   pre-acquisition filesystem check cannot authorize creation.
5. Maintenance/build/restart/rollback cannot acquire admission while creation or its cleanup is
   still live, even before a destination session exists. Creation likewise cannot start under
   maintenance. Release owned resources on every terminal path; if helper termination cannot be
   confirmed, retain their protections until existing cleanup confirms it. Do not weaken Docker
   orphan recovery, common-metadata mounts, source-writer exclusion or checkpoint recovery.
6. Apply the same scoped ownership to retries and unfinished-intent reconciliation. Reconcile
   each affected repository under its own lease; a busy intent must not block unrelated ready
   checkouts. Existing immutable request/baseline rules, ambiguous-partial refusal and ready or
   archived session handling remain authoritative. A busy refusal before intent creation leaves
   no session, journal, generated branch or worktree; a retry after an intent exists reuses it.
7. Return HTTP 409 with a bounded, server-owned conflict description. Identify the addressed
   machine, the requested source and the actual blocker kind. For turn blockers, include bounded
   session/run identities so the UI can name the session and its state using that machine's
   existing Arena data. For Undo, helper reads, maintenance or another creation, explain the
   operation directly. Never describe all activity on the machine as the cause when only one
   source is involved. Unknown or stale display metadata has a useful generic fallback.
8. Desktop, Arena and VR show the same actionable reason at the creation form and retain its
   provider, execution, machine, project/source, checkout choice and `creationRequestId` after
   failure. Offer explicit Retry; do not resubmit automatically, cancel a blocker, switch to the
   current checkout, or discard the draft. Changing the creation choices starts the existing
   fresh request identity. A lost response still retries the same recorded intent/session.
9. All decisions happen on the executing machine. Attached-executor requests preserve the
   conflict response and show that executor's blockers, rather than the home machine's activity.
   Polling remains advisory and lightweight under Story 96; exposing busy state must not spawn
   Git helpers, acquire checkout leases or traverse metadata recursively.

### Type contract

Keep the existing success response, request schema and durable session/journal formats. Add an
optional bounded conflict payload to a failed session-creation response; older callers can still
display `error`. Define and validate it in side-effect-free shared code and preserve it through
the existing machine gateway and client creation owner. The intended shape is:

```ts
interface WorktreeCreationConflict {
  machineId: string;
  sourceCheckoutId?: string; // May be unresolved when maintenance/creation blocks first.
  kind: 'maintenance' | 'creation' | 'turn' | 'recovery' | 'git-read';
  blockingTurns?: Array<{
    sessionId: string;
    runId?: string; // Include only a discoverable, activated run.
    state: 'preparing' | 'queued' | 'running' | 'needs-you';
  }>; // At most 8; show that more exist if the list is truncated.
  additionalTurns?: number; // Bounded positive count, at most 40.
}

// HTTP 409 from POST /api/sessions when worktree admission is busy.
{ error: string; worktreeConflict?: WorktreeCreationConflict }
```

Do not return host paths, provider-session keys, commands, helper/container identifiers, private
provider state or credentials. Resolve blocker details from the atomic admission result, not an
unrelated later sample of all machine activity. If needed, add a bounded count of additional turn
blockers; no new discovery endpoint or durable operation store is required.

## Acceptance criteria

- [x] On one machine, creation from source A completes while a turn, Git read, archive or Undo
      runs against unrelated source B. A newly submitted B turn remains eligible during A's
      creation, even when an earlier queued A turn is waiting for its creation lease.
- [x] Running, queued, reserved and approval-blocked work on the source or any recorded sibling
      worktree blocks creation and reports that source's actual session/state. A live helper or
      Undo sharing common metadata or an enclosing path also blocks. Unknown write scopes refuse
      conservatively; finished/retained run records never act as live blockers.
- [x] User-created Local linked worktrees outside the managed folder and ordinary checkouts with
      redirected top-level or nested Git metadata cannot escape common-metadata exclusion. Existing
      work blocks before any intent; newly accepted unknown/related turns wait through persistence.
- [x] Atomically admitted creation blocks newly executing overlapping turns, helper reads, Undo,
      another creation, build/restart and rollback until persistence/cleanup completes. Unrelated
      operations continue. Creation's own full preflight and helper reads do not deadlock.
- [x] A stale plan cannot miss a sibling created by an intervening creation: with deterministic
      barriers, create that sibling and start a Local turn there between the first snapshot and
      reservation/scope grant; the pending creation refreshes and refuses for that turn. A changed
      project binding before prepared-session persistence also cannot escape the owned scopes.
      Retry of an existing intent continues to use its immutable recorded bindings.
- [x] Local and Docker use the same admission rules after Docker provisioning. Failed helper
      termination keeps protections and excludes restart until confirmed cleanup, while unrelated
      provider work remains eligible. Existing protected-source/mount restrictions still pass.
- [x] Busy refusal before intent creation leaves no session, intent, branch or worktree. Busy
      retry and lost-response retry preserve request identity; source HEAD/project changes after
      an intent exists do not change its baseline/bindings or create duplicates.
- [x] Reconciliation skips busy repository scopes and recovers unrelated intents without changing
      already ready/archived sessions or admitting turns into unfinished worktrees. Every failure
      path releases ownership when it is safe, and restart retains conservative orphan recovery.
- [x] All three creation surfaces display a useful reason, preserve choices/request identity and
      allow an explicit retry that succeeds after the blocker exits. Remote execution names the
      addressed machine and its sessions; conflicts contain no private paths or provider details.
- [x] Repeated Arena polling adds no Git helpers, metadata walks or checkout leases to derive
      worktree capability or busy information. Ordinary current-checkout creation stays usable.
- [x] Focused concurrency/failure tests, the offline suite, TypeScript, production build, desktop
      and automated VR creation checks, a disposable real-Docker concurrency probe and independent
      review pass. Record any unavailable physical-device or production-transport checks separately.

## Out of scope

- Creating a worktree concurrently with work sharing its source/common Git directory; automatic
  queuing/retry, auto-cancellation, creating from arbitrary linked worktrees or relaxing placement.
- Changing provider capabilities, security policies, Git metadata mounts, checkpoint coverage,
  branch integration, worktree cleanup or the user's live server lifecycle.
- New persistent operation records, new status endpoints, or changes to session/journal formats.

## How to verify

1. First add deterministic scheduler/worktree regressions for disjoint A/B repositories and the
   failure matrix above. Hold preflight, Git creation and session save at explicit barriers instead
   of relying on sleeps. The A-creation/B-turn case must fail against global maintenance admission.
2. Run `npm test -- test/sessionWorktrees.test.ts test/runScheduler.test.ts test/gitRead.test.ts test/codeAiLifecycle.test.ts`
   plus the existing Docker runtime, machine gateway and creation-owner tests affected by the
   shared response. Exercise own-lease preflight, mode upgrades, cleanup failure, lost response,
   retained finished runs, restart reconciliation and competing maintenance in both orderings.
3. Run the focused production-browser creation journeys for desktop/Arena and automated VR.
   Include an attached-executor fixture, busy Retry, lost response, changed form choices and both
   themes. Assert a specific blocker and intact form choices, not just a toast's presence.
4. With the existing pinned Docker image and disposable repositories, hold a helper or worker
   against B while creating from A, then repeat with shared-source metadata to confirm refusal.
   Inspect mounts/termination and test subsequent admission after release. Use no provider login,
   owner repository, reprovisioning or production restart.
5. Run the offline suite with fixture settings, `npm run lint`, and a production build in an unused
   scratch directory. Review the final scheduler, Git lease and UI contracts independently. Update
   Story 92's scheduling follow-up and the relevant architecture/Docker documentation when shipped.

## Specification review

Independent read-only subagent review passed on October 7, 2026, after adding fresh complete
dependency planning under the single creation reservation and project-binding validation inside
the store mutation queue. This addresses an intervening creation that adds a sibling worktree and
starts a Local turn before an earlier request grants its scopes. Deterministic regressions cover
that race and immutable existing-intent bindings.

No blocking findings remain. Review checked scheduler, worktree/Git/helper/lifecycle, creation UI
and machine-gateway contracts against Stories 92/95/96. It confirmed the stated limitation that a
turn sharing the requested source's common Git still blocks creation and receives an actionable
reason.

## Implementation review

Repeated independent read-only reviews found and closed three high-severity scope defects: an
inconsistent unknown-managed-path check for Undo, user-created Local linked worktrees outside the
managed folder, and ordinary Git directories with top-level or nested metadata symlinks. Final
backend and independent whole-change reviews report no remaining critical or high-severity issues.
Reviewers independently ran disposable real-Git/selected regression checks. Codex and the shared
desktop/Arena/VR retry contract also passed independent review.

## Verification record

- The disjoint-source regression failed under the former global maintenance barrier. Real-Git
  regressions reproduced success with linked/redirected metadata before the fixes, then confirmed
  HTTP 409 with actual blocker sessions and no intent/branch/session. Additional barriers cover
  fresh sibling membership, project revision, scope ownership during save and cleanup retention.
  Two-source reconciliation skips a busy source and completes the unrelated retained intent.
- All 1,201 offline tests in 116 files, `npm run lint` and the scratch production build passed.
  Build output: `.next-e2e/session-recovery-fixes`; the running application was untouched.
- Six focused scratch-production Chrome checks passed: desktop independent choices and busy retry,
  managed creation in both themes, lost-response identity, Arena Undo retry, and automated VR
  executor-specific blocker/identity coverage. The VR case uses an attached-executor fixture.
- `npm run test:docker:worktrees` passed against the installed pinned image with disposable
  repositories/workers: creation beside an unrelated real worker, shared-common-Git refusal,
  cleanup/restart admission, Local/Docker creation after provisioning, isolated reads, Undo,
  Ask/Plan/Agent Git/mount restrictions and tampered-link rejection. No provider login or owner
  repository was used; disposable resources were cleaned up.
- Physical Quest 3S, signed-in Docker inference, production attached-executor TLS/pairing and
  observation in the rebuilt live application were not rerun. No deployment or restart occurred.
- Full metadata proof runs only during creation/reconciliation, with existing per-repository
  traversal limits. Aggregate planning time grows with the catalog; lightweight Arena polls are
  unchanged.
