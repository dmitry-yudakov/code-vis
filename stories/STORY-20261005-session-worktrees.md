# Story 92 — Start a session in its own Git worktree

Follow-up: [Story 95](STORY-20261007-docker-worktrees.md) replaces this release's Docker provisioning
and managed Docker-worktree restrictions with verified, bounded Git metadata mounts.
Follow-up: [Story 98](STORY-20261007-worktree-creation-admission.md) replaces machine-wide idle
admission with exclusive affected repository/Git scopes and actionable retained-retry conflicts.

**Status:** Shipped · **Type:** Full-stack · **Depends on:**
[Story 37](STORY-20260901-concurrent-turns.md) (checkout scheduling),
[Story 65](STORY-20260921-tolerate-newer-session-format.md) (record compatibility),
[Story 83](STORY-20261001-turn-checkpoints.md) (checkout recovery)

## Motivation

Several conversations can work on one repository, but writing turns on its single checkout must
take turns and leave their changes mixed together. A session-owned worktree would give a piece of
work its own files and branch, let independent sessions progress concurrently, and preserve the
user's existing checkout for other work.

The user agreed to choosing a worktree at session creation and also wants a later path for a
conversation that starts with a question and only subsequently becomes an implementation task.
This story delivers the creation choice; the later transition is recorded below as a follow-up.

