# Story 64 — Rebuild and restart CodeAI from CodeAI

**Status:** In progress (every box but the last ticked; the Quest 3S steps of How to verify are not yet run) · **Type:** Full-stack · **Depends on:** [Story 63](STORY-20260921-report-evidence-in-conversation.md) Part A (the self-project helper), [Story 65](STORY-20260921-tolerate-newer-session-format.md)

**Vision slice:** the operational end of the existing agent change loop: after the user supplies
evidence and accepts a fix in CodeAI's own checkout, they can run the changed application and verify
it from the same paired device. This story changes process lifecycle, not the software-model schema,
provider permissions, deployment, or automatic update policy.

**Delivery.** Three parts, one commit each: **A** the `start:managed` parent (slots, build, swap,
rollback, `SIGUSR2`); **B** the managed server's side (IPC bridge, maintenance lease, routes,
health); **C** the browser (the shared flow, the More menu, and Session tools → CodeAI).

---

## Motivation

The user wants to develop CodeAI through CodeAI without running `next dev`, whose hot reloads and
file-triggered restarts interfere with headset acceptance:

> for code-ai project opened - ability to rebuild and restart the project. Basically I want to use it
> for code-ai development and if I see an issue to be able to take a screenshot or explain the issue
> and send it in conversation and make the agent fix it and then ask to restart code-ai server

The process serving the request cannot safely replace itself. Building over the directory used by the
live server risks a mixed release; killing it before knowing the candidate can boot can strand the
headset. The lifecycle therefore needs a small parent process, two build slots, an exact self-checkout
capability, explicit user confirmation, fallback to the previous build, and a way back to that build
which does not depend on the new UI working.

---

## Current behavior (where the code is)

