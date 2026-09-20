# Story 57 — Run agents autonomously inside a local Docker container

**Status:** In progress · **Type:** Full-stack ·
**Depends on:** [Story 20](STORY-20260817-web2-codex-provider.md),
[Story 37](STORY-20260901-concurrent-turns.md), and
[Story 38](STORY-20260903-arena-and-inbox.md) (all shipped).

## TLDR

- Add optional **Docker** execution for new Claude/Codex sessions. **Local** stays the default,
  with its existing approval policies and Codex Agent gate.
- Start with **one real repository mounted per session**. Docker Agent edits and runs project
  commands without individual approvals; Ask/Plan get a read-only repository. Changes appear
  immediately in the existing diff UI. There is no rollback or separate working copy.
- Keep CodeAI outside the worker. Enforce a pinned image, non-root execution, limited mounts,
  resource limits, and controlled network access. Protect host Git reads from agent-modified
  metadata; public npm downloads go through a GET/HEAD gateway.
- Use provider-owned login and persistent provider storage (shared by new conversations since
  [Story 59](STORY-20260909-docker-session-friction.md)). Preserve native history, streaming,
  checkout locks, and recovery; cancellation must stop every container process before reuse.
- **Mounted files and credentials remain exposed inside the container.** This is for trusted
  personal repositories. Multiple repositories, cloud execution, remote integrations, and
  apply/discard are follow-ups.
- **Implementation and macOS boundary verification in progress.** The opt-in backend, UI,
  migration, execution profile and operator helpers are implemented. Release still requires the
  complete macOS/Linux and signed-in Claude/Codex matrix; see the experiment log.

