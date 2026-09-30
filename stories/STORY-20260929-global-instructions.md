# Story 80 — Let agents use your global instructions, show them, and isolate a session

**Status:** In progress · **Type:** Full-stack · **Depends on:**
[Story 20](STORY-20260817-web2-codex-provider.md) (Codex App Server),
[Story 57](STORY-20260908-local-docker-execution.md) (Docker execution),
[Story 65](STORY-20260921-tolerate-newer-session-format.md) (a newer session hides only itself),
[Story 68](STORY-20260924-personal-git-ignore.md) (bounded reads of a personal file). It changes two
of AGENTS.md's safety boundaries, and it takes session format 7:
[Story 79](STORY-20260928-sandboxed-auto-mode.md) shipped first and took 6.

Implemented on September 30, 2026. One acceptance criterion is open: a signed-in Docker Codex turn
(see *Verification record*). Decision 8 shipped as drafted and still wants the user's word.

---

## Motivation

The user, on September 29, 2026, while reviewing Story 79:

> is it guaranteed that claude/codex read their global AGENTS.md/CLAUDE.md? If I have set up the
> agents on my machine, I could rely on them to go on Auto. But if they're clear installations, it
> might be dangerous

and then:

> I think we should allow the user to define this behavior - to have access to global
> .claude/.codex (maybe in read-only in docker), allow the user to see the contents of their global
> AGENTS/CLAUDE and also to allow to isolate better.

Today it depends on the provider and on where the turn runs, and nothing in CodeAI shows which case
applies:

- **Local Claude never gets them.** Every run passes `--safe-mode`, which turns off CLAUDE.md along
  with hooks, skills, plugins, and MCP. The user's `~/.claude/CLAUDE.md` is ignored.
- **Local Codex always gets them.** Codex loads `~/.codex/AGENTS.md` whatever CodeAI sends. CodeAI
  only mentions this in a path-free readiness note.
- **Docker gets neither.** Workers use the shared provider home, which does not hold the user's
  files.

On this machine `~/.claude/CLAUDE.md` is a symlink to `~/.codex/AGENTS.md`, so both providers are
meant to follow one file. Today only local Codex does.

This story makes that a choice the user sees and controls: a default per provider on each machine,
an override when a session is created, the file's contents on screen, and read-only access to the
user's customizations in Docker.

---

## Current behavior (where the code is)

*As it was before this story. The line numbers are those of commit `2a0efe9`; "What shipped" has
today's.*

### Providers

