# Story 68 — Honor the personal Git ignore file in CodeAI's Git views

**Status:** In progress · **Type:** Server-only · **Depends on:** [Story 57](STORY-20260908-local-docker-execution.md)

---

## Motivation

CodeAI's changed-files view listed `.claude/settings.local.json` in its own checkout while `git
status` and VS Code showed only `next-env.d.ts`. The file is ignored only by the user's personal
ignore file, `~/.config/git/ignore`, which Claude Code wrote when it first created a
`settings.local.json`. CodeAI's hardened Git reads switch that file off, so every personally
ignored file comes back as noise. In the user's words: *"I don't want extra noise in the project."*

The hardening exists to keep a checkout, including an Agent-replaced `.git`, from making CodeAI's
Git reads execute anything or read outside the checkout. The personal ignore file is a list of
patterns chosen by the host user, not by the checkout, so it can be read without weakening that.

---

## Current behavior (where the code is)

- Every Git read runs with `-c core.excludesFile=/dev/null`, `GIT_CONFIG_GLOBAL=/dev/null` and
  `GIT_CONFIG_NOSYSTEM=1`: [gitRead.ts:13](../src/server/repository/gitRead.ts#L13) (~line 13).
- Before Docker is provisioned, host Git reads the checkout directly:
  [gitRead.ts:50](../src/server/repository/gitRead.ts#L50) (~line 50).
- After provisioning, every read runs in a network-disabled, read-only helper container whose only
  host file is the checkout bind: [gitRead.ts:71](../src/server/repository/gitRead.ts#L71) (~line 71).
- The status view, diffs and a turn's repository context all use these reads:
  [gitRepository.ts:81](../src/server/repository/gitRepository.ts#L81),
  [repositoryContext.ts:12](../src/server/repository/repositoryContext.ts#L12).

---

## Desired behavior

CodeAI's Git reads honor Git's default personal ignore file, located as Git locates it:
`$XDG_CONFIG_HOME/git/ignore` when `XDG_CONFIG_HOME` is set, otherwise `~/.config/git/ignore`. A
relative `XDG_CONFIG_HOME` is ignored, as the XDG specification says.

### Concrete changes

1. Read that file on the host. Only a regular UTF-8 file of at most 64 KiB without NUL bytes
   counts. Size is checked before and after reading, in bytes.
   Anything else, including a missing or unreadable file, reads as no file. The host then passes
   `core.excludesFile=/dev/null`, and the helper gets an empty pattern list.
2. Host reads pass `-c core.excludesFile=<that path>`.
3. Isolated reads pass the file's patterns, never its path. The Docker CLI copies them from its own
   environment (`--env CODEAI_PERSONAL_IGNORE`), so they stay out of command lines. A fixed `sh`
   step writes them to the helper's `/tmp` and then runs Git with the unchanged arguments. The
   helper still binds nothing but the checkout.
4. The helper sets `--entrypoint /bin/sh`. The worker image inherits Node's `docker-entrypoint.sh`,
   which runs `node "$1"` when `$1` names a non-executable file in the working directory, and that
   directory is the checkout. Before this story, a planted `git` file at the checkout root replaced
   CodeAI's Git output. With the `sh` step it would have been a planted `sh`, which could also
   print the patterns.
5. A custom `core.excludesFile` in the user's global Git configuration is not followed. CodeAI
   still reads no global or system Git configuration.
6. [docker-execution.md](../docs/docker-execution.md) states the rule, and one remaining risk: a
   personal ignore file symlinked into a checkout that Docker Agent edits.

The first version bind-mounted the file into the helper. Review found three problems with that. A
`"` in the path broke every isolated Git read. A daemon that cannot see the path, such as snap
Docker with hidden home folders or a `/nix/store` target on macOS, would do the same. And the file
became the helper's second host mount. Passing the patterns removes all three. A second review
found the entrypoint problem (change 4), which the committed code already had, and that decoding
non-UTF-8 bytes could push the value past Linux's 128 KiB limit for one environment string.

---

## Acceptance criteria

- [x] Before provisioning, status omits a file matched only by `~/.config/git/ignore`, and still
      lists other untracked files.
- [x] `XDG_CONFIG_HOME` takes precedence over `~/.config` for the personal ignore file, unless it
      is relative.
- [x] An oversized file, one with a NUL byte, one that is not UTF-8, and a FIFO all read as no
      personal ignore file.
- [x] After provisioning, the helper receives the patterns through the Docker CLI's environment, not
      its command line. Git reads them through `core.excludesFile`, and the checkout is still the
      helper's only bind.
- [x] A real helper container, which has a read-only root filesystem, honors the patterns.
- [x] A non-executable `sh` or `git` file at the checkout root cannot replace the helper's output.
- [x] The Docker execution contract describes the rule and its remaining symlink risk.
- [x] Tests no longer depend on the developer's own personal ignore file.
- [x] `npm run lint`, `npm test`, and `npm run test:e2e` pass.

