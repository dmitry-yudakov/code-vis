# Local Docker execution

Story 57 is in progress. The code is opt-in; its release checklist includes actual Docker Desktop
and Linux Engine boundary tests and signed-in Claude/Codex turns. See the
[experiment log](experiment-log.md) for evidence and outstanding checks.

## Setup

Use a separately installed CodeAI, Node 20.9+, and a local Docker Desktop or Linux Docker Engine
28+ over a Unix socket. Remote Docker contexts and custom worker images are unsupported. CodeAI
rejects a repository that overlaps its running installation, data directory or provider storage.
To run Docker turns on CodeAI's own repository, use a separate installation; Local turns on this
installation's own project are unaffected.

From the installed CodeAI directory:

```sh
npm run docker:provision
```

This builds only CodeAI's `docker/` context, with a digest-pinned Node 22.22.0 Debian base, Claude
2.1.226, Codex 0.152.0, Git, npm, Python 3, make and a C/C++ compiler. It records the resulting
immutable image ID and local engine identity in `<CODEAI_DATA_DIR>/docker/profile.json`. A changed
engine fails closed: CodeAI cannot assume a worker on the previous engine stopped. No session Dockerfile, Compose file,
devcontainer configuration, dependency script or host provider configuration is used. Provisioning
is explicit and cannot occur as a side effect of a turn. An existing profile is not overwritten,
except by the explicit [engine replacement](#replacing-the-docker-engine) below.

**After provisioning, keep the Docker daemon running, for Local work too.** Each CodeAI start
completes Docker recovery before its first turn, Local included, and every status/diff/context Git
read runs in a helper container; nothing falls back to the host. If the daemon is stopped when
CodeAI starts, every turn answers 409 "Docker recovery is incomplete" until Docker is running. If it
stops later, Git views and a turn's repository context are unavailable and Docker turns are refused.
Start Docker and retry: CodeAI needs no restart. Turning Docker off in Arena does not change this.
Before provisioning, none of it applies, whether or not Docker is enabled.

In **Arena**, turn on **Enable Docker**. The choice is saved on this machine and takes effect
immediately, including after browser reloads and CodeAI restarts. The control shows **Off**,
**Setup needed**, or **Ready**; use **Check again** after starting Docker or provisioning the worker.
Enabling can precede provisioning, but Docker sessions require a ready worker. Sign in once for
each provider you use, before or after creating your first session:

```sh
npm run docker:login -- claude
npm run docker:login -- codex
```

Run only the command for the provider you want. New Docker conversations on this CodeAI installation
reuse that provider's login and persistent home. Login waits for ordinary admissions and refuses
while a turn is using that home; finish those turns before signing in again.

The saved boolean lives in `<CODEAI_DATA_DIR>/docker/settings.json` and overrides
`CODEAI_DOCKER_ENABLED` (or its `CODEAI_WEB2_DOCKER_ENABLED` alias). Without a saved UI choice,
the environment flag supplies the initial value, defaulting to false. Invalid or unreadable
saved settings disable Docker; saving from Arena repairs the record if the directory is writable.
Disabling blocks subsequent Docker session and turn requests. Already accepted running or queued
turns retain their configuration; use their existing Cancel control to stop them.

Choose **Docker** in **New session** inside your project, on the empty project screen, or in Arena.
A project needs exactly one primary repository on this machine; loose Docker sessions offer a
repository selector. New session creation starts with Local, or the current conversation's execution
when opening its New session menu. Provider availability follows the selected execution, so a host
provider installation is not required for Docker.

The conversation header has a distinct **Local** or **Docker** badge. **Continue in Docker/Local**
creates a new session in the other execution with the source session's project and exact repository
bindings. A bounded recap and unsent draft appear in its composer for you to edit and send. The
source conversation and its draft remain intact. Execution and Docker checkout bindings stay fixed;
provider-native history is not moved between environments or automatically replayed.

Docker participants created before shared provider storage retain their existing individual volumes,
history and login in place. Their login errors continue to give the legacy command:

```sh
npm run docker:login -- <session-id> <participant-id>
```

Run login in your own interactive terminal. It starts the provider's own CLI login in the pinned
image with the appropriate provider home and the execution network policy, and **no repository**.
Browser/device authentication steps belong to that provider. All setup output stays in your
terminal. CodeAI does not import your host login, read provider credential files, forward provider
environment variables, or include setup output in API responses or transcripts.

## Replacing the Docker engine

Moving between Docker Desktop, OrbStack, colima or a Linux Engine, or resetting Docker to factory
defaults, changes the engine identity. CodeAI never talks to a daemon other than the one it
recorded, so Git reads and Docker turns then stop, and after a restart Local turns too. If the
previous engine still exists, switch back to it. If it is gone or will stay stopped, adopt the
current one from the installed CodeAI directory:

```sh
npm run docker:provision -- --replace-engine
```

This builds and verifies the pinned image on the current engine, then replaces `profile.json`. It
refuses when the recorded engine is still the current one. Do not delete `profile.json` by hand.
Run it only when the previous engine is gone or stopped: CodeAI can no longer confirm that workers
there were removed, although every worker [ends itself](#execution-contract). Restart CodeAI
afterwards: a turn stranded by the switch releases its checkout, and startup recovery removes
anything this installation once left on the adopted engine. Provider logins and native history
do not move between engines: sign in again with `npm run docker:login`, and continue affected
conversations in a new session.

## Execution contract

Docker Agent edits the real checkout at `/workspace` and runs its commands without individual
approval cards. Ask/Plan use a read-only bind; their scratch space and provider home remain
writable. Every turn gets a new worker. New participants share one persistent provider-home volume
per CodeAI installation and provider; Claude and Codex have separate homes. Each participant still
resumes its own native conversation ID, but its tools can read and modify other conversations,
settings and login in that shared provider home. Changing the provider account affects all new
conversations using that home. Host provider storage remains separate. Older participant volumes
remain in use until explicitly cleaned up; their contents are never read or copied by CodeAI.
Missing native history fails visibly and requires a new provider participant/session, without
automatic replay. Local sessions retain their existing policies and separate Codex Agent gate.

Workers run non-root, with all capabilities dropped, `no-new-privileges`, Docker's default seccomp,
a read-only image filesystem, 2 CPUs, 4 GiB memory, 256 processes, 256 MiB `/tmp`, and bounded logs.
No Docker socket, host socket, device, host namespace, SSH agent or provider port is exposed.
Linux uses the owner's UID/GID; CodeAI does not recursively chown/chmod the checkout.
Launch flags clear all [proxy variables Docker would otherwise inject from client configuration](https://docs.docker.com/engine/cli/proxy/).
Only workers receive CodeAI's fixed provider proxy; helper containers receive empty proxy values.

The checkout is one direct bind mount. Existing source, dependencies and build outputs remain
visible at their original paths; preparation validates Git metadata without creating directories.
Agent dependency installs, lockfile changes and generated outputs affect the host checkout directly.
Ask/Plan cannot write anywhere in the checkout, including existing `node_modules` or build output
directories. Commands that require those writes must run in Agent mode. npm downloads use
disposable `/tmp/npm` scratch space within the worker's 256 MiB temporary-storage limit.

Host and container tools share the checkout's dependencies and outputs. Native dependencies
installed on macOS may not run in Linux, and Docker installs may replace dependencies needed by
host tools. Reinstall dependencies for the target environment when switching; CodeAI does not
maintain separate dependency trees. Run project tests/builds **inside Docker** during Docker work.

The worker has only an internal bridge in Docker's isolated gateway mode, with no direct outbound
route and no host gateway address. A separate egress container serves exact provider inference/auth
hosts. CONNECT authority and TLS server name must match; encrypted/ambiguous server names are
unsupported. The npm gateway accepts GET/HEAD only, strips client headers/credentials, pins a
validated public IPv4 upstream to `registry.npmjs.org`, validates redirects, and rewrites tarball
URLs through itself. Direct registry TLS/CONNECT, private registries, arbitrary web access, git
remotes, publishing, deployment and remote integrations are unavailable. Blocked requests fail
inside this profile; CodeAI never retries them on the host.

After provisioning, CodeAI's own status/diff/context Git invocations run in read-only,
network-disabled helpers without provider homes or other host directories. This remains true when
Docker turns are subsequently disabled, including for Local sessions. Git hooks, fsmonitor,
external diff/textconv, ambient configuration and optional index writes are disabled. Replacing
`.git` or redirecting configuration cannot add a host mount. Keep the pinned image available for
these reads. Before provisioning, Local retains host Git with executable features disabled.
The helper binds only the selected root: external metadata in a Local linked worktree can make
its Git view unavailable after provisioning as well. It never adds that external directory as a mount.

Local and Docker turns share the existing machine scheduler and checkout locks, including overlapping
parent/child checkout paths. Helpers protect their bind sources from enclosing writers. Reloading a browser
detaches its stream. Completion, timeout, cancellation and protocol failure remove the entire worker
before releasing its lock. If termination is unconfirmed, the turn stays active with a stopping
message and keeps its checkout/machine slot until Docker recovers. Startup/admission recovery removes
owned orphans before new turns, records interrupted delivery and never replays prompts. Owned
interactive setup sessions remain protected by their terminal process lease. A login or cleanup
whose terminal was killed is recognized by its dead process: the next turn, login or cleanup that
meets it clears it, without restarting CodeAI.

A worker cannot outlive CodeAI indefinitely. Its first process exits after the turn's time limit
plus ten minutes (one hour for a login), which ends every provider process inside it; Docker turns
never pause that limit for approvals. When the CodeAI process exits by itself, including `npm start`
handling SIGINT/SIGTERM, it also asks Docker to remove its active workers, without waiting and
without changing the exit. That step is best effort: SIGKILL, or a signal nothing handles as under
`start:remote`, skips it and leaves the time limit and the next startup recovery to clean up.

## Exposure and cleanup

Use this only for your trusted personal repositories. The provider and its commands can read the
mounted provider home and ignored repository files, including secrets. Allowed provider endpoints
can receive repository data; this is not a complete data-loss-prevention boundary. Agent can delete
uncommitted files, change `.git` and fill the writable checkout's storage. Memory limits do not
limit bind-mount disk growth. Cancellation is not rollback. Host editors, watchers, Git hooks and
later execution of changed code are outside CodeAI's container and scheduler and can run changes
as your desktop user.

Archiving retains history and provider homes. To explicitly remove an inactive **legacy**
participant's individual home:

```sh
npm run docker:cleanup -- <session-id> <participant-id>
```

Cleanup takes the same exclusive session lease as setup/turns, refuses active or unowned resources,
and never deletes source files or the shared provider home. It removes the legacy participant's
native history and login: add a new participant or create a new Docker session to use the shared
provider login. Running the command for a participant using shared storage leaves that storage
intact. It leaves the Git isolation profile intact. Unrelated Docker resources are never selected
for cleanup. Cleanup also removes that participant's obsolete dependency-cache volume if it was
created by the earlier prerelease implementation.

## Verification

```sh
npm test
docker build --load --tag codeai-worker:codeai-docker-v1 docker
npm run test:docker
npm run lint
npm run build
npm run test:e2e
```

`test:docker` uses a disposable repository, synthetic secrets and ownership-scoped cleanup, never
personal provider credentials. Run it on macOS Docker Desktop and Linux Engine. It does not clear
the signed-in provider matrix: Ask, Plan, Agent editing/testing, images, usage/activity, native
resume across replacement/restart, expired login and missing history need actual provider runs.
Record image/CLI/platform versions and outcomes before marking Story 57 shipped.

Design references: [Docker isolated gateway mode](https://docs.docker.com/engine/network/port-publishing/),
[Codex App Server external sandbox](https://learn.chatgpt.com/docs/app-server), and
[Claude CLI permissions and safe mode](https://code.claude.com/docs/en/cli-reference).