**Vision context:** a local execution slice of [the cloud chapter](../docs/vision.md#the-cloud-chapter),
supporting the arena's principle that capabilities are resolved on the execution machine and the
[software model's change loop](../docs/software-model.md). This proposes bringing local containment
forward from vision step 10; it does not start cloud hosting, the second-machine registry, or
[Story 21's team environment](STORY-20260806-web2-team-environment.md). The vision now permits
this optional local boundary and autonomous writes for explicitly selected Docker Agent sessions.
The second-machine registry remains the next breadth milestone.

---

## Motivation

CodeAI currently compensates for host execution with provider-specific tool restrictions and
approval handling. Claude's command allowlist is not argument-level isolation. Codex Agent remains
behind an unpassed release gate because CodeAI promises approval before every side effect; the
recorded real-provider runs tested Ask/Plan, not the Agent approval matrix. Codex already has an
OS-enforced sandbox, but CodeAI has no independent boundary around the entire provider process and
its integrations.

The user proposes running agents in Docker with only the assigned repository mounted, giving them
more freedom without granting ordinary desktop access. The new contract is: **Agent may edit and
run project commands autonomously inside the assigned container workspace.** The container limits
filesystem, process, and network reach. It does not protect files deliberately mounted writable or
make arbitrary external integrations safe.

The first version uses the real checkout, preserving today's immediate edits and repository diff
experience. Separate working copies and apply/discard are a subsequent product decision.

---

## Implementation (where the code is)

- `src/shared/types.ts:104` and `src/shared/sessionSchema.ts:202`: version 4 sessions carry an
  immutable Local/Docker identity; `sessionSchema.ts:383` and
  `src/server/storage/sessionStore.ts:812` migrate active/archived version 3 records to Local.
- `src/app/api/sessions/route.ts:44` and `src/features/arena/Arena.tsx:181`: execution selection,
  direct-edit disclosure, exactly one primary checkout, and capability-specific creation.
- `src/server/agents/agentPolicy.ts:24` and `codexInvocation.ts:39`: Docker tool/permission policy;
  Local policy and the Local Codex gate remain separate.
- `src/server/execution/dockerProcessRunner.ts:10`: existing Claude/Codex protocol runners use
  Docker stdio, translated context/image/resume paths, participant authentication, and confirmed
  whole-container termination before returning a result.
- `src/server/execution/dockerProfile.ts:6`, `dockerRuntime.ts:159`, and `docker/Dockerfile:1`:
  pinned profile, engine/image identity, validated binds, session leases, participant homes,
  and container resource/security settings.
- `docker/gateway.mjs:1`: provider CONNECT/SNI allowlist and fixed public npm GET/HEAD gateway.
  `docker/worker.mjs:1`: credential-free Git metadata validation and checkout access checks.
- `src/server/repository/gitRead.ts:31`: hardened Git in credential-free read-only helpers after
  provisioning, including subsequent Local reads; recovery precedes reads and archiving.
- `src/server/runs/runRegistry.ts:100` and `src/app/api/agent/message/route.ts:136`: the shared
  scheduler additionally excludes overlapping canonical checkout paths and protects helper bind
  sources from enclosing writers.
- `src/server/execution/dockerRuntime.ts:84` and `dockerRecovery.ts:10`: confirmed removal,
  ownership-scoped orphan reconciliation, durable interrupted-delivery ledger and no replay.
- `scripts/docker.ts:1` and [the setup guide](../docs/docker-execution.md): explicit provisioning,
  owner-terminal provider login and inactive-participant cleanup.
- `test/dockerExecution.test.ts:1`, `test/dockerProcessRunner.test.ts:1`,
  `test/dockerRuntime.test.ts:1`, `test/dockerGateway.test.ts:1`, and `e2e/docker-execution.spec.ts:1`: offline contracts, lifecycle,
  migration and browser coverage. `scripts/test-docker.ts:1` contains opt-in real Docker probes.
- `test/dockerRuntime.test.ts:163` and `scripts/test-docker.ts:58`: direct checkout mounts,
  preserved source/dependencies, mode-specific write permissions, and provider home lifecycle.
- [Experiment log](../docs/experiment-log.md): exact evidence and remaining release checks.

---

## Desired behavior

### Checkout mount simplification (2026-09-09)

**Verification:** Complete on macOS for this simplification; the broader Story 57 release matrix
remains in progress. The owner chose a single repository bind with mode-specific permissions for
the first version. Remove recursive dependency/build masks, generated mount-target creation,
and the dedicated dependency-cache volume/keeper. All existing checkout contents remain visible.
Agent installs and generated outputs affect the host checkout; Ask/Plan cannot write anywhere
within it. Use `/tmp/npm` for disposable npm downloads and retain isolated provider homes.
Host and Linux dependencies may require reinstalling when switching execution environments.

- [x] Worker preparation validates Git metadata without scanning or creating generated directories.
- [x] Worker mounts contain one checkout bind, read-only context, and the participant home; no
      nested checkout mounts, dependency-cache volumes, or keeper containers are created.
- [x] Regression checks preserve `src/build` and existing dependencies, verify Agent writes reach
      the host, and verify Ask/Plan reject dependency/output writes, including after Agent.
- [x] Setup/architecture documentation and the Docker boundary probes describe the direct mount.
- [x] Focused Docker tests, TypeScript, production build, and a disposable real-Docker probe pass.

### A. Choose execution explicitly and persist it

1. Add an opt-in local Docker backend. [Story 58](STORY-20260909-docker-ui-enablement.md) adds a
   saved **Enable Docker** choice in Arena; without a saved choice, server setting
   `CODEAI_DOCKER_ENABLED` supplies the default (false; accept the usual `CODEAI_WEB2_*` alias).
   Use only a locally configured Docker daemon;
   remote Docker contexts, cloud orchestration, and a general runtime plugin system are outside
   this story. Support Docker Desktop on macOS and Docker Engine on Linux through the same profile.
2. When enabled, session creation offers **Local** and **Docker** execution, with Local the default.
   Docker's explanatory copy says: “Agent edits this repository directly and runs commands without
   individual approvals. Mounted files, including ignored files, are accessible.” Choosing Docker
   and creating the session establishes that scope; ordinary turns need no repeated confirmation.
3. Persist execution on the session, expose it in the session and Arena, and derive provider/mode
   readiness for that execution. A container still belongs to the current machine (`hostId`); it
   is not a new machine. Execution and the Docker session's checkout binding are immutable after
   creation. Use a new session to change either; never resume a local provider session in Docker.
4. Docker sessions require exactly one primary repository on the current machine. Reject zero,
   multiple, or reference-only bindings clearly, including inherited project bindings and later
   repository mutations. This keeps the initial mount and lock contract aligned with today's
   single-checkout scheduler. Local sessions keep their existing repository options.
5. Browsers send only a supported execution name at creation and the existing mode on a turn.
   Image, binary, mounts, privileges, network rules, provider flags, and resource limits are
   server-owned. Reject unsupported names/settings; Docker unavailable or disabled means that
   Docker session cannot run. Never fall back to host execution.
   Execution/provider capability health is separate from the addressed participant's login
   readiness: session creation may precede login, but a turn checks that participant's provider
   status through its CLI before sending a prompt. A different participant's login is insufficient.

### B. Bound the entire provider process

6. Keep the CodeAI application, device authorization, canonical records, and Docker control on the
   host. A small server-owned execution module launches the existing provider protocol inside the
   container over stdio and retains the current event stream and response parser. Reuse protocol
   handling; do not create a second conversation service or expose a provider listener port.
7. At most one worker container is active per CodeAI session. Create it for each turn and remove
   it after all its processes stop. [Story 59](STORY-20260909-docker-session-friction.md) simplifies
   persistence: new participants share one provider-owned Docker home per installation/provider.
   Existing participant homes remain in place. Other providers' homes and CodeAI's data directory
   are never mounted; same-provider Docker conversations deliberately share file access to history,
   settings and login.
8. Use a server-pinned Linux image containing both provider CLIs, Git, Node/npm, and the supported
   project toolchain. Build/provision it explicitly outside a turn; do not build a repository's
   Dockerfile or interpret its devcontainer/Compose configuration on the host. Pin tested CLI/image
   versions and disable automatic provider updates. Mount the checkout directly without masking
   dependency/build directories. Dependencies, lockfiles and generated outputs written by Agent
   are host checkout changes. Document that macOS/Linux native dependencies may need reinstalling
   when switching environments; npm downloads use disposable `/tmp/npm` scratch space.
9. Mount the resolved checkout at a stable container path such as `/workspace`, read-only for
   Ask/Plan and writable for Agent. Mount only this turn's prepared attachments at `/context`,
   read-only. Translate paths in prompts, image inputs, context manifests, and provider resume
   configuration; never make host paths work by mounting their parents. Validate canonical source
   paths immediately before creation and reject sources overlapping CodeAI's installation, data,
   runtime configuration, or provider storage. Reject checkouts whose Git metadata requires an
   external path (linked worktrees/external gitdirs), and do not follow symlinks to add mounts.
10. Run as a non-root user with no sudo, privileged mode, added capabilities, host PID/network
    namespaces, devices, host sockets, SSH-agent forwarding, or Docker socket/API access. Drop
    capabilities, set `no-new-privileges`, retain the default seccomp protections, and use a
    read-only image filesystem with explicit writable home/tmp locations. Start with limits
    of 2 CPUs, 4 GiB memory, 256 processes, 256 MiB tmpfs, and bounded logs; expose only validated,
    bounded host settings where needed. Memory/process limits do not impose a disk quota on a
    writable bind mount: repository growth remains a documented direct-mount risk.
    On Linux, map the worker UID/GID to the owner's checkout access without recursively changing
    host ownership or permissions. Fail clearly if the non-root worker cannot access the checkout.
11. Docker launch configuration and trusted image selection live outside the writable checkout and
    are validated on every launch. An agent editing configuration in its repo cannot grant itself
    mounts, capabilities, network access, or a different next-turn profile. CodeAI must never run
    workspace build scripts on the host. Every CodeAI Git read must remain non-executing,
    non-mutating, and confined to the checkout, including after Agent replaces `.git`, changes
    `core.worktree`, or plants path redirections. Admission-only validation is insufficient. Host
    calls must disable executable hooks, fsmonitor, external diff/textconv and ambient executable
    configuration, and establish that metadata, config includes, and file paths cannot cause
    outside reads/writes. Any read path that cannot prove this entire contract must execute in an
    isolated read-only helper using the same filesystem boundary, without provider credentials or
    network. Cover status, diff, context, and later Local reads of an Agent-modified checkout;
    test both repo-planted commands and synthetic outside-file reads/writes.

### C. Define network and authentication separately

12. Enforce outbound access outside the worker's authority, using host-controlled network rules
    and an isolated egress service with no direct outbound route from the worker. Ship a reviewed
    allowlist for the selected provider's inference/authentication endpoints. Serve public npm
    metadata/tarballs through a fixed-upstream gateway that permits only required GET/HEAD
    operations, strips client credentials, and routes tarball URLs back through the gateway;
    reject alternate upstream origins and redirects outside the approved upstream. Block direct
    registry connections, including CONNECT tunnels: a packet firewall cannot inspect HTTP
    methods inside TLS. Private registries, arbitrary web access, git remote access, publishing,
    deployment, and remote MCP/apps are not granted by this profile. No general purpose
    network-permission UI is required for this version.
13. Block host/LAN services, the CodeAI HTTP/HTTPS API, Docker control, other workers, private and
    link-local destinations, and cloud metadata. DNS, redirects, IPv6, and direct IP requests must
    not bypass the policy. A proxy environment variable alone is insufficient. Agents must reach
    the model, so “network disabled” must not accidentally disable provider inference. Report
    blocked requests as bounded failures; never retry them on the host or widen the policy.
14. The owner signs in with the provider's own CLI in a dedicated setup container, once per provider
    for new Docker conversations. A documented terminal helper selects the same image, provider home, and
    network policy as execution, without mounting a repository. CodeAI manages volume identities
    and readiness only: it never reads, copies, logs, or stores credential contents, imports the
    host's provider configuration, or forwards its host environment. Credentials and native
    session files are written only by the provider in its volume. Setup output stays in the
    owner's interactive terminal; no login secrets enter API responses, transcripts, or debug logs.
    Setup retains a home-admission lease and refuses mounted homes; ordinary turns release that
    lease after mounting, permitting concurrent conversations. Legacy cleanup holds the exclusive
    session lease and never removes shared homes. Setup cannot overlap an executing turn using
    that home. Treat setup containers as
    owned resources during recovery, with explicit labels and no automatic restart policy.
15. Reuse the selected authenticated provider home across turns and application restarts.
    Missing/expired login produces actionable setup guidance. Missing native session state fails
    visibly and offers a new provider session without silently replaying a possibly delivered turn.
    Record only opaque volume ownership and provider-session identity in server metadata.
16. State the remaining exposure honestly: the provider and its commands share access to the
    mounted provider home; a read-only mount would not hide a token. Ignored repository secrets
    are also visible. Allowed provider destinations can carry repository data, and an allowlist
    is not a complete data-loss-prevention boundary. This version remains for the owner's trusted
    repositories. It does not promise safety for hostile tenants or arbitrary untrusted code.

### D. Grant autonomy inside the boundary

17. Docker Agent supports Claude and Codex with ordinary built-in file and shell tools available
    without CodeAI per-action permission cards. It can edit, run local Git commands, install allowed
    dependencies, and run tests/builds inside the container. Exact provider flags are pinned and
    verified against the shipped CLI versions; retain native sandboxing where compatible, and
    relax it only inside a verified container profile. Never achieve this by blanket-accepting
    every provider approval request in the existing host approval broker.
18. Ask/Plan may inspect files and run commands against the read-only checkout but cannot change
    it, including through Bash/Git flags. Writable scratch/provider state is allowed; the claim is
    “repository read-only.” Changing mode creates a new container with the appropriate mounts and
    resumes only the addressed participant's native session. A previous Agent process cannot
    survive into Ask/Plan. Build/dependency volumes must not retain writable access to host files.
19. Keep inherited hooks, plugins, custom commands, MCP/apps, and subagents disabled in this first
    profile. Broader built-in file/shell access supplies the requested autonomy; enabling executable
    integrations is a separate capability decision. Unexpected escalation/integration requests
    fail closed, with a clear unsupported-action result, rather than executing outside the boundary.
20. Local provider policies and the `CODEAI_CODEX_AGENT` local release gate remain in force. Docker
    Codex Agent has its own readiness criteria: the tested container profile, supported protocol,
    authentication readiness, and the real-provider matrix below. Passing Docker checks does not
    claim the old host per-side-effect approval matrix passed. UI/docs explain the two contracts.

### E. Preserve scheduling, recovery, and the direct-edit contract

21. Reserve the existing machine slot and canonical checkout lock before any worker launch. Local
    and Docker turns share the same lock key: Agent excludes all other CodeAI turns on that checkout;
    Ask/Plan share reads. A container id never becomes a checkout or provider lock identity. Existing
    one-turn-per-session/provider rules still apply across participants and providers.
22. Browser reload/disconnect only detaches the stream. Completion, cancellation, timeout, protocol
    failure, and output overflow stop the entire container, including background processes, before
    releasing its slot/lock. Killing only the attached Docker client is not cancellation. If Docker
    is unreachable and termination cannot be confirmed, retain the lock and surface the failure.
23. Label workers with server-instance ownership, session, and run ids. On application startup,
    reconcile owned workers before admitting new turns: stop orphans, mark interrupted delivery
    honestly, and retain native session state for the next explicit turn. Never automatically replay
    a command or prompt. Use no automatic container restart policy; losing the daemon must not
    resurrect an old writer after recovery. Clean up only resources proven to belong to this
    CodeAI data-directory/machine identity, not every Docker container on the desktop.
24. Finishing/cancelling a turn removes its worker and temporary attachments, not the checkout or
    provider home. Archiving stops admitting turns and retains resumable state. Document an explicit
    owner-invoked cleanup operation for inactive participant volumes; cleanup must reject active
    use and explain that removing native history requires a new provider session.
25. Direct writes appear in the existing repository status/diff UI. Cancellation is not rollback;
    an agent can delete uncommitted files, change `.git`, or fill repository storage. Other host
    tools and editors are outside CodeAI's scheduler. The setup guide requires project tests/builds
    to run in the container and warns that host watchers, Git hooks, or later execution of modified
    code can execute agent changes as the desktop user. Reject mounting the running CodeAI checkout;
    use a separately installed CodeAI to work on its source.

### Type contract

```ts
export type AgentExecution = 'local' | 'docker';

interface DurableSession {
  version: 4;
  execution: AgentExecution;
  // Existing fields retained; also expose execution in public session/Arena summaries.
}

interface CreateSessionRequest {
  execution?: AgentExecution; // Omission retains existing clients' Local behavior.
  // Existing creation fields retained.
}
```

Keep `AgentMode` as Ask/Plan/Agent. Carry resolved execution in server runner/preflight inputs and
scope health by execution and provider; existing local health fields must remain compatible until
their consumers are migrated together. Container ids, mount paths, image configuration, and volume
identities stay server-private. Update `types.ts`, `sessionSchema.ts`, `protocol.ts`, store migrations,
creation, public projection, and client mode availability together. Test old active and archived
records; preserve revision/idempotency semantics and existing compatibility identifiers.

---

## Acceptance criteria

- [x] Docker is opt-in; Local remains the default. Creation explains direct autonomous edits,
      persists execution, displays it in Arena/session views, and rejects unsupported bindings.
- [x] Old active/archived sessions run as Local; execution/checkout cannot silently change,
      and Docker/native provider histories never cross execution boundaries. Version 1 and 2
      records migrate to version 4 Local on read. Version 3 records are not rewritten
      ([Story 60](STORY-20260909-session-format-compatibility.md)): their absent `execution` is
      read as Local everywhere, including the scheduler key
      ([Story 61](STORY-20260920-spacial-merge-review-fixes.md)).
- [ ] Both providers run via the existing protocols inside the pinned container profile, with
      correct prompt/attachment/image/resume paths and no host-execution fallback.
- [x] Filesystem and privilege probes prove access only to the assigned mounts; path escapes,
      dangerous configuration, external gitdirs, and protected-directory overlap are rejected.
- [x] Tests prove repo-planted Git configuration/metadata cannot execute host commands, expose
      outside files, or cause writes through any CodeAI status/diff/context read, including later
      Local reads. Workspace configuration cannot alter the Docker launch profile.
- [ ] The provider can authenticate/reach inference and install a public npm package through the
      GET/HEAD gateway; prohibited methods, direct registry access, redirects, DNS/IP/IPv6 bypasses,
      host APIs, and other workers stay blocked.
- [ ] Provider-owned login/history persists across turns/restarts without CodeAI reading or copying
      credentials; provider storage is separate per installation/provider, legacy homes remain
      intact, and missing authentication/history is explicit.
- [ ] Claude and Codex Docker Agent edit and run tests without individual approval cards;
      Ask/Plan cannot mutate the checkout, including after an Agent turn. Unsupported integrations
      and boundary escalation fail closed. The local Codex gate remains separate.
- [x] Local/Docker turns obey the same checkout locks, session/provider exclusion, queue bounds,
      and per-machine concurrency; reload and reattachment retain the existing event semantics.
- [ ] Cancellation/failure stops all descendants before releasing locks; unconfirmed termination
      blocks reuse. Restart/daemon-loss reconciliation prevents duplicate delivery and removes
      orphans. Reconciliation runs only in the next server process, so it cannot stop writes made
      between an exit and that start: those are bounded by the worker's own lifetime and a
      best-effort exit hook ([Story 61](STORY-20260920-spacial-merge-review-fixes.md)). Confirming
      that bound against a real daemon remains part of this box.
- [ ] Resource/output limits are enforced; cleanup is ownership-scoped, retains inactive resumable
      state by default, and never removes source files or active participant volumes.
- [x] README, architecture, sample configuration, setup/cleanup instructions, vision/AGENTS safety
      statements, and the experiment log describe what actually ships and its direct-mount limits.
- [ ] Focused automated checks, the real Docker boundary suite on macOS/Linux, and the real Claude
      and Codex matrix below pass. Record versions and evidence; mocks alone do not clear release.
- [x] `npm run lint`, `npm test`, `npm run build`, and affected Playwright flows pass.

## Out of scope

- Separate clones/worktrees, snapshots, automatic rollback, apply/discard, and merging agent output.
- Multiple mounted repositories, repository-free Docker sessions, and external Git metadata.
  A later story must extend mount authorization and atomic locks across every mounted checkout.
- Remote Docker daemons, a machine registry, cloud execution, teams, hostile multi-tenant isolation,
  VMs/microVMs, and automatic runtime installation.
- Arbitrary devcontainer/Compose execution, custom user images, other language toolchains, private
  registries, Docker-in-Docker, port-forwarded previews, and host GUI/browser automation.
- Remote integrations, credential brokering, unrestricted web access, publishing/deployment flows,
  per-command Docker approval cards, or removing restrictions from the existing Local backend.

## How to verify

1. Keep ordinary `npm test` offline using fake provider/Docker processes. Cover configuration,
   profile construction, old-record migration, strict API input, backend-specific health, path
   translation, resume identity, permission handling, cleanup ownership, and lifecycle failures.
   Exercise session creation/mode labels and disabled/unavailable Docker in Playwright.
2. Add a separate opt-in Docker integration command that uses disposable fixture repositories and
   synthetic secrets/sentinels, never personal files or real credentials. Run it on Docker Desktop
   for macOS and Docker Engine for Linux with the actual image/network policy. Prove read-only
   mounts, non-root/no-capability enforcement, protected-path rejection, and memory/process limits.
3. From that fixture worker, attempt outside-path/symlink access, alternate gitdirs, remounts,
   Docker control, host/LAN/metadata/other-worker access, direct IP and IPv6, redirected requests,
   DNS-policy bypass, proxy bypass, direct registry access/CONNECT, and prohibited registry methods
   through the real npm gateway. Allowed npm metadata/tarball downloads succeed. Plant
   fsmonitor/textconv/hook commands, replace `.git`, and redirect `core.worktree`/config includes in
   the repo after admission; invoke every CodeAI status/diff/context path, including later Local
   reads. External synthetic secret contents must never appear in responses/context/output, and
   external read/write and execution sentinels must remain untouched. Use fixed test executables,
   not model compliance, as evidence of boundary enforcement.
4. For each real provider, use a disposable trusted Node repo and the documented provider-owned
   login flow. Ask inspects it; Plan proposes a change; Agent edits and runs its tests without
   permission cards. Verify the host diff, image/canvas input, usage/activity stream, and a later
   Ask/Plan write denial. Record image digest, CLI versions, OS/runtime versions, and outcomes in
   `docs/experiment-log.md`, without credential contents.
5. Resume both providers after turn-container replacement and application restart. Exercise
   separate provider-native conversation identities within a shared provider home, retained legacy
   homes, expired authentication, missing native history, and
   incompatible CLI/profile state. None may resume another participant or repeat a delivered turn.
   Attempt setup/turn/cleanup overlap on one participant home and verify mutual exclusion; on Linux,
   verify generated file ownership and rejection of an inaccessible checkout without host chmod/chown.
6. Queue Local and Docker Agent turns on one checkout, then independent checkouts. Verify shared
   exclusion/capacity and browser reattachment. Cancel a fixture that spawns a delayed background
   writer; its sentinel must not change after cancellation or after the lock is released.
7. Simulate application death, daemon loss, timeout, oversized output, and stop failure. Restart
   and verify owned-worker reconciliation before admission, no resurrected writes, accurate
   interrupted outcomes, and intact source/provider state. Confirm cleanup ignores unrelated
   containers and refuses active homes.
8. Run `npm run lint`, `npm test`, `npm run build`, and the affected Playwright flows. Publish the
   exact Docker integration command and passing platform/provider evidence before marking Shipped.

## Spec review

Cleared for implementation planning by an independent subagent review on September 8, 2026, after
revising HTTPS registry method enforcement and host Git filesystem containment and their verification
criteria. The follow-up review found no remaining blockers. No Docker or real-provider tests ran
during that spec review. Implementation began afterward; the checklist above tracks current progress.

## References

Official documentation consulted September 8, 2026. Verify flags, endpoint lists, and supported
versions again during implementation; these links are design inputs, not completed test evidence.

- [OpenAI sandboxing](https://learn.chatgpt.com/docs/sandboxing) — sandbox boundaries and approval
  policy are separate controls.
- [Claude development containers](https://code.claude.com/docs/en/devcontainer) — unattended
  execution, provider-owned authentication, and the remaining mounted-file/credential exposure.
- [Docker bind mounts](https://docs.docker.com/engine/storage/bind-mounts/) — writes affect the host
  directory directly.
- [Docker security](https://docs.docker.com/engine/security/) and
  [networking](https://docs.docker.com/engine/network/) — daemon authority, isolation, resource
  controls, and default outbound connectivity.