- **Claude arguments:** [claudeInvocation.ts:15](../src/server/agents/claudeInvocation.ts#L15)
  passes `--safe-mode` in every mode. Probed flags are `BASE_CLAUDE_FLAGS`
  ([:70-73](../src/server/agents/claudeInvocation.ts#L70-L73)). The runner builds the arguments at
  [claudeProcessRunner.ts:130](../src/server/agents/claudeProcessRunner.ts#L130) and inherits the
  user's environment unchanged ([:142-143](../src/server/agents/claudeProcessRunner.ts#L142-L143)).
- **Codex instructions:** [codexProcessRunner.ts:508](../src/server/agents/codexProcessRunner.ts#L508)
  sends `CODEX_DEVELOPER_INSTRUCTIONS`
  ([codexInvocation.ts:85](../src/server/agents/codexInvocation.ts#L85)) at thread start and resume.
  Preflight starts an ephemeral thread
  ([codexPreflight.ts:205-219](../src/server/agents/codexPreflight.ts#L205-L219)) and turns
  `instructionSources` outside the checkout into a readiness note
  ([codexInvocation.ts:158-169](../src/server/agents/codexInvocation.ts#L158-L169)).
- **Run input:** `AgentProcessRun` ([types.ts:618](../src/shared/types.ts#L618)) carries the prompt,
  policy, model, and effort. [conversationService.ts:104](../src/server/conversation/conversationService.ts#L104)
  starts the run.

### Docker

- **Worker:** [dockerRuntime.ts:413-431](../src/server/execution/dockerRuntime.ts#L413-L431) sets
  `HOME` to the shared provider volume at `DOCKER_HOME`
  ([dockerProfile.ts:24](../src/server/execution/dockerProfile.ts#L24)). The only binds are the
  checkout and the read-only per-run context (line 428).
- **Contract:** [docker-execution.md](../docs/docker-execution.md) and AGENTS.md: "Never mount the
  running CodeAI installation or provider host storage."

### Settings, files, sessions

- **Machine setting pattern:** Docker's on/off record is
  [dockerSettings.ts:5-17](../src/server/execution/dockerSettings.ts#L5-L17)
  (`<dataDir>/docker/settings.json`, read on each resolution, and a damaged record fails closed). It
  is written by `PATCH` [execution/docker/route.ts:14](../src/app/api/execution/docker/route.ts#L14)
  and shown in the Arena's Docker execution section
  ([Arena.tsx:203](../src/features/arena/Arena.tsx#L203)).
- **Bounded personal file:** `personalIgnore`
  ([gitRead.ts:38-49](../src/server/repository/gitRead.ts#L38-L49)) reads a regular UTF-8 file of
  at most 64 KiB without NUL bytes, and treats anything else as no file.
- **Session creation:** `createSessionRequestSchema`
  ([protocol.ts:81-91](../src/shared/protocol.ts#L81-L91)). The flat shell posts it at
  [AppShell.tsx:627-631](../src/features/shell/AppShell.tsx#L627-L631) for the conversation and the
  Arena ([Arena.tsx:90](../src/features/arena/Arena.tsx#L90)). VR uses `launchChoice`
  ([SessionTools.tsx:75](../src/features/shell/immersive/SessionTools.tsx#L75)). The executor
  gateway already forwards `POST sessions`
  ([machineRoutePolicy.ts:12](../src/server/machines/machineRoutePolicy.ts#L12)).
- **Session format:** the newest readable format is 6 (5 when this was drafted)
  ([sessionSchema.ts:214](../src/shared/sessionSchema.ts#L214)). Schemas are `.strict()`, so an
  older build rejects any new field. Public snapshot: `publicSessionSchema`
  ([:351](../src/shared/sessionSchema.ts#L351)).
- **Composer:** `ExecutionLine`
  ([InstructionComposer.tsx:197](../src/features/conversation/InstructionComposer.tsx#L197)) shows
  where and how the next turn runs.

### What the providers do (checked September 29, 2026)

Claude Code 2.1.284 and codex-cli 0.156.1, in a scratch repository. The Codex checks called
`thread/start` only, so no model turn ran. The Claude checks were five single-turn Haiku runs.

| Check | Result |
|---|---|
| Codex `thread/start`, defaults | `instructionSources`: `~/.codex/AGENTS.md` and the checkout's `AGENTS.md` |
| Codex, `project_doc_max_bytes=0` (flag or thread `config`) | Only `~/.codex/AGENTS.md`: the setting drops the repository file, never the global one |
| Codex, empty `CODEX_HOME` | Only the checkout's file. A separate home is the only way to drop the global file, and that home also holds the login and the thread history |
| Claude `--safe-mode`, no extra flags | The global CLAUDE.md is not in context |
| Claude `--safe-mode --append-system-prompt` | The appended text is in context |
| Claude `--resume` with different appended text | The conversation keeps the text it started with. A conversation that started without it still has none |
| Claude `--resume --system-prompt-snapshot off` | The new text is used |

---

## Design decisions

1. **Only instruction text reaches the model.** CodeAI reads the file on the server and passes its
   text: Claude with `--append-system-prompt`, Docker Codex with `developerInstructions`. Safe mode
   stays on, so hooks, skills, plugins, MCP, and settings stay off. Instructions add words.
   Everything else there adds capabilities or runs code.
2. **Instructions are guidance, never a boundary.** No mode, sandbox, or approval decision depends on
   them. Story 79's Auto rests on its sandbox whether or not they are loaded.
3. **CodeAI reads what the provider reads.**
   - Claude: `$CLAUDE_CONFIG_DIR/CLAUDE.md` when that variable is an absolute path, else
     `~/.claude/CLAUDE.md`. A probe confirmed that Claude itself reads the file there (see the
     experiment log).
   - Codex: `$CODEX_HOME/AGENTS.override.md`, else `$CODEX_HOME/AGENTS.md`, with `CODEX_HOME`
     defaulting to `~/.codex`. As Codex does, CodeAI skips an override that is missing, empty,
     unreadable, or not a file. An override it cannot pass (too large, not text) stays the answer,
     so `AGENTS.md` is never passed in its place.
   - A relative `CLAUDE_CONFIG_DIR` or `CODEX_HOME` makes the CLI use a folder under the turn's
     checkout. CodeAI never reads that as the user's own and uses the home folder instead.
   - The user's own symlinks are followed. The target must be a regular UTF-8 file of at most
     32 KiB (Codex's default document limit) without NUL bytes, read with Story 68's bounded reader.
   - Two kinds of link are refused (added after review). A link that lives under the repositories
     root or a temp directory, because a turn that edits a checkout could repoint it at any file the
     user can read. And a path that ends in a provider folder's private files, the home folder of a
     provider included when a variable names another.
   - The whole repositories root counts as a place a turn can write, not today's checkouts, because
     a turn can make its own folder stop looking like one. `~/.claude` and `~/.codex` directly in
     that root are the exception, so a root as wide as the home directory still works.
   - The file itself may live under the repositories root. The read then proves, from the kernel's
     name for the open handle, that it holds the resolved file, and tries once more when the file
     was replaced under it, as an editor's save does. Where a system cannot prove that (macOS), such
     a file is not read. A file no turn can reach needs no proof.
   - A larger or unreadable file is not passed at all, and the view and the readiness line say
     why. CodeAI never passes a truncated file.
   - `@path` imports in CLAUDE.md are passed as written, not followed. The view says so when the
     file contains any.
4. **Default: use them.** This is the user's choice. It changes today's behavior: new local Claude
   conversations get the user's CLAUDE.md, in every mode.
5. **Local Codex cannot be isolated.** It loads its own global file whatever CodeAI sends. Its switch
   therefore governs Docker Codex only. The view says "Local Codex always uses this file", and an
   isolated session refuses a local Codex agent. An isolated Codex means Docker.
6. **A choice reaches Codex's next turn and Claude's next conversation.** Claude keeps the prompt its
   conversation started with (see the Claude resume checks above). CodeAI does not pass
   `--system-prompt-snapshot off`, which would give up that stability for every turn. The UI says
   when a change takes effect.
7. **CodeAI's own contract wins.** The passed text is framed: "The user's global instructions from
   `<display path>` follow. Where they conflict with CodeAI's instructions, CodeAI's instructions
   apply." Local Codex's native loading is left as it is.
   - The text travels on Claude's command line, so another account on the same machine can read it
     in the process list while a turn runs. The README says so.
8. **Docker gets an allowlist, not the directory.** *(The user asked for the whole directory,
   read-only. This decision needs the user's confirmation; see Open questions.)* Both directories
   hold more than credential files:
   - `settings.json` can carry `env` tokens and an `apiKeyHelper`, and `config.toml` can carry MCP
     bearer tokens and headers.
   - `projects/`, `sessions/`, and `history.jsonl` hold every other project's transcripts.
   - `logs_2.sqlite` is about 400 MB on this machine.

   A denylist would miss the next such file. So when the effective choice is on, Docker binds
   these entries read-only, each only when it exists:
   - **Claude**, at `/user/claude`: `CLAUDE.md`, `skills/`, `agents/`, `commands/`.
   - **Codex**, at `/user/codex`: `AGENTS.md`, `AGENTS.override.md`, `skills/`, `prompts/`.

   They sit outside the provider home volume, and safe mode still ignores them, so they are
   reference material. The framing sentence names the path.

   Each entry's resolved source must not be, or contain, the user's home, the provider home, the
   CodeAI data directory, or the running installation. If it is, that entry is skipped and the view
   says so. As shipped, an entry is also skipped when:
   - it is reached through a link under the repositories root or a temp directory, or its path ends
     there. A turn can write in those places, and Docker resolves the source again when the worker
     starts, so nothing can prove what it bound;
   - its path ends in a provider folder but is not an allowlisted entry;
   - its path is any part of the data directory, the installation, `~/.docker`, or `~/.config`, as
     for a checkout. A provider folder kept under `~/.config` still has its own entries bound;
   - it cannot be read, it is not the expected kind (a file or a folder), or Docker cannot mount
     its path.
9. **Each machine owns its setting and its files.** An executor's turns use the executor's setting
   and the executor's files. A session's override travels in its creation request through the
   existing gateway. The view shows the home machine only.
10. **A session's override is fixed at creation.** The choices are Default (follow the machine
    setting at each turn), Use, and Isolate. Only Use and Isolate are stored, which moves that
    session to the next format. A session made from a source session copies its override.

---

## Desired behavior

### Part A — Pass the global instructions (server)

- `<dataDir>/instructions/settings.json` holds `{ claude: boolean, codex: boolean }`. It is written
  like Docker's record, and an absent record means both are on. A damaged record means off for both,
  and readiness says so.
- `src/server/agents/globalInstructions.ts` resolves each provider's file (decision 3) with a bounded
  reader extracted from `personalIgnore`, and gives either `{ displayPath, text }` or an issue.
  `displayPath` is relative to the home directory, such as `~/.claude/CLAUDE.md →
  ~/.codex/AGENTS.md`.
- `conversationService` resolves the effective choice for each turn (the session's override, else
  the machine setting) and passes `globalInstructions?: { displayPath, text }` in `AgentProcessRun`,
  with `userCustomizations` for a Docker turn whose choice is on. An empty file passes nothing.
- **Claude** (local and Docker): `buildClaudeArgs` adds `--append-system-prompt <framed text>` when
  it is set. `--append-system-prompt` joins `BASE_CLAUDE_FLAGS`.
- **Codex Docker:** `developerInstructions` becomes `CODEX_DEVELOPER_INSTRUCTIONS` plus the framed
  text, at thread start and resume. **Codex local** is unchanged: it never gets the text twice.
- The Codex readiness note points to the view instead of only counting files.

### Part B — See them and switch them

- `GET /api/instructions` returns, for each provider: the switch, the display path, the text,
  whether it has `@` imports (Claude only, outside code), any issue (missing, not a file, too large,
  not UTF-8, unreadable, reached through a link a turn could repoint, a provider folder's private
  file, or unverifiable on this system), whether a turn can edit the file, and what a Docker worker
  sees. For Codex it also returns `localAlways: true`. `PATCH` takes `{ provider, enabled }`. Both routes use the
  existing device authorization. The executor gateway does not allow them.
- The Arena gains a **Global instructions** section beside Docker execution. It has one row per
  provider with the switch, the display path, and a read-only monospace view of the file.
  - Codex's row says "Local Codex always uses this file. The switch applies to Docker Codex."
  - When the two files resolve to one file, the view says "Claude and Codex share this file" and
    shows it once.
  - The hint says "Takes effect on the next Docker Codex turn and in a Claude agent's next provider
    session."
  - A file under the repositories root says "This file is under the repositories root: a turn that
    edits its folder can change what these instructions say."
  - The Arena's Refresh reads the files again.
- `GET /api/health` carries each provider's switch and whether a file is there, so a session can
  show what applies. Its readiness line names the file and no path, because health reaches an
  attached home machine.

### Part C — Choose per session at creation

- `createSessionRequestSchema` takes an optional `instructions: 'global' | 'isolated'`. The Arena's
  new-session form and the conversation's new-session action offer **Global instructions: Default ·
  Use · Isolate**, and the device remembers the last choice (Story 70). VR does not offer it.
- The session stores `instructions` only when given. **Session format 7** is format 6 plus that
  field, and a session created with a choice is written at 7. Report evidence and an Auto message
  never lower the version. An older CodeAI hides only such sessions (Story 65).
- An isolated **local** session refuses a Codex agent with a 409, both at creation and when an agent
  is added: "Local Codex always loads your global AGENTS.md. Use Docker for an isolated Codex." The
  forms disable Isolate for a local Codex choice and say why. A remembered Isolate that a form had
  to set aside stays remembered.
- The public session carries `instructions`. The execution line shows "global instructions" or
  "isolated" for the addressed agent, and "global instructions unavailable" when they are on but
  this machine has none it can give. Local Codex is never "isolated". For an executor's session it
  shows only a choice the session itself carries, and nothing for local Codex there, because the
  executor's switches and files are its own.

### Part D — Docker: read-only customizations

- When a Docker turn's effective choice is on, the worker gets decision 8's entries as read-only
  binds, validated immediately before `docker start` the way the checkout is. The framed text adds
  "The user's customizations are available read-only at `/user/<provider>`." The sentence stands
  alone when entries are bound but there is no instruction file.
- An isolated Docker turn gets no binds and no text.
- docker-execution.md and AGENTS.md state the new exception to "never mount provider host storage".

### Type contract

```ts
// src/shared/types.ts
export type GlobalInstructionsChoice = 'global' | 'isolated';
export interface AgentProcessRun {
  // …unchanged fields
  /** Server-resolved; undefined means isolated, a file that cannot be passed, or local Codex. */
  globalInstructions?: { displayPath: string; text: string };
  /** Server-resolved; Docker only: the choice is on, so the worker may see the allowlisted entries. */
  userCustomizations?: boolean;
}
/** Health: each provider's switch, whether CodeAI has text to pass, and whether local Codex has a file. */
export type MachineInstructions = Record<AgentProvider, { enabled: boolean; passable: boolean; present: boolean }>;

// src/shared/protocol.ts — createSessionRequestSchema gains
instructions: z.enum(['global', 'isolated']).optional(),

// src/shared/sessionSchema.ts — format 7 sessions may carry
instructions?: GlobalInstructionsChoice;
```

---

## Acceptance criteria

### Part A — pass

- [x] With no settings record, a local Claude run passes `--append-system-prompt` with the framed
      text of the resolved file. With Claude switched off, it passes nothing.
- [x] `$CLAUDE_CONFIG_DIR`, `$CODEX_HOME`, `AGENTS.override.md` precedence, and symlinks resolve as
      decision 3 says.
- [x] A missing file, a file over 32 KiB, a non-UTF-8 or NUL-containing file, or a non-regular file
      passes nothing and reports its issue. No text is ever truncated.
- [x] Docker Codex sends the framed text inside `developerInstructions` at start and resume. Local
      Codex sends only `CODEX_DEVELOPER_INSTRUCTIONS`.
- [x] A damaged settings record means off for both providers, with a readiness line.
- [x] No browser input reaches the file path or the text. The browser names only the switch and the
      session's choice.

### Part B — view

- [x] `GET /api/instructions` returns each provider's switch, display path, text, import flag, and
      issue. `PATCH` changes one provider's switch. Neither route is reachable through the executor
      gateway.
- [x] The Arena section shows both providers, collapses a shared file into one view, and carries the
      local-Codex and timing notes.

### Part C — per session

- [x] Creating a session with `instructions` stores it and upgrades the session to the next format.
      Without it, the session keeps its version.
- [x] Report evidence on an upgraded session keeps its version.
- [x] Each turn uses the session's choice before the machine setting.
- [x] An isolated local session refuses a Codex agent at creation and when one is added (409).
- [x] The conversation and Arena forms offer the choice, remember it on the device, and disable
      Isolate for local Codex with the reason.
- [x] The execution line shows the addressed agent's effective choice, and says when the choice is
      on but this machine has nothing it can give that agent.

### Part D — Docker

- [x] A Docker turn with the choice on binds exactly the allowlisted entries that exist, read-only,
      at `/user/<provider>`. An isolated turn binds none.
- [x] An entry whose resolved source is, or contains, the home directory, the provider home, the data
      directory, or the installation is skipped and reported.
- [x] *(Added after review.)* A link that lives where a turn can write is never followed, for the
      text or for a bind; nothing there is a bind source; a private file of a provider folder is
      never read; and the file that is read is proven to be the one that was resolved.
- [x] docker-execution.md and AGENTS.md describe the exception.

### All

- [x] `npm run lint`, `npm test`, and `npm run test:e2e` pass. Each new rule has a test proven to
      fail when the rule is removed.
- [x] One real Claude turn follows a marker line in the global file when the choice is on, and
      does not when it is off (recorded in docs/experiment-log.md).
- [ ] One real Docker Codex turn does the same. It needs the signed-in worker of the owner's own
      installation, which no session uses for checks (How to verify, step 5).

## Out of scope

- Loading skills, hooks, plugins, MCP, or settings natively in either provider. Safe mode and
  Codex's disabled features stay as they are.
- Isolating local Codex through a CodeAI-owned `CODEX_HOME` (a separate login, and threads that no
  longer resume).
- Viewing or switching an executor's setting from the home machine. That needs a gateway route
  and its own story.
- The override in VR's new-session form. VR sessions follow the machine setting.
- Editing the instruction file from CodeAI. The view is read-only.
- A provider-home `CLAUDE.md` or `AGENTS.md` inside Docker's shared volume. Docker Codex still loads
  one if the user put it there. The view does not show it.

### Known limits

- **Your own links are your choice.** A link in a provider folder that you point at `~/.ssh`, `/run`,
  or another private folder outside the protected ones is bound into a Docker worker. Only a link
  that lives where a turn can write is refused.
- **Case-insensitive volumes.** Paths are compared as text. On a volume that ignores case (the macOS
  default), a link you spell in another case than the folder's own can hide that it leads under the
  repositories root. Not reproducible on this machine.
- **The line under the composer reads health.** A switch another device changes, or a file created
  or edited after the page loaded, is not seen until this one refreshes the Arena or reloads. The
  server decides each turn whatever the line says.
- **Only the one file is passed.** Its imports are not followed, and any other file the provider
  would load from the folder by itself, such as user rules, is not passed (not probed here).
- **A repositories root that holds a provider folder under another name**, such as a stow-style
  `~/dotfiles/claude`, makes links in that folder refused and its entries unbound. The Arena says
  why.
- **An older executor** answers a creation that names Use or Isolate with a 400, because it does not
  know the field.
- **Two devices saving different switches at the same moment** can lose one of the two.
- **An isolated Docker Codex** still loads an `AGENTS.md` inside its own shared provider home, which
  any earlier Docker Codex turn can write.

## Open questions

1. **Allowlist or whole directory (decision 8).** The user chose "whole directory, read-only". This
   draft proposed the allowlist because the directories hold tokens and every project's transcripts,
   and the allowlist is what shipped. **Still open:** confirm it, or name what else Docker should
   see. Adding a name is one line in `PROVIDER_CUSTOMIZATIONS`.
2. **Format number.** Settled: Story 79 shipped first and took 6, so this story is 7.
3. **`--append-system-prompt-file`.** The text is on Claude's command line today, where the process
   list and Docker's event stream show it. Writing it into the run's context directory and passing
   the file flag would remove both. It needs its own probe of the pinned CLI versions, so it is
   left for a follow-up.

## How to verify

1. `npm run lint && npm test && npm run test:e2e`.
2. Put a marker line in `~/.codex/AGENTS.md` (on this machine `~/.claude/CLAUDE.md` links to it).
   Open the Arena and check that Global instructions shows the file once, as shared.
3. Start a new local Claude session and ask for the marker: it answers. Switch Claude off, start
   another session, ask again: it does not. The first session still answers, because Claude keeps
   its conversation's prompt.
4. Create a local session with Isolate and Claude: no marker. Try to add a Codex agent: refused with
   the message.
5. In a Docker Codex session with Default, ask for the marker and list `/user/codex`: the marker is
   there, and so is `skills/`, but no `auth.json` or `config.toml`. `AGENTS.md` is listed only when
   the file lies outside the repositories root (on this machine it does not, so its text is passed
   and the file is not bound). Create an isolated Docker session: no marker, and no `/user`.

## What shipped

Parts A to D, with the allowlist of decision 8 as drafted and session format 7.

- **The file each provider reads.** `providerFolder`
  ([providerFolder.ts](../src/server/agents/providerFolder.ts#L19)) names the folder,
  `resolveGlobalInstructionFile`
  ([globalInstructions.ts](../src/server/agents/globalInstructions.ts#L166)) picks the file in the
  provider's own order, and `resolveUserPath`
  ([globalInstructions.ts](../src/server/agents/globalInstructions.ts#L85)) resolves it link by
  link, refusing a link that lives where a turn can write (`agentWritable`,
  [L56](../src/server/agents/globalInstructions.ts#L56)) and a provider folder's private files
  (`providerFolders`, [L65](../src/server/agents/globalInstructions.ts#L65)).
- **Whole or not at all.** `readBoundedTextFile`
  ([boundedTextFile.ts](../src/server/boundedTextFile.ts#L23)) was extracted from `personalIgnore`
  ([gitRead.ts](../src/server/repository/gitRead.ts#L55)). It reads from one handle, never more than
  one byte past the limit, and with `exactly` requires the kernel's name for the handle to be the
  resolved path. `readInstructionFile`
  ([globalInstructions.ts](../src/server/agents/globalInstructions.ts#L131)) asks that of a file a
  turn can reach, tries once more when the file was replaced under it, and does not read such a
  file on a system that cannot prove it.
- **The switches and one turn.** `readInstructionSettings`
  ([globalInstructions.ts](../src/server/agents/globalInstructions.ts#L203)) reads
  `<dataDir>/instructions/settings.json`. `turnGlobalInstructions`
  ([L217](../src/server/agents/globalInstructions.ts#L217)) applies `effectiveInstructions`
  ([globalInstructions.ts](../src/shared/globalInstructions.ts#L39)) and is called for every turn
  ([conversationService.ts](../src/server/conversation/conversationService.ts#L106)).
- **Claude.** `buildClaudeArgs` adds `--append-system-prompt`
  ([claudeInvocation.ts](../src/server/agents/claudeInvocation.ts#L36)), which preflight requires
  ([L76](../src/server/agents/claudeInvocation.ts#L76)). The runner frames the text
  ([claudeProcessRunner.ts](../src/server/agents/claudeProcessRunner.ts#L145)) with
  `frameGlobalInstructions` ([globalInstructions.ts](../src/server/agents/globalInstructions.ts#L235))
  and logs its size, never the text ([L151](../src/server/agents/claudeProcessRunner.ts#L151)).
- **Codex.** `codexDeveloperInstructions` takes the framed text
  ([codexInvocation.ts](../src/server/agents/codexInvocation.ts#L156)), and the runner names it for
  a Docker turn only ([codexProcessRunner.ts](../src/server/agents/codexProcessRunner.ts#L560)).
  The readiness note points to the Arena
  ([codexInvocation.ts](../src/server/agents/codexInvocation.ts#L246)).
- **The view.** `GET` and `PATCH /api/instructions`
  ([route.ts](../src/app/api/instructions/route.ts#L43)); the Arena section
  ([GlobalInstructions.tsx](../src/features/arena/GlobalInstructions.tsx#L28), mounted at
  [Arena.tsx](../src/features/arena/Arena.tsx#L255)). Health carries the switches, whether a file is
  there, and the readiness lines ([health/route.ts](../src/app/api/health/route.ts#L51),
  `instructionsReadiness` at [globalInstructions.ts](../src/server/agents/globalInstructions.ts#L249)).
- **A session's choice.** The request field ([protocol.ts](../src/shared/protocol.ts#L96)), format 7
  ([sessionSchema.ts](../src/shared/sessionSchema.ts#L234), enforced at
  [L282](../src/shared/sessionSchema.ts#L282)), creation and the continuation copy
  ([sessionStore.ts](../src/server/storage/sessionStore.ts#L554)), and the refusal of a Codex agent
  in an isolated local session at creation and at
  [addAgent](../src/server/storage/sessionStore.ts#L686), through `isolatesLocalCodex`
  ([globalInstructions.ts](../src/shared/globalInstructions.ts#L27)).
- **The forms and the line.** Both forms offer Default, Use, Isolate
  ([Arena.tsx](../src/features/arena/Arena.tsx#L334),
  [SessionPicker.tsx](../src/features/conversation/SessionPicker.tsx#L92)) through
  `launchInstructions` and `namedLaunchInstructions`
  ([devicePreferences.ts](../src/features/shell/devicePreferences.ts#L81)); the device remembers
  the choice ([AppShell.tsx](../src/features/shell/AppShell.tsx#L657)). The line under the composer
  ([InstructionComposer.tsx](../src/features/conversation/InstructionComposer.tsx#L195)) shows
  `instructionsLine` ([globalInstructions.ts](../src/shared/globalInstructions.ts#L56), wired at
  [AppShell.tsx](../src/features/shell/AppShell.tsx#L348)). In a panel too narrow for both, the
  state moves under the mode's hint as one piece instead of reaching past the panel. A continuation that would isolate local
  Codex says why it cannot ([AppShell.tsx](../src/features/shell/AppShell.tsx#L346)).
- **Docker.** `PROVIDER_CUSTOMIZATIONS`
  ([globalInstructions.ts](../src/server/agents/globalInstructions.ts#L30)) is the allowlist.
  `resolveDockerCustomizations`
  ([dockerCustomizations.ts](../src/server/execution/dockerCustomizations.ts#L39)) resolves it;
  `createWorker` binds the result read-only and resolves it again before `docker start`
  ([dockerRuntime.ts](../src/server/execution/dockerRuntime.ts#L425)); the Docker runner asks for
  the binds and names the folder only when some were made
  ([dockerProcessRunner.ts](../src/server/execution/dockerProcessRunner.ts#L35)). A checkout may not
  hold a provider folder that a variable names
  ([dockerProfile.ts](../src/server/execution/dockerProfile.ts#L80)).
- **Tests keep the developer's own files out.** [test/setup.ts](../test/setup.ts) points both
  provider variables at folders that do not exist, and the end-to-end server reads
  [test/fixtures/provider-homes](../test/fixtures/provider-homes). Fixtures that stand for the
  user's own folders live in `/var/tmp` ([test/userOwned.ts](../test/userOwned.ts)), because the
  temp directory counts as a place a turn can write; the suites say so and stop when `TMPDIR`
  names that folder.
- **Docs.** README (*Global instructions*), [architecture.md](../docs/architecture.md),
  [docker-execution.md](../docs/docker-execution.md#your-global-instructions-and-customizations),
  [experiment-log.md](../docs/experiment-log.md#story-80--global-instructions-probes-2026-09-30-utc),
  and AGENTS.md (the two safety boundaries, the source table, and the Now line).

### Changed from the draft

- **Format 7**, not 6.
- **Two link rules, a proven read, and tighter binds** (decision 3 and decision 8), from the reviews.
- **The line under the composer has a third state**, "global instructions unavailable". A switch
  that is on says nothing about a machine that has no file, which is the case the motivation is
  about.
- **`@` imports are flagged for Claude only**, and not inside code.
- **The framing sentence for Docker** says "The user's customizations", since it is addressed to the
  model.

## Verification record

September 30, 2026. Claude Code 2.1.284, codex-cli 0.159.2, Docker Engine 28.5.2, Ubuntu 26.04.1.

- `npm run lint`: passes.
- `npm test`: 850 tests in 96 files pass.
- `npm run test:e2e`: 102 of 102 pass in installed Chrome, including
  [the new flow](../e2e/global-instructions.spec.ts#L37) and
  [the narrow panel](../e2e/global-instructions.spec.ts#L161).
- `npm run test:docker` against the real daemon: every line passes, with a new one for the binds
  ([test-docker.ts](../scripts/test-docker.ts#L149)).
- **Tests, then mutation.** 113 mutations of single rules, one at a time, each failed at least one
  test on the final code. That was not true at first. The third review ran mutations of its own and
  found five that survived. While its findings were being applied, an edit also cut four tests by
  mistake, which the next mutation run caught. Each survivor led to a test (an override without read permission, a folder where local
  Codex's file should be, a folder holding the other provider's folder, a home reached through a
  link, and each temp directory by itself), and checks a mutation could not tell apart from another
  check were removed. The mutations cover the file and folder resolution, the override order, each
  bound of the reader, the proof of the open handle and when it is asked, the second try, both link
  rules and their one exception, the switches and the damaged record, the turn's choice, each
  provider's text, the log line, the routes and the gateway, the readiness lines, format 7 and its
  validation, the three refusals of isolated local Codex, the forms, the remembered choice, the
  states of the line, every bind rule, the recheck before start, and the Docker runner.
- **Four reviews.**
  - The first found that the line claimed instructions a machine had no file for, that the bind
    check looked one way only, and that one local Codex session reset a remembered Isolate.
  - The second, adversarial, found that the link rule checked a path and then opened it by name
    (12.7% of racing resolutions returned another file), that the read was not bounded, and that
    the provider-folder exemption held inside a repository.
  - The third reviewed those fixes. It found that a repositories root as wide as the home directory
    refused the provider folders themselves, that an editor's save was mistaken for a swap, that
    the walk looked for a file beyond a file, that an executor's local Codex and an unpassable file
    were described wrongly under the composer, several strings, two suites that depended on where
    the temp directory is, and the mutation claim above.
  - A fourth, from outside this session, found that a folder holding `~/.config` was bound when
    `~/.config` is a link to somewhere the home directory does not hold, and that the longest state
    of the line reached past a 360-pixel panel. The first came from a check removed as redundant:
    it was redundant only for the fixtures at hand. Both have a test that failed before the fix.
  - All are fixed and tested, except what *Known limits* lists.
- **Real providers.** See the experiment log: thirteen Claude turns (Haiku) with a scratch
  instruction file, the last two through the final code; Claude's and Codex's file choice probed
  without a model turn; `--append-system-prompt` present in `claude --help` from 2.1.226 on.
- **Not verified:** a signed-in Docker Codex turn (the open criterion), and a look at the running
  app on this machine's own data. On this machine both providers resolve to
  `~/my_projects/agents-prompts/AGENTS.md`, which lies under the repositories root: its text is
  passed, the Arena will mark it as a file agents can edit, and Docker binds `skills/` but not the
  file.
