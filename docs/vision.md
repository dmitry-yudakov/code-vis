# Vision — the arena

**Status:** Main vision. Aspirational — this is where the product is going, not what exists today
([architecture.md](architecture.md) is the current reality). · **Updated:** August 29, 2026

Its vocabulary is fixed in [vocabulary.md](vocabulary.md). Its two chapters are
[software-model.md](software-model.md) (understanding and changing code visually) and
[multi-project-session-environment.md](multi-project-session-environment.md) (the engineering notes
behind records, machines, and concurrency).

---

## Thesis

Agents write code faster than one person can read it, and now they do it several at a time. The
scarce resource has moved: not producing changes, but **holding many parallel pieces of work in your
head — knowing what each agent is doing, which one is stuck, which one is about to do something you
would not have allowed, and what any of it actually did to the software.**

CodeAI is a **multi-project, multi-session, multi-device arena**: one place where a person
orchestrates many sessions, sees the state of all of them at a glance, and steps into any one of
them to understand it visually and steer it.

The product has two halves, and it is only interesting when both are true at once:

- **Breadth — the arena.** Many sessions across many projects and machines, each showing what it is
  up to, what state it is in, and whether it is waiting for you.
- **Depth — the session.** One conversation with one or more agents, a canvas of diagrams that shows
  how the software fits together, the repositories it touches, and the code and diffs behind them.

Breadth without depth is a process list. Depth without breadth is a chat window. Together they are
the environment for working the way people now actually work with agents.

---

## The arena

The arena is the home surface: every session you have, grouped by project, wherever it runs.

Each session shows its title, its project and repositories, its agents, the machine it runs on, a
line of what it is currently doing, and one state:

| State | Meaning |
|---|---|
| **Idle** | Open, nothing running. |
| **Running** | An agent turn is executing on its machine. |
| **Needs you** | Blocked on a human: a permission request, a question, a choice. |
| **Queued** | Ready to run, waiting on that machine's concurrency limit. |
| **Failed** | The last turn ended in error. |
| **Offline** | Its machine is unreachable — a normal state; laptops sleep. |

**Attention is the product.** *Needs you* is the state the arena exists to surface. It carries the
reason with it ("permission: run tests", "which of these two schemas?"), it appears in the **Inbox**
alongside finished turns and failures, and — this is the part that makes the arena more than a
dashboard — **it reaches you while you are inside a different session**. A permission request from
the incident investigation should be answerable in three seconds without losing your place in the
auth redesign, on whichever device you happen to be holding.

Two rules keep that from becoming noise or a security hole:

- Only a human answers a permission request, and only through an authenticated identity — never
  "whichever client is connected", and never one session answering another's request.
- Everything that is not *Needs you* or *Failed* is quiet by default. A finished turn is unread, not
  an interruption.

The arena's other job is starting work: a new session in a project, with a provider and a mode
chosen up front, on the machine you pick.

---

## Inside a session

Opening a session gives roughly today's product, widened:

- **Conversation** — the transcript, with more than one agent participant, each with a provider, a
  role, and a mode (Ask / Plan / Agent).
- **Canvas** — the zoomable visual surface holding the session's diagrams and sketches. Agents
  author Mermaid; you draw over it, and your marks are durable. For a session with no repository,
  the canvas is the *primary* artifact rather than a companion to code.
- **Repositories** — the working tree, branch, changed files, **diffs, and individual files**, in
  the same surface as the diagram they explain. Understanding what an agent did means moving between
  the map and the code without leaving the session.
- **Participants** — you and the agents; later, other people.

A session is not a task and does not close. It goes idle, and you come back to it.

The visual half — the persistent model of the software, lenses over it, editorial arrangement,
provenance honesty, and previewing a proposed change on the same map that renders an applied one —
is the subject of [software-model.md](software-model.md). Everything in that chapter now happens
*inside a session*, and its "saved view" is what a **view** in this vocabulary is when you name it.

---

## Projects, repositories, and repository-free work

