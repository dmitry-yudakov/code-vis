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
Code and Codex at the versions in `DOCKER_VERSIONS` (Claude 2.1.226 and Codex 0.152.0 in this
CodeAI), Git, npm, Python 3, make and a C/C++ compiler. Those versions are also the **minimum** an
[update](#updating-a-provider-cli) can choose. The Dockerfile has no default versions, so a build
that does not name both fails. Provisioning runs the same offline checks as an update, then records
the resulting immutable image ID and local engine identity in `<CODEAI_DATA_DIR>/docker/profile.json`,
and the image's CLI versions and Codex model list in `versions.json` beside it. A changed
engine fails closed: CodeAI cannot assume a worker on the previous engine stopped. No session Dockerfile, Compose file,
devcontainer configuration, dependency script or host provider configuration is used. Provisioning
is explicit and cannot occur as a side effect of a turn. An existing profile is not overwritten,
except by the explicit [engine replacement](#replacing-the-docker-engine) and
[CLI updates](#updating-a-provider-cli) below.

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
conversations in a new session. The adopted engine gets the `DOCKER_VERSIONS` CLIs; if you had
updated either one, [update it again](#updating-a-provider-cli).

## Updating a provider CLI

Claude Code and Codex publish new versions every few days, and a new model often needs one. Each
installation records which image it runs, so it can move one provider's CLI to another version
without a new CodeAI.

**In Arena**, once Docker is enabled and ready, the Docker section shows each provider's recorded
version. When Arena opens it asks npm for each package's `latest`, keeps the answer for an hour,
and **Check for updates** asks again; nothing checks on a timer. A release newer than the recorded
one shows as **Update**, and the version the last update replaced as **Roll back to**, or
**Return to** after a rollback. A release below the minimum is never offered. The browser names
only the provider and which of the two it wants; the server resolves the version from its current
answer, never a new lookup, so once that answer is an hour old, check for updates again first. The
update runs in CodeAI, not the browser: the section shows building, checking and switching, then
the outcome, also after a reload. One update runs at a time on a machine. Restarting CodeAI during
an update abandons it and changes nothing, since only a successful switch writes the records.
Arena updates the machine serving it; other executor machines keep their own Docker.

**From the owner terminal**, for any exact version:

```sh
npm run docker:upgrade                      # recorded versions, previous versions and minimums
npm run docker:upgrade -- claude 2.1.280    # update one provider to an exact version
```

An update takes an exact `MAJOR.MINOR.PATCH` (no ranges, tags or pre-releases), at least the
minimum and different from the recorded version. It is refused, before anything is built, on an
unprovisioned installation or a changed engine. It then:

1. **Builds a candidate** from the same `docker/` context with that version for one provider and
   the recorded version for the other, under a `codeai-worker:candidate-…` tag of its own. It is
   not recorded, so nothing that runs changes.
2. **Checks it offline.** Each check runs in a new container from the candidate with CodeAI's
   container security, no network, no mounts and a throwaway home: `claude --version` and
   `codex --version` report the expected versions; `claude --help` documents every flag CodeAI's
   modes require and `--effort`, by the rule the host check uses; and Codex App Server completes
   CodeAI's handshake, reports that nobody is signed in, and answers `model/list`. Nothing signs
   in, no model is called, and no provider home, checkout or CodeAI data is reachable. A failed
   check is named, and `profile.json` and `versions.json` stay unchanged. The candidate's tag is
   removed, and the image with it unless something else still references it: the build cache can
   reproduce an image another update or installation recorded.
3. **Switches** under the same hold on the provider's shared home that login takes. It refuses
   while a turn or login uses that home ("Claude is in use by a turn. Try again when it
   finishes."), and when `profile.json` names a different image than the one the candidate was
   built from. Otherwise it replaces the image ID in `profile.json` on the same engine, records
   the versions with the replaced one as `previous`, and tags the image `codeai-worker:<id>` with
   this installation's own ID. The next turn, login and Git read use the new image without
   restarting CodeAI; turns already running finish in their own containers, and the previous image
   stays in Docker without that tag. A turn of that provider starting during the switch's moment
   is refused ("Docker provider setup is active"); send it again.

**Rolling back** is the same update with the previous version, printed by `npm run docker:upgrade`
and after every switch. Docker usually still has its build layers cached, so it is quick. Going
to a lower version prints a warning, and in Arena asks first: the newer CLI may already have
migrated the provider's shared home, so watch the first turn afterwards.

**What the checks do not cover.** They catch a failed install, a removed or renamed flag, a broken
App Server handshake and a Codex that cannot list models. They cannot catch a change in a turn's
event stream, a new network host the CLI needs, or a changed login flow, because those need a
signed-in turn. Those surface on the first real turn; roll back if it misbehaves.

`versions.json` also holds the worker's own Codex `model/list`, so Docker Codex's model menu offers
what that Codex knows rather than the host's list; without it, as for an installation provisioned
before this record existed, the host's list is offered as before. Docker Claude's `fable`, `opus`,
`sonnet` and `haiku` already resolve to the newest model the worker's CLI knows. A browser already
open when a terminal update switches keeps its model menu until it reads readiness again, for
example on **Refresh**. A Docker session on an attached executor lists that executor's Local Codex
choices, while the executor checks a turn against its worker's own list.

Provisioning and every switch tag the recorded image with its installation's own tag, so
`docker image prune` keeps it even when another installation's provisioning moves
`codeai-worker:codeai-docker-v1`. An installation provisioned before this tag existed relies on the
shared tag until its first update: until then, avoid `docker image prune` after provisioning
another installation on the same engine, or tag its recorded image (the `image` in `profile.json`)
yourself. Legacy per-participant homes are not held during a switch; they meet the new CLI on their
next turn. A CodeAI restart during a build can leave a `codeai-worker:candidate-…` tag behind; list
such tags with `docker image ls 'codeai-worker:candidate-*'` and remove them with `docker image rm`
when no update is running. A newer CodeAI may raise `DOCKER_VERSIONS` above what an installation
records: it keeps running its recorded image, and an update is how it catches up.

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
npm run docker:provision   # once per installation; later runs refuse before building
npm run test:docker
npm run lint
npm run build
npm run test:e2e
```

`test:docker` probes the image this installation records, including one an update installed, and
accepts CLI versions at or above the minimums. Before provisioning it probes the image tagged
`codeai-worker:codeai-docker-v1`; a manual build must name both versions, for example
`docker build --load --build-arg CLAUDE_VERSION=2.1.226 --build-arg CODEX_VERSION=0.152.0 --tag codeai-worker:codeai-docker-v1 docker`.
It uses a disposable repository, synthetic secrets and ownership-scoped cleanup, never
personal provider credentials. Run it on macOS Docker Desktop and Linux Engine. It does not clear
the signed-in provider matrix: Ask, Plan, Agent editing/testing, images, usage/activity, native
resume across replacement/restart, expired login and missing history need actual provider runs.
Record image/CLI/platform versions and outcomes before marking Story 57 shipped.

Design references: [Docker isolated gateway mode](https://docs.docker.com/engine/network/port-publishing/),
[Codex App Server external sandbox](https://learn.chatgpt.com/docs/app-server), and
[Claude CLI permissions and safe mode](https://code.claude.com/docs/en/cli-reference).
