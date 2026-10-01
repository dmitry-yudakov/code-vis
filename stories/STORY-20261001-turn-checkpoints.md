# Story 83 — Save writing turns and undo their checkout changes

**Status:** Shipped · **Type:** Full-stack · **Depends on:** [Story 82](STORY-20261001-native-security-level.md)

## Motivation

Native writing turns and Guarded Agent/Auto edit the real checkout. A mistaken turn can destroy
uncommitted work that Git cannot recover. The [security levels epic](EPIC-20261001-security-levels.md#catching-mistakes-without-asking)
calls for recovery at both levels, without another approval before every turn. This is development
queue Q1 and supports the vision's local repository change loop.

## Implementation (where the code is)

- [turnCheckpoints.ts:201](../src/server/repository/turnCheckpoints.ts#L201) — private checkpoint
  storage, bounded capture, terminal fingerprints, retention, restart status and guarded restore.
- [message/route.ts:288](../src/app/api/agent/message/route.ts#L288) — captures before provider
  execution and finalizes recovery before releasing checkout access or publishing completion.
- [runRegistry.ts:123](../src/server/runs/runRegistry.ts#L123) — exclusive recovery access blocks
  overlapping turns and repository helper reads; its internal token admits Undo's own Git reads.
- [gitRead.ts:14](../src/server/repository/gitRead.ts#L14) — bounded, hardened Git reads; installations
  with Docker provisioned use their credential-free helper, even for Local sessions.
- [checkpoint/route.ts:11](../src/app/api/agent/checkpoint/route.ts#L11) and
  [undo/route.ts:14](../src/app/api/agent/undo/route.ts#L14) — authenticated, bounded recovery routes.
- [useTurnCheckpoint.ts:15](../src/features/conversation/useTurnCheckpoint.ts#L15) — the shared
  desktop/VR status, confirmation and Undo owner, composed in
  [AppShell.tsx:295](../src/features/shell/AppShell.tsx#L295).
- [TurnCheckpoint.tsx:4](../src/features/conversation/TurnCheckpoint.tsx#L4) and
  [SessionTools.tsx:141](../src/features/shell/immersive/SessionTools.tsx#L141) — desktop and VR controls.
- [machineRoutePolicy.ts:4](../src/server/machines/machineRoutePolicy.ts#L4) — executor status/Undo
  allowlist; backups remain on the executing machine and never enter Docker mounts.

## Desired behavior

### Capture and scope

1. Every writing mode, Local or Docker, at either security level saves the eligible checkout files
   **after acquiring the writing turn's checkout access and before starting the provider**. Ask and
   Plan do not capture. Queued cancellation does not capture. A capture failure prevents execution
   and records a failed, not-sent message with a useful recovery error.
2. Capture changes neither the index nor HEAD nor the working tree. It preserves the exact bytes
   and permissions of staged, unstaged, and nonignored untracked regular files. Existing deletions
   stay deleted. Undo leaves the original index intact, preserving staged versus unstaged work.
3. Ignored files (including personal Git ignores), `.git`, provider/private directories, `.env*`
   except `.env.example`, credential files, and key/certificate files are excluded even when
   tracked. No symlink is followed, no credential file is read, and no backup is mounted in Docker.
   A previously included file remains covered if a turn changes ignore rules. Git submodules,
   nested repositories, nonexcluded symlinks, hard-linked files and special files fail capture;
   recovery must not claim it can safely restore them. Folders without Git use the same private and
   common generated-directory exclusions. Empty directories are outside the file contract.
   Retain a bounded inventory of initially ignored file/directory names, without their contents,
   so removing ignore rules never lets Undo delete pre-existing ignored work. Keep eligible tracked
   paths even if they were already deleted, so recreating and ignoring them still restores the deletion.
   Privacy is a fixed filename contract, not secret scanning: recognized credential directories/files
   are excluded; secrets stored under arbitrary source-file names cannot be identified.
4. Checkpoints live privately under the executing machine's data directory, which must be outside
   the checkout. They are independent durable records; no session-format migration is needed.
   Executors capture and undo on the executor through the existing authenticated gateway.
   The first implementation requires Linux's `/proc/self/fd` to prove the opened file and pin
   restore directories; other operating systems fail writing capture explicitly rather than
   follow unverifiable paths. Status uses tiny summary records instead of rereading backup content.

### Undo and concurrency

5. After the provider stops, capture a terminal fingerprint before releasing checkout access.
   Completed, failed and cancelled turns all offer Undo if eligible files changed. No-change turns
   explain that there is nothing to undo. A failure to save the terminal fingerprint leaves the
   original backup but disables automatic Undo.
6. Undo takes exclusive checkout access in the same scheduler, refuses active or queued work on
   the checkout (including other sessions and enclosing/nested checkouts), respects helper reads
   and maintenance, and prevents new overlapping turns from starting until it ends.
7. Before any restore, compare the entire covered checkout to the terminal fingerprint, including
   file identity and modification metadata. Later edits, even an edit followed by a content revert,
   refuse Undo without writing any checkout file. Recheck each changed file just before mutation.
   Restore only changed files: replace original files, recreate removed files, and delete new files.
   Never follow a link or recursively delete a directory. Users must not edit concurrently with
   Undo; filesystem changes cannot be made atomic as a multi-file transaction with an outside editor.
8. Git history and metadata are never restored. HEAD or index changes during the turn disable Undo
   with an explicit explanation; changes after it also refuse Undo. This includes commits, staging,
   checkout and reset. Other `.git` metadata and external actions are outside recovery's scope.
   Compare branch identity and index semantic flags too, including intent-to-add, assume-unchanged
   and skip-worktree; ignore stat-cache metadata refreshed by ordinary Git reads.
9. Persist a restoring marker before mutation. If a restore fails or the process stops during it,
   automatic Undo remains disabled; retain the original backup for manual recovery and explain that
   the checkout may be partly restored. Do not force a retry or roll back over intervening edits.
   A restart before a terminal fingerprint likewise cannot infer ownership of later changes.
   A summary carries the backup file's identity/stamp. If a crash interrupts its replacement,
   status rereads the durable record once instead of trusting a stale ready summary.

### Lifecycle and UI

10. Retain at most ten checkpoints, expiring after seven days, and at most 512 MiB of checkpoint records per
    machine. Limit a capture to 10,000 eligible paths and 10,000 ignored inventory entries,
    4 MiB per file and 32 MiB total file bytes. Prune oldest
    finished/expired records before admitting a capture; never evict an active capture. If active
    captures fill the budget, refuse the next writing turn. Storage errors fail closed.
    Expired bytes are pruned on the next capture. Each durable record is bounded to 48 MiB; its
    atomic replacement temporarily needs one additional record's space. Crash temporaries are
    removed before the next capture.
11. Desktop conversation and VR Session tools show the latest writing turn's recovery state,
    including availability, unavailable reason, expiration and successful Undo. Associate it with
    its user message and keep the transcript after Undo. Explain the exclusions and that recovery
    cannot undo external actions or writes elsewhere in Full access. Confirm the concrete restore
    scope before the user's Undo action; this is a product control, not an agent approval.
12. Read status and request Undo through authenticated, bounded routes. The browser names only
    session/checkpoint identities; checkout paths, backups, limits and restore policy are server-owned.

## Acceptance criteria

- [x] Writing modes capture without changing pre-existing staged, unstaged or untracked work; Ask,
      Plan and queued cancellations do not capture; capture failure prevents provider execution.
- [x] Undo preserves pre-existing work and refuses newer edits, another session's work, changed Git
      state, unsafe paths and scheduler conflicts without modifying the checkout.
- [x] Completed, failed and cancelled turns, checkpoint failures, restart, interrupted restore,
      retention and storage limits follow the contracts above.
- [x] Local, Docker and executor routing preserve credentials, private-file exclusions and mounts.
- [x] Desktop and VR show recovery availability, successful Undo and its checkout-only scope.
- [x] Focused failure/concurrency checks, TypeScript, the verification steps and subagent review pass.

## Out of scope

- Undoing commits or index edits; restoring `.git`, ignored/private files, provider history,
  conversation messages, external services, or other paths reachable in Full access.
- Multi-file atomic transactions with outside editors, automatic crash recovery, and redo.
- Changes to provider sandboxes, credential/customization mounts, or security levels.

## How to verify

1. Run the focused checkpoint, scheduler, route, UI and machine-policy tests and `npm run lint`.
2. In a disposable real Git checkout, stage a change, leave another unstaged, create an untracked
   file and an ignored/private file. A fake writing provider modifies, removes and creates files.
   Verify capture did not touch the index/work, then Undo restores original bytes and staging while
   leaving the ignored/private file alone. Repeat with provider failure and cancellation.
3. Edit a covered file after the turn, then try Undo: it must refuse and preserve the edit. Repeat
   with another session, a staged change/commit, and an unsafe path replacement.
4. Exercise failed capture/terminal capture/restore, restart, expiry/budgets and overlapping checkout
   admission. Verify no provider starts without a checkpoint and no partial recovery is advertised.
5. Render desktop and VR controls through their shared recovery owner; verify confirmation scope,
   disabled/busy states and success. Build the application and run the automated browser journey
   against a fake writing provider, including reload and both themes. Physical Quest input is an
   additional device check, not required to validate this shared control's repository recovery.

## Verification evidence — October 1, 2026

- `npm test`: 104 files, 968 tests passed. The new checkpoint, route and VR suites contain 46 tests,
  using disposable real Git checkouts and injected storage/provider failures. They cover staged,
  unstaged and untracked work; deletions and ignore-rule changes; credential exclusions; Git flags;
  newer edits; unsafe replacements; overlapping scheduler access; restart, interrupted restore,
  expiry, record retention and byte/path limits. Routes exercise completed, failed and cancelled
  turns, pre-provider capture refusal, Local/Docker capture, device authentication and executor
  operation restrictions. Providers and Docker execution are simulated in these checks.
- `npm run lint` and `CODEAI_DIST_DIR=.next-e2e npm run build`: passed.
- `npx playwright test e2e/checkpoints.spec.ts --project=chrome`: one production-browser journey
  passed against the fake writing provider. It verifies durable status after reload, confirmation
  and Keep changes, both themes, exact eligible-file restoration, unchanged staging, private-file
  preservation, transcript retention and refusal of a later human edit. Dark availability and light
  confirmation screenshots were inspected. No real provider or physical Quest run was claimed.
- Review subagent independently ran the checkpoint, route and VR suites (44 tests before the final
  two quota tests), then reported no remaining findings. Its findings about ignored paths,
  intent-to-add flags, stale summaries, credential exclusions, permissions and original tracked
  deletions were fixed and have regression coverage.
