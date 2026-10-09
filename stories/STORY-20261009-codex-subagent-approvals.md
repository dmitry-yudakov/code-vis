# Story 102 — Route Native Codex subagent approvals to their conversation

**Status:** Shipped · **Type:** Server-only · **Depends on:** [Story 82](STORY-20261001-native-security-level.md)

## Motivation

Native Local Codex writing turns allow provider-managed review subagents, but CodeAI accepts
approval callbacks only when their thread and turn identifiers match the main agent. A reviewer
can therefore lose the ability to ask the owner for a command or file-change approval. The owner
asked to implement descendant routing with a test subagent driving TDD and independent reviews
until critical findings are resolved.

## Current behavior (where the code is)

- [codexSubagentThreads.ts:26](../src/server/agents/codexSubagentThreads.ts#L26) owns bounded
  provider ancestry, current child turns, metadata discovery and verified cleanup targets.
- [codexProcessRunner.ts:347](../src/server/agents/codexProcessRunner.ts#L347) routes root and
  verified descendant callbacks through the run's existing broker and answers original RPC IDs.
- [codexProcessRunner.ts:446](../src/server/agents/codexProcessRunner.ts#L446) handles child
  lifecycle separately from root output, including ancestry invalidation and provider resolution.
- [permissionBroker.ts:39](../src/server/runs/permissionBroker.ts#L39) cancels one ended provider
  callback without closing unrelated or future cards.
- [codexInvocation.ts:126](../src/server/agents/codexInvocation.ts#L126) continues to inherit
  Native integrations while disabling subagents in Guarded execution.
- [codexSubagentApprovals.test.ts:1](../test/codexSubagentApprovals.test.ts#L1) and
  [codexSubagentThreads.test.ts:1](../test/codexSubagentThreads.test.ts#L1) own the failure-first
  routing/lifecycle regressions and bounded ancestry checks; existing Native/Codex checks remain.

## Desired behavior

1. In Native Local writing turns, accept command/file callbacks only from the root's verified
   spawned descendants and their live turns. Use provider-owned thread metadata, never a model's text, working-directory similarity, or an arbitrary browser ID. Bound
   discovery state and asynchronous metadata lookups. Unknown, unrelated, malformed, closed,
   stale, conflicting-parent and unsupported requests fail closed.
2. Verify actual App Server delivery/subscriptions with the installed Codex. The installed 0.161.0 probe delivers child events/approvals on the root connection without
   extra subscriptions; use bounded `thread/read` when metadata is absent, without sending a new
   child task or replacing its policy. Prove parentage through the root, including nested children and resumed
   roots; older metadata can use the provider's documented source parent where available.
3. Show the existing permission card in the same CodeAI run/conversation, identifying it as a
   subagent request and preserving its command/file detail. The browser sends the same run ID,
   request ID and Allow/Deny decision. The original RPC callback ID is answered exactly once;
   no new browser/server wire contract, provider rules store, or session format is required.
4. Keep child output, usage, errors and completion distinct from the parent's final result. Child
   failures may be shown as activity, but never overwrite the final answer or finish the whole run.
   Handle colliding item IDs across threads without borrowing another agent's file-change detail.
5. Close child cards on their own request/turn/thread lifecycle and close all cards on parent
   completion, provider exit, cancellation or mode change. Late answers cannot approve a completed
   child, replacement turn or completed run. Cancel verified active descendant turns along with
   the root, maintaining checkout ownership until the existing runner termination boundary.
6. Keep Guarded, Docker, Ask/Plan and unrelated Native control requests unchanged. Do not enable
   turn-wide permission tools or grant capabilities based solely on shared provider session IDs.

## Acceptance criteria

- [x] A real installed-Codex probe establishes spawn ancestry, child approval delivery, lifecycle,
      response correlation and any required subscription operation without credential access or
      changes to the owner's provider configuration.
- [x] Failure-first regressions from a test subagent fail before implementation and pass afterward
      for direct/nested children, resumed root, Allow/Deny and file/command requests.
- [x] Unknown/malformed/conflicting ancestry, stale child turns, duplicate callbacks and unsupported
      controls cannot gain approval; discovery and lookup state are bounded.
- [x] Child cards use the root's existing run/session broker and identify their source; child events
      cannot overwrite the parent's answer, usage, file details or completion.
- [x] Child and parent completion/exit, callback resolution, cancellation and mode-change teardown
      settle cards once and reject late decisions; verified descendant turns are interrupted.
- [x] Guarded, Docker, Ask/Plan and Native permission-feature settings retain their contracts.
- [x] Focused tests, the offline suite, TypeScript, production build and whitespace checks pass.
- [x] Independent review subagents find no unresolved critical/high issues; relevant documentation
      and real-provider evidence describe the implemented behavior and its verified limits.

## Out of scope

- Persistent approvals (Story 101 remains blocked), changing provider setup, upgrading a CLI,
  staging/committing, restarting/deploying the running application.
- A separate CodeAI roster/session per provider subagent, full child transcripts, new subagent UI,
  Claude changes, or subagent enablement in Guarded/Docker/Ask/Plan.

## How to verify

1. Probe actual Codex App Server in a disposable checkout/provider runtime home. Let only Codex
   read its existing login through read-only mounts; never read/copy credentials. Record actual
   protocol behavior, version, request ordering and cleanup in `docs/experiment-log.md`.
2. Have a test subagent add meaningful regression fixtures/tests and demonstrate the failures.
   Run them after the implementation, then focused Codex/Native/broker/scheduler tests.
3. Run `npm test`, `npm run lint`, `npm run build`, and `git diff --check`.
4. Repeat a real delegated review with the actual runner, including an owner-answered child request.
   Confirm parent continuation and no stale live child/card after completion or cancellation.
5. Run independent reviews and resolve/recheck critical findings. Record unperformed browser,
   attached-transport and physical Quest acceptance separately; this story reuses their unchanged
   approval transport and surfaces.

## Implementation evidence — October 9, 2026

The installed provider confirmed direct child event/callback delivery without another subscription;
parent metadata is fetched lazily when the spawn/thread notification is absent. See
[the experiment log](../docs/experiment-log.md#story-102--native-codex-subagent-approval-routing-2026-10-09)
for exact probe scope and limits. Actual Native Auto/Agent delegated reviews and Auto cancellation
passed through the updated runner. No production restart, provider configuration/rules change,
credential access, staging, commit or deployment occurred.

The requested test subagent demonstrated regressions failing before implementation, including
review-discovered races. Security and lifecycle reviewers were run independently and repeated after
fixes. Both final reviewers reported no unresolved actionable findings, including the asynchronous
metadata-failure cleanup; each independently passed all 64 descendant/helper/broker checks.

Final exact-source validation: all **1,355 offline tests** in 125 files, strict TypeScript,
production build and `git diff --check` passed. Automated evidence covers direct/nested/resumed
ancestry, command/file Allow/Deny, typed callback identities, bounded discovery, stale turns,
completion/exit, parent/child simultaneous cards, timeout and mode-interruption teardown paths.
Real provider evidence covers direct command approvals in Native Auto and Agent, parent continuation,
and cancellation. Browser checks, production attached transport and physical Quest were not rerun;
the existing approval wire format and surfaces were reused unchanged.
