# Vocabulary — the words the product uses

**Status:** Adopted, August 29, 2026 · **Decides names, not features**

The product is becoming a multi-project, multi-session, multi-device **arena**: one place where a
person watches many agent (and non-agent) sessions, sees what each is doing, notices which one is
waiting for them, and steps into any of them. [vision.md](vision.md) describes that direction; this
document fixes the nouns before more code, UI, and documentation are written against provisional
ones. It is the naming authority: where any other document disagrees, this one wins.

Two rules drive every choice here:

1. **Borrow the noun.** If Claude.ai, ChatGPT, Miro, Notion, Motion, and Linear already agree on a
   word, use their word with their meaning. A user who knows any one of those tools should not have
   to learn our synonym for something they already understand.
2. **Coin at most one word.** The overview of many running agent sessions is genuinely new — nobody
   has a settled term for it. That is the one place to be distinctive. Everywhere else,
   distinctiveness is a tax on onboarding.

Where a borrowed word cannot carry our meaning, the tie-breaker is: *what will a new user assume
this word means before we explain it?*

---

## What the industry already agrees on

Product terms as published by each vendor (checked August 2026). The striking result is how much
agreement there is at the top of the hierarchy and how little there is at the bottom.

| Concept | Claude.ai | ChatGPT | Miro | Notion | Motion | Linear | GitHub / VS Code |
|---|---|---|---|---|---|---|---|
| Everything you own | Organization / Workspace | Workspace | Team (= "workspace") | **Workspace** | **Workspace** | **Workspace** | Organization |
| A body of work | **Project** | **Project** | Space (renamed from Project) | Teamspace / page tree | **Project** | **Project** | Repository |
| One ongoing piece of work | Chat | Chat · Task (Codex) | Board | Page | Task | Issue · **Agent session** | **Agent session** · Task |
| Dialogue inside it | messages | messages | comments | comments | — | comments | chat |
| What it produces | **Artifact** | Canvas | board content | page / blocks | — | document | pull request |
| Visual surface | — | Canvas (a text/code editor) | Board (infinite **canvas**, frames) | — | Calendar | — | — |
| The AI actor | Claude | GPT · Codex | Miro AI | Notion AI / agent | AI | **Agent** (an "app user") | **Agent** (Copilot) |
| Needs your attention | — | — | notifications | **Inbox** | My Day | **Inbox** | **Inbox** / notifications |
| Overview of everything | sidebar chat list | sidebar | Home | Home | Home | Views / Inbox | **mission control** |
| Where work executes | — | Environment (Codex) | — | — | — | — | runner · codespace |
| A saved arrangement | — | — | — | **View** | **View** | **View** | — |

Three conclusions:

- **Workspace → Project → (unit of work)** is the near-universal spine. Only the innermost noun
  differs, because the innermost thing differs (a chat, a board, a page, a task, an issue).
- **"Session" has already won for agent work.** Linear creates an *agent session* per delegated
  task; GitHub's Agent HQ *mission control* lists current and completed *agent sessions*; VS Code's
  *Agent Sessions* view lists local and remote ones side by side; Devin, Codex, and Claude Code all
  call their unit a session. Our arena lists exactly this thing.
- **Nobody owns the overview.** GitHub says "mission control", everyone else says "Home". The word
  is available.

---

## The lexicon

### The spine

