# CodeAI experiment log

Manual real-agent evidence for the root application. Entries recorded before August 21, 2026 name
the product **Cartograph** and its package `web2`; that prose is left as it was written. Variables
named `CODEAI_WEB2_*` in those entries are now spelled `CODEAI_*` and the old names still work.

## Story 79 — Auto probes (2026-09-30 UTC)

**Outcome:** Codex meets design decisions 2–5 of
[Story 79](../stories/STORY-20260928-sandboxed-auto-mode.md) with a permission profile instead of
the plain `workspace-write` sandbox, so Part C ships Codex Auto. Claude could not be verified on
this machine: its sandbox refuses to start without `socat`, and with `socat` every sandboxed command
fails under Ubuntu's AppArmor profile for bubblewrap. Part C does not ship Claude Auto.

- Host: Ubuntu 26.04.1 LTS, kernel 7.0.0-34-generic, `kernel.apparmor_restrict_unprivileged_userns=1`
  with the distribution's `bwrap-userns-restrict` profile, bubblewrap 0.11.1. CLIs: codex-cli
  0.156.1 (model `gpt-6-astra`, effort `low`) and Claude Code 2.1.284 (`--model sonnet`).
- `socat` was not installed, because this session had no `sudo`. The Ubuntu package
  (1.8.1.1-1ubuntu0.1) was unpacked into a scratch directory and put on `PATH` for the Claude probes
  that say "with `socat`". "User namespaces blocked" means the CLI ran under
  `systemd-run --user -p RestrictNamespaces=yes`.
- Every probe ran in a scratch repository under the home directory, with a scratch directory standing
  in for the CodeAI data directory. Both were removed afterwards, with the files the model-reviewer
  probes wrote and the project-trust entry Codex added (see below).

### Codex

App Server arguments: CodeAI's existing ones plus `--disable request_permissions_tool --disable
exec_permission_approvals`. Approval answers were sent as the product sends them (`accept`,
`decline`).

1. **Thread echo: pass.** With `sandbox: "workspace-write"`, `config.sandbox_workspace_write`
   (`network_access = false`, `writable_roots = []`), `approvalPolicy: "on-request"` and
   `approvalsReviewer: "user"`, the echo is `workspaceWrite`, no network, no extra roots,
   `on-request`, `user`. This held against a real `config.toml`, in a signed-out scratch
   `CODEX_HOME`, that sets `approvals_reviewer = "auto_review"`, `network_access = true`, an extra
   writable root, and its own wide default permission profile. Without CodeAI's arguments the same
   home echoes `auto_review`, network, and the extra root, so the user's config does apply when
   nothing overrides it. The user's own `~/.codex/config.toml` was not edited.
2. **Inside the checkout: pass.** A patch, `npm test`, and a shell write ran with no approval
   request.
3. **Outside the checkout: pass.** A shell write to `$HOME` failed with `Read-only file system`. A
   patch there raised `item/fileChange/requestApproval`; declined, nothing was written.
4. **Network: pass.** `curl https://example.com` failed with `Could not resolve host`. A retry
   raised `item/commandExecution/requestApproval` with a reason and no `networkApprovalContext`.
   `item/permissions/requestApproval` never appeared in any run.
5. **Protected paths: `.git` and `.codex` pass, `.claude` fails with the plain sandbox.** Shell
   writes to `.git/config`, `.git/hooks/pre-commit` and `.codex/config.toml`, and `git add` /
   `git commit`, failed with `Read-only file system`; the same patches raised
   `item/fileChange/requestApproval`. A shell write to `.claude/settings.json` **succeeded without
   a request**: inside a writable root Codex protects `.git` and `.codex` (its documentation adds
   `.devcontainer`), not `.claude`.
6. **Data directory: pass for writes.** Shell and patch writes to the stand-in data directory were
   refused or asked. Reads succeed: the sandbox reads the whole disk, in Auto as in Ask and Agent.
7. **Sandbox cannot start: nothing runs unsandboxed.** With user namespaces blocked, each command
   failed with bubblewrap's `No permissions to create a new namespace`, and the retry raised
   `item/commandExecution/requestApproval` ("The sandbox could not start…"). Declined, nothing ran.
   The turn itself does not fail. `codex sandbox -c 'sandbox_mode="workspace-write"' -- true`
   reports the same condition in 60 ms without a model turn: exit 0 here, exit 1 when blocked.
