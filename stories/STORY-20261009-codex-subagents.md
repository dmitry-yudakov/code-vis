# Story 103 — Allow requested Codex subagents

**Status:** Shipped · **Type:** Backend fix · **Depends on:** Stories 20, 79, 82

## Problem and behavior

CodeAI told Guarded Codex turns that their bounded conversation forbids subagents, disabled
`multi_agent`, and rejected delegation events. This prevented an explicitly requested independent
review even when the repository's instructions required one.

Guarded Codex now enables built-in subagents. The user or applicable repository instructions can
request delegation in ordinary conversation. Docker's prompt permits available built-in subagents
inside the same container. Native keeps its provider configuration. Skills, integrations, hooks,
web search, and turn-wide permission requests retain their existing restrictions.

## Execution contract

- Start and resume receive the same capability settings and updated developer instructions.
  Subagents inherit the turn's permissions; no sandbox or approval policy is widened.
- Current `subAgentActivity` and legacy `collabAgentToolCall` events discover candidates.
  Bounded provider metadata proves ancestry through the root; spawn hints cannot override
  conflicting metadata. Only a verified descendant's current turn can raise a permission card.
- Child activity appears in the existing timeline. Child text, errors, usage, final messages and
  completion cannot replace or finish the parent's answer. Item identities include the thread and turn ids.
- One broker handles concurrent approvals and pauses the shared execution clock. Provider-resolved
  requests, child interruptions and parent completion cancel obsolete cards without permitting work.
- Cancellation starts cleanup without waiting for the parent to acknowledge interruption. Cleanup
  terminates retained terminals, including those from completed children, before closing input.
  Local Codex requires the experimental background-terminal inventory/termination protocol before
  user input is sent. Docker's transport still confirms whole-container termination independently.
- On Linux, bounded snapshots track host descendants across all provider threads. Captured
  identities include process start time; parent identities are checked throughout traversal and
  identities are rechecked before signalling. Live orphan identities remain tracked after wrapper
  exit; dead or reused identities are pruned. Surviving descendants stop after launcher exit,
  before inherited stdio can hold the run open or the checkout lease can be released.
- Unconfirmed stopping retains the checkout and machine slot, reports “Stopping Codex”, and
  retries. One denied signal does not prevent attempts to stop other workers. Partial inventories
  preserve proved identities and enforce their bound before verifying more processes. An
  incomplete inventory clears only with a complete capture anchored to the original live launcher.
- Exit closes control input, cancels cards and rejects obsolete RPC waits independently of stdio.
  Its cleanup barrier stops workers both before and after the SDK's final capture, so late workers
  with inherited output cannot block the stop needed to close that output. Repeated launcher kill
  errors retain their listener and remain in cleanup rather than settling as startup failures.

The process fallback reads process metadata only, never command lines, environments or credentials.
It cleans up observed descendants; polling cannot contain arbitrary processes that detach before
being captured. Native external effects and deliberately detached work remain outside checkout Undo.

## Incoming branch verification (before integration)

The initial regressions failed against the old feature settings, instructions and event handling.
Focused checks cover start/resume, all Guarded modes, Docker, both event formats, nested delegation,
foreign/stale approvals, file-subject collisions, concurrent approvals, denial, provider cancellation,
late requests and children, terminal cleanup failure, missing protocol support, provider crash and
inherited stdio and terminals exiting between inventory and termination. Real Linux process tests
cover detached descendants, orphans while a sibling remains, and mismatched identities.

The requested repeated review independently reproduced further critical lifecycle defects: a
denied signal released admission beside a live captured worker; a bounded capture discarded
already proved identities; final SDK captures could arrive after the first stop, including workers
whose inherited output prevented `close`; and runtime launcher errors bypassed cleanup and consumed
the only error listener. Repairs have regressions that failed before their fixes, including an
actual inherited-output worker, plus complete/incomplete inventory and startup-failure checks.

Real Codex CLI 0.161.0 probes used disposable `/tmp` checkouts and the owner's existing sign-in,
without reading or copying credentials. A read-only child could read a marker but could not write.
The actual CodeAI Auto runner delegated an eligible marker edit, surfaced a child's protected-path
approval, respected denial, preserved the protected marker, and returned the parent's summary.
Heartbeat cancellation initially demonstrated surviving worker processes despite a successful
terminal-termination response. Captured Linux descendant cleanup then stopped the heartbeat before
the runner returned; normal delegated completion also passed.

All 1,373 offline tests pass. `npm run lint`, the production build with
`CODEAI_DIST_DIR=.next-e2e`, and `git diff --check` pass. Independent review found and verified
repairs to approval, shutdown, orphan-retention and terminal-exit races; its final review found no
remaining blockers. Two review subagents independently reproduced the critical failure paths
and verified their repairs through repeated review. Final real CodeAI Ask, Auto and
heartbeat-cancellation probes pass, with the
protected marker unchanged, no pending cards and heartbeat bytes stable after cancellation.

Noncritical follow-ups remain: readiness can advertise a CLI whose missing terminal protocol is
then refused by the runner before input, and a persistent process-metadata read failure may delay
stopping accessible siblings. Unconfirmed cleanup retains admission in the latter case.

A signed-in Docker provider turn, other operating systems, attached transport, browser and
physical Quest checks were not rerun. The running application was not restarted or deployed.

## Integration acceptance — October 9, 2026

Integrate incoming `f3e8d08` into `044bd89`, common base `8e1a7f0`, without a commit or index
change. Preserve Story 102's Native approval guarantees and bounded lazy `thread/read` discovery,
plus requested Guarded delegation and admission retained through cleanup. One tracker and one
broker own the entire thread tree. Story 101 remains blocked; Machine settings and concurrent
worktree creation are renumbered 104 and 105.

