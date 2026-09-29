# Story 80 — Let agents use your global instructions, show them, and isolate a session

**Status:** Draft · **Type:** Full-stack · **Depends on:**
[Story 20](STORY-20260817-web2-codex-provider.md) (Codex App Server),
[Story 57](STORY-20260908-local-docker-execution.md) (Docker execution),
[Story 65](STORY-20260921-tolerate-newer-session-format.md) (a newer session hides only itself),
[Story 68](STORY-20260924-personal-git-ignore.md) (bounded reads of a personal file). It changes two
of AGENTS.md's safety boundaries (see *Docs*), and it coordinates the next session format with
[Story 79](STORY-20260928-sandboxed-auto-mode.md).

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
- **Session format:** the newest readable format is 5
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
     `~/.claude/CLAUDE.md`. Part A confirms that Claude itself uses `CLAUDE_CONFIG_DIR` for this
     file (not checked yet).
   - Codex: `$CODEX_HOME/AGENTS.override.md`, else `$CODEX_HOME/AGENTS.md`, with `CODEX_HOME`
     defaulting to `~/.codex`. This matches the path Codex reports in `instructionSources`.
   - Symlinks are followed. The target must be a regular UTF-8 file of at most 32 KiB (Codex's
     default document limit) without NUL bytes, read with Story 68's bounded reader.
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
   says so.
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
  the machine setting) and passes `globalInstructions?: { displayPath, text }` in `AgentProcessRun`.
- **Claude** (local and Docker): `buildClaudeArgs` adds `--append-system-prompt <framed text>` when
  it is set. `--append-system-prompt` joins `BASE_CLAUDE_FLAGS`.
- **Codex Docker:** `developerInstructions` becomes `CODEX_DEVELOPER_INSTRUCTIONS` plus the framed
  text, at thread start and resume. **Codex local** is unchanged: it never gets the text twice.
- The Codex readiness note points to the view instead of only counting files.

### Part B — See them and switch them

- `GET /api/instructions` returns, for each provider: the switch, the display path, the text,
  whether it has `@` imports, and any issue (missing, too large, not UTF-8, unreadable). For Codex it
  also returns `localAlways: true`. `PATCH` takes `{ provider, enabled }`. Both routes use the
  existing device authorization. The executor gateway does not allow them.
- The Arena gains a **Global instructions** section beside Docker execution. It has one row per
  provider with the switch, the display path, and a read-only monospace view of the file.
  - Codex's row says "Local Codex always uses this file. The switch applies to Docker Codex."
  - When the two files resolve to one file, the view says "Claude and Codex share this file" and
    shows it once.
  - The hint says "Takes effect on the next Codex turn and in new Claude conversations."

### Part C — Choose per session at creation

- `createSessionRequestSchema` takes an optional `instructions: 'global' | 'isolated'`. The Arena's
  new-session form and the conversation's new-session action offer **Global instructions: Default ·
  Use · Isolate**, and the device remembers the last choice (Story 70). VR does not offer it.
- The session stores `instructions` only when given. **Session format 6** is format 5 plus that
  field. Writing it upgrades the session to 6. Report evidence and any later upgrade never lower the
  version. An older CodeAI hides only such sessions (Story 65). *(If Story 79 ships first and takes
  format 6, this becomes 7.)*
- An isolated **local** session refuses a Codex agent with a 409, both at creation and when an agent
  is added: "Local Codex always loads your global AGENTS.md. Use Docker for an isolated Codex." The
  forms disable Isolate for a local Codex choice and say why.
- The public session carries `instructions`. The execution line shows "global instructions" or
  "isolated" for the addressed agent. For local Codex it always shows "global instructions".

### Part D — Docker: read-only customizations

- When a Docker turn's effective choice is on, the worker gets decision 8's entries as read-only
  binds, validated immediately before `docker start` the way the checkout is. The framed text adds
  "Your customizations are available read-only at `/user/<provider>`."
- An isolated Docker turn gets no binds and no text.
- docker-execution.md and AGENTS.md state the new exception to "never mount provider host storage".

### Type contract

```ts
// src/shared/types.ts
export type GlobalInstructionsChoice = 'global' | 'isolated';
export interface AgentProcessRun {
  // …unchanged fields
  /** Server-resolved; undefined means isolated, or local Codex, which loads its own file. */
  globalInstructions?: { displayPath: string; text: string };
}

// src/shared/protocol.ts — createSessionRequestSchema gains
instructions: z.enum(['global', 'isolated']).optional(),

// src/shared/sessionSchema.ts — format 6 sessions may carry
instructions?: GlobalInstructionsChoice;
```

---

## Acceptance criteria

### Part A — pass

- [ ] With no settings record, a local Claude run passes `--append-system-prompt` with the framed
      text of the resolved file. With Claude switched off, it passes nothing.
- [ ] `$CLAUDE_CONFIG_DIR`, `$CODEX_HOME`, `AGENTS.override.md` precedence, and symlinks resolve as
      decision 3 says.
- [ ] A missing file, a file over 32 KiB, a non-UTF-8 or NUL-containing file, or a non-regular file
      passes nothing and reports its issue. No text is ever truncated.
- [ ] Docker Codex sends the framed text inside `developerInstructions` at start and resume. Local
      Codex sends only `CODEX_DEVELOPER_INSTRUCTIONS`.
- [ ] A damaged settings record means off for both providers, with a readiness line.
- [ ] No browser input reaches the file path or the text. The browser names only the switch and the
      session's choice.

### Part B — view

- [ ] `GET /api/instructions` returns each provider's switch, display path, text, import flag, and
      issue. `PATCH` changes one provider's switch. Neither route is reachable through the executor
      gateway.
- [ ] The Arena section shows both providers, collapses a shared file into one view, and carries the
      local-Codex and timing notes.

### Part C — per session

- [ ] Creating a session with `instructions` stores it and upgrades the session to the next format.
      Without it, the session keeps its version.
- [ ] Report evidence on an upgraded session keeps its version.
- [ ] Each turn uses the session's choice before the machine setting.
- [ ] An isolated local session refuses a Codex agent at creation and when one is added (409).
- [ ] The conversation and Arena forms offer the choice, remember it on the device, and disable
      Isolate for local Codex with the reason.
- [ ] The execution line shows the addressed agent's effective choice.

### Part D — Docker

- [ ] A Docker turn with the choice on binds exactly the allowlisted entries that exist, read-only,
      at `/user/<provider>`. An isolated turn binds none.
- [ ] An entry whose resolved source is, or contains, the home directory, the provider home, the data
      directory, or the installation is skipped and reported.
- [ ] docker-execution.md and AGENTS.md describe the exception.

### All

- [ ] `npm run lint`, `npm test`, and `npm run test:e2e` pass. Each new rule has a test proven to
      fail when the rule is removed.
- [ ] One real Claude turn and one real Docker Codex turn follow a marker line in the global file
      when the choice is on, and do not when it is off (recorded in docs/experiment-log.md).

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

## Open questions

1. **Allowlist or whole directory (decision 8).** The user chose "whole directory, read-only". This
   draft proposes the allowlist because the directories hold tokens and every project's transcripts.
   Confirm the allowlist, or name what else Docker should see.
2. **Format number.** Story 79 also plans format 6. Whichever story ships first takes it.

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
   there, and so are `AGENTS.md` and `skills/`, but no `auth.json` or `config.toml`. Create an
   isolated Docker session: no marker, and no `/user`.
