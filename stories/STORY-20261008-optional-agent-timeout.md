# Story 100 — Allow turns without an execution timeout

**Status:** Shipped · **Type:** Server-only · **Depends on:** nothing

**Vision slice:** [Inside a session](../docs/vision.md#inside-a-session): the owner can let an
agent finish a long task and explicitly cancel it when needed.

## Motivation

The owner asked to make `CODEAI_AGENT_TIMEOUT_MS` optional after learning that execution timeouts
could not be disabled. Accept zero as an explicit unlimited setting without changing the existing
default for installations that omit it.

The November 5 follow-up extends this to `CODEAI_BUILD_TIMEOUT_MS=0`: an Auto turn hit the
separate one-hour writing budget even though Ask/Plan was already configured without a timeout.

## Implementation (where the code is)

- `src/server/config.ts` — explicit trimmed `0` disables the selected Ask/Plan or writing
  timeout; unset/empty keeps each default and all other values use positive bounded validation.
- `src/server/agents/claudeProcessRunner.ts:188` and
  `src/server/agents/codexProcessRunner.ts:201` — zero policies never start or restart an execution
  timer; exhausted finite timers keep their existing behavior.
- `src/server/conversation/conversationService.ts:119` — mode continuation checks spent time
  against finite timeouts while preserving zero; elapsed work and used turns stay accounted for.
- `src/server/execution/dockerRuntime.ts` — unlimited turn workers use `sleep infinity`,
  finite workers retain timeout plus 600 seconds, and setup/login workers keep their own bound.
- `test/runningMode.test.ts:61` — exercises real route/conversation mode changes with fake runners.

## Desired behavior

`CODEAI_AGENT_TIMEOUT_MS=0` disables CodeAI's Ask/Plan execution clock on the executing machine,
for Claude and Codex, Local and Docker. The existing `CODEAI_WEB2_AGENT_TIMEOUT_MS` alias works
with normal precedence. Unset or empty retains the 15-minute default; positive values keep their
current 1-second–1-hour range. Invalid nonzero values still fail validation.

`CODEAI_BUILD_TIMEOUT_MS=0` independently disables the execution clock for writing modes
(Agent, Auto, Accept edits and Full access), for both providers and execution targets where
supported. Unset/empty retains one hour, and positive values retain the 1-second–2-hour range.
The legacy `CODEAI_WEB2_BUILD_TIMEOUT_MS` alias follows the same precedence. Neither setting
changes the other's timeout, maximum-turn counts, permissions or provider-owned limits.

Resolved policy keeps its numeric contract: `timeoutMs: 0` means no execution timer. Provider
runners never start or restart a timeout timer for that policy. Cancellation, protocol/output
bounds, Claude's maximum turns, permissions, checkout locks and provider-owned limits keep their
meaning. The existing Codex runner does not enforce CodeAI's maximum-turn setting; implementing
that is outside this timeout change.

Conversation mode changes preserve zero and existing elapsed-time/turn accounting. A bounded
mode still deducts work already spent; an unlimited mode does not reject elapsed time or turn it
into a negative timeout.

An unlimited Docker turn worker uses `sleep infinity`, matching the existing lease command,
instead of ending after the grace period. Completion/cancellation/error cleanup, process-exit
removal and restart reconciliation stay active. A worker abandoned by an abrupt process death has
no time-based expiry when this setting is explicitly zero; the next server reconciliation cleans
it up. Login/setup terminals keep their bounded lifetime.

## Acceptance criteria

- [x] Configuration supports explicit zero, defaults, aliases, precedence and existing positive
  bounds for both Ask/Plan and writing timeouts.
- [x] Claude and Codex can complete a zero-timeout turn and cancel one without a timeout error;
  positive execution timeouts still terminate a stalled provider.
- [x] Real conversation execution and mode changes preserve unlimited policies and
  enforce existing finite time/turn budgets when switching to a bounded mode.
- [x] Docker workers do not impose an expiry on unlimited turns; normal cleanup works
  and finite turn/setup worker lifetimes stay bounded.
- [x] README, environment example and policy comments document explicit zero, unchanged defaults,
  independent turn/writing limits and Docker recovery behavior.
- [x] Focused regressions fail before implementation, then focused/offline tests, TypeScript and
  independent review pass.

## Out of scope

Disabling maximum-turn limits, changing default timeouts, removing provider-internal limits,
restarting/deploying the owner server, or committing without another request. The November 5 fix
also configures the owner's `.env.local` writing timeout to zero; applying it needs a rebuild/restart.

## How to verify

1. Run `npm test -- test/config.test.ts test/claudeProcessRunner.test.ts test/codexProcessRunner.test.ts test/runningMode.test.ts test/dockerRuntime.test.ts test/agentModes.test.ts`.
2. Run the offline suite with fixture-local settings and `npm run lint`; request independent
   read-only review and fix blockers before shipping.
3. Configure `CODEAI_AGENT_TIMEOUT_MS=0` in `.env.local` and restart the server when applying the
   change. Ask/Plan then keep running until completion, cancellation, or another existing limit.
   `CODEAI_BUILD_TIMEOUT_MS=0` does the same for writing turns; configure either independently.

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

### November 5, 2026 — Unlimited writing turns

Six configuration/mode regressions failed before the fix because zero writing timeouts were
rejected. The follow-up accepts trimmed explicit zero for the writing setting with normal alias
precedence, without changing defaults or positive validation. Existing zero-aware runners,
conversation accounting and Docker lifetime handling need no implementation changes.

All 350 focused checks across configuration, both provider runners, mode changes, Docker runtime,
mode policy and Native security pass, along with `npm run lint` and `git diff --check`. Coverage
includes a real fixture Codex runner through the message route in Native Auto, successful durable
delivery, explicit cancellation, checkpoint finalization, released admission, unlimited writing
mode switches after one hour, and elapsed work carried into a later finite Ask budget. Docker
checks include unlimited Agent cleanup and bounded setup workers. Independent read-only review
found no correctness issues.

The focused checks run without inherited `CODEAI_*` settings. Two Docker customization cases
needed a rerun outside the sandbox because their existing fixtures live under `/var/tmp`.
Real providers, a real Docker daemon, production build and browser checks were not rerun.
The owner's ignored `.env.local` now has `CODEAI_BUILD_TIMEOUT_MS=0`; the running application
has not been rebuilt or restarted.
