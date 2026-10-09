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
- Current `subAgentActivity`, legacy `collabAgentToolCall`, and parent-linked thread notifications
  prove membership. Only a known descendant's current turn can raise a permission card.
- Child activity appears in the existing timeline. Child text, errors, usage, final messages and
  completion cannot replace or finish the parent's answer. Item identities include the thread id.
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

## Verification

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