A **project** is a body of work, not a repository. It groups sessions and the repositories those
sessions touch, and later carries its own instructions and knowledge — the meaning Claude.ai,
ChatGPT, Linear, and Motion all give the word.

That unlocks three things the current one-repo-per-conversation shape forbids:

- **A session with no repository at all** — a design argued out on a canvas, a plan, a brainstorm.
  First-class, not a degenerate case.
- **A session spanning several repositories** — "this change touches the client and the API" stops
  requiring two disconnected conversations.
- **The same repository in two sessions** — comparing two implementations, or one agent building
  while another reviews.

A repository's **identity** and its **checkout** on a particular machine are different facts. A
laptop and a desktop hold two checkouts of one repository, and the product must be able to say so.

---

## Machines and devices

**Work happens on a machine; you watch from a device.** Today those are fused — one Next.js process
on `localhost` is both the executor and the only screen. Separating them is what makes the rest of
the vision possible:

- one person has several machines (laptop, desktop, later a cloud sandbox) and several devices
  (browsers, a tablet, a headset);
- any device may see and address any reachable machine's sessions;
- concurrency is a property of a **machine**, not of a person — a cloud sandbox and a laptop do not
  share a limit;
- an agent turn runs on one machine and may only act on that machine's checkouts;
- a session whose machine is asleep is *Offline*, not broken: its transcript and canvas still read.

