# Story 99 — Keep rotating server logs in the checkout

**Status:** Shipped · **Type:** Server-only · **Depends on:** nothing

**Vision slice:** [Inside a session](../docs/vision.md#inside-a-session): an agent investigating
CodeAI can read the installation's diagnostic output directly from its checkout.

## Motivation

The owner wants environment-configured rotating server log files inside the project, so a coding
agent can investigate problems without asking the owner to copy console output.

## Implementation (where the code is)

- `package.json:10` — normal server commands run through the common output launcher; the existing
  `tsx` package is a runtime dependency so production-only installations can still start.
- `scripts/run-server.ts:7` — loads log settings with Next environment precedence without forwarding
  file-loaded values into Next's shell environment, preserving development environment reloads.
- `scripts/run-server.ts:19` — captures both streams once, with console backpressure, inherited
  child output, argument forwarding, signals and exit codes intact.
- `scripts/run-server.ts:23` — a failed console destination shuts down the child through SIGTERM,
  keeps both streams draining through large shutdown writes, waits for them to close, flushes the
  log and returns exit code 1; catchable unexpected launcher exits also send SIGTERM through an exit hook.
- `scripts/serverLogging.ts:17` — validates opt-in directory, byte and retention settings and aliases.
- `scripts/serverLogging.ts:40` — creates/checks ordinary directory components before writes and
  rotation; current files are opened without following links and must be regular, singly linked files.
- `scripts/serverLogging.ts:74` — bounded line buffering, split UTF-8 decoding and shutdown flush.
- `scripts/serverLogging.ts:145` — rotates exact owned filenames and handles failures once.
- `scripts/managedLifecycle.ts:247` — existing inherited output includes managed servers and builds.
- `test/serverLogging.test.ts:29` and `test/serverLauncher.test.ts:42` — rotation and real subprocess
  regressions, including inherited output, settings, failures and managed rollback signals.

## Desired behavior

Setting `CODEAI_LOG_DIR=./logs` opts into timestamped, plain-text `server.log` output from stdout
and stderr, while preserving console output. Relative directories resolve from the project root;
absolute paths and `~/` work too. Unset means no files. Environment files use Next's normal
development/production loading and every setting accepts its `CODEAI_WEB2_*` alias.

`CODEAI_LOG_MAX_BYTES` defaults to 10 MiB (1 KiB–100 MiB).
`CODEAI_LOG_MAX_FILES` defaults to five files total (1–100), including `server.log` and numbered
archives (`server.log.1` is newest). Rotation is byte-bounded, including oversized lines, and
appends across launches. Lowering the byte cap bounds new output while preserving existing history
at its previous size until it ages out. One running launcher owns each configured directory; concurrent servers
must use different directories. Logging failures warn once and leave console/server operation intact.

Capture `dev` (including `devs`), `start`, `start:remote`, and `start:managed`. The managed parent's
server replacements and rebuilds share its one output capture. Preserve argument forwarding,
shutdown signals, SIGUSR2 rollback, and exit codes. Do not add application/request/prompt logging.
If a console destination fails, stop and reap the child through normal shutdown, flush captured
output, and return a failure code instead of leaving an orphaned server.
The standard `logs/` directory is Git-ignored; document ignoring custom locations and direct file
access for agents. Existing diagnostic switches keep their meaning.

## Acceptance criteria

- [x] Opt-in settings load from environment files, with aliases, precedence and bounded validation;
  disabled logging creates no directory.
- [x] Both streams reach console and readable timestamped files; split UTF-8, partial lines,
  multiline errors, and oversized output remain bounded and readable.
- [x] Rotation retains the configured total file count and bounds new output across restarts;
  initialization/write failures preserve console output and log files do not follow symlinks.
- [x] All server npm commands use the capture; inherited child output is recorded exactly once,
  arguments, exit codes, shutdown and managed rollback signals work.
- [x] A broken stdout or stderr destination shuts down the child and returns a failure code after
  flushing the log, including 2 MiB shutdown writes with both destinations closed, instead of
  crashing or hanging the launcher and leaving the server running.
- [x] Environment example, README, Git ignore and repository instructions explain enabling logs
  and reading them from the project without committing them.
- [x] Focused tests, TypeScript, real isolated server smoke checks and independent review pass.

## Out of scope

Browser logs, a logs API/UI, request tracing, provider transcript dumps, dependency additions,
multi-writer rotation in a shared directory, deployment, or restarting the owner's running server.

## How to verify

1. Run `npm test -- test/serverLogging.test.ts test/serverLauncher.test.ts test/managedLifecycle.test.ts`
   and `npm run lint`.
2. Start an isolated server with `CODEAI_LOG_DIR` pointing at a temporary directory, make a request,
   stop it, and inspect `server.log`. Verify startup/error output and clean shutdown. Probe the real
   development launcher and production startup error without changing the owner's running process.
3. For normal use, put `CODEAI_LOG_DIR=./logs` in `.env.local`, restart with the usual npm command,
   and ask the agent to inspect `logs/server.log` and the numbered archives. Optional
   `CODEAI_DEBUG_AGENT=1` adds the existing compact turn diagnostics.

## Verification record

On October 8, 2026, all 54 focused tests and TypeScript passed. Tests cover byte bounds, total
retention, restart append, reduced limits, Unicode fragmentation, partial-line flush, failures,
aliases and environment-file precedence, inherited child output exactly once, argument forwarding,
exit codes, shutdown and SIGUSR2 forwarding. Both directory-link regressions failed before their
guards were implemented, then passed. The existing managed lifecycle suite covers rebuilding,
swapping, rollback and shutdown alongside the launcher checks.

An isolated real Next.js development fixture returned HTTP 200, logged startup and requests,
reloaded `.env.development.local` while running, and exited cleanly on SIGTERM. The real
`npm start` missing-build error and `npm run start:remote` configuration error reached both console
and log files with exit code 1. Temporary smoke evidence is under
`/tmp/codeai-log-smoke-b2otldmb`. Independent subagent review and its own 54-test run passed.
The owner's running server was not restarted; the full offline suite and production build were
not needed for this launcher-only change.

A follow-up critical review reproduced a P1: closing either console pipe crashed the launcher
with `EPIPE` while leaving its idle child running. Both new shutdown-marker regressions failed
before the fix. Destination-error handling now stops the child through SIGTERM, waits for it,
records the failure, captures a final partial line, and exits 1. All 56 focused tests and TypeScript
pass. The original reviewer repeated its Python reproductions for stdout and stderr and confirmed
the child is gone after launcher exit. Generic uncatchable SIGKILL of a parent remains subject to
the same process-tree ownership limitation as an npm parent; the exit hook cannot trap SIGKILL.

A fresh critical review then reproduced a second P1: unpiping a failed destination paused its
child stream, blocking a large shutdown write callback and preventing exit. Two 2 MiB regressions
failed before the fix. Each error handler now unpipes and resumes its own child stream before the
shared failure guard, so both streams keep draining throughout shutdown. All 58 focused tests and
TypeScript pass. The reviewer repeated its original stdout-only and simultaneous stdout/stderr
probes, verified complete shutdown callbacks and the full >2 MiB log tail, and reported no remaining
critical/high findings after re-review. No temporary review tests remain in the repository.
