# Story 121 — Push the current branch from Changes

**Status:** Shipped · **Type:** Full-stack · **Depends on:** nothing

## Motivation

"It would be convenient to have git push capabilities in Changes." The branch summary already
shows ahead/behind counts; it now offers the action beside the branch.

## Delivered behavior

Changes offers **Push** for outgoing commits and **Publish** for a committed branch that needs an
upstream on the selected remote. One click sends the current branch to the same branch name on
that remote, shows progress, then reports success or the refusal in a toast. Status refreshes on
success and failure, leaving a failed action available for retry.

The destination honors `branch.<name>.pushRemote`, then `remote.pushDefault`, then the upstream's
remote, then `origin` or the only remote. It refuses ambiguous choices and multiple upstream refs.
A feature branch cut from `origin/main` publishes to `origin/feature`, preserving `main`; a
triangular workflow pushing to a different remote preserves its existing fetch upstream. Explicit
refspecs prevent fetch mappings or `push.default` from changing the destination on the button.
Ahead/behind still describes the fetch upstream; an offer for a different push remote checks that
remote's local tracking ref. No fetch is performed.

There is no button for an up-to-date destination, a detached or unborn branch, a missing or
ambiguous remote, or an attached executor. The immersive repository panel remains read-only.

## Implementation

- `src/server/repository/gitRepository.ts` retains upstream and unborn status in `GitWorkingTree`.
- `src/server/repository/gitPush.ts` derives the advisory offer, rechecks it under checkout leases,
  gates local configuration and metadata, and runs the fixed host push.
- `GET /api/repository/status` adds `pushTarget` and `publishes` to the tree when appropriate.
- `POST /api/repository/push` accepts exactly `{ checkoutId, target }`, resolves the checkout on the
  server, and returns `{ target }` or `{ error }`. The target is compared, never used as a Git argument.
- `useRepositoryChanges`, `RepositoryPanel`, `RepositoryChangesView`, and `AppShell` own the request,
  compact button, progress, refresh, and existing toast feedback.

## Preserved contracts and failure paths

This is the first CodeAI Git command that uses the owner's credentials and network. A worker can
write `.git/config`, so host Git must not execute that configuration unchecked.

- **Configuration gate:** read the branch and local configuration through `runGitRead`, including
  the credential-free Docker helper once provisioned. Read without includes and allowlist keys;
  unknown keys, including local credential helpers, transport commands, includes, and extensions,
  refuse with the key named. Values and URL user info stay out of the refusal.
- **Metadata containment:** ordinary repositories require a contained `.git` directory without
  symbolic links, external common directories, worktree configuration, or object alternates.
  Managed worktrees keep their journal-verified linkage. Reuse the existing bounded metadata walk
  (100,000 entries / 15 seconds); exceeding it refuses the push.
- **Exclusive writer admission:** acquire exclusive access, then synchronously retain a read lease
  that permits status reads and excludes writing turns, Undo, another push, creation, and restart.
  A managed source and every journal-linked sibling are held too: Local siblings can change shared
  configuration. Hold the source before reading the sibling journal, then hold siblings before
  checking configuration. Existing turns or Git operations refuse immediately; new writers wait
  until Git exits. Every success or refusal releases the acquired scopes.
- **Transport and hooks:** allow HTTPS and SSH only. Disable hooks, tag following, and submodule
  recursion, and send one explicit, non-forced `HEAD:refs/heads/<current branch>` refspec. Refuse an
  executable pre-push hook, including global/custom hook paths, rather than silently bypassing
  checks or Git LFS uploads. Non-fast-forward rejection says to pull first.
- **Owner environment:** global/system Git configuration, SSH agent access, and proxy settings
  apply. Filter PATH to exclude checkout/installation/worktree/temp executables and node_modules,
  resolving directory symlinks first; preserve ordinary user tool directories. Other server secrets
  are not passed to Git or its helpers. Run Git in its own session with no terminal prompt; stop its
  process group on the two-minute command limit. Complete on Git exit after a short pipe drain so
  an SSH ControlPersist master cannot hold the response open. Bound retained stdout/stderr to
  64 Ki characters; refuse inspection output overflow and retain the last 480 characters of a
  redacted remote rejection for feedback.
