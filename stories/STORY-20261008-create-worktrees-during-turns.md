# Story 102 — Create a worktree while another Local task uses its repository

**Status:** Shipped · **Type:** Backend fix · **Depends on:**
[Story 98](STORY-20261007-worktree-creation-admission.md),
[session setup](STORY-20261007-compose-new-session.md)

## Problem and behavior

Creating a new CodeAI session from the gear returned a worktree conflict while another CodeAI
turn was running. Story 98 only removed machine-wide exclusion for unrelated repositories; it
deliberately excluded the same source and all sibling worktrees. That prevented starting an
independent Local task at the moment the owner needed it.

Creation now admits existing Local turns at the exact verified source root and freshly verified
ready managed sibling roots. Reserved, queued, running and approval-blocked Local turns are
compatible. Creation uses a captured committed SHA, a unique branch and a new worktree index;
unfinished source/sibling edits and later source commits remain untouched. Newly submitted
affected turns wait for the short creation operation, then follow normal per-checkout scheduling.
Both Arena and the fixed managed CodeAI gear route use this admission.

## Contracts retained

- Keep the singleton creation gate and full affected paths through intent, mutation, session
  persistence and confirmed helper cleanup. Maintenance and another creation remain exclusive.
- Concurrent turn authority comes from fresh structural source validation and exact ready-journal
  linkage. Nested/enclosing, unknown, unregistered, damaged and unfinished scopes remain blockers.
  Undo retains exclusive affected-checkout admission.
- Explicitly read-only Git operations and managed Docker Ask/Plan leases can coexist. Docker
  writing turns and workers' writable-metadata leases still block host Git creation. Every reader
  still excludes new overlapping writers, Undo and maintenance until confirmed termination.
- A new Docker managed worker still cannot run while an ordinary-source writer can replace its
  common Git bind root. Local workers can run independently; supported existing Docker siblings
  retain their previous concurrency. No bind, sandbox or provider permission is widened.
- After provisioning, concurrent Local managed checkpoints/Git reads and creating-state recovery
  pin the verified common Git directory with a read-only local-driver volume. Ordinary leased
  reads retain their existing binds. Retain readers and descriptor until container removal and
  volume absence are confirmed; reconcile old owned pins after their helpers. A daemon unable
  to access the host descriptor refuses the concurrent read without a host-Git fallback.
- Capture the baseline once and retain request/session/worktree identities on retries. Recheck
  source identity, metadata containment and strict configuration immediately before mutation;
  recheck destination linkage before materialization and persistence. These checks refuse source
  replacement, redirected refs, planted filters and destination retargeting at the journal and
  mutation boundaries. They do not revoke the host authority of an approved or Native Local turn.
- Retry a complete metadata scan on transient ENOENT, at most twice within the original entry/time
  budget. Symbolic links and malformed metadata never become an allowed transient condition.
- No durable or wire format changes, new dependencies, automatic retries, deployment or restart.

## Verification

The initial real-Git regressions failed with HTTP 409 for both a running source turn and a running
managed sibling turn before the admission fix. They now verify a separate committed checkout,
unchanged dirty files/index, and the original task remaining active, with and without Docker
provisioning. A real-Git fixed gear-route regression covers the owner's original entry point.

Further deterministic checks cover a source commit after baseline capture, fresh ready/damaged
sibling membership, exact-root exclusion, queued affected work, compatible read-only mounts,
Docker writing leases, Undo, and retained cleanup. Review identified two unsafe mutation boundaries;
regressions now inject a common Git root replacement, a refs symlink, a real checkout filter
(including after provisioning), and destination retargeting, and assert no external ref/filter
or materialization effects.

The production browser gear regression starts a second approval-blocked Local task while the source
task stays active and selected, then checks both active runs and their independent checkout files.
Both themes' creation/Undo/New chat flows, launcher choices, lost-response retry and Arena retry
also pass (six browser checks). The gear's parent availability transport is simulated; actual fixed
route creation is covered separately with real Git.

The real Docker probe verifies the original common-directory inode across rename/replacement,
provisioned Local creation/recovery/checkpoint plus two independent running turns, read-only
worker admission, exact writable Docker mount permissions, Git and worktree-only Undo. No provider
login is needed. Deterministic helper tests cover lost volume/container responses, changed pre-start
linkage, retained descriptors/readers through unconfirmed cleanup, source Undo exclusion and
owner/instance-scoped orphan recovery. A temporary failed recovery inspection stays retryable;
its regression failed before the catch-all ambiguity classification was removed.

All 1,326 offline tests, TypeScript and the production build pass. Repeated independent review
identified and resolved the mutation-boundary and recovery issues; final review has no remaining
critical/high finding. No deployment or running-app restart was performed. Signed-in provider,
production attached-executor transport, Linux Docker Desktop concurrency and physical Quest checks
were not rerun.
