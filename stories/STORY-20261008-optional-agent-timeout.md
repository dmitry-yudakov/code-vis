# Story 100 — Allow Ask/Plan turns without an execution timeout

**Status:** Shipped · **Type:** Server-only · **Depends on:** nothing

**Vision slice:** [Inside a session](../docs/vision.md#inside-a-session): the owner can let a
read-only agent finish a long investigation and explicitly cancel it when needed.

## Motivation

The owner asked to make `CODEAI_AGENT_TIMEOUT_MS` optional after learning that execution timeouts
could not be disabled. Accept zero as an explicit unlimited setting without changing the existing
default for installations that omit it.

## Implementation (where the code is)

- `src/server/config.ts:198` — explicit trimmed `0` disables the Ask/Plan timeout; unset/empty
  keeps 900,000 ms and all other values use the existing positive bounded validation.
- `src/server/agents/claudeProcessRunner.ts:188` and
  `src/server/agents/codexProcessRunner.ts:201` — zero policies never start or restart an execution
  timer; exhausted finite timers keep their existing behavior.
- `src/server/conversation/conversationService.ts:119` — mode continuation checks spent time
  against finite timeouts while preserving zero; elapsed work and used turns stay accounted for.
- `src/server/execution/dockerRuntime.ts:351` — unlimited Ask/Plan workers use `sleep infinity`,
  writing workers retain timeout plus 600 seconds, and setup/login workers keep their own bound.
- `test/runningMode.test.ts:61` — exercises real route/conversation mode changes with fake runners.

## Desired behavior

`CODEAI_AGENT_TIMEOUT_MS=0` disables CodeAI's Ask/Plan execution clock on the executing machine,
for Claude and Codex, Local and Docker. The existing `CODEAI_WEB2_AGENT_TIMEOUT_MS` alias works
with normal precedence. Unset or empty retains the 15-minute default; positive values keep their
current 1-second–1-hour range. Invalid nonzero values still fail validation.

Resolved policy keeps its numeric contract: `timeoutMs: 0` means no execution timer. Provider
runners never start or restart a timeout timer for that policy. Cancellation, protocol/output
bounds, Claude's maximum turns, permissions, checkout locks and provider-owned limits keep their
meaning. The existing Codex runner does not enforce CodeAI's maximum-turn setting; implementing
that is outside this timeout change.

Conversation mode changes preserve zero and existing elapsed-time/turn accounting. A bounded
writing mode still deducts work already spent; an unlimited Ask/Plan mode does not reject elapsed
time or turn it into a negative timeout. Writing timeouts use `CODEAI_BUILD_TIMEOUT_MS` unchanged.

An unlimited Docker Ask/Plan worker uses `sleep infinity`, matching the existing lease command,
instead of ending after the grace period. Completion/cancellation/error cleanup, process-exit
removal and restart reconciliation stay active. A worker abandoned by an abrupt process death has
no time-based expiry when this setting is explicitly zero; the next server reconciliation cleans
it up. Login/setup terminals keep their bounded lifetime.

## Acceptance criteria

- [x] Configuration supports explicit zero, defaults, aliases, precedence and existing positive
  bounds, while leaving the writing timeout's validation unchanged.
- [x] Claude and Codex can complete a zero-timeout turn and cancel one without a timeout error;
  positive execution timeouts still terminate a stalled provider.
- [x] Real conversation execution and mode changes preserve unlimited Ask/Plan policies and
  enforce existing finite time/turn budgets when switching to a bounded mode.
- [x] Docker Ask/Plan workers do not impose an expiry on unlimited turns; normal cleanup works
  and finite writing/setup worker lifetimes stay bounded.
- [x] README, environment example and policy comments document explicit zero, unchanged defaults,
  independent turn/writing limits and Docker recovery behavior.
- [x] Focused regressions fail before implementation, then focused/offline tests, TypeScript and
  independent review pass.

## Out of scope

Disabling writing timeouts or maximum-turn limits, changing the default timeout, editing the
owner's environment, removing provider-internal limits, restarting/deploying the owner server,
or committing without another request.

## How to verify

1. Run `npm test -- test/config.test.ts test/claudeProcessRunner.test.ts test/codexProcessRunner.test.ts test/runningMode.test.ts test/dockerRuntime.test.ts test/agentModes.test.ts`.
2. Run the offline suite with fixture-local settings and `npm run lint`; request independent
   read-only review and fix blockers before shipping.
3. Configure `CODEAI_AGENT_TIMEOUT_MS=0` in `.env.local` and restart the server when applying the
   change. Ask/Plan then keep running until completion, cancellation, or another existing limit.
   `CODEAI_BUILD_TIMEOUT_MS` still controls writing turns.

## Verification record

On October 8, 2026, 14 targeted regressions failed before implementation: configuration rejected
zero, both provider runners ended zero-budget turns immediately, mode continuation refused zero,
and Docker workers still expired after the grace period. After implementation all 188 focused
checks passed, followed by all 1,297 offline tests across 123 files and TypeScript.

The independent reviewer ran the original 186 focused checks and found no critical/high blockers.
Its two lower-priority findings were fixed: explicit zero no longer includes whitespace-only
values (two additional regressions failed before that guard), and docs qualify turn-count limits
by provider. Final review and its 44 configuration checks passed with no remaining findings.

Mode tests cover unlimited Ask → Plan, finite writing → unlimited Plan, and elapsed work retained
when switching from unlimited Ask into a finite writing budget, including exhaustion. Provider
tests cover normal completion and cancellation without an execution timer; existing positive
timeout/protocol/approval tests remain green. Docker tests verify unlimited workers and cleanup
alongside bounded writing/setup workers. Real providers, a real Docker daemon, production build
and browser checks were not needed for this server budget change and were not rerun. The owner's
running server and environment were not changed, and these changes were not staged or committed.