- **Safe advisory reads:** system/global push preferences are read with `--git-dir=/dev/null` so
  status never asks host Git to parse checkout configuration while a writer may run. The click
  validates the effective destination again. Global conditional includes based on Git directory or
  branch cannot match this advisory read; push preferences there can cause a safe refresh refusal.
- **Origin and credentials:** require exact origin in every access mode, plus the existing device
  authorization. Paired personal devices may push. Machine transport does not allow this operation,
  and the client hides it for attached executors.
- **Redirected remote:** a worker can still rewrite an allowed remote URL to another HTTPS/SSH host
  and receive the branch it could already read. Credential helpers answer by host. Toasts name the
  remote and branch, without exposing its URL.
- **Recovery:** never force, pull, stage, or commit. Failure refreshes status and keeps retry available.
  As with terminal Git, a lost response after remote acceptance cannot prove the remote was unchanged.

## Acceptance criteria

- [x] Push sends only the current branch to the destination shown on the button.
- [x] Publish creates the matching remote branch and records its upstream; a feature tracking main
  cannot update main. A triangular workflow retains its fetch upstream.
- [x] Honor local/global push defaults and branch push remotes; refuse ambiguous destinations.
- [x] Hide the action when there is nothing to send, no usable branch/remote, or an attached executor.
- [x] Reject non-fast-forward updates without changing the remote and show useful remote refusals.
- [x] Refuse unsafe configuration, transports, hooks, and external Git metadata without executing them.
- [x] Exclude source/sibling writers and recovery until Git exits; release ownership on refusal/timeout.
- [x] Preserve credential/SSH/proxy setup without forwarding server secrets or writable PATH entries.
- [x] Reject stale destinations, wrong origins, unauthorized devices, and machine transport.
- [x] Verify the provisioned-Docker helper gate followed by a successful host push.
- [x] TypeScript, isolated production build, focused unit/browser checks, and both-theme screenshots.

## Verification — November 1, 2026

- 176 focused tests pass across `gitPush`, `gitPushGate`, `gitPushRoute`, `gitRepository`, `gitRead`,
  and `sessionWorktrees`. Real Git uses a synthetic SSH executable from a temporary global
  configuration; no external remote receives repository content. Added regressions were observed
  failing before the implementation, including push-default destination offers.
- `npm run lint`, `git diff --check`, and `CODEAI_DIST_DIR=.next-e2e npm run build` pass.
- A disposable real-daemon probe passes: the provisioned Docker helper reads status/configuration,
  host Git publishes through synthetic SSH, upstream/status update correctly, and unsafe local
  configuration is refused. No signed-in provider or external Git hosting was used.
- Independent review found and rechecked fixes for shared-metadata sibling writers, journal snapshot
  timing, and global config startup reading local configuration; no blocking findings remain.
- All 12 production-browser checks pass across `git-push` and `machines`: progress, successful
  push/publish, action visibility, rejection/retry, real route origin checks, phone layout, and
  attached-executor action hiding at both security levels, plus accurate destination tooltips.
  Desktop light/dark and dark phone
  screenshots were inspected. The browser command explicitly selects `.next-e2e` because this
  managed session inherits its running application's older `CODEAI_DIST_DIR`.

The running application has not been restarted.

## Out of scope

Pull/fetch, commits, staging, force push, tags, running hooks, VR controls, and pushing with another
executor's credentials.

## How to verify

```sh
npx vitest run test/gitPush.test.ts test/gitPushGate.test.ts test/gitPushRoute.test.ts test/gitRepository.test.ts test/gitRead.test.ts test/sessionWorktrees.test.ts
npm run lint
CODEAI_DIST_DIR=.next-e2e npm run build
CODEAI_DIST_DIR=.next-e2e CODEAI_REMOTE_ACCESS=local npx playwright test e2e/git-push.spec.ts e2e/machines.spec.ts
```