## Out of scope

- Following a custom `core.excludesFile` from `~/.gitconfig`. That would mean reading global Git
  configuration, which the Git-read hardening rules out.
- Changing what the repository's own `.gitignore` or `.git/info/exclude` do. Both were already
  honored.
- Refusing a personal ignore file whose symlink chain passes through a checkout. The documented
  risk needs such linked configuration, and a Docker Agent editing it already controls the rest of
  that configuration. The risk is limited to inferring lines only because of change 4.
- The same entrypoint exposure in the checkout preparer:
  [dockerRuntime.ts:377](../src/server/execution/dockerRuntime.ts#L377) runs `node …` with the
  checkout as its working directory. A planted non-executable `node` file would run instead of the
  preparer's Git-metadata check. That needs its own fix, either `--entrypoint` there or
  `ENTRYPOINT []` in `docker/Dockerfile` for new images. The lease container mounts no checkout, and
  a worker already runs the agent's own commands.

## How to verify

1. `npm test -- test/gitRead.test.ts`.
2. With the user's own installation (Docker provisioned), open CodeAI's own project and check that
   the changed-files view no longer lists `.claude/settings.local.json`.

---

## What shipped

- **Reading the file.** `personalIgnore()` locates the file as Git does, then applies the
  regular-file, byte-size, NUL and strict UTF-8 rules once for both modes
  ([gitRead.ts:38](../src/server/repository/gitRead.ts#L38)).
  `core.excludesFile=/dev/null` left the fixed option list and is now passed per read.
- **Host.** Git gets the file's path
  ([gitRead.ts:75](../src/server/repository/gitRead.ts#L75)).
- **Helper.** `--env CODEAI_PERSONAL_IGNORE` with the value in the Docker CLI's environment,
  `--entrypoint /bin/sh`, then
  `-c 'printf %s "$CODEAI_PERSONAL_IGNORE" > /tmp/personal-git-ignore && exec git "$@"'`
  ([gitRead.ts:102](../src/server/repository/gitRead.ts#L102)). `dockerCommand` accepts extra
  environment variables, which cannot override its own
  ([dockerCommand.ts:22](../src/server/execution/dockerCommand.ts#L22)).
- **Tests.**
  - The Git-read tests ([gitRead.test.ts:89](../test/gitRead.test.ts#L89)) each use a temporary
    `HOME`.
  - [gitRepository.test.ts](../test/gitRepository.test.ts#L17) points `XDG_CONFIG_HOME` at an empty
    directory.
  - The real-Docker probe plants `sh` and `git` in its checkout
    ([test-docker.ts:167](../scripts/test-docker.ts#L167)).
- **Docs.** [docker-execution.md](../docs/docker-execution.md#L232).

## Verification record

September 24, 2026, on this machine (Docker Engine 28.5.2):

- **Mutation checks.** Each rule was broken in turn, and the matching test failed:
  - the host passing `/dev/null`;
  - no `XDG_CONFIG_HOME` precedence;
  - a relative `XDG_CONFIG_HOME` honored;
  - no size bound;
  - no NUL check;
  - lenient UTF-8 decoding;
  - no regular-file check (the FIFO test times out);
  - the helper getting empty patterns;
  - the variable not forwarded into the container;
  - the patterns placed in the command line;
  - the helper's Git using `/dev/null`;
  - no entrypoint override.

  Removing only the pre-read size check survives on purpose: the post-read check still rejects
  the file, and the pre-check only keeps a huge file out of memory.
- **Real helper.** In the user's recorded worker image, with a read-only root filesystem, a
  multi-line pattern value carrying quotes and a literal `$HOME` reached Git unchanged. A failed
  write in `/tmp` fails the read instead of being hidden.
- **Planted files, through the real helper** (scratch data directory holding a copy of the user's
  Docker profile):
  - with the committed code, a planted `git` file printed `?? FORGED-by-planted-git`;
  - with the first version of this change, a planted `sh` file printed a forged line plus the
    patterns;
  - with `--entrypoint /bin/sh`, the status is the real one: `git`, `real.txt`, `sh`.
  - The new `test-docker.ts` step makes the same check. The full `npm run test:docker` probe was not
    run.
- **This checkout, through the real helper:**
  - before the change, `readWorkingTree` listed `.claude/settings.local.json`;
  - after it, the file is gone;
  - with an empty `XDG_CONFIG_HOME`, it is listed again;
  - host Git gives the same result.
  - No helper container was left behind.
- **Suites, on the final code:** `npm run lint` passes, `npm test` passes 87 files / 691 tests, and
  `npm run test:e2e` passes 87 of 87.
- **Pending:** How to verify step 2 in the running app, for the user.
