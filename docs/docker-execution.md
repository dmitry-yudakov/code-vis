# Local Docker execution

Story 42 is in progress. The code is opt-in; its release checklist includes actual Docker Desktop
and Linux Engine boundary tests and signed-in Claude/Codex turns. See the
[experiment log](experiment-log.md) for evidence and outstanding checks.

## Setup

Use a separately installed CodeAI, Node 20.9+, and a local Docker Desktop or Linux Docker Engine
28+ over a Unix socket. Remote Docker contexts and custom worker images are unsupported. CodeAI
rejects a repository that overlaps its running installation, data directory or provider storage.
To work on CodeAI itself, run a separate installation.

From the installed CodeAI directory:

```sh
npm run docker:provision
```

This builds only CodeAI's `docker/` context, with a digest-pinned Node 22.22.0 Debian base, Claude
2.1.226, Codex 0.152.0, Git, npm, Python 3, make and a C/C++ compiler. It records the resulting
immutable image ID and local engine identity in `<CODEAI_DATA_DIR>/docker/profile.json`. A changed
engine fails closed: CodeAI cannot assume a worker on the previous engine stopped. No session Dockerfile, Compose file,
devcontainer configuration, dependency script or host provider configuration is used. Provisioning
is explicit and cannot occur as a side effect of a turn. An existing profile is not overwritten.

Set `CODEAI_DOCKER_ENABLED=true` (the `CODEAI_WEB2_DOCKER_ENABLED` alias also works), then restart
CodeAI. In Arena, create a session with **Docker** execution and exactly one primary repository
on this machine. Local is the default. A project must itself have one primary binding; otherwise
create a loose Docker session and select its repository. Execution and that session's binding are
fixed. Adding participants does not share their provider home.

A Docker session can exist before provider login. Sending a turn without that participant's
authentication returns a terminal command containing its session and participant IDs:

```sh
npm run docker:login -- <session-id> <participant-id>
```

Run this in your own interactive terminal. It starts the provider's own CLI login in the pinned
image with the participant's home and the execution network policy, and **no repository**.
Browser/device authentication steps belong to that provider. All setup output stays in your
terminal. CodeAI does not import your host login, read provider credential files, forward provider
environment variables, or include setup output in API responses or transcripts.

## Execution contract

Docker Agent edits the real checkout at `/workspace` and runs its commands without individual
approval cards. Ask/Plan use a read-only bind; their scratch space and provider home remain
writable. Every turn gets a new worker; native history stays in an isolated participant volume.
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
interactive setup sessions remain protected by their terminal process lease.

## Exposure and cleanup

Use this only for your trusted personal repositories. The provider and its commands can read the
mounted provider home and ignored repository files, including secrets. Allowed provider endpoints
can receive repository data; this is not a complete data-loss-prevention boundary. Agent can delete
uncommitted files, change `.git` and fill the writable checkout's storage. Memory limits do not
limit bind-mount disk growth. Cancellation is not rollback. Host editors, watchers, Git hooks and
later execution of changed code are outside CodeAI's container and scheduler and can run changes
as your desktop user.

Archiving retains history and provider homes. To explicitly remove an inactive participant's home:

```sh
npm run docker:cleanup -- <session-id> <participant-id>
```

Cleanup takes the same exclusive session lease as setup/turns, refuses active or unowned resources,
and never deletes source files. It removes native history and login: add a new participant or create
a new Docker session and sign in again. It leaves the Git isolation profile intact. Unrelated
Docker resources are never selected for cleanup. Cleanup also removes that participant's obsolete
dependency-cache volume if it was created by the earlier prerelease implementation.

## Verification

```sh
npm test
docker build --load --tag codeai-worker:20260908 docker
npm run test:docker
npm run lint
npm run build
npm run test:e2e
```

`test:docker` uses a disposable repository, synthetic secrets and ownership-scoped cleanup, never
personal provider credentials. Run it on macOS Docker Desktop and Linux Engine. It does not clear
the signed-in provider matrix: Ask, Plan, Agent editing/testing, images, usage/activity, native
resume across replacement/restart, expired login and missing history need actual provider runs.
Record image/CLI/platform versions and outcomes before marking Story 42 shipped.

Design references: [Docker isolated gateway mode](https://docs.docker.com/engine/network/port-publishing/),
[Codex App Server external sandbox](https://learn.chatgpt.com/docs/app-server), and
[Claude CLI permissions and safe mode](https://code.claude.com/docs/en/cli-reference).