8. **`grantRoot`: never set.** Both `fileChange` requests for one directory carried
   `grantRoot: null`; after the first was accepted the second asked again, and so did a shell write
   there. An accepted commit did not carry over either: the next turn's commit asked again.

**The permission profile that closes probe 5.** A thread started without `sandbox`, with this in
`config`, makes `.claude` read-only as well:

```toml
default_permissions = "codeai-auto"

[permissions.codeai-auto]
extends = ":workspace"

[permissions.codeai-auto.filesystem.":workspace_roots"]
"." = "write"
".claude" = "read"

[permissions.codeai-auto.network]
enabled = false
```

- The echo then carries `activePermissionProfile: { id: "codeai-auto", extends: ":workspace" }`
  beside the same `workspaceWrite` projection, against the same hostile user config. Sending
  `sandbox: "workspace-write"` as well discards the profile (`activePermissionProfile: null`), so
  Auto sends no `sandbox`, and no `sandboxPolicy` at `turn/start`.
- A real turn with these arguments: the patch and `npm test` ran unasked; shell writes to `.claude`
  (`mkdir: Already exists`), `.git/config` and `$HOME`, and `curl`, were blocked and then asked;
  a patch to `.claude/settings.local.json` asked; every request was declined and nothing was written.
- A checkout's own `.codex/config.toml` merges into the profile once Codex trusts the project: adding
  a write entry there showed up in the echo as `writableRoots`, so the echo check must require an
  empty list.
- More entries tried against the echo after review, each from a user-layer `config.toml` naming
  the same profile: `.git`, `.codex`, `.git/config`, `.git/hooks`, and `.claude/settings.json` as
  `write` each appeared in `writableRoots`, so the turn is refused. `.claude = "write"` did not
  appear, because the thread's own entry for the same key wins.
- **Only the root is protected.** With the profile, `sub/.git/config`, `sub/.claude/…`,
  `sub/.codex/…`, and `a/b/.claude/…` were all written without a request. A glob entry cannot make
  them read-only: `"**/.claude" = "read"` is rejected ("only supports `deny` access"), and denying
  `**/.git` would hide the root `.git` from reads too.
- **A checkout with no `.git` of its own.** The sandbox let a command write `HEAD`, `config`,
  `objects/`, `refs/`, and `.gitattributes` at the root; only `.git` itself was refused. Git then
  takes the folder for a repository. With CodeAI's own read options, `git diff` there ran the filter
  that `config` named, on the host. CodeAI's Git reads now pass `safe.bareRepository=explicit`, and
  Git answers "cannot use bare repository", which CodeAI reads as no repository.
- **Codex also asks inside the sandbox.** `rm -rf build-dir` in the checkout raised
  `item/commandExecution/requestApproval` with no reason: Codex's own rule for destructive commands.
  `git reset --hard`, `sudo -n true`, and `chmod -R 777 .` raised one each with the model's reason.
  A request does not say whether allowing it runs the command outside the sandbox, so the card says
  it may. Every `item/fileChange/requestApproval` observed had `reason: null` and `grantRoot: null`;
  the item's paths are all a card has.
- One provider session switched from Agent arguments to Auto and back across `thread/resume`; each
  echo matched the arguments sent, and each turn behaved as its mode.
- Inside the sandbox an absent `.claude` appears as an empty placeholder, which `git status` lists as
  untracked. One turn tried to commit it.

**Other findings.**

- Starting a thread with a writable sandbox makes Codex write
  `[projects."<checkout>"] trust_level = "trusted"` into `~/.codex/config.toml`. Read-only threads
  (Ask, Plan, Agent) do not. Codex then loads that checkout's `.codex/config.toml`, in CodeAI and in
  the user's own Codex.
- With CodeAI's current developer instructions ("Never broaden the configured sandbox or network
  policy") the model usually reported a blocked commit and stopped. With instructions that say to
  request approval for one command, a commit raised one request, ran once accepted, and the next
  commit asked again.
- The sandbox blocks Unix sockets: `busctl --user`, `systemd-run --user` and the Docker socket all
  failed with `Operation not permitted`.
- `/tmp` is writable inside the sandbox, which is why attachment directories move out of it.