- **Workspace** — everything that belongs to you: your projects, sessions, machines, devices, and
  settings. Device-independent; it is what you would see after signing in from anywhere. *(Replaces
  the earlier notes'* Environment*.)*
- **Project** — a named body of work. It groups sessions, the repositories they touch, and later its
  own instructions and knowledge. A project may have no repository at all. *(Redefines today's
  Project, which is a repository.)*
- **Session** — one ongoing piece of work: a conversation, its canvas, its participants, and the
  repositories it works in. This is the unit the arena lists and the unit you open. A session has
  zero or more repositories, runs on one machine, and can be watched from any device. *(Replaces the
  earlier notes'* Thread*.)*
- **Repository** — one git repository a session can read and change. **Checkout** — that repository
  as it exists on one machine, at one path. Identity and location stay separate, exactly as
  [the engineering notes](multi-project-session-environment.md#repository-identity-is-not-a-path)
  argue. *(Replaces* Attachment*; keeps* checkout*.)*

### Inside a session

- **Conversation** — the message transcript: what you and the agents said, in order. It is a
  *surface within* a session, not the session itself. *(Already the UI's word; its scope narrows.)*
- **Canvas** — the zoomable visual surface of a session. It holds **diagrams** (agent-authored
  Mermaid) and **sketches** (surfaces you draw on). *(Today a canvas* is *one diagram; the canvas
  becomes the surface those live on — Miro's sense of the word.)*
- **Artifact** — anything durable a session produces and you can reopen: a diagram, a sketch, a
  plan, later a patch or document. Claude.ai's meaning, already the server's word.
- **Agent** — an AI participant (a provider, a role, a mode). **You / member** — a human one.
  *Participant* stays a data-model word covering both, as it does in meeting products.
- **Turn** — one instruction and the agent work it causes. Internally addressed as a **run**
  (`runId`), which is what a cancel, a permission answer, or a reattach resolves against.

### Across machines and devices

- **Machine** — where agents actually run and files actually change: this laptop, the desktop, a
  cloud sandbox. *(The earlier notes'* Host*; `hostId` stays as the code name.)*
- **Device** — a screen you watch from: a browser, a tablet, a headset. A device executes nothing.
  *(The earlier notes'* Client*.)*
- **View** — one open presentation of a session on one device. **Layout** — how a device arranges
  its views. Both are per-device and never shared; losing them never loses work. *(Replaces the
  earlier notes'* Workspace*-as-a-pane; the "saved view" of*
  [software-model.md](software-model.md) *is a view you named.)*

### The arena

- **Arena** — the overview of every session, across projects and machines: what each is doing, what
  state it is in, who is waiting for whom. The one coined word in the lexicon.
- **Inbox** — the attention queue inside the arena: permission requests, agent questions, finished
  turns, failures. Notion, Linear, and GitHub all call this an Inbox, and it answers the arena's
  central question — *which session needs me right now?*

### Session state

The arena is only as useful as this list is short and unambiguous. Six states, one of them loud:

| State | Meaning |
|---|---|
| **Idle** | Open, nothing running. |
| **Running** | An agent turn is executing on its machine. |
| **Needs you** | Blocked on a human: a permission request, a question, a choice. |
| **Queued** | Ready to run, waiting on that machine's concurrency limit. |
| **Failed** | The last turn ended in error. |
| **Offline** | Its machine is unreachable. A normal state — laptops sleep. |

*Needs you* is the state the whole arena exists to surface; it should be visible from any session,
on any device, and always name the session and the reason ("permission: run tests", "question").
Everything else can be quiet. *Done* is deliberately absent: a session that finished a turn is
*Idle* with unread messages, because sessions are not tasks and do not close.

---

## Collisions worth avoiding

**Workspace ≠ a pane.** The August 20 notes used *workspace* for one open presentation of a thread. Every major
product uses it for the top-level container (Notion, Slack, Linear, Motion, Miro's team), and VS
Code uses it for a folder of code. Both meanings are far from "a pane", and a developer audience
holds both. Ours becomes the top-level container; the pane becomes a *view*.

**Environment reads as a sandbox.** To a developer, "environment" means the machine or container
work runs in — ChatGPT's Codex literally calls its containers environments. Using it for a user's
collection of open sessions puts it one word away from *machine* and means something else. Dropped.

**Thread is already taken, twice.** In Slack, Gmail, and Discord a thread is a *reply branch inside*
a conversation. In OpenAI's Assistants API a thread is the conversation object itself. Neither is
what those notes meant, and both are things a user of this product may reasonably expect. Keeping the
word free also leaves room for the feature it usually names — branching a conversation.

**Attachment means an uploaded file.** In Claude.ai, ChatGPT, Gmail, and Slack, attaching is
something you do with a file in a message. Using it for a repository binding conflicts with a
feature we will certainly want. A session simply *has repositories*.

**Canvas is safe, but "a canvas" is not.** ChatGPT's Canvas is a document editor and Miro's canvas
is an infinite surface; ours is closer to Miro's and the word survives. What misleads is the
countable use — "canvas history", "three canvases" — where we mean diagrams. Keep *canvas*
singular per session; count diagrams and sketches.

**Arena has one real collision.** In AI circles, "arena" primarily means LMArena-style model
comparison, and the word carries a note of competition that a calm control surface does not want.
It is still the strongest candidate: memorable, unclaimed as a product noun, and it names a place
rather than a metaphor to maintain. The safeguard is that *Arena* stays a view name and a brand
word, never a data-model type — every noun inside it is borrowed.

---

## What this costs

| Concept | Earlier term | Proposed | Where it lives today |
|---|---|---|---|
| Top container | Environment | **Workspace** | not built |
| Body of work | Project (= repo) | **Project** (grouping) | `projectRegistry`, `ProjectSummary` ([types.ts:1](../src/shared/types.ts#L1)), project picker |
| Repo binding | Attachment | **Repository** + **Checkout** | `ProjectAttachment` ([types.ts:56](../src/shared/types.ts#L56)) |
| Unit of work | Thread | **Session** | `DurableSession` ([types.ts:91](../src/shared/types.ts#L91)), `SessionStore`, `SessionPicker.tsx`, "New session" |
| Transcript | Conversation | **Conversation** (narrowed) | unchanged |
| Diagram surface | Canvas (= one diagram) | **Canvas** (the surface) | `CanvasKind` ([types.ts:134](../src/shared/types.ts#L134)), `CanvasWorkspace.tsx` |
| Executor | Host | **Machine** (UI) / `hostId` (code) | `hostId` fields |
| Viewer | Client | **Device** (UI) / `clientId` (code) | not built |
| Open pane | Workspace | **View** | not built |
| Provider handle | Agent session | **provider session** (always qualified) | `ProviderSessionRef` |

Most of the cost is concentrated in two renames — *thread → session* and *project → project +
repository* — and both are cheapest now: the durable session record is young, and Stories 26
and 27 already rewrite attachments and host identity. The rest is either unbuilt or a string change.

Two names deliberately do **not** change: `runId`/`runRegistry` (correct, and never user-visible as
"run") and *participant* (right word, stays in the data model).

---

## Decisions

Taken August 29, 2026:

1. **The unit is a Session**, and *conversation* narrows to the transcript inside it. It matches
   every agent tool, and it signals correctly that the thing has a canvas, repositories, and a
   machine — which a "chat" does not.
2. **A Project is a body of work**, and **Repository** becomes its own noun. This is what every
   comparable product means by the word, and it is the only way a repository-free session stops
   being a special case.
3. **The overview is called the Arena in the UI**, accepting the LMArena echo, on the condition that
   it stays a view name and a brand word and never becomes a data-model type.

Still deferred: a level between workspace and project (Miro's *Space*, Notion's *Teamspace*). Not
needed until there is a team; *space* stays reserved for it.

The code follows in two stories: [Story 34](../stories/STORY-20260829-rename-thread-to-session.md)
landed session across types, wire, routes, records, and strings;
[Story 35](../stories/STORY-20260829-projects-and-repositories.md) next makes a project a body of work
and a repository its own noun. The remaining transitional names are `ProjectAttachment` and
`hostId`; new user-visible strings use the vocabulary above.

---

## Sources

Product terminology checked August 2026 against
[Miro Spaces](https://help.miro.com/hc/en-us/articles/21040490154898-Spaces),
[GitHub Agent HQ](https://github.blog/news-insights/company-news/welcome-home-agents/) and its
[mission control](https://github.blog/ai-and-ml/github-copilot/how-to-orchestrate-agents-using-mission-control/),
and [Linear's agent docs](https://linear.app/developers/agents) and
[AI agents guide](https://linear.app/docs/agents-in-linear). Claude.ai, ChatGPT, Notion, and Motion
terms are taken from their current product surfaces; re-verify before quoting any of them outside
this repository.
