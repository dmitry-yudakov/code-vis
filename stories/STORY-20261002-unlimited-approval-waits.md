# Story 88 — Keep approval requests pending until the user returns

**Status:** Shipped · **Type:** Server-only · **Depends on:** [Story 19](STORY-20260806-web2-conversation-modes.md)

**Vision context:** the Arena's **Needs you** state in [vision.md](../docs/vision.md#the-arena):
work waits for a human decision, visible across sessions and devices.

---

## Motivation

The user starts a task, leaves CodeAI, and returns to find that a tool request expired before
they could approve it. Automatic denial can make the agent abandon the requested action or
finish an incomplete task. Requests should wait by default, with expiry available when the
machine owner explicitly configures it.

## Implementation (where the code is)

- [src/server/config.ts:201](../src/server/config.ts#L201) — defaults approval waiting to `0`
  (unlimited), with explicitly configured expiry bounded to 5,000–3,600,000 milliseconds.
- [src/server/runs/permissionBroker.ts:23](../src/server/runs/permissionBroker.ts#L23) — creates
  an expiry timer only for positive timeouts; decisions and cancellation settle requests once.
- [src/server/agents/claudeProcessRunner.ts:248](../src/server/agents/claudeProcessRunner.ts#L248)
  and [src/server/agents/codexProcessRunner.ts:352](../src/server/agents/codexProcessRunner.ts#L352)
  — pause the execution budget during approvals and return the human decision to the provider.
- [src/server/runs/runRegistry.ts:416](../src/server/runs/runRegistry.ts#L416) — waiting turns
  retain a concurrency slot and their checkout access; browser detachment preserves the run.
- [test/permissionBroker.test.ts:1](../test/permissionBroker.test.ts#L1) — simulated long waits,
  late human decisions, cancellation, and optional finite expiry.
- [test/config.test.ts:71](../test/config.test.ts#L71) — default and configured timeout validation,
  legacy compatibility, and precedence.

## Desired behavior

1. An unset or zero `CODEAI_APPROVAL_TIMEOUT_MS` means unlimited waiting and is the default.
2. Positive values keep the existing 5,000–3,600,000 millisecond bounds and auto-denial behavior.
   The legacy `CODEAI_WEB2_APPROVAL_TIMEOUT_MS` alias and neutral-name precedence still apply.
3. Unlimited requests create no expiry timer. Allow, Deny, cancellation, and provider completion
   still settle each pending request once; decisions against resolved requests are rejected.
4. Both provider adapters keep pausing the execution timeout during a pending request. Waiting
   cards remain available after leaving or reloading the browser while the run is alive.
5. README, architecture, and the example environment describe the default, optional expiry,
   and the process lifetime and scheduler implications.

### Type contract

`AppConfig.approvalTimeoutMs` stays a number; `0` disables expiry. No wire or session-format change.

## Acceptance criteria

- [x] Unset and explicit zero approval timeouts disable expiry; legacy aliases and precedence work.
- [x] Positive timeout bounds remain unchanged and invalid values fail configuration validation.
- [x] An unlimited request remains pending beyond the old timeout and can subsequently be allowed
      or denied; cancelling unlimited requests settles them and rejects late decisions.
- [x] Explicit finite expiry still settles as timeout and rejects late decisions.
- [x] Claude and Codex offline provider checks cover unlimited approval, execution timeout pause,
      and cancellation; scheduler checks retain existing waiting behavior.
- [x] TypeScript and the focused checks pass, and an independent review has no remaining findings.
- [x] Active documentation and example configuration match the shipped behavior.

## Out of scope

- Releasing checkout locks or execution slots while a provider waits.
- Resuming provider processes or approvals across a server restart or provider exit.
- Changing checkpoint retention: seven days from capture still bounds Undo availability, including
  turns left waiting that long.
- A browser setting for the timeout or a provider-specific approval policy.

## How to verify

1. Run the focused checks:

   ```sh
   npm test -- test/config.test.ts test/permissionBroker.test.ts test/claudeProcessRunner.test.ts test/codexProcessRunner.test.ts test/runScheduler.test.ts
   ```

   Broker checks advance simulated time beyond the former default; fake providers exercise the
   real approval protocols, execution clock pause, and cancellation.
2. Run `npm run lint` and `git diff --check`.
3. Review the resulting diff with an independent subagent and resolve concrete findings.
4. Optional running-app check: with the timeout unset or `0`, start a Local approval-capable turn,
   leave the browser for more than ten minutes, return, and allow the pending card. Restart with
   `CODEAI_APPROVAL_TIMEOUT_MS=5000` and confirm an unanswered card expires after five seconds.

## Verification evidence

- TDD: the added checks first failed against the old implementation (six failures), including
  the default configuration and unlimited broker waits; finite expiry checks already passed.
- Focused Vitest verification: five files / 89 tests passed, including simulated thirty-day
  broker waits, late decisions, finite expiry, both provider protocols, execution clock pause,
  cancellation, and scheduler ownership during approval waits.
- `npm run lint` and `git diff --check` passed.
- Two independent reviews, including a fresh pre-merge review, reported no actionable findings.
  Each reran configuration and broker verification: two files / 36 tests passed, plus a clean
  diff check.
- The optional real-provider/browser wait journey was not run; no provider policy or UI change
  was required, and the offline checks exercise both actual adapter approval protocols.