- [x] Retain both regression suites and reconcile current/legacy/lazy fake-provider notifications.
- [x] Closed/conflicting ancestry, typed/deduplicated callbacks, turn-scoped file details,
      broker registration before publication and concurrent approval clocks remain protected.
- [x] Native and Guarded approvals use the parent broker; noninteractive and Docker escalations
      remain refused, and child output cannot replace the parent result.
- [x] Cancel before sending input; correlate early root callbacks with the actual started turn.
- [x] Clean up background commands and verified descendants before releasing admission.
      Outside Linux, unconfirmed SDK stopping or thread ownership retains admission, including
      late discovery and discovery overflow; no unverified thread becomes a cleanup target.
- [x] Focused regressions, full offline suite, TypeScript and isolated production build pass.
- [x] Bounded installed-provider delegation/approval/cancellation probes are recorded.
- [x] Repeated independent security/lifecycle reviews leave no actionable critical/high/medium
      findings, and documentation records actual evidence and limits.

### Where the code is

- `src/server/agents/codexInvocation.ts:32` — Guarded capabilities and delegation instructions.
- `src/server/agents/codexSubagentThreads.ts:28` — bounded ancestry, turn/card validity and
  previously verified cleanup ownership, separate from permission eligibility.
- `src/server/agents/codexProcessRunner.ts:182` — typed callbacks, one tracker, startup and
  approval reconciliation, SDK/process cleanup and admission barrier.
- `src/server/agents/processDescendants.ts:36` — bounded Linux identity snapshots and stopping.
- `test/codexSubagentApprovals.test.ts:88`, `test/codexCleanupContract.test.ts:18` and
  `test/codexRootApprovalCorrelation.test.ts:1` — integration approval and lifecycle regressions.

### Integrated verification before the pre-commit review

All **1,440 offline tests in 131 files**, strict TypeScript, the isolated production build
(`CODEAI_DIST_DIR=.next-e2e npm run build`) and `git diff --check` pass. The initial restricted
build could not fetch the existing Google fonts; the network-enabled retry passed. Linux process
regressions and the full suite ran outside the execution sandbox so wrapper/worker signals behaved
as they do on the host. The running app's build directory was not changed.

The test subagent reproduced the five incoming approval regressions and the surviving-worker
cleanup defect. Review found and repaired early stale root callbacks, startup cancellation that
could still send input, unverified/late child cleanup, delayed start identity, failed interrupts
and metadata overflow. Both independent reviewers repeated their reviews and reported no
remaining actionable critical/high/medium findings. The dedicated root correlation tests also
failed against frozen `044bd89` before passing against integration.

Bounded real `codex-cli 0.161.0` probes passed Guarded Ask delegation, Guarded Auto protected-path
approval denial, Native Agent child approval denial/parent continuation and foreground heartbeat
cancellation. Every run finished with zero pending cards; the cancelled heartbeat remained stable
after settlement. All used the experimental handshake and left the owner's credentials and
configuration untouched. Notification ordering and exact outcomes are recorded in
[the experiment log](../docs/experiment-log.md#stories-102105--codex-integration-2026-10-09).

Physical macOS/non-Linux, signed-in Docker, production attached transport, browser and Quest
checks were not rerun. Simulated macOS regression workers are real processes; unconfirmed SDK
stopping, child ownership or inventory deliberately keeps admission, potentially indefinitely.
Linux snapshots cover observed descendants, not arbitrary work detached before capture.
No staging, commit, deployment or running-app restart occurred.

## Pre-commit review follow-up

The owner subsequently requested another independent review followed by a commit. That review
reproduced a host fallback race: after SDK cleanup attempts, the additional host `SIGTERM` let a
captured worker's TERM handler spawn a detached replacement and exit. The runner then settled
while that replacement survived. The host fallback must force-stop captured workers without
opening another graceful handler window; SDK interruption/terminal cleanup remains the graceful
path. This tightens stopping of observed descendants and does not claim containment of arbitrary
processes detached before capture.

- [x] Failure-first real-process regressions reproduce the TERM replacement race.
- [x] Host fallback force-stops captured descendants without running another TERM handler.
- [x] Focused regressions, full suite, TypeScript and isolated build pass after the fix.
- [x] Independent review is repeated after repairs and finds no actionable critical/high/medium
      issues before the owner's authorized commit.

The original unstaged/no-commit evidence above describes the completed integration phase. This
follow-up explicitly authorizes committing the reviewed integration, preserving both branch
parents. No deployment or running-app restart is authorized.

Final pre-commit evidence: **1,442 offline tests in 132 files**, strict TypeScript, the isolated
production build and whitespace checks pass. The helper and runner/admission regressions both
failed before the fix; the runner no longer creates the detached replacement. The independent
reviewer repeated the actual runner reproduction and final audit, finding no remaining actionable
critical/high/medium issues. The real Guarded Auto foreground heartbeat cancellation probe was
repeated: SDK terminal stopping succeeded, host force cleanup completed, the runner returned
`cancelled`, heartbeat size stayed 20 bytes across the follow-up interval and no cards remained.

Host `SIGKILL` fallback covers the launcher as well as captured descendants; SDK interruption and
background-terminal termination, then EOF, remain the graceful path. Linux polling still covers
observed descendants and cannot contain arbitrary work detached before capture, including through
a provider-owned graceful signal handler. No operating-system containment guarantee is added.
