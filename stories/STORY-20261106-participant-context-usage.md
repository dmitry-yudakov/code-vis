# Story 132 — Participant context usage

**Status:** Shipped · **Type:** Full-stack

## Behavior and contracts

The selected conversation agent has a small filling circle and percentage beside its picker.
Hover or keyboard focus reveals exact used/available token counts. Selecting another participant
shows that participant's own reading; a new participant starts with “not reported yet.” Unknown
capacity shows a neutral circle and dash, retaining any measured token count in the tooltip.

- Codex uses `thread/tokenUsage/updated.tokenUsage.last.totalTokens` and the provider's effective
  `modelContextWindow`. Cumulative `total` usage, child threads, unscoped notifications, stale turns,
  malformed numbers and post-completion events do not fill the current participant's circle.
- Claude uses the latest root assistant request's `input_tokens + cache_read_input_tokens +
  cache_creation_input_tokens`, matching its own status-line percentage. Its result's `modelUsage`
  supplies capacity for that exact root model. Cached tokens count once; aggregate result token
  counts, child usage, synthetic messages and old replayed snapshots are excluded. A previously
  reported capacity is reusable during resumed work only for the same actual model. The first
  turn may show measured tokens without a percentage until its result reports capacity.
- Measurements replace older measurements, so compaction can lower the circle. The tooltip
  identifies the measurement as the last provider report. There is no transcript-based estimate,
  hardcoded model capacity or prediction for an unsent draft/next-model choice.
- Current context streams independently of chat activity. Replay retains one latest snapshot;
  pending streams coalesce context and activity separately while preserving required events.
- One metadata write at the end of each provider attempt persists the addressed participant's
  latest reading, including failures, cancellation and mode changes. A telemetry write failure
  cannot replace the reply or the provider's original error. Reporting upgrades only that session
  to format 14; untouched sessions keep their prior version. Private provider handles remain private.
- Desktop and phone reuse MUI progress/tooltip controls. Known percentages expose an accessible
  meter; unknown usage uses a labelled image role. The warning color at 90% supplements the number.

## Verification

Focused checks cover provider parsing, real process fixtures, saved/public participant isolation,
reload, failure/cancellation, compaction decreases, exact-model capacity reuse, unknown states,
bounded replay and 30,000-update slow-reader delivery. Production browser checks cover both themes,
desktop/phone layout, live/resumed Claude fixture turns, participant switching, reload and saved
Codex usage.

- All 1,969 unit tests across 166 files pass with production `CODEAI_*` environment overrides
  removed. The suite needs its existing disposable `/var/tmp` fixtures and localhost/subprocess
  capabilities outside the workspace sandbox.
- All 22 production-browser cases pass: six new context checks and 16 chronological-chat
  regressions, including large activity bursts, approvals, saved completion and reload.
- TypeScript (`npm run lint`), the isolated production build and `git diff --check` pass.
- Light/dark desktop and phone screenshots were inspected; picker, circle and percentage remain
  visible without overlap. Independent review passed after its findings were fixed and checked.

Real signed-in provider turns and physical device acceptance have not been run for this change.
The running app has not been rebuilt or restarted.

## Protocol references

- [Codex App Server notifications](https://developers.openai.com/codex/app-server), with field names
  verified against the installed CLI's generated `ThreadTokenUsage` and notification types.
- [Claude status-line context fields](https://code.claude.com/docs/en/statusline#context-window-fields)
  specify the input-only percentage and both cache categories.
- [Claude SDK ModelUsage](https://code.claude.com/docs/en/agent-sdk/typescript#modelusage) supplies
  the per-model `contextWindow`; its cumulative token totals are deliberately unused here.