- `npm run start:remote` sets `NODE_ENV=production` and runs the HTTPS/Next server as the top-level
  process; it owns TLS, prepares Next, and listens directly with no parent able to replace it. It
  handles no signals, and the app holds long-lived event streams:
  [package.json:14](../package.json#L14), [start-remote.mjs:28](../scripts/start-remote.mjs#L28),
  [agent/stream/route.ts:23](../src/app/api/agent/stream/route.ts#L23).
- Next already accepts a server-owned alternate build directory through `CODEAI_DIST_DIR`:
  [next.config.ts:48](../next.config.ts#L48).
- A build into another directory makes Next rewrite `next-env.d.ts` to import that directory's types
  and add its type globs to `tsconfig.json`; the `.next-e2e` entries are there for that reason:
  [tsconfig.json:38](../tsconfig.json#L38).
- `/api/health` is device-authorized and checks storage/provider readiness, but does not identify a
  release or managed-parent capability: [health/route.ts:13](../src/app/api/health/route.ts#L13).
- `CheckoutRegistry.resolve` verifies that checkout ids still resolve inside the configured root;
  Story 63 Part A adds the exact-realpath self-project predicate:
  [checkoutRegistry.ts:95](../src/server/repository/checkoutRegistry.ts#L95).
- The process-wide run registry holds every live turn in one map; a run is `queued`, `running`,
  `needs-you`, or `finished`, and `reserve` is the single admission point. The registry survives
  route-module reloads as a `globalThis` singleton:
  [runRegistry.ts:86](../src/server/runs/runRegistry.ts#L86),
  [runRegistry.ts:113](../src/server/runs/runRegistry.ts#L113),
  [runRegistry.ts:473](../src/server/runs/runRegistry.ts#L473),
  [types.ts:407](../src/shared/types.ts#L407).
- Turns on an attached executor are forwarded to that machine and live in its registry, not the
  home's; a peer home's turns on this machine enter through the same message route and `reserve`:
  [machineRoutePolicy.ts:9](../src/server/machines/machineRoutePolicy.ts#L9).
- Flat administrative actions live under the header's More menu, while immersive administrative
  actions use shared Session controls: [AppShell.tsx:1758](../src/features/shell/AppShell.tsx#L1758),
  [SessionTools.tsx:14](../src/features/shell/immersive/SessionTools.tsx#L14).
- The Vitest suite runs in a Node environment with no component tests, and the end-to-end server is
  plain `next start`, which is never managed:
  [playwright.config.ts:28](../playwright.config.ts#L28).

---

## Desired behavior

### 1. Managed mode is explicit

A new `npm run start:managed` command starts a small Node parent in the CodeAI installation. The
parent spawns the server directly as `process.execPath scripts/start-remote.mjs` with
`NODE_ENV=production`, `shell: false`, and an `'ipc'` stdio slot. It does not go through `npm run`,
which would not carry the IPC channel. Ordinary `npm start`, `npm run start:remote`, and `npm run dev`
retain their current behavior and report lifecycle management as unavailable.

The parent derives the installation root from its own script location, resolves it, requires it to
equal the resolved working directory, and refuses to start otherwise. It ignores
`CODEAI_INSTALLATION_ROOT`. It sets the child's `CODEAI_DIST_DIR` and delivers the installation root,
active slot, and release id on the IPC channel; the child uses that root as `config.installationRoot`.
A child without a live channel is unmanaged whatever its environment says, and browser input can set
none of these values. A **release id** is the content of the slot's Next `BUILD_ID` file.

Successful managed builds alternate between `.next-managed-a` and `.next-managed-b`. Only those exact
descendants of the verified installation root are build/cleanup targets, and `.gitignore` excludes
them. The parent never recursively targets the repository root, `$HOME`, or an unresolved path.

The parent keeps no state file. On start it serves the most recently built valid directory among
`.next`, `.next-managed-a`, and `.next-managed-b`, judged by the modification time of each `BUILD_ID`
file, and the next most recent becomes the fallback. A first launch therefore serves the ordinary
`.next` build, a later launch serves the latest managed build, and a manual `npm run build` wins when
it is newer. A managed slot the parent abandons, by rollback or by the previous-release command
below, is deleted so it cannot be chosen again. `.next` is never a cleanup target: if it is the
abandoned release, the terminal says that it will be chosen again until it is rebuilt or removed.

The parent is not a crash supervisor. If the child exits outside a lifecycle operation, the parent
stops any running build and exits with the child's code, exactly as `start:remote` would have ended.

### 2. Capability is narrow and server-owned

`GET /api/codeai-lifecycle?projectId=…` returns an authorized lifecycle snapshot. It is available only
when the server has the live parent IPC channel and the selected project's local primary checkout
satisfies Story 63's exact self-project predicate. A project named CodeAI at another path, a reference
binding, a remote-machine project, or a renamed/missing checkout does not qualify. Sessions in a self
project are always Local, because Docker execution refuses the installation's own checkout.

`POST /api/codeai-lifecycle` accepts exactly `{ action: 'build-and-restart', projectId }`. It rejects
unknown fields, an unavailable capability, a second lifecycle operation, and any live run in this
machine's registry. It accepts no executable, command, arguments, working directory, environment,
port, origin, build path, or signal from the request.

Admission is atomic with turn admission. The run scheduler owns a maintenance lease: acquiring it fails
unless the registry's live-run map is empty, and while it is held every later `reserve` fails with a
retryable maintenance outcome. The lifecycle route acquires the lease before asking the parent to
build. It is released when the build fails; on the success path it is never released, because the
process holding it ends. This closes the check-then-start race; UI disabling alone is not a
concurrency boundary.

A replacement child starts with an empty registry and no lease. That is safe because `ready` is sent
from the listener's own callback, so a child that can accept a request has already reported ready, and
the parent never discards a child after `ready`.

Turns this home has running on an attached executor are not in its registry. They do not block the
operation and are not lost: the executor keeps running them, the forwarded stream drops with the home,
and the device reattaches after the reload. A peer home's turns on this machine are in the registry:
they block the operation, and while the lease is held the peer receives the same retryable outcome.

### 3. The current release stays available while the candidate builds

After returning an operation id, the child sends one IPC request to the parent. The parent spawns
`process.execPath node_modules/next/dist/bin/next build` with `shell: false`, the verified installation
as `cwd`, `NODE_ENV=production`, and `CODEAI_DIST_DIR` set to the inactive exact slot. No package
manager or `PATH` lookup is involved. The current server keeps serving throughout the build. The UI
receives bounded phase/progress and a sanitized failure summary; raw environment values and provider
credentials are never included or persisted.

The build must leave the checkout the user is about to commit as it found it. The parent records the
bytes of `next-env.d.ts` and `tsconfig.json` before the build and restores them when the build process
exits, on every path. `tsconfig.json` therefore never lists a slot, and `npm run lint` never typechecks
a stale slot's generated route types. An edit the user makes to either file by hand during the build
is lost; the documentation says so.

If the build exits unsuccessfully, is interrupted, exceeds its bounded timeout, or does not produce a
valid `BUILD_ID`, the parent marks the operation `build-failed`, releases the lease through the child,
and leaves the current child and active slot untouched. A later request may replace the failed slot.

The confirmation states that building modified CodeAI source executes that source on the home machine.
This user-confirmed fixed operation does not grant an agent a new shell capability and does not bypass
the existing Local Agent per-action approvals.

### 4. Swap, readiness, and fallback are owned by the parent

After a successful candidate build, the parent tells the child that restart is imminent, allows the
accepted HTTP response/status event to flush, then sends `SIGTERM`. `start-remote.mjs` handles it by
closing the listener, closing the remaining connections after a short grace, because event streams
never end by themselves, and exiting. The parent sends `SIGKILL` after a bounded period.

The parent starts the candidate slot with the same server-owned configuration and waits, up to a
bounded readiness timeout, for a private IPC `ready` message carrying the expected release id, sent
only after Next preparation and the TLS listener succeed. Only then does it mark the candidate active
and the former slot as fallback. Readiness is this message and nothing else: there is no HTTP probe
and no unauthenticated lifecycle endpoint. The browser-visible authorized health response includes
the release id for reconnect.

If candidate spawn, TLS bind, Next preparation, or the readiness timeout fails, the parent stops the
candidate, deletes it, and restarts the prior slot under the same readiness rule. The operation
reports `rolled-back` once the prior release is ready. If the prior release cannot be restored either,
the parent prints bounded recovery instructions and exits non-zero; it does not loop.

**What the fallback does and does not cover.** A slot holds compiled output only.
`scripts/start-remote.mjs`, `next.config.ts`, `public/`, `node_modules`, and `.env*` are read from the
working tree by the candidate and the fallback alike, so a change that breaks one of them breaks both.
Automatic rollback catches a candidate that cannot boot. It does not catch the likelier failure: a
candidate that boots and reports ready but whose UI is broken.

**Returning to the previous release without the UI.** At startup and after every swap the parent
prints its pid and the exact command, `kill -USR2 <pid>`. On that signal the parent:

1. does nothing, and says so, when there is no fallback;
2. asks the child for the maintenance lease over IPC with a bounded wait. A refusal because of live
   runs is printed and nothing happens. No answer within the wait means the child is hung and may be
   replaced;
3. swaps to the fallback under the same termination and readiness rules, deletes the abandoned
   release, and records the outcome as `rolled-back`.

The previous release may then read sessions the newer one wrote; Story 65 keeps the store open when it
meets a newer format.

For acceptance only, a parent started with `CODEAI_MANAGED_TEST_FAIL_CANDIDATE=1` treats the next
candidate's readiness as failed once and says so at startup. It is read from the parent's environment
at startup and nowhere else.

Pairing credentials, sessions, projects, reports, promoted attachments, and device layouts remain in
their existing stores and are not copied into a build slot. In-memory run state is protected by the
no-live-run admission rule.

### 5. Flat and immersive users explicitly approve the interruption

An eligible self project shows **Build & restart CodeAI** in the flat More menu and in an immersive
CodeAI section of Session tools. The first activation opens a confirmation; the second starts it. The
confirmation names the selected checkout, says modified code will execute on the home machine, and
warns that the current WebXR session will end.

During `building`, CodeAI remains usable for reading but disables new agent turns and another lifecycle
request so source cannot change underneath the build. The initiating view shows phase and elapsed time.
At `restarting`, the browser expects connection loss, polls the same exact origin with bounded backoff,
and reloads only after health reports the candidate release id (succeeded) or the former one (rolled
back). After the reload the snapshot's last operation says which. The canonical session and draft
restore through their existing owners; WebXR requires a fresh user gesture and is never claimed to
survive the document replacement.

The client's sequence, confirm → building → restarting → reconnect → outcome, is one pure module shared
by the flat and immersive controls, so it can be tested without a component environment.

The agent may recommend this control in ordinary text, and a completed Agent turn in an eligible
project may make the control visually prominent. Free-form conversation text, provider output, a magic
Markdown marker, or a tool call never constitutes restart authorization.

### Concrete changes

1. Add `scripts/start-managed.mjs` as the parent and a `start:managed` package script. Keep
   `start-remote.mjs` usable alone; teach it the private IPC contract only when spawned with a channel,
   and add its `SIGTERM` handling (close the listener, then the remaining connections).
2. Add `scripts/managedLifecycle.mjs` (or the smallest equivalent testable module) for slot selection
   by `BUILD_ID`, build admission, the `next-env.d.ts`/`tsconfig.json` restore, child replacement, the
   readiness timeout, fallback, deletion of an abandoned release, and the `SIGUSR2` previous-release
   path. All child processes use `process.execPath`, argument arrays, and `shell: false`.
3. Add `.next-managed-a/` and `.next-managed-b/` to `.gitignore`; validate every target using exact
   parent/realpath rules before removing or replacing a slot.
4. Add shared lifecycle schemas in `src/shared/codeAiLifecycle.ts` and a process-wide child-side
   registry in `src/server/lifecycle/` that receives parent status over IPC and, like the run registry,
   is a `globalThis` singleton without durable state.
5. Add authorized `GET`/`POST /api/codeai-lifecycle` routes. Reuse the Story 63 self-project helper and
   add the atomic maintenance lease to `runRegistry`; keep readiness and lifecycle control on the
   private parent/child IPC channel.
6. Advertise managed availability/release identity through health without making provider health depend
   on it. The message route answers the maintenance outcome with a clear retryable status.
7. Add the pure client lifecycle module, the flat More-menu confirmation/progress/reconnect UI, and the
   matching immersive Session-tools section/actions through shared `AppShell` state.
8. Document managed startup, the execution warning, build slots and how a start chooses one, what the
   fallback covers, the previous-release command, restart/rollback outcomes, the expected XR exit, and
   recovery when neither release starts. Add `start:managed` to the AGENTS.md commands and a
   `src/server/lifecycle/` row to its ownership table.

### Type contract

```ts
// src/shared/codeAiLifecycle.ts
type CodeAiLifecyclePhase = 'idle' | 'building' | 'restarting';

interface CodeAiLifecycleOperation {
  operationId: string;
  outcome: 'succeeded' | 'build-failed' | 'rolled-back';
  finishedAt: string;
  detail?: string; // bounded, sanitized, no host path or environment value
}

type CodeAiLifecycleSnapshot =
  | { available: false; reason: 'not-managed' | 'not-self-project' }
  | {
      available: true;
      phase: CodeAiLifecyclePhase;
      releaseId: string;
      operationId?: string; // the operation in progress
      startedAt?: string;
      candidateReleaseId?: string; // known once the build has produced it
      lastOperation?: CodeAiLifecycleOperation; // carried to the next child by the parent
    };

interface BuildAndRestartRequest {
  action: 'build-and-restart';
  projectId: string;
}

// private parent/child IPC; never accepted from HTTP
type ManagedLifecycleMessage =
  | { type: 'lifecycle-init'; installationRoot: string; slot: string; releaseId: string; lastOperation?: CodeAiLifecycleOperation }
  | { type: 'lifecycle-request'; operationId: string; action: 'build-and-restart' }
  | { type: 'lifecycle-lease'; request: 'acquire' | 'release'; granted?: boolean }
  | { type: 'lifecycle-ready'; releaseId: string }
  | { type: 'lifecycle-state'; snapshot: CodeAiLifecycleSnapshot };
```

There is no "neither release starts" state on the wire: when that happens no server exists to report
it, and the parent's terminal output is the only channel.

---

## Acceptance criteria

- [x] `npm run start:managed` serves the same paired HTTPS origin through a directly spawned child with
      a live IPC channel; ordinary dev/start/start:remote modes remain supported and report management
      unavailable rather than pretending they can restart themselves.
- [x] A fresh start serves the most recently built valid directory among `.next` and the two slots and
      keeps the next most recent as fallback; a rolled-back or abandoned managed slot is deleted and is
      not chosen again, and `.next` is never deleted.
- [x] Lifecycle capability appears only for a selected local project whose primary checkout resolves
      exactly to the managed installation real path. Names, client context, `CODEAI_INSTALLATION_ROOT`,
      symlinks escaping the repository root, reference bindings, and remote machines cannot enable it.
- [x] The authorized POST accepts only the fixed action and project id, rejects unknown input, a
      concurrent operation, and any live run in this machine's registry, and returns before terminating
      a child. The scheduler's maintenance lease closes the race with a simultaneous new turn and is
      released when a build fails. A turn on an attached executor neither blocks the operation nor is
      lost; a peer home's turn here blocks it.
- [x] One explicit confirmation is required in both flat and immersive UI and states that modified
      source executes locally and that WebXR will end. Agent/provider text cannot approve the action.
- [x] While building, the old release stays responsive, new turns/lifecycle operations are rejected,
      status remains bounded, and the build runs Next's own CLI through `process.execPath` with only the
      verified root plus the exact inactive slot.
- [x] A managed build on a clean working tree, successful or failed, leaves `git status` clean:
      `next-env.d.ts` and `tsconfig.json` are byte-identical afterwards, and `npm run lint` passes with
      a stale slot present.
- [x] A failed, timed-out, or invalid build leaves the current child and active slot running. No build
      output, error, or status response exposes credentials or an unrestricted environment dump.
- [x] A successful build stops the old child only after status/response flush, by `SIGTERM` that closes
      open event streams within the bounded period; starts the candidate; verifies its expected release
      id through private IPC readiness; and updates active/fallback slots. No public endpoint can spoof
      readiness or invoke the parent.
- [x] Candidate start or readiness failure automatically restores and verifies the prior slot. If that
      also fails, the parent prints bounded recovery instructions and exits non-zero without looping.
- [x] `kill -USR2 <pid>` returns to the fallback release without any UI: it refuses when live runs
      exist, replaces a child that does not answer, reports `rolled-back`, and does nothing when there
      is no fallback. A child that exits outside an operation ends the parent with the same code.
- [x] No cleanup operation can target the repository root, configured repositories root, data
      directory, home directory, unresolved variable/glob, active build slot, or anything outside the
      two exact managed slot directories.
- [x] Pairing, project/session records, promoted report evidence, drafts, and layouts survive a
      successful restart and a rollback. No local agent run is lost, because live runs prevent
      admission.
- [x] The browser tolerates the expected disconnect, reconnects only to the same origin, distinguishes
      new-release from rolled-back health, reloads canonical state, and requires deliberate VR re-entry.
- [x] `npm run lint` and `npm test` pass. Supervisor tests use fake build/child processes to cover
      slot selection, success, build failure, hung build, candidate failure, rollback failure, the
      file restore, duplicate requests, malicious paths, `SIGTERM`, and `SIGUSR2`. The client lifecycle
      module and the routes are covered with a fake registry. `npm run test:e2e` covers unmanaged mode
      only: the control is absent and the POST is refused.
- [ ] Manual verification completes one real production build/restart, one intentionally failing
      candidate rollback, and one `SIGUSR2` return before the story is marked Shipped; Quest 3S confirms
      the warning, expected XR exit, reload, preserved conversation/report, and fresh re-entry.

## Out of scope

- `next dev`, hot-module reload, restarting after every file edit, or pretending WebXR survives reload.
- Generic process management, crash supervision, arbitrary scripts/commands, environment editing,
  dependency installation, git operations, deployment, release publishing, or operating any project
  other than this exact local CodeAI installation.
- Isolating `start-remote.mjs`, `next.config.ts`, `public/`, `node_modules`, or `.env*` per release.
  The fallback covers compiled output only.
- A managed mode without the paired HTTPS server, for example over plain `npm start`.
- Automatically rebuilding after every agent turn or interpreting “restart” in conversation as user
  authorization. The user always activates and confirms the fixed lifecycle action.
- Cancelling an accepted build, streaming complete build logs into the headset, or retaining historical
  build logs. Only bounded current status and the terminal's ordinary output are required.
- Zero-downtime proxying. A short same-origin disconnect between children is expected and handled.
- Remote-executor lifecycle control, multiple managed installations behind one home, OS services,
  container deployment, and unattended upgrades.

## How to verify

1. `npm run lint && npm test && npm run test:e2e`.
2. Build once normally, run `npm run start:managed`, pair a browser/headset, and select the exact local
   CodeAI checkout. Confirm the flat and immersive controls appear; rename the project and confirm they
   remain. Select a same-named clone and a remote project and confirm they disappear.
3. Start an agent turn in any session and confirm Build & restart is rejected. After it finishes, accept
   the two-step confirmation. Keep using the old release during build, observe the expected disconnect,
   and confirm the new release id and preserved session/report after reload. Run `git status` and
   confirm the build left the tree as it was.
4. Introduce a safe compile failure, request a build, and confirm the old release never disconnects.
   Restore the source, restart the parent with `CODEAI_MANAGED_TEST_FAIL_CANDIDATE=1`, request a build,
   and confirm the prior release is restored and reported as rolled back.
5. After a successful swap, run the printed `kill -USR2 <pid>` command and confirm the previous release
   returns. Stop the parent, start it again, and confirm it serves the most recent remaining release.
6. From Quest 3S, attach a report, have an Agent turn change CodeAI, invoke Build & restart from Session
   tools, accept the XR warning, reconnect/reload, re-enter VR, and verify the reported issue against the
   new release.

---

## What shipped

All three parts are implemented and verified offline, in the end-to-end suite, and against a real
`start:managed` on this machine: real builds and restarts, a failed build, a forced rollback,
`kill -USR2` both ways, and a killed parent. The Quest 3S steps of **How to verify** remain.

### Part A — the parent

- **Contract.** `src/shared/codeAiLifecycle.ts` holds the snapshot, the one request body, the slot
  names, and the IPC messages in each direction as strict schemas
  ([codeAiLifecycle.ts](../src/shared/codeAiLifecycle.ts#L49)). The parent and the server each parse
  what the other sends ([parent → server](../src/shared/codeAiLifecycle.ts#L62),
  [server → parent](../src/shared/codeAiLifecycle.ts#L77)).
- **Start.** `npm run start:managed` runs `node --import tsx scripts/start-managed.ts`, one process.
  It resolves its own checkout, requires the working directory to be that checkout, and ignores
  `CODEAI_INSTALLATION_ROOT` ([start-managed.ts](../scripts/start-managed.ts#L11)). `ManagedServer`
  serves the newest valid release among `.next` and the two slots, judged by `BUILD_ID` time. The
  next newest is the fallback. A release is a real directory, not a link, whose `BUILD_ID` matches the
  release-id pattern ([managedLifecycle.ts](../scripts/managedLifecycle.ts#L45),
  [start](../scripts/managedLifecycle.ts#L182)).
- **The server.** Each server is `process.execPath scripts/start-remote.mjs` with an `ipc` slot,
  `shell: false`, `NODE_ENV=production`, its `CODEAI_DIST_DIR`, and the marker
  `CODEAI_MANAGED_SERVER=1`. The installation override and the acceptance flag are removed
  ([managedEnvironment](../scripts/managedLifecycle.ts#L94), [launch](../scripts/managedLifecycle.ts#L243)).
- **The server's side of the contract.** `start-remote.mjs` reads the marker before `.env*` loads
  ([start-remote.mjs](../scripts/start-remote.mjs#L12)). It expects `lifecycle-init` only with both
  the marker and a live channel, checks that the root is its own working directory, and installs the
  bridge before Next prepares ([start-remote.mjs](../scripts/start-remote.mjs#L36)). It sends
  `lifecycle-ready` with the `BUILD_ID` it serves from the listen callback
  ([start-remote.mjs](../scripts/start-remote.mjs#L129)). A server counts as started only on that
  message with the expected id, within two minutes. When the parent's channel closes, the server
  stops as it does on `SIGTERM` ([start-remote.mjs](../scripts/start-remote.mjs#L97)).
- **Build.** A request builds into the managed slot that is not serving, preferring one that is not
  the fallback ([candidateSlot](../scripts/managedLifecycle.ts#L415)). It first removes that slot's
  `BUILD_ID`, which keeps Next's cache.
  - `next-env.d.ts` and `tsconfig.json` are read first. Only a missing file counts as absent; any
    other read error means no build starts ([readIfPresent](../scripts/managedLifecycle.ts#L135)).
  - The build then runs `process.execPath node_modules/next/dist/bin/next build` in the verified root.
    Both files are restored byte for byte on every path before anything waits on the build, and a
    restore failure is printed with the `git checkout` that repairs it
    ([runBuild](../scripts/managedLifecycle.ts#L340)).
  - A failure, a 20-minute timeout, or a missing `BUILD_ID` invalidates the slot. It records
    `build-failed` with fixed text and tells the server to release its lease
    ([buildAndRestart](../scripts/managedLifecycle.ts#L292)).
- **Swap and rollback.** On success the parent publishes `restarting` and waits two seconds for it
  to be read. It then sends `SIGTERM` (`SIGKILL` after ten seconds) and starts the candidate
  ([replace](../scripts/managedLifecycle.ts#L383)). `start-remote.mjs` answers `SIGTERM` by closing
  the listener and idle connections, then every connection after two seconds, then exiting
  ([stop](../scripts/start-remote.mjs#L52)). A candidate that is not ready is stopped and deleted,
  and the former release starts under the same rule. If that also fails, the parent prints recovery
  instructions and exits 1 ([restore](../scripts/managedLifecycle.ts#L391),
  [giveUp](../scripts/managedLifecycle.ts#L500)).
- **`kill -USR2`.** The parent asks the server for the lease and waits five seconds. It prints a
  refusal, or replaces a server that does not answer. It swaps to the fallback and deletes the
  abandoned managed slot, never `.next` ([previousRelease](../scripts/managedLifecycle.ts#L205),
  [abandon](../scripts/managedLifecycle.ts#L405)). Build slots are removed only through
  `managedSlotPath`: one of two exact names directly under a resolved absolute root, and never the
  served release ([managedLifecycle.ts](../scripts/managedLifecycle.ts#L70)).
- **Ending.** A server that exits on its own ends the parent with its code, or 128 plus the signal
  number, after any build is stopped and its files restored
  ([exitedOnItsOwn](../scripts/managedLifecycle.ts#L487)). A failed IPC write or kill is not
  mistaken for an exit ([exitOf](../scripts/managedLifecycle.ts#L145)). `SIGINT` and `SIGTERM` to
  the parent stop the build, the serving server, and a server still starting, then exit 130 and 143
  ([shutdown](../scripts/managedLifecycle.ts#L236)).

### Part B — the managed server

- **Bridge and root.** `managedBridge()` reads what `start-remote.mjs` installed
  ([managedBridge.ts](../src/server/lifecycle/managedBridge.ts#L17)). `config.installationRoot` is
  the parent's verified root when it exists ([config.ts](../src/server/config.ts#L188)), so reports
  and Build & restart agree on which project is CodeAI's own.
- **Lease.** `RunRegistry.acquireMaintenance()` answers `held`, `live-runs`, or `acquired` in one
  synchronous step, and `reserve` refuses everything with `maintenance` while it is held
  ([runRegistry.ts](../src/server/runs/runRegistry.ts#L164), [reserve](../src/server/runs/runRegistry.ts#L125)).
  The message route answers that with `503` and `Retry-After: 30` and appends nothing
  ([message/route.ts](../src/app/api/agent/message/route.ts#L205)).
- **Lifecycle.** `CodeAiLifecycle` mirrors the parent's snapshot. `start()` takes the lease and sends
  one `lifecycle-request`; the lease is the concurrency boundary. It releases the lease when told,
  answers the parent's lease requests, and ignores anything outside the schemas
  ([codeAiLifecycle.ts](../src/server/lifecycle/codeAiLifecycle.ts#L16)). The instrumentation hook
  creates it as the server starts, so `SIGUSR2` is answered before any route has loaded
  ([instrumentation.ts](../src/instrumentation.ts#L6)).
- **Routes.** `GET`/`POST /api/codeai-lifecycle` admit only a paired personal device; the `POST` also
  needs the exact origin in every access mode. Both need a live channel and Story 63's self-project
  predicate. The body is `{ action: 'build-and-restart', projectId }` and nothing else: `400` for
  anything more or another project, `409` for unmanaged, busy, or live turns, `202` with the building
  snapshot ([route.ts](../src/app/api/codeai-lifecycle/route.ts#L35)). Health reports
  `release: { managed, releaseId }` without changing `ok` ([health/route.ts](../src/app/api/health/route.ts#L69)).

### Part C — the browser

- **Flow.** `lifecycleFlow.ts` is the pure confirm → building → restarting → reconnect → outcome
  sequence ([lifecycleFlow.ts](../src/features/lifecycle/lifecycleFlow.ts#L84)). `ask` shows the
  warning, and only `confirm` after it submits.
  - A view follows an operation it sees in progress, even one it did not start.
  - The idle answer that ends it decides: a recorded `build-failed` keeps the page. Any other
    outcome reloads it, and so does, without an outcome, a server that announced a restart or
    stopped answering ([observe](../src/features/lifecycle/lifecycleFlow.ts#L62)).
  - A failed request does not count as a restart: the next building answer shows the build again.
  - A new answer replaces an earlier refusal or give-up message.
  - Polls run every two seconds while building. While the server may be gone they back off from one
    to five seconds, and after five minutes unreachable they stop and point at the terminal
    ([lifecyclePollDelay](../src/features/lifecycle/lifecycleFlow.ts#L113)).
  - The same module supplies the status, header badge, and confirmation text
    ([lifecycleView](../src/features/lifecycle/lifecycleFlow.ts#L143),
    [lifecycleConfirmation](../src/features/lifecycle/lifecycleFlow.ts#L175)).
- **Owner.** `useCodeAiLifecycle` fetches the snapshot for the selected local project. It drops an
  answer overtaken by a later read, a project change, or a confirmation
  ([useCodeAiLifecycle.ts](../src/features/lifecycle/useCodeAiLifecycle.ts#L95)). It posts the fixed
  body with a relative URL and reloads when the flow says so
  ([useCodeAiLifecycle.ts](../src/features/lifecycle/useCodeAiLifecycle.ts#L40)). Before reloading it
  notes the project in `sessionStorage`, and the first catalog load reopens it
  ([takeRestartProject](../src/features/lifecycle/useCodeAiLifecycle.ts#L15),
  [AppShell.tsx](../src/features/shell/AppShell.tsx#L467)). That project's focused session and draft
  then restore through the workspace views.
- **Flat.** The More menu shows `CodeAiLifecycleMenu` only where the snapshot is available: the
  button, the warning with **Build and restart** and **Cancel**, and the status
  ([CodeAiLifecycleMenu.tsx](../src/features/lifecycle/CodeAiLifecycleMenu.tsx#L7)). A header pill
  shows the badge while busy ([AppShell.tsx](../src/features/shell/AppShell.tsx#L1883)). `send()`
  refuses with a notice and keeps the draft while busy ([AppShell.tsx](../src/features/shell/AppShell.tsx#L1132)).
- **Headset.** Session tools' home button **Reports** became **CodeAI**
  ([SessionTools.tsx](../src/features/shell/immersive/SessionTools.tsx#L155),
  [layout](../src/features/shell/immersive/SessionTools.tsx#L229)).
  - The section holds **Reports**, **Back**, and **Build & restart**, which becomes **Confirm build &
    restart** after the warning. Back from Reports returns to the section.
  - Leaving the section by any route withdraws the confirmation
    ([SessionTools.tsx](../src/features/shell/immersive/SessionTools.tsx#L94)).
  - Entering it or pressing Refresh reads the lifecycle again, so a failed first read recovers.
  - Its controls come from the same owner ([sessionControls.ts](../src/features/shell/immersive/sessionControls.ts#L65),
    [AppShell.tsx](../src/features/shell/AppShell.tsx#L1744)), and the conversation's Send is
    disabled while busy.

### Deviations from the draft, and why

- **The parent is TypeScript**, `scripts/start-managed.ts` and `scripts/managedLifecycle.ts`, run with
  `node --import tsx`. The tests import it with its types, as `scripts/docker.ts` is tested. One
  process, not the `tsx` CLI's two, so the printed pid is the parent's.
- **A marker as well as the channel.** A process manager such as pm2 also gives its child an IPC
  channel, and `start:remote` under one would otherwise wait for an initialization that never comes.
  The channel is still required, and the marker is read before `.env*` loads.
- **An instrumentation hook** binds the server's lifecycle at start. Without it a `SIGUSR2` could
  reach a server whose lifecycle module no route had loaded yet, get no answer, and replace a server
  with live turns.
- **A managed server stops when its parent goes.** The draft only asked that the parent not be a
  crash supervisor. Without this, a killed parent would leave a server that no one can swap and that
  keeps its lease through a build, so every turn gets `503` until someone kills it.
- **The failure summary is fixed text** for each way a build fails. No build output crosses to the
  browser, so none can carry a path or an environment value; the terminal shows the output.
- **A build clears only `BUILD_ID` first.** This keeps Next's cache. A failed build's slot is
  invalidated the same way; slots the parent abandons on rollback or `SIGUSR2` are deleted as drafted.
- **The browser decides the outcome from the lifecycle snapshot, not from health.** The old server
  still answers health with its own release id during the two seconds after it announces the restart,
  and a rolled-back release answers with that same id. The snapshot's recorded outcome for the
  operation is unambiguous. Health reports the release id too, for diagnostics.
- **Elapsed time advances every five seconds.** Each tick re-renders the whole shell, and on the
  headset a texture too.
- **Session tools' Reports moved under CodeAI.** The panel's two button rows were full.
  [Story 63](STORY-20260921-report-evidence-in-conversation.md)'s How to verify notes the new path.
- **The reload reopens its project.** Real verification showed a reload landing in whichever project
  lists first, not in the session being verified; a tab-scoped note now brings it back.
- **Not done:** making the control prominent after an Agent turn (the draft's optional "may").

### Known limits

- Two slots hold the serving release and one other. A build reuses the other slot, so while it
  builds, and after it fails, the previous release is whatever else remains, often `.next`.
- Only a view that reads the lifecycle follows an operation. It reads when a CodeAI project is
  selected, when More or the CodeAI section opens, and while it follows one. Another device left idle
  on the old page, the headset while the flat browser starts a build for example, is not reloaded
  after the swap; its sends get the retryable `503` during the build. A view that leaves the self
  project during an operation stops following it.
- A parent killed with `SIGKILL` during a build stops its server through the closed channel, but it
  cannot restore `next-env.d.ts` and `tsconfig.json`; `git checkout -- next-env.d.ts tsconfig.json`
  does.
- A Docker CLI update started from Arena (Story 67) does not block Build & restart. A restart during
  one leaves at most a `codeai-worker:candidate-…` tag, as Story 67's own limits describe.
- The bounds are fixed: 20 minutes to build, two minutes to become ready, two seconds of flush, ten
  seconds from `SIGTERM` to `SIGKILL`, five seconds for a `SIGUSR2` lease answer.
- Nothing stops two `start:managed` parents in one checkout from building into the same slots; a
  second parent on the same port fails when its server cannot bind.
- `kill -USR2` whose fallback cannot start restores the release it left and records no outcome; the
  terminal says what happened.
- `npm run lint` does not type-check `scripts/start-managed.ts`, like the other entry scripts under
  `scripts/`; `scripts/managedLifecycle.ts` is checked through its tests.

## Verification record

September 23, 2026, on Ubuntu 26.04.1 with Node 24.20.0 and Next 16.3.1.

- `npm run lint` passes, also with both managed slots present.
- `npm test` passes: 87 files, 687 tests. They include 27 real-process parent tests with fake server
  and build processes (`test/managedLifecycle.test.ts`). The route tests use the real scheduler with
  a fake parent bridge.
- `npm run test:e2e` passes: 87 of 87. Besides the unmanaged checks, a mocked lifecycle route drives
  the flat control through build, restart, and reload into the same project, and the headset's
  two-step confirmation.
- A review subagent read the whole change. It found a server that shutdown or a killed parent could
  orphan, a stale read that could end the watch after a confirmation, a VR section that could not
  recover from a failed first read, an error that hid progress, and a restore that treated any read
  error as a missing file. It also found smaller issues. All are fixed except the Docker-update
  interaction, recorded above.
- Mutation proof: 67 rules were broken one at a time, and each made a test fail.
  - Part A had 22 before the review and 5 after it. One survived at first, until the
    crash-during-build test was added; another, until the shutdown test checked the server before
    the start attempt ended.
  - Part B had 18. Two survivors exposed a redundant phase check, now removed, and a missing
    local-mode origin test, now added.
  - Part C had 11 in the pure flow and 3 more after the review. Another 8 were in the UI, through
    the end-to-end tests. Its one survivor was a second-activation guard that exists in both Session
    tools and the owner; removing both fails.
  - Not proven by a test: the guard that stops a build from starting when shutdown lands during the
    milliseconds it reads the checkout files.
- Real `start:managed` on port 3443 with this checkout, a scratch data directory, the fake Claude, and
  a paired browser and `curl`:
  - The self project showed the control; the `code-ai-next` clone did not. Health named the release.
  - With a turn running, Build & restart was refused in the menu and `kill -USR2` was refused in the
    terminal. A turn sent during a build got `503` with `Retry-After: 30`, and nothing was appended.
  - A real build took about 17 seconds. The old release answered health throughout, and the pill
    counted the time.
  - The page reloaded on the new release, back in the same project and session, and the menu said
    *the new release is running*. `git status` and both rewritten files were byte-identical
    afterwards, and one server remained.
  - A deliberate type error failed the build. The page never reloaded or lost the server, the menu
    stated the outcome, and the slot lost its `BUILD_ID`.
  - With `CODEAI_MANAGED_TEST_FAIL_CANDIDATE=1` the candidate was treated as not ready, deleted, and
    the prior release restored and reported as rolled back.
  - `kill -USR2` returned to the previous release and deleted the abandoned slot. `SIGTERM` to the
    parent stopped its server and exited 143, and a new start served the newest remaining release.
  - After the review fixes, one more real build and restart succeeded. `kill -KILL` on the parent
    then stopped its server and freed the port.
  - The slots were removed afterwards; your `.next` and the dev server were not touched.
- Not yet run: the Quest 3S part of the last acceptance criterion and step 6 of How to verify.