The step ladder is: one machine that owns the records → your own devices authenticated to it →
a second execution machine → a coordinator that no single device owns. The engineering shape of
each is in [the environment notes](multi-project-session-environment.md#persistence-and-device-continuity).

---

## Surfaces: web, desktop, VR

The web and spatial surfaces **project the same workspace state**; they share records, not layout.
Each device keeps its own layout, and losing a layout never loses work.

- **Web / desktop** — the arena as cards or a zoomable surface; a session as panels around a canvas.
- **Tablet / phone** — mostly the arena and the Inbox: answer a permission, read what happened,
  redirect an agent. Touch-drawing on a canvas is a natural fit.
- **VR / AR** — sessions arranged as tables, walls, or rooms, with diagrams rendered as real spatial
  nodes and edges rather than flat images. Watching six agents work is a genuinely spatial problem,
  and no adjacent tool has a credible spatial surface — which is why it is a differentiator rather
  than a curiosity. Mermaid stays the canonical source; renderers derive what they need
  ([Mermaid across 2D and 3D](multi-project-session-environment.md#mermaid-across-2d-and-3d)).

---

## The cloud chapter

Long term, a person should be able to join their arena from anywhere without a machine of their own
being awake: sessions execute in cloud sandboxes, driven either through provider APIs or by running
`claude` / `codex` inside a container against the user's own subscription.

This is deliberately last. It needs everything above it — records that never assume "here",
authenticated devices, a machine registry, per-machine concurrency — plus a trust model this product
does not have yet: a cloud sandbox sits outside the "trusted local repository" stance that today's
capability restrictions depend on.

---

## More than one person

A shared arena is the natural end of this, and near term it costs only discipline: stop asserting
that exactly one human exists, keep artifacts and views serializable, and let a session hold several
participants. The expensive parts — identity, authorization, live multi-writer synchronization, and
sandboxing — stay owned by [Story 21](../stories/STORY-20260806-web2-team-environment.md) and are
not started by anything above.

---

## Principles

1. **Attention is the scarce resource.** The arena is measured by how fast you notice the one
   session that needs you, and how little the other five interrupt you.
2. **Borrowed nouns, one coined word.** Every concept uses the industry's word with the industry's
   meaning; *Arena* is the single exception ([vocabulary.md](vocabulary.md)).
3. **Durable records never assume "here".** No host-local path inside an identity, no record that
   silently means "this machine", no single global slot standing in for keyed state, nothing another
   device must see living in browser storage.
4. **Provenance honesty.** Static structure, agent suggestion, and unapplied proposal are always
   visually distinct — the credibility anchor of the whole visual half
   ([software-model.md](software-model.md)).
5. **User marks are durable.** Sketches, notes, pins, and asserted edges are the highest-precedence
   source and are never silently reorganized.
6. **Capabilities are resolved where work executes.** A machine decides what a turn may do; a client
   never asserts it. A permission is answered by an authenticated human.
7. **Layout is per device; work is not.** Geometry, viewport, and panel state are local and
   disposable. Conversations, canvases, and artifacts are not.

---

## Sequence

Roughly in dependency order; the engineering detail and current status of each live in
[the environment notes](multi-project-session-environment.md#possible-delivery-slices).

1. **Machine-owned sessions** — *shipped.* Canonical session records on the machine instead of the
   browser, with repositories instead of one project id
   ([Story 26](../stories/STORY-20260826-loosen-project-host-bindings.md)).
2. **Runs addressed by id** — *shipped.* Every live and retained turn discoverable and answerable by
   `runId` ([Story 27](../stories/STORY-20260826-session-keyed-host-bound-runs.md)).
3. **Projects, and sessions without or with several repositories** — *shipped.* The grouping the arena lists
   sessions under, the repository-free session, and repository surfaces that follow the selected one
   ([Story 35](../stories/STORY-20260829-projects-and-repositories.md)).
4. **Several sessions open at once** — *shipped.* Views and per-device layout, still one turn
   running globally; navigation without concurrency
   ([Story 36](../stories/STORY-20260830-multi-session-workspace.md)).
5. **Concurrent turns** — a per-machine limit, queueing, and background activity across sessions
   ([Story 37](../stories/STORY-20260901-concurrent-turns.md)).
6. **The arena** — the overview itself: states, the Inbox, cross-session permission answering, and
   starting a session from it.
7. **Your own devices** — authenticated pairing to one machine; the arena on a tablet or headset.
8. **A second machine** — a machine registry, remote sessions listed and streamed in one arena.
9. **Spatial surfaces** — desktop 3D first, then WebXR.
10. **Cloud execution** — sandboxes, subscription-in-container, joining from anywhere.

Steps 1–4 shipped in August 2026 and are what makes the rest affordable. From step 5 on this is
direction, not a plan.

The arena comes fourth of the four near-term steps rather than first, for two reasons. It groups
sessions **by project**, so building it before step 3 gives one flat list of everything; and its
states only mean something once several turns can run at once, which is step 5. Built earlier it is
a real improvement — switching sessions without losing your place, and answering a permission from
elsewhere — but it is not yet the thing this document describes.

One prerequisite sat outside this list because it delivered nothing to a user:
[Story 34](../stories/STORY-20260829-rename-thread-to-session.md) shipped the code-level vocabulary
rename before step 3, so every story after it is written once in the settled nouns.

---

## Not now

- Real-time multi-writer collaboration inside one session.
- A coordinator service, sandboxing, or any inbound network exposure.
- Portable repository identity across machines (the checkout/identity split is prepared, not built).
- Autonomous apply: a change is previewed and verified before it is written.
- Anything that makes the single-machine, single-person product worse in order to be ready for the
  multi-machine one.

---

## Open questions

1. What is the smallest useful arena: a list, cards, or a zoomable surface — and does it group by
   project, by machine, or by attention?
2. How does a *Needs you* reach a person who is inside another session, or on another device,
   without becoming noise — and what is the smallest answerable form of a permission request?
3. Can one session be open in two views (and two devices) at once, and what does focus mean then?
4. What is a repository's portable identity, who mints it, and how are two checkouts recognized as
   the same repository?
5. When a session's repositories span machines, what may a turn on one machine do with the others?
6. Who chooses the machine a turn runs on — the user, the session, or a policy?
7. Where does a repository-free session's file output go, and can it later be promoted into a repo?
8. What is the default and maximum concurrency per machine, and does a waiting permission hold a
   slot?
9. What authentication is sufficient for one person's own devices, before any team model exists?
10. In a spatial arena, what does a session look like at rest, and what interaction moves a session
    versus a node inside its diagram?