This extends the [arena vision's same-repository sessions](../docs/vision.md#projects-repositories-and-repository-free-work)
and [concurrent turns](../docs/vision.md#sequence), and prepares the
[software model's Review changes lens](../docs/software-model.md#lenses-slicing-the-model).
Repository identity, checkout location, and the code version a model describes remain separate.

## Where the code is

- [SessionPicker.tsx:38](../src/features/conversation/SessionPicker.tsx#L38),
  [Arena.tsx:71](../src/features/arena/Arena.tsx#L71), and
  [CheckoutChoice.tsx:6](../src/features/conversation/CheckoutChoice.tsx#L6) — desktop creation
  offers the current/worktree choice, source and baseline explanation, and retained retry identity.
- [SessionTools.tsx:43](../src/features/shell/immersive/SessionTools.tsx#L43) — VR's launcher
  offers the same choice using the selected executor's catalog and capability.
- [AppShell.tsx:672](../src/features/shell/AppShell.tsx#L672) — creation routes to the addressed
  machine; New chat and Local continuation inherit exact bindings and worktree provenance.
- [protocol.ts:98](../src/shared/protocol.ts#L98) and
  [sessions/route.ts:38](../src/app/api/sessions/route.ts#L38) — strict creation requests,
  device authorization, repository resolution, and Docker preflight.
- [sessionStore.ts:529](../src/server/storage/sessionStore.ts#L529) — prepares fresh provider
  sessions and reserves host capacity by persisting the intent inside the store's mutation queue.
  Session save/reconciliation preserves already saved or archived conversations.
- [sessionStore.ts:823](../src/server/storage/sessionStore.ts#L823) — managed bindings are
  fixed; generic project/session edits cannot attach another session's managed checkout.
- [managedWorktrees.ts:89](../src/server/repository/managedWorktrees.ts#L89) — canonical placement,
  source preflight, bounded offline Git, private journal, immutable retries, and conservative recovery.
  [managedWorktrees.ts:313](../src/server/repository/managedWorktrees.ts#L313) holds the existing
  maintenance lease through creation and persistence.
- [checkoutRegistry.ts:36](../src/server/repository/checkoutRegistry.ts#L36) — ordinary discovery
  keeps its configured root; only journal records add external managed checkouts. Concurrent refreshes
  use independent snapshots. Managed resolution verifies recorded directories and Git linkage.
- [sessionSchema.ts:232](../src/shared/sessionSchema.ts#L232) and
  [config.ts:179](../src/server/config.ts#L179) — format 10 provenance and server-owned worktree root.
- [runRegistry.ts:181](../src/server/runs/runRegistry.ts#L181) and
  [runRegistry.ts:422](../src/server/runs/runRegistry.ts#L422) — an existing maintenance lease
  excludes runs and recovery; ordinary execution locks distinguish checkout paths.
- [gitRead.ts:84](../src/server/repository/gitRead.ts#L84) and
  [dockerProfile.ts:89](../src/server/execution/dockerProfile.ts#L89) — Docker provisioning
  switches all Git reads to a single-checkout helper; managed Local operations refuse provisioning,
  and Docker turns reject linked worktrees.
  [The documented limitation](../docs/docker-execution.md#execution-contract) affects Local too.
- [turnCheckpoints.ts:120](../src/server/repository/turnCheckpoints.ts#L120) — recovery inventories
  the executing checkout and fingerprints its HEAD and index.
- [repositoryModelStore.ts:20](../src/server/model/repositoryModelStore.ts#L20) — temporary model
  accumulation is already scoped by executing checkout path.
- [selfProject.ts:11](../src/server/repository/selfProject.ts#L11) — report access depends on
  the project's primary checkout matching the installation, rather than its name.
- [machineRoutePolicy.ts:4](../src/server/machines/machineRoutePolicy.ts#L4) — attached executors
  already permit session creation through the authenticated machine gateway.

## Desired behavior

### Session creation and visible scope

1. Desktop New session forms and the VR launcher offer **Use current checkout** (the default)
   and **Create a worktree** when the selected machine supports it. This choice is separate from
   Local/Docker execution, the agent's mode, and global instructions. Ask and Plan may use either
   choice; asking a question never creates a worktree automatically.
2. The first release creates a worktree for exactly one repository binding, a primary repository
   on the executing machine, using Local execution. A loose Local session can select an existing
   checkout, extending the current Docker-only direct selection. Repository-free and multiple-
   repository sessions keep their existing behavior; the worktree choice explains why it is unavailable.
3. The form names the source checkout and branch and explains: **Start from the latest commit;
   uncommitted changes and local setup stay in the current checkout.** Dirty sources are allowed
   with that explanation visible. Do not stash, commit, or copy staged/unstaged/untracked changes
   or ignored/private local files from the source working directory. Materialize only the committed
   baseline. Dependencies, build output, and local configuration are prepared separately through
   existing user/agent actions; creation runs no install scripts.
4. On submission, resolve the source again on the executing machine, capture its HEAD under the
   creation lease, and create a unique branch `codeai/session-<sessionId>` at that exact commit.
   The worktree belongs to this session across all its turns and participants. No user branch is
   reset, checked out elsewhere with force, or renamed. Existing source files, index, branch, and
   uncommitted work stay unchanged; Git's linked-worktree metadata and the new branch are the
   intended source-repository metadata changes.
5. Persist the session only with its new primary checkout binding ready. Keep its project id and
   the project's original repository binding. Do not add the session's managed worktree to the
   project as another repository, or change other sessions' bindings. Provider sessions start fresh.
   A managed session's repository bindings are fixed in this first release: changed repository
   PUT requests return 409 and the attachment/edit UI explains why it is unavailable. Identical
   requests may remain idempotent. This prevents stale worktree metadata or an implicit transition
   through the existing Local binding editor; ordinary sessions keep their existing editing behavior.
6. The conversation's repository context and Arena card identify **Worktree**, its current branch,
   and its source repository. Repository views, provider cwd, attachments/context, model emissions,
   and Undo all resolve the executing worktree. Display metadata is not authority: recheck the
   actual checkout and branch for operations rather than trusting the stored branch label.
7. Existing **New chat** keeps Story 86's exact-checkout inheritance: a new conversation on a
   managed worktree shares that worktree, with the same worktree identity/base metadata. Its label
   must not imply a newly isolated checkout. To start an independent task, use New session and
   select Create a worktree. Execution continuation likewise keeps exact bindings; Continue in
   Docker is unavailable for linked worktrees until Docker support ships. No path change is hidden
   behind either action.
   Any current-checkout creation that selects a registered managed checkout likewise derives its
   worktree metadata from the server record. Clients cannot omit its provenance by choosing current,
   or add a managed checkout to a project's ordinary repository bindings through generic edits.

### Server-owned contract and placement

The browser submits choices and opaque identities. It never submits a filesystem path, shell
command, Git flags, writable roots, branch name, or executable. Extend the strict shared request
and wire/session schemas together; this is the intended shape, not an additional abstraction:

```ts
// Addition to session creation. Omitted checkoutMode retains current behavior.
checkoutMode?: 'current' | 'worktree';
creationRequestId?: string; // UUID, required for worktree creation/retry

// Addition to a session created in, or continuing on, a managed worktree.
interface SessionWorktree {
  id: string;               // managed worktree UUID; shared continuations retain it
  originCheckoutId: string; // executing machine's original checkout identity
  baseCommit: string;       // full resolved commit id; supports Git's object format
  branch: string;           // generated initial branch name, not a live branch assertion
}
worktree?: SessionWorktree;
```

8. `checkoutMode: 'worktree'` requires Local execution, a project with one eligible primary
   binding or a direct checkout id, and no `sourceSessionId`. Allow direct checkout ids for Local
   current-checkout creation too. Malformed combinations/unknown modes are 400; an unavailable
   machine capability or a busy creation lease is 409 with a useful reason. Omitted choices and
   existing source-session requests retain their behavior.
9. A new session-format version carries worktree metadata; records without it keep their existing
   versions. Update durable/public schemas and newer-version handling together. Store canonical
   worktree records on the executing machine under `<dataDir>/worktrees/`; browser storage owns
   only the pending form choice. Public responses omit absolute checkout and metadata paths.
10. Add a server-owned `CODEAI_WORKTREES_ROOT` setting (with the usual former spelling accepted),
    defaulting to `~/.code-ai/worktrees`. Each directory is derived from the generated worktree id.
    The root must be disjoint from the data directory, installation, provider storage, and ordinary
    source/executing checkouts. Its own allowlisted managed checkouts are permitted descendants;
    their individual destinations must be disjoint from each other. Refuse symlinked/changed
    parents, existing destination paths, unsafe roots, or an unwritable destination, without falling
    back inside the source checkout.
    This makes the default usable when `CODEAI_REPOSITORIES_ROOT` is itself the application's checkout.
11. Extend checkout resolution with only the server's durable allowlist of managed worktrees
    under that validated root. Do not broaden ordinary checkout discovery to its parent or scan
    arbitrary paths. Retain the current path-hash checkout ids; persist the relationship to the
    source separately. Recheck canonical location and the recorded Git linkage before provider
    execution, Git reads, or Undo. A moved root or changed link makes a checkout unavailable rather
    than silently rebinding it. Existing user-created worktrees retain ordinary discovery behavior.
12. Keep model accumulation separated by executing checkout. Story 7's persistence must retain
    checkout/version context when grouping worktrees under the same repository; one branch's model
    must not overwrite another's. This story introduces no portable repository identity scheme.
    Preserve the project's self-project test and reports access. Build & restart still builds the
    installation checkout; it never silently builds or applies the session's worktree.

### Capability, scheduling, and failure paths

13. Capability is decided by the executing machine and carried in its health/snapshot data. The
    initial supported source has a normal contained `.git` directory and a resolvable HEAD.
    Non-Git folders, unborn repositories, submodules, external/symlinked Git metadata, linked
    source worktrees, unsupported checkout filters, partial/promisor clones, missing required
    objects, and external object storage/alternates are unavailable for managed creation.
    Never run repository checkout hooks or smudge/process filters as a side effect. Use fixed,
    bounded Git invocations and sanitized environments; refuse unsupported repositories before
    mutation. Creation is offline and never invokes transports, credential helpers, or lazy object
    retrieval. The provider's mode/security rules and checkpoint platform limits still apply.
14. Docker turns and machines with an existing Docker provisioning record cannot offer managed
    worktrees in this first release, even if Docker is disabled in Arena. Explain that the Git
    helper lacks linked-worktree support. Recheck at creation and before turns: provisioning Docker
    after creation leaves the transcript/canvas readable but blocks worktree execution and Git
    operations. No host-Git fallback or extra host mounts are introduced.
15. For creation, reuse the scheduler's existing machine maintenance lease: fail promptly if any
    run, queue reservation, checkout recovery, or other maintenance is present. Hold it through
    preflight, Git mutation, persistence, and reconciliation; release it in every terminal path.
    This deliberately makes creation brief and exclusive without a new repository-wide lock layer.
    Normal turns retain per-checkout locking and machine/provider budgets, so different worktrees
    can write concurrently. Worktrees separate checkout files; shared Git refs/configuration and
    external actions still follow the existing security levels and permissions.
16. Make creation retryable with the same `creationRequestId`: before Git mutation, persist an
    intent containing the exact request, generated session/worktree identities, resolved origin
    identity/location and Git linkage, immutable base commit, generated branch/destination, and
    chosen project/session bindings. Retries reuse these facts and revalidate their availability;
    they never recapture a changed source HEAD or inherit different project bindings. Matching
    retries return or finish that same session; a different request with the same id is a conflict.
    The browser retains its request id across transient failure/lost response and offers Retry;
    a deliberately new creation uses a new id. Disable repeated UI submission, but do not rely on
    the browser for deduplication. Cancel before submit does nothing; disconnect after submit does
    not imply cancellation or deletion.
17. Treat Git creation and session persistence as a recoverable operation, not an atomic filesystem
    transaction. Reconcile recorded unfinished intents before admitting turns after restart;
    ambiguous records become unavailable without blocking unrelated ready checkouts indefinitely.
    If session persistence failed after creation, retain the worktree/branch and intent and allow
    a matching retry to finish. A failed or ambiguous partial creation retains an unavailable
    record and gives a useful recovery reason; never recursively delete, force-remove, reset, or
    overwrite uncertain state. Bound the journal to the existing host session limit, including
    unfinished intents, and bound Git subprocess duration/output. Unsupported or failed preflight
    must leave no branch, worktree, or session behind.

### Review, retention, and bringing changes back

18. This release retains the recorded starting commit and uses the existing working-tree status,
    file diff, and session review surfaces. It does not claim those surfaces already show a full
    branch-to-base diff after commits. A later review slice will combine committed and current
    work against that baseline before explicit integration.
19. Closing a tab, cancellation, automatic/manual archive, and restart preserve the worktree and
    branch. Restore reopens the same checkout. A missing/moved worktree leaves history and canvas
    available and explains why execution is unavailable. A shared New chat reference keeps the
    same resource alive. No age-based worktree deletion accompanies session auto-archive.
20. There is no automatic commit, merge, cherry-pick, push, discard, or cleanup. Users can review
    and integrate with normal Git through existing authorized actions. A later product cleanup
    action must account for active/archived session references, dirty files, ignored local setup,
    and commits not integrated into the chosen target; a clean working tree alone is insufficient
    evidence that removing it preserves all recoverable work.

## Follow-up: adopt a worktree during a conversation

This is a requested later slice, **not an acceptance gate for initial creation support**. Example:
the user asks why a feature behaves a certain way, the answer identifies a fix, and the user then
chooses **Move work to a worktree** without losing the investigation.

The follow-up must specify and verify these requirements before implementation:

- An explicit user action changes the session's executing checkout; an agent may suggest it, but
  switching mode, asking a question, or beginning a writing turn never silently changes location.
- Preserve the session id, transcript, canvas/artifacts/marks, project, roster, drafts, and agent
  selections. Repository-free conversations first choose their source repository.
- Require the expected session revision and idle session/checkout access; reject active or queued
  turns, permission waits, Undo, and conflicting binding edits before changing anything.
- Offer a clean committed baseline first. If there are existing edits, explain that they remain
  in the old checkout; transferring them needs its own preview and explicit conflict/private-file
  contract. Never silently stash, commit, or copy them.
- Start fresh provider-native sessions for the new cwd, with a bounded recap from the canonical
  conversation. Retain prior provider history; a failed transition leaves the old binding usable.
- Keep earlier checkpoints tied to their original checkout and clearly distinguish that recovery
  scope. An old turn's Undo must never restore files into the new worktree.
- Persist and reconcile the transition across failure/restart, keeping the project repository
  binding unchanged. Use the creation contract's capability and root validation.

Separate follow-ups own full session diffs and explicit integration, safe cleanup, and Docker/helper
support with reviewed Git metadata mounts. They need their own stories; this story sets no queue
priority and does not make Story 7 depend on implementing worktrees.

## Acceptance criteria

- [x] Desktop and VR creation expose the explicit checkout choice, source/baseline explanation,
      and executing-machine availability reason; current checkout remains the default.
- [x] Eligible project and loose Local sessions create one persistent worktree/branch from the
      resolved commit; pre-existing dirty work and private/local setup stay untouched.
- [x] Existing creation requests, repository-free/multiple-repository sessions, New chat sharing,
      execution continuation, and fixed managed bindings follow the explicit contracts above.
- [x] Durable/public metadata, format compatibility, server-owned root/allowlist resolution,
      and project/self-project identity survive reload, restart, archive, and Restore.
- [x] Provider cwd, Git/context reads, model accumulation, and checkpoint/Undo target the worktree;
      independent writing sessions run concurrently within existing machine/provider budgets.
- [x] Unsupported source/platform conditions and Docker-provisioned machines refuse managed
      creation correctly; later provisioning blocks worktree operations without hiding history.
- [x] Creation leases, duplicate/mismatched requests, partial failures, lost responses, restart
      reconciliation, and unavailable/missing worktrees satisfy the recovery contract.
- [x] Unsafe/changed paths or linkage, checkout hooks/filters, and crafted request fields cannot
      broaden host access, modify source work, or start unauthorized provider execution.
- [x] No archive or other automatic lifecycle event deletes worktrees, branches, or local setup;
      full integration, cleanup, and later adoption remain clearly documented follow-ups.
- [x] Focused offline/real-Git checks, TypeScript, production build/browser checks, and independent
      review pass; README/architecture/config documentation describes actual supported behavior.

## Out of scope

- In-place adoption after conversation creation; transferring dirty source changes.
- Docker worktree execution or Docker-provisioned helper compatibility; widening sandbox profiles,
  customization mounts, provider permissions, or remote-machine operation scope.
- Automatic dependency/setup installation, secret/config copying, or shared dependency directories.
- Worktrees for every agent/turn, simultaneous writers within one checkout, and isolation of all
  repositories in a multiple-repository session.
- Full branch-to-base diff UI, product merge/cherry-pick/push, cleanup/discard, automatic commits,
  portable repository identity, and model persistence implementation.

## How to verify

1. Add focused tests using disposable real Git repositories and fake providers. Cover ordinary,
   project, loose, inherited-source and malformed requests; a dirty source with staged, unstaged,
   untracked and ignored/private files; exact base commit, unique branch, and unchanged source
   HEAD/index/files. Test Git's supported object formats without assuming 40-character ids.
2. Exercise the root/allowlist resolver with the repositories root itself set to a checkout,
   managed paths outside it, changed/symlinked parents, pre-existing destinations, incorrect Git
   links and unregistered ids. Unsupported filters/hooks and missing-object/promisor retrieval or
   credential helpers must not execute fixture marker commands. Managed binding edits are refused,
   provenance cannot be dropped, and generic project edits cannot add a managed worktree.
3. Inject request duplication, lost response, busy maintenance/run/Undo, Git failure, full disk or
   permission failure during session save, and restart at each creation boundary. A matching retry
   returns one session/worktree; mismatches conflict; ambiguous state remains recoverable and no
   provider starts with an unresolved intent or unavailable checkout. Move the source HEAD/change
   project bindings after recording the intent and restart before Git mutation: a retry retains
   the original commit/bindings or refuses, and never silently starts from the changed source.
4. Run writing providers in two worktrees of the same source and verify concurrent eligible turns,
   isolated files/model accumulation, unchanged source work, and worktree-only Undo. Archive and
   restore one, create New chat on it, and restart. Remove a disposable worktree externally and
   verify readable history/canvas plus an unavailable execution reason.
5. Simulate Docker provisioning before and after creation, including Docker disabled in Arena.
   Verify managed creation/operations refuse without host-Git fallback, new metadata mounts, or
   a broken conversation view. Existing ordinary Docker sessions remain unchanged.
6. Run focused session, checkout, scheduler, checkpoint, machine-gateway, schema, and UI suites,
   `npm run lint`, and `npm run build`. Use production Playwright checks for the desktop creation
   journey in both themes, reload, failures, labels, New chat, archive/Restore, and keyboard access;
   cover VR creation choice/reasons through its automated controls. On an attached executor, verify
   the worktree and journal are created there, and an offline machine cannot create them locally.
7. Record a real Local provider turn in a disposable worktree and verify cwd, Git reads, checkpoint
   recovery, and the current Guarded/Native policies. Probe Guarded Codex Auto's actual linked-
   worktree handling before claiming support; preserve its existing profile and echo checks. A
   physical Quest launcher run is additional device evidence, not an acceptance requirement.

## Specification review

October 5, 2026: an independent read-only review subagent checked the draft against the current
creation, repository-binding, checkout, scheduler, Git-helper, checkpoint, and machine contracts.
The review identified and the draft corrected:

- Root placement now permits its own managed descendants while keeping checkout destinations disjoint.
- Managed bindings remain fixed, and server-derived provenance cannot be dropped through existing edits.
- The creation intent preserves its resolved origin, commit, branch, destination, and bindings across retries.
- Creation explicitly excludes lazy object retrieval, transports, and credential-helper execution.

A focused second review confirmed **no remaining findings** in the specification. Local-link,
code-anchor, and Markdown whitespace checks passed before implementation began.

## Implementation and verification — October 5, 2026

The implementation preserves the source checkout and project while registering each managed checkout
on its executing machine. Initial intents reserve capacity inside the existing store mutation queue;
creation holds the existing machine maintenance lease. Reconciliation defers while another operation
holds that lease, so a retained failed intent cannot block unrelated ready checkouts. Ambiguous partial
Git state is retained as unavailable, without reset/removal. All managed Git invocations override local
ignore-file paths, hooks, external attributes files, credential helpers, transports, and lazy retrieval.

- Disposable real-Git tests cover SHA-1/SHA-256, source index/files/private setup, live branches,
  immutable retries and changed project/HEAD, every creation boundary, save failure, malformed and
  capacity-limited journals, concurrent catalog refreshes, scheduler concurrency, model separation,
  Undo, inheritance, fixed bindings, archive/Restore, missing/replaced linkage, and provisioning.
- Production browser checks cover keyboard creation in both themes, writing and Undo, reload,
  New chat, archive/Restore, lost-response Retry, and Arena creation/context. VR automated controls
  cover executing-machine capability, source/baseline, immutable Retry, remote routing, and the
  existing repository-free/attach/allow/deny journey.
- Real Claude Code 2.1.288 Sonnet Agent turns passed at Guarded and Native in a disposable managed
  worktree; actual Git reads and checkpoint Undo left the source unchanged. Codex 0.160.0 with
  gpt-6-astra passed a Guarded Auto probe: checkout writes succeeded without approval, while
  staging and writing shared Git configuration requested escalation and were denied. The existing
  Auto profile and echo checks are unchanged. See [the experiment log](../docs/experiment-log.md#story-89--local-worktree-provider-and-executor-probes-2026-10-05).
- An attached executor probe used two disposable processes with separate data/checkout roots, the
  production home gateway, one-time machine pairing, and real executor route handlers behind a TLS
  fixture listener. Only the executor received the worktree/journal; stopping it produced 502 with
  no home creation. The standard production `start:remote` listener returned 426 during fixture
  pairing, so that listener's pairing remains unverified here. Physical Quest use is also unverified
  and remains additional device evidence rather than this story's acceptance gate.
- Independent implementation review found and corrected five issues: busy reconciliation blocking
  unrelated checkouts, a final-session-slot admission race, local Git ignore-file paths, shared-map
  catalog interleaving, and incorrect status precedence for changed managed repository PUTs.
  Its second pass reported **no remaining actionable findings** and passed 46 focused checks plus
  `git diff --check`.
- Final checks passed: strict TypeScript, the production build in `.next-e2e`, all 1,096 Vitest
  tests across 110 files, and all ten focused production Chrome journeys. Both-theme screenshot
  inspection also corrected the checkout label's placement within the conversation header;
  browser geometry assertions preserve transcript space. A final review of that correction and
  the documentation reported no additional findings.
