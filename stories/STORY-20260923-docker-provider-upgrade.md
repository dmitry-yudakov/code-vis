# Story 67 — Update a provider's Docker CLI from Arena after checking it

**Status:** In progress · **Type:** Full-stack · **Depends on:** [Story 57](STORY-20260908-local-docker-execution.md), [Story 66](STORY-20260922-select-model-and-effort.md)

**Vision slice:** the local Docker execution slice of [the arena vision](../docs/vision.md#the-cloud-chapter)
that Story 57 opened. It changes which image one installation records. It does not change the
execution contract: mounts, network policy, container security and provider homes stay as they are.

It ships in three parts, one commit each:

- **Part A** — build, check and switch one provider's CLI; the `docker:upgrade` command.
- **Part B** — see new versions, update and roll back from Arena.
- **Part C** — Docker Codex offers the models its own worker lists.

---

## Motivation

Claude and Codex publish new CLI versions every few days, and a new model often needs one. The
Docker worker pins Claude 2.1.226 and Codex 0.152.0; on 2026-09-23 npm offers 2.1.280 and 0.156.1.
An installation that is already provisioned cannot move to either:

- The versions live in code, in two places that must agree. Changing them has no effect on a
  provisioned installation: `npm run docker:provision` builds and verifies the new image, then
  refuses to record it with "This installation is already provisioned". `--replace-engine` refuses
  because the engine has not changed. CodeAI keeps running the old image by its ID.
- The only way through is moving `profile.json` aside by hand, which the setup guide forbids.
- Nothing checks a new CLI against what CodeAI relies on before turns start using it.
- Docker Codex's model picker is filled from the host's Codex, so a Docker Codex that knows a new
  model would not offer it.

The image that runs is already host state: each installation records its own image ID in
`<CODEAI_DATA_DIR>/docker/profile.json`. The owner wants to see a new version from the UI, update to
it on the day a model needs it, have it checked before turns use it, and roll back if it misbehaves.
Offering a release as soon as it is published is acceptable because rollback exists.

---

## Current behavior (where the code is)

- The worker image installs both CLIs at fixed versions:
  [Dockerfile:5](../docker/Dockerfile#L5). Claude's auto-updater is disabled at
  [Dockerfile:11](../docker/Dockerfile#L11).
- The same versions are repeated as `DOCKER_VERSIONS`:
  [dockerProfile.ts:10](../src/server/execution/dockerProfile.ts#L10).
- Provisioning builds the image under the tag `codeai-worker:codeai-docker-v1`, checks each CLI's
  `--version` in a container without network, and records the image:
  [docker.ts:26](../scripts/docker.ts#L26).
- The profile is written only when absent, or when the engine was replaced:
  [dockerRuntime.ts:443](../src/server/execution/dockerRuntime.ts#L443). Its schema is strict
  ([dockerRuntime.ts:16](../src/server/execution/dockerRuntime.ts#L16)), so another checkout sharing
  the data directory would reject a new field.
- `profile()` reads `profile.json` on every call and checks the recorded image ID and profile label:
  [dockerRuntime.ts:47](../src/server/execution/dockerRuntime.ts#L47). Workers and Git-read helpers
  start from that ID, not from the tag.
- Login holds a provider's shared home through a setup worker. The hold waits for admissions, and
  login refuses while a turn uses the home:
  [dockerRuntime.ts:280](../src/server/execution/dockerRuntime.ts#L280),
  [dockerRuntime.ts:341](../src/server/execution/dockerRuntime.ts#L341).
- The host Claude check reads `claude --help` for every flag a mode requires and for `--effort`:
  [claudePreflight.ts:14](../src/server/agents/claudePreflight.ts#L14). It only spawns a host
  binary: [claudePreflight.ts:27](../src/server/agents/claudePreflight.ts#L27).
- The host Codex check runs the App Server handshake (`initialize`, `model/list`, then
  `account/read` and the capability inventories) against a host binary:
  [codexPreflight.ts:16](../src/server/agents/codexPreflight.ts#L16),
  [codexPreflight.ts:112](../src/server/agents/codexPreflight.ts#L112). `codexModelChoices` turns
  a `model/list` answer into choices:
  [codexInvocation.ts:112](../src/server/agents/codexInvocation.ts#L112).
- Docker Claude offers family aliases (`fable`, `opus`, `sonnet`, `haiku`) that the CLI resolves to
  the newest model in each family, so a newer CLI brings a newer model under the same choice:
  [claudeInvocation.ts:44](../src/server/agents/claudeInvocation.ts#L44).
- Docker Codex takes its models and efforts from the host's Codex:
  [providerRegistry.ts:93](../src/server/agents/providerRegistry.ts#L93).
- Arena's Docker section shows Off / Ready / Setup needed, the Enable Docker switch and the setup
  help: [Arena.tsx:189](../src/features/arena/Arena.tsx#L189). Its settings route authorizes the
  device and requires the exact origin:
  [execution/docker/route.ts:13](../src/app/api/execution/docker/route.ts#L13).
- The real-daemon probe inspects whatever image carries the tag and asserts the exact pins:
  [test-docker.ts:27](../scripts/test-docker.ts#L27), [test-docker.ts:73](../scripts/test-docker.ts#L73).

Probed 2026-09-23 on the current worker image: Codex 0.152.0's App Server, with no network and
nobody signed in, answers `initialize` and `model/list` with its built-in model list.

---

## Desired behavior

### Part A — Build, check and switch one provider's CLI

`DOCKER_VERSIONS` means two things: the versions a fresh provision installs, and the minimum this
CodeAI supports. There is no other version list in code. The Dockerfile takes both versions as build
arguments with no defaults, so a build without them fails instead of installing whatever npm calls
latest.

**The versions record.** `<CODEAI_DATA_DIR>/docker/versions.json` describes the recorded image:

```ts
{
  image: string;                                          // the image ID it describes
  claude: string; codex: string;                          // CLI versions in that image
  previous: { claude?: string; codex?: string };          // the version each update replaced
  codexModels?: ModelChoices;                             // that image's Codex model/list
}
```

It is separate from `profile.json`, so a checkout that predates this story keeps reading the profile.
When its `image` differs from the profile's, it is stale: versions are read again by running each
CLI's `--version` in the recorded image, `previous` is empty, and `codexModels` is absent. Provisioning
writes it too.

**One update** takes a provider and an exact target version:

1. **Validate** before building anything. The installation must be provisioned on the current
   engine. The version must be an exact `MAJOR.MINOR.PATCH` (no ranges, tags or pre-releases), at
   least the pin, and different from the recorded one. A lower version is allowed, down to the pin;
   it prints that the newer CLI may already have migrated the provider's shared home.
2. **Build a candidate** from the same `docker/` context, with the target for this provider and the
   recorded version for the other. The candidate carries only a `codeai-worker:candidate-<uuid>`
   tag of its own and is not recorded, so nothing live changes.
3. **Check the candidate.** Each check runs in a new container from the candidate with CodeAI's
   container security, no network, and a throwaway home that disappears with the container:
   - `claude --version` and `codex --version` report the expected versions;
   - `claude --help` documents every flag CodeAI's modes require and `--effort`, by the same rule
     the host check uses;
   - Codex App Server completes CodeAI's handshake, reports that nobody is signed in, and answers
     `model/list`. The answer is kept for the versions record.

   Nothing is signed in, no model is called, and no provider home, checkout or CodeAI data is
   mounted.
4. **On failure**, report which check failed, remove the candidate's tag (and with it the image,
   unless something else still references it), and leave `profile.json` and `versions.json`
   unchanged.
5. **On success, switch.** Take the updated provider's setup hold, the same one login takes. Refuse
   when a turn or login is using that provider's home, and refuse when `profile.json` no longer names
   the image the candidate was built from. Otherwise replace the image ID in `profile.json`
   atomically, write `versions.json` with the replaced version as `previous`, tag the candidate
   `codeai-worker:<installation id>` in place of its candidate tag, and release the hold. The next
   turn, login and Git read use the new image without a CodeAI restart. Turns already running finish
   in their own containers. The previous image stays in Docker without the installation tag. Once
   `profile.json` names the candidate, the outcome is `switched`, whatever fails after it.

Rolling back is the same update with `previous` as the target. Docker usually still has its build
layers cached, so it is quick.

**The command** is a thin owner-terminal wrapper, useful before Part B and where no browser is at
hand:

```sh
npm run docker:upgrade                      # print recorded versions, previous versions and minimums
npm run docker:upgrade -- claude 2.1.280    # update one provider to an exact version
```

### Part B — Update and roll back from Arena

When Docker is enabled and ready, Arena's Docker section shows one row per provider:

```
Claude   2.1.226   2.1.280 available          [Update]
Codex    0.156.1   up to date                  [Roll back to 0.152.0]
                                               [Check for updates]
```

- **New versions.** The server reads each package's `latest` tag from the npm registry when Arena
  asks, and keeps the answer for one hour. **Check for updates** asks again. A lookup failure shows
  "Couldn't check for updates" and changes nothing else. Only a `latest` above the recorded version
  (and so at least the pin) is offered; going lower is a rollback. There is no background timer.
- **Update / Roll back** start one operation on this machine. The browser names only the provider
  and `latest` or `previous`; the server resolves the version from the lookup Arena showed (never a
  new one) or the versions record, so the browser never sends a version string. Another request
  while one runs answers `409`.
- **Progress.** The operation runs in the server, not the browser, and reports `building`,
  `checking`, `switching`, then `switched`, `failed` with the failed check, or `in use` ("Claude is
  in use by a turn. Try again when it finishes."). Arena polls it while it runs and finds it again
  after a reload. A CodeAI restart during an operation abandons it; the records are unchanged
  because only a successful switch writes them.
- **Authorization** matches the Docker settings route: an authorized device, and in paired mode the
  exact origin for the mutation.
- The operation is for the machine serving Arena. Other executor machines keep their own Docker.

### Part C — Docker Codex offers its own worker's models

When `versions.json` describes the recorded image and holds `codexModels`, Docker Codex offers those
models and efforts. Otherwise it offers the host's list, as today. Docker Claude is unchanged: its
aliases already follow the CLI.

### What the checks do not cover

The checks catch a failed install, a removed or renamed flag, a broken App Server handshake, and a
Codex that cannot list models. They cannot catch a change in a turn's event stream, a new network
host the CLI needs, or a changed login flow, because those need a signed-in turn. Those surface on
the first real turn, and rollback is one click. The setup guide says so.

### Concrete changes

1. [docker/Dockerfile](../docker/Dockerfile): `ARG CLAUDE_VERSION` and `ARG CODEX_VERSION`, with no
   defaults; the install step fails when either is empty.
2. [dockerProfile.ts](../src/server/execution/dockerProfile.ts): document `DOCKER_VERSIONS` as the
   fresh-provision versions and the minimum; add strict version parsing and comparison.
3. A new `src/server/execution/dockerUpgrade.ts`: the versions record, reading an image's versions,
   the candidate build and checks, and the switch. `saveDockerProvision` gains a same-engine image
   replacement that only the switch uses.
4. [claudePreflight.ts](../src/server/agents/claudePreflight.ts): export the help-text rule so a
   candidate check can apply it to container output.
   [codexPreflight.ts](../src/server/agents/codexPreflight.ts): let the handshake run over a given
   process (the container), return its `model/list`, and tell "handshake passed, not signed in"
   apart from a protocol failure.
5. [scripts/docker.ts](../scripts/docker.ts) and [package.json](../package.json): `docker:upgrade`;
   provisioning passes the build arguments and writes `versions.json`.
6. [scripts/test-docker.ts](../scripts/test-docker.ts): probe the recorded image, and accept any
   version at or above the pins.
7. Part B: an npm `latest` lookup with a one-hour cache, a process-wide single operation, a
   `GET`/`POST /api/execution/docker/versions` route with wire schemas in `src/shared`, and the rows
   in [Arena.tsx](../src/features/arena/Arena.tsx).
8. Part C: [providerRegistry.ts](../src/server/agents/providerRegistry.ts) reads `codexModels` for
   Docker Codex.
9. [docs/docker-execution.md](../docs/docker-execution.md): the listed versions become minimums; a new
   "Updating a provider CLI" section covers Arena, the command, the checks and their limits, and
   rollback. [AGENTS.md](../AGENTS.md) lists the command.

---

## Acceptance criteria

### Part A

- [x] On a fresh data directory, `npm run docker:provision` installs the versions in
      `DOCKER_VERSIONS` and writes a matching `versions.json`; building the Dockerfile without
      version arguments fails.
- [x] An update rejects a malformed version, a pre-release, a version below the pin, the recorded
      version, an unknown provider, an unprovisioned installation, and a changed engine, before
      building anything.
- [x] Updating one provider keeps the other provider's recorded version, including on an image
      provisioned before this story (stale or missing `versions.json`).
- [x] A candidate that fails any check (wrong version, a missing required Claude flag, missing
      `--effort`, a broken Codex handshake, no `model/list` answer) leaves `profile.json` and
      `versions.json` byte-for-byte unchanged and is removed, and the result names the failed check.
- [x] The checks run with no network and without a provider home, checkout or CodeAI data mounted.
      They never sign in or call a model.
- [x] A passing candidate is recorded with the same engine ID and `previous` set to the replaced
      version. Without a CodeAI restart, the next Docker turn and Git read use it.
- [x] The switch refuses, and writes nothing, while a turn or login uses the updated provider's
      home, and when `profile.json` changed after the candidate's build began.
- [x] Updating to `previous` rolls back, prints the migrated-home warning, and sets `previous` to
      the version it replaced.
- [x] `npm run docker:upgrade` without arguments prints recorded versions, previous versions and
      minimums; with a provider and version it performs one update.
- [x] `npm run test:docker` passes against an updated installation.

### Part B

- [ ] Arena shows each provider's recorded version, an available `latest` above it, and a rollback
      target when `previous` exists and is not below the pin.
- [ ] The lookup is cached for one hour, **Check for updates** refreshes it, and a lookup failure
      shows the message without affecting the rest of the section.
- [ ] The route accepts only `{ provider, target: 'latest' | 'previous' }`; a version string, an
      unknown target, or a target with nothing to resolve is `400`, and a second operation is
      `409`.
- [ ] Progress survives a browser reload, and the switched, failed-check and in-use outcomes each
      show their message.
- [ ] Unpaired and wrong-origin requests are refused as on the Docker settings route.

### Part C

- [ ] Docker Codex offers `codexModels` when `versions.json` describes the recorded image, and the
      host's list otherwise.

### All parts

- [ ] The setup guide and AGENTS.md describe updating from Arena and the command, the minimum-version
      rule, what the checks do not cover, and rollback.
- [ ] `npm run lint`, `npm test` and `npm run test:e2e` pass. Unit tests with fake Docker and npm
      output cover validation, each check outcome, the refusals, and that no failure writes a record.

## Out of scope

- A signed-in check before switching, such as a real Ask turn in a throwaway home. A later story can
  add it if the offline checks prove too weak. Copying the live provider home into the check is ruled
  out: CodeAI never copies provider credentials.
- Updating without a click, or checking for versions on a timer.
- Entering an arbitrary version in Arena. The command accepts one from the owner's terminal.
- Updating another executor machine's Docker from Arena.
- Local execution. Host CLIs are the owner's own installation.
- Refusing turns when a newer CodeAI raises a pin above the recorded version. The installation keeps
  running its recorded image, as today, and an update is how it catches up.
- Holding legacy per-participant homes during a switch. They meet the new CLI on their next turn.
- The Node base image and the other packages in the worker.

## How to verify

1. `npm run lint && npm test && npm run test:e2e`.
2. On a provisioned installation with Docker running, `npm run docker:upgrade` prints Claude 2.1.226
   and Codex 0.152.0, with no previous versions.
3. In Arena, **Check for updates** shows the current `latest` for both providers. **Update** Claude.
   Progress reaches `switched`; `profile.json` records a new image with the same engine ID, and
   `versions.json` records `previous.claude`.
4. Without restarting CodeAI, run a Docker Claude Ask turn and an Agent turn, then a Codex turn.
   Codex still reports 0.152.0.
5. **Update** Codex. Its model picker in a Docker session now shows the worker's list, and a turn on
   a model that only the newer Codex knows succeeds.
6. Make a check fail, for example by temporarily adding a nonexistent flag to
   `requiredFlagsForMode`, and update again. It shows the failed check, and the SHA-256 of both
   records is unchanged. Restore the file.
7. Start a Docker Claude turn and press **Roll back** for Claude while it runs. It shows the in-use
   message and writes nothing. After the turn, roll back; a Claude turn works afterwards.
8. `npm run test:docker`.
9. Record the image IDs, CLI versions and outcomes in [the experiment log](../docs/experiment-log.md).