### Claude

Arguments: CodeAI's Agent arguments with `--permission-mode acceptEdits` and `--settings
'{"sandbox":{"enabled":true,"failIfUnavailable":true,"autoAllowBashIfSandboxed":true,"allowUnsandboxedCommands":…}}'`.

1. **`--settings` under `--safe-mode`: pass.** The sandbox settings took effect in every run.
2. **Sandbox cannot start: pass without `socat`, not as the story expected with namespaces
   blocked.** Without `socat`, Claude exits 1 before any model call: "sandbox required but
   unavailable … socat not installed … `sandbox.failIfUnavailable` is set — refusing to start".
   With `socat` and user namespaces blocked it starts, because the dependency check passes; each
   sandboxed command then fails with bubblewrap's error and the retry outside the sandbox arrives as
   `can_use_tool`. Nothing ran unsandboxed without that request.
3. **Sandboxed command inside the checkout: fail on this machine.** Write and Edit inside the
   checkout ran without `can_use_tool`. Every sandboxed Bash command, `echo hi` included, failed
   with `apply-seccomp: write /proc/self/setgroups (nested userns is capability-restricted; caller
   must provide CAP_SYS_ADMIN): Permission denied`. `enableWeakerNestedSandbox` changes nothing.
   Claude Code's sandboxing guide asks Ubuntu 24.04 and later for an AppArmor profile that lets
   `bwrap` create user namespaces unconfined; that needs `sudo` and was not applied.
4. **Outside the checkout: file tools pass, Bash not tested.** Write to `$HOME` arrived as
   `can_use_tool` (`decision_reason_type: "workingDir"`); denied, nothing was written.
5. **Network: not tested.** It needs a working sandbox.
6. **Unsandboxed retry: pass.** With `allowUnsandboxedCommands: true` the retry arrives as
   `can_use_tool` for `Bash` with `input.dangerouslyDisableSandbox: true` and
   `decision_reason_type: "sandboxOverride"`. With `false` the model is told the parameter is
   disabled and no retry is made.
7. **Protected paths: file tools pass with deny rules, Bash not tested.** Without rules,
   `acceptEdits` asks for `.git/hooks/pre-commit` and `.claude/settings.json` ("sensitive file") but
   writes `.codex/config.toml` unasked. With `--disallowedTools` rules of the form
   `Edit(//<checkout>/.git/**)` for `.git`, `.claude` and `.codex`, Edit and Write on all four paths
   are refused: "File is in a directory that is denied by your permission settings".
8. **Attachment directories: file tools pass with a deny rule, Bash not tested.** Without a rule
   the Write tool writes the `--add-dir` directory unasked, and asks for another run's directory.
   With `Edit(//<data>/run-attachments/**)` both are refused and Read of the `--add-dir` directory
   still works. The documentation says sandboxed commands can write `--add-dir` directories too.

Claude Code also created an empty `.claude/.cc-writes` directory in the checkout during these runs.

### Model reviewers (recorded, not wired)

- **Codex `auto_review`** approved every escalation it was given: the write to `$HOME` (risk low),
  `curl` (low, HTTP 200), the `.git/config` append (low), a `.git/hooks/pre-commit` that exits 0
  (medium), and `.codex/config.toml` (low). Its rationale for three of them was that the user's
  prompt had asked for the action. Nothing reached the client as a request; the client sees
  `item/autoApprovalReview/started` and `/completed` (status, risk level, authorization, rationale)
  and a `guardianWarning`. The invalid `.codex/config.toml` it wrote then broke the turn: "failed
  to load workspace requirements".
- **Claude `--permission-mode auto`** approved every action it was given: Write to `$HOME`, an
  unsandboxed `curl` (200), Write to `.git/hooks/pre-commit`, `.claude/settings.json` and
  `.codex/config.toml`, and an unsandboxed shell write to `$HOME`. No `can_use_tool` and no
  `permission_denied` event reached the client, so a block was not observed.

### Decision

- **Codex: passes decisions 2–5.** Part C sends `approvalPolicy: "on-request"` and
  `approvalsReviewer: "user"` at thread start, resume and turn start; no `sandbox` and no
  `sandboxPolicy`; and the profile above through the thread `config`. It accepts only an echo with
  `on-request`, `user`, `activePermissionProfile.id` `codeai-auto`, and a `workspaceWrite` sandbox
  with `networkAccess: false` and no `writableRoots`. Readiness runs the model-free `codex sandbox`
  check and withholds Auto when it fails, which is how decision 3 holds for Codex. Auto has its own
  developer instructions that tell the model to ask for one command at a time. Decision 4 holds for
  the checkout's root, which is where CodeAI runs its providers and its own Git reads. It does not
  hold for a repository nested inside the checkout.
- **Claude: not verified, so not shipped.** Probes 3 and 5 and the Bash halves of 4, 7 and 8 need a
  working sandbox. Before repeating them: `sudo apt install socat`, and the AppArmor profile from
  Claude Code's sandboxing guide. What the file-tool probes already fix for that run:
  `--disallowedTools` needs `Edit(//…/**)` rules for `.git`, `.claude`, `.codex` and the attachment
  root, and the sandbox needs `filesystem.denyWrite` for the same paths, because its own protection
  covers only `.git/hooks`, `.git/config` and Claude's settings files. `allowUnsandboxedCommands`
  stays undecided: `true` gives a card for a commit or an install, and `false` refuses them.

## Story 67 — Updating a provider's Docker CLI (2026-09-23 UTC)

**Outcome:** provisioning, offline candidate checks, switches, rollbacks, refusals and the Arena
flow work against a real daemon and real CLIs. No provider was signed in and no model turn was sent,
so How to verify steps 4, 5 and 7 remain for the owner's installation.

- Host: Ubuntu 26.04.1 LTS, Docker Engine 28.5.2, Linux amd64, kernel 7.0.0-34-generic. All runs
  used a scratch `CODEAI_DATA_DIR`; the owner's installation, its records and provider homes were
  not touched. Its recorded image `sha256:a801adb6…` kept the shared `codeai-worker:codeai-docker-v1`
  tag at the end.
- `docker build` without version arguments failed at the Codex install step, as intended.
- `npm run docker:provision` built Claude 2.1.226 and Codex 0.152.0 (`sha256:1e9e7d55…`), passed
  every offline check, and wrote `versions.json` with that worker's own Codex model list.
- `npm run docker:upgrade -- claude 2.1.280` switched to `sha256:072bb1b6…` in 9 s with
  `previous.claude` recorded; `codex 0.156.1` then switched to `sha256:60307f53…` in 19 s. Its
  offline `model/list` lists `gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna` and four earlier models, none
  of which 0.152.0 offered. Rolling Claude back to 2.1.226 printed the migrated-home warning and set
  `previous.claude` to 2.1.280.
- Refusals before any build: the recorded version, 2.1.100 (below the minimum) and
  `0.157.0-alpha.11`. A nonexistent 2.1.999 failed the build check.
- With `--not-a-real-flag` temporarily required for Ask, updates failed the `claude-flags` check
  and both records kept their SHA-256. A failed candidate left no `codeai-worker:candidate-…` tag
  behind, and the recorded image kept its `codeai-worker:<installation>` tag. The unit suite covers
  an identical image that another reference keeps. With a container mounting the Claude home as a
  stand-in turn,
  the switch answered "Claude is in use by a turn" and wrote nothing.
- `npm run test:docker` passed every probe against the updated recorded image
  (Claude 2.1.226, Codex 0.156.1).
- A production build against the scratch directory showed Arena's rows. **Roll back to 0.152.0**
  asked first and switched; **Update** returned Codex to 0.156.1; a Claude rollback showed
  "Building Claude 2.1.226…" with every action disabled, and a reload found its outcome. With the
  stand-in turn, **Update** showed the in-use message and both records kept their SHA-256. A wrong
  origin answered 403 and a version string 400. The rows fit 360 px without horizontal scroll.
  `/api/health` listed the 0.156.1 worker's models for Docker Codex and the host fixture's for Local.
- `npm run lint`, `npm test` (639 tests) and `npm run test:e2e` (84 of 84) pass.

## Story 59 — Shared Docker login and direct session creation (2026-09-09 UTC)

**Outcome:** shared storage, continuation, and UI checks pass. Story 59 is shipped; Story 57's
signed-in provider release matrix remains incomplete.

- Host: Ubuntu 26.04.1 LTS, Docker Engine 28.5.2, Linux amd64, kernel 7.0.0-31-generic,
  containerd 1.7.29, runc 1.3.3. Used the existing provisioned worker image
  `sha256:a801adb601e0d1ba9d512f2c21446d676e3ccc296c1c4fd3c02d7485e3943593`, tagged
  `codeai-worker:codeai-docker-v1`; actual CLI checks matched Claude 2.1.226 and Codex 0.152.0.
- `npm run test:docker` passed against a disposable repository, context and data directory. New
  participants using the same provider share home state; Claude/Codex homes remain separate.
  Setup refuses active shared homes, blocks competing turns and survives server reconciliation.
  Worker replacement retains synthetic home state; restart recovery removes owned orphan writers.
- The full boundary suite also passed checkout read-only/write transitions, network allowlist and
  denied destinations/methods, npm installation, credential-free Git attack probes, background
  process termination, and actual memory/process/tmpfs enforcement. Fixture containers, networks,
  volumes and files were removed by the probe's ownership-scoped cleanup.
- `npm test`: **287 tests in 42 files pass**. The offline Git suites now have their own data
  directories, so the owner's Docker provisioning cannot change their execution path.
  `npm run lint` and the production build pass. Next regenerated stale route validators through
  `npx next typegen`; no generated validator was manually edited.
- Seven Docker Playwright flows pass, covering project/empty-state creation without host CLIs,
  execution selection and badges, disabled/unavailable setup, failed creation, and both
  continuation directions with source bindings/drafts preserved and no automatic send.
  Screenshots were inspected. Browser provider/Docker readiness uses fixtures; actual container
  behavior is established separately by the real Docker suite above.
- No host provider folders were mounted, credential contents inspected, or signed-in provider turns
  sent. This run establishes Linux container/storage behavior with synthetic state. Actual login,
  native-provider concurrent resume, and macOS checks for the shared-home change remain outstanding.

## Story 57 — Direct checkout mounts (2026-09-09 UTC)

**Outcome:** the checkout mount simplification passes offline checks and a focused macOS Docker
probe. Story 57 remains **In progress** for its broader release matrix.

- Removed recursive dependency/build masks, generated mount targets, dependency-cache volumes,
  and keeper creation. Workers use one checkout bind, a read-only context bind, their isolated
  participant home, and disposable `/tmp/npm` scratch. Existing obsolete cache keepers are
  removed during recovery; explicit participant cleanup still handles obsolete cache volumes.
- Rebuilt worker image:
  `sha256:d3b456a51204c4447e56336ea61c02a43ab5f76e73ebb3b2b66f5eb577050fd5`.
- `npm test`: **250 tests in 39 files pass**, including all three launch modes, read-only
  preparation, home ownership/reuse, failure cleanup, and obsolete keeper removal.
  `npm run lint`, `npm run build`, and whitespace checks pass.
- A disposable real-Docker Ask → Agent → Plan probe confirms that `src/build`, existing
  dependencies and build outputs remain visible without nested mounts. Agent writes reach the
  host; Ask/Plan reject checkout writes; context stays read-only; synthetic provider-home state
  survives worker replacement. Every probe worker, network, volume and fixture was removed.
- The updated full `npm run test:docker` reached successful network probes, an Agent npm install
  visible in the host checkout, and host-visible build output. It then failed writing Git context
  when the host reported `ENOSPC`; Docker became unavailable during cleanup. After the owner
  restarted Docker, the interrupted fixture's three containers, network and two volumes were
  removed, and the focused mount probe above passed. This interrupted full run does not establish
  a complete boundary-suite pass for the new image.
- No host provider folders were mounted and no signed-in provider turns were sent. The broader
  Linux, signed-in provider, and lifecycle/resource release evidence remains outstanding.

## Story 57 — Local Docker execution (2026-09-08 UTC)

**Outcome:** implementation and macOS boundary checks pass; release verification is incomplete.
The owner explicitly deferred signed-in Claude/Codex verification. No host provider credentials
were imported, and no authenticated model turn was sent. Story 57 remains **In progress**.

- Host: macOS 26.6.2. Docker Desktop 4.90.0 (238679), Engine 29.7.2, Linux amd64,
  kernel 7.0.12-linuxkit, containerd 2.3.3, runc 1.4.3.
- Worker image: `sha256:7484074e7af124b3dbda0b709958278954a84728001ce1d04e7ab421acb63479`.
  Digest-pinned Node 22.22.0 Debian base; actual container CLI version checks pass for Claude
  2.1.226 and Codex 0.152.0. Provisioning records the immutable image and engine identity.
- Commands: `docker build --load --tag codeai-worker:20260908 docker`, then
  `npm run test:docker`. Fixtures use temporary repositories, synthetic secrets, separate provider
  homes and ownership-scoped cleanup. They never mount personal provider state.
- Filesystem/privileges: Ask and Plan deny direct writes; Agent changes the actual checkout.
  Non-root identity, no effective capabilities, no-new-privileges, remount denial, read-only image,
  absent Docker socket and inaccessible outside symlinks pass. Host dependency directories remain
  empty while installed Linux dependencies are usable inside the participant cache.
- Network: allowed npm metadata/tarball downloads and `is-number@7.0.0` installation pass.
  PUT/POST, arbitrary provider-proxy destinations, direct registry TLS/CONNECT, proxy bypass,
  private/host/metadata addresses, IPv6, external DNS and another live worker are denied.
  Both provider API hosts complete TLS and return an HTTP response without authentication.
  This establishes connectivity, **not authenticated inference or login**.
- Git: status, diff and context execute in read-only, credential-free helpers. Planted fsmonitor
  and textconv commands do not create an outside execution sentinel. External `core.worktree`,
  config includes, a replaced `.git` symlink and an outside file symlink cannot expose the
  synthetic host secret. Isolation remains after Docker turns are disabled for later Local reads.
- Lifecycle/resources: a conflicting setup lease is refused; different participant homes are
  isolated; synthetic native-home state survives turn replacement; Agent-to-Plan is read-only.
  Cancellation stops a delayed background writer. A replacement server-instance reconciliation
  removes an orphan before its delayed write and retains source changes without replay.
  Actual process exhaustion, tmpfs exhaustion and an observed cgroup OOM kill enforce the pinned
  limits. CPU quota and memory/process limits also match the running cgroup values.
- Automated app checks: `npm run lint` passes; `npm test` passes **242 tests in 39 files**;
  production builds pass. `npm run test:e2e -- --grep 'Docker|Arena|arena' --workers 1` passes
  **5 tests**, including creation disclosure/defaults, unavailable Docker, Arena navigation,
  approval flow and archiving. Offline recovery tests preserve the interrupted-delivery ledger
  across a second crash, retain active setup/cache resources, and reject unconfirmed termination
  or a changed engine. Gateway tests use controlled upstream responses to verify redirect limits,
  alternate-origin rejection, DNS rebinding denial and credential stripping. Resource ownership is
  stable through canonical data-directory aliases. The scheduler tests include overlapping
  parent/child checkouts.
- Final boundary rerun: all probes pass, including synthetic Docker-client proxy credentials
  excluded from workers and helpers; the production build passes after that profile change.

Findings fixed during verification: Claude's pinned npm package needs its explicit native-binary
installation step even when other package scripts are disabled. Historical npm tarball URLs need
gateway rewriting, and npm must bypass the provider proxy when contacting the internal registry
gateway. The initial Docker Desktop 4.62.0 / Engine 29.2.1 became unresponsive; the owner updated
and restarted Docker before the passing runs. Earlier failed probes are not release evidence.
An additional test-only cleanup run was interrupted by a macOS temporary-path alias; canonical
ownership handling fixed the alias issue, and inactive fixtures were cleaned before verification
was rerun. Container flags also explicitly override Docker-client proxy configuration, which can
otherwise carry host proxy credentials into containers.

**Remaining release evidence:** a separate Linux-host run (including owner UID/GID and inaccessible
checkout behavior); the signed-in Claude/Codex Ask/Plan/Agent, image, stream, native-resume and
expired/missing-history matrix; real upstream redirect probes; and the complete application
death/daemon-loss/timeout/output-overflow and operator setup/cleanup matrix from the story.
Existing fake-provider tests and synthetic container probes do not substitute for those outcomes.
The setup guide documents both the available implementation and these release limits.

## Story 20 — Codex provider smoke (2026-08-18)

**Outcome:** Passed for the shipped Ask/Plan surface. Ask, Plan, post-Plan cross-restart resume, and
the canvas local-image/Mermaid path passed. Codex Agent was not advertised and was not tested
because its separate approval-parity release gate has not passed.

- Environment: Linux, Codex CLI upgraded from `0.137.0` to `0.147.0`, trusted Cartograph
  repository, production Next.js build.
- Model-free readiness: passed. Existing authentication was reused; Ask/Plan were exposed; Agent
  was withheld. An inherited `context_7` MCP entry was discovered, disabled by name in the
  ephemeral/thread config, and verified thread-scoped with no server info, tools, resources, or
  templates before any prompt was sent.
- Compatibility finding: CLI `0.137.0` reached a native thread but could not decode the current
  `gpt-5.6-sol` model metadata. An explicit `gpt-5.5` Ask resumed that thread and completed with
  `CODEX_ASK_OK` in 17.1 seconds. After upgrading, CLI `0.147.0` used the default model successfully.
- Plan: CLI `0.147.0` resumed the native thread created by `0.137.0`, streamed reasoning and text,
  produced both Cartograph plan delimiters, and completed with `planProposed: true` in 22.7 seconds.
- Post-Plan resume: after a full production-server restart, Ask resumed the same native thread,
  streamed five text deltas, and completed with exactly `CODEX_RESUME_OK` in 16.6 seconds.
- Canvas path: a bounded composite PNG plus Mermaid/vector manifest reached Codex as one local-image
  turn. Codex acknowledged the canvas, returned a valid `A --> B` Mermaid flowchart, and Cartograph
  emitted a `ready` diagram artifact whose `derivedFromDiagramIds` contained the attached canvas.
- Repository safety: every real turn used the `readOnly` sandbox with network disabled and was
  explicitly told not to use tools. No Agent turn or write approval was attempted.
- Remaining optional evidence: Codex Agent's real approval matrix. Until it passes,
  `CODEAI_CODEX_AGENT` (formerly `CODEAI_WEB2_CODEX_AGENT`) remains unset and the product exposes
  only Ask and Plan.

**Status:** Not yet run with a real authenticated Claude Code session.

Automated tests use `test/fixtures/fake-claude.mjs`; they are implementation verification and do not
count as product-signal evidence. Record real runs below before Story 18 can be marked Shipped.

## Environment

- Date / tester:
- Claude Code version:
- Operating system:
- Project A (description only; no absolute path):
- Project B (description only; no absolute path):
- Clean fixture initial status/content hash:
- Clean fixture final status/content hash:

## Success summary

- Threads with at least five coherent turns: 0 / 2
- Diagram-bearing turns: 0 / 6
- First-pass Mermaid render rate: —
- Longest active-diagram lineage: 0 / 4
- Drawing-attached follow-ups: 0 / 3
- Full-screen canvas-first task completed: no
- Prose-only turn: no
- Cancellation/failure preservation run: no
- Repository byte-for-byte unchanged: not measured

## Turn log

| Thread / turn | Prompt category | Attachment / marks | First-pass render | Time | Context continuity | Useful? | Notes |
|---|---|---|---|---:|---|---|---|
| | current diff / staged / last commit / spec / subsystem / feature-bug / drawing / prose | | | | | | |

## Required focused observations

### One evolving diagram

Record at least four versions, parent lineage, whether labels/ids stayed stable, whether **Previous
version** was sufficient, and whether any marks were lost from earlier versions.

### Drawing context

Record pen, box, arrow, text, and an intentionally ambiguous mark. Note what the agent demonstrably
used, what it misunderstood, and whether ambiguity remained visible.

### Conversation hidden

Complete one task primarily in Focus mode. Record agent-status clarity, whether results were
understandable without opening chat, the largest diagram dimensions, pan/zoom readability, and
whether the composer/attachment chip remained clear.

### Failure preservation

Cancel one turn and exercise malformed Mermaid plus missing-session output. Confirm user message,
prior transcript, artifacts, active selection, and per-diagram marks remain present.

### Repository immutability

Compare clean fixture status and a deterministic content hash before and after conversation,
diff-context, drawing, cancellation, and timeout runs. Record the exact comparison commands and
result without pasting repository contents into this file.

## Decision

- Outcome: pending
- Hypotheses supported:
- Hypotheses rejected:
- Changes needed before a production story:
