# EPIC — Use CodeAI as an immersive workspace

**Status:** In progress · **Updated:** September 9, 2026 · **Owns:** the full VR presentation and working
journey across the Arena and sessions, under [vision.md step 9](../docs/vision.md#sequence).
The [software-model epic](EPIC-20260705-north-star-roadmap.md) continues to own model identity,
provenance, lenses, and the change loop. [Vocabulary](../docs/vocabulary.md) remains authoritative:
the workspace contains projects and sessions; a panel is a presentation of a view or tool.

## Motivation

The user's clarification after Story 44:

> I wanted some decent VR experience where I could switch to full-screen VR and use the system
> this way — not just one pane where 3D would be available.

**Enter VR changes the presentation of CodeAI as a whole.** The user should be able to start work,
talk to agents, answer permissions, inspect results, and move between sessions while remaining
immersive. Success is a useful work session in a headset, rather than the presence of a VR button.

Flat work panels are useful for prose and code. A canvas may also contain real spatial diagram
nodes and edges. Those are two choices within the immersive workspace; neither makes VR entry
depend on selecting a diagram or on implementing the future software model.

## Gaps identified before implementation

| Gap | Evidence | Consequence and owner |
|---|---|---|
| VR entry belongs to a non-empty canvas | [CanvasWorkspace.tsx:107](../src/features/diagram/components/CanvasWorkspace.tsx#L107), [135](../src/features/diagram/components/CanvasWorkspace.tsx#L135); Story 44 A.1 | Cannot enter from the Arena, an empty session, or Flat. Story 45 moves ownership to the shell. |
| Reading replaces working | [immersiveTypes.ts:61](../src/features/diagram/spatial/immersiveTypes.ts#L61); Story 44 C.15 | No send, cancel, participant changes, or approval decisions. Stories 47–48 complete the active-session work loop. |
| Only one artifact and a fixed companion panel | [ImmersiveWorkspace.tsx:244](../src/features/shell/immersive/ImmersiveWorkspace.tsx#L244); Story 44 B.6–10 | Cannot arrange tools or watch several sessions. Story 46 provides layout; the later Story 52 adds the Arena. |
| Session navigation ends immersion | Story 44 A.5; [AppShell.tsx:1144](../src/features/shell/AppShell.tsx#L1144) changes the active session/project | The XR lifetime must survive ordinary navigation. Story 45 establishes this boundary. |
| No repository evidence or drawing workflow | Story 44's world-space action set and out-of-scope list | The user must exit to understand or redirect a change. Story 49 owns review and canvas attachments. |
| Automated entry is treated as almost complete | Story 44 verification uses an injected adapter; actual Quest acceptance is pending | Browser tests cannot establish readability, text input, comfort, or sustained work. Story 51 gates the complete release on physical use. |

The surrounding docs already support the broader request: [the vision's Arena](../docs/vision.md#the-arena)
makes attention answerable across sessions and devices; its surfaces section describes spatial
sessions; [the environment notes](../docs/multi-project-session-environment.md#browser-state-implications)
require attention in immersive mode. The gap is the delivery plan between the viewer and that
vision. The earlier model roadmap also mixed a Quest 2 target with a Quest 3 mitigation. The user's
confirmed device for this track is **Quest 3S**; actual acceptance must use that headset.

## Confirmed product decisions — September 5, 2026

- **One complete session first; the multi-session Arena later.** First-release users can create/open
  a session, converse, approve/cancel, and review/annotate results while immersive. Simultaneous
  session views and cross-session Inbox interactions are a second milestone.
- **Movable work panels plus real 3D diagrams.** Text and diffs live on readable panels; supported
  diagrams expose spatial nodes and edges. Both belong to the first usable release, with an honest
  2D fallback for unsupported Mermaid. A seated default is the implementation starting point;
  walking/teleportation is not required.
- **Quest 3S, controllers, and voice initially.** Controllers operate tools and decisions; voice
  creates and corrects text drafts before explicit Send. A physical keyboard is an optional
  convenience. Hand tracking is future work; a virtual keyboard may follow later and is not a
  first-release prerequisite.
- **AR/passthrough remains a future option.** The user explicitly wants to keep it in the product
  direction. The current VR milestones do not require it, and their exclusions do not reject it.

The remaining choices are engineering validation: the transcription path and supported language,
voice correction interaction, readable panel geometry, supported Mermaid subset/parser, and measured
scene budgets. Story 47 must prove microphone/transcription while XR is live on Quest 3S. Do not
promise browser speech support or make an unchosen external service a hidden requirement.

## A work session that defines success

1. After initial pairing/setup, open CodeAI on Quest 3S and choose **Enter VR**, including from an
   empty session. Entry is available at application level; the first release opens the focused
   session or a simple session launcher, without requiring a spatial multi-session Arena.
2. Choose an existing project and machine, start a session, select an agent and mode, dictate and
   correct an instruction, and explicitly send it without another device or a required keyboard.
3. Arrange conversation beside the canvas and a repository diff. Read streaming output, compare
   diagrams, mark a correction, and send the marked artifact back to the agent.
4. Inspect the active session's requested action, allow or deny it with the controller, answer agent
   questions, and cancel a selected run when appropriate, preserving the current draft and view.
5. Explore a diagram's real spatial nodes and edges, switch to its 2D projection to mark a correction,
   and review the resulting revision/diff. Failures remain understandable and recoverable in VR.
6. Exit deliberately to the desktop presentation with work and drafts intact. Re-entry requires a
   fresh gesture; recovering the layout never requires reproducing a previous headset pose.

The second milestone adds surrounding session summaries and the Arena: notice another session's
**Needs you**, inspect/answer it, and return to the original work without leaving immersion.

## Boundaries and ownership

- **The application shell owns XR lifetime.** Extract reusable client state/actions from
  [AppShell.tsx:79](../src/features/shell/AppShell.tsx#L79) as needed. The DOM and immersive surfaces
  consume the same state/actions; do not build a second session store or duplicate polling/run
  orchestration. The persistent [shell layout:4](../src/app/(shell)/layout.tsx#L4) is the existing
  composition anchor. New XR workspace modules belong with the shell or a dedicated feature;
  diagram renderers remain responsible for diagram content.
- **Workspace presentation and canvas rendering are independent.** Entering VR from Flat, Spatial,
  the Arena, or an empty session is valid. A failed canvas renderer must not remove the composer,
  Inbox, or Exit control. Story 44's diagram-owned lifecycle and lazy-load rules are superseded for
  the whole workspace by Story 45, not carried into it.
- **Keep the environment separate from the work tools.** An opaque virtual background belongs to
  the VR presentation, not to session records, panel controls, or diagram semantics. Keep these
  concerns separate so a future AR presentation can reuse the tools. This does not require building
  AR infrastructure during the VR milestones.
- **Core interactions must work in the headset.** No essential control can exist only in an unseen
  DOM element. Choose and validate world-space UI/text input on the reference headset. Optional
  browser overlays and system keyboards need their own capability and failure checks. Voice is
  required for the first release and must be validated independently of those optional paths.
- **Commands keep explicit identity.** Actions address their machine, session, participant, run,
  and permission as applicable. Changing focus during a request cannot retarget it. Continue to
  use the paired home origin and existing authorized routes and server-owned provider policies.
- **Records are shared; layouts are device-owned.** Transcript, artifacts, marks, participants,
  repository bindings, and runs keep their current ownership. Immersive panel layout is disposable,
  versioned device state, separate from desktop cameras. Do not persist XR sessions, live tracking,
  or microphone audio as layout. Named shared views remain with the software-model roadmap.
- **Comfort is functional behavior.** Seated reach, legible text, clear focus, recovery of lost
  panels, no forced locomotion, and stable placement during updates are acceptance requirements.
  Visible scene content has an aggregate resource budget; hidden panels must release or suspend
  their resources. Story 44's per-view budget is a baseline, not an allowance for each new panel.

## Story map

Each linked story carries code anchors, acceptance checkboxes, and verification steps. Story 45
is in progress; its automated shell/navigation implementation is complete and Quest 3S verification
is pending. Story 46 is in progress with movable panels, device layout, and shared read-only diffs;
physical acceptance is pending. Stories 47–52 remain Drafts.
Existing Stories 43–44 remain useful foundations and retain their own status.

| Story | Outcome | Depends on |
|---|---|---|
| [45 — Enter VR across the application](STORY-20260905-application-vr-shell.md) | One immersive shell survives navigation and empty states | 44 implementation, 41 |
| [46 — Arrange a comfortable VR workspace](STORY-20260905-vr-workspace-panels.md) | Readable, movable tools with recoverable device layout | 45 |
| [47 — Converse and steer agents in VR](STORY-20260905-vr-conversation-input.md) | Edit/send text, choose participants and modes, cancel runs | 45, 46 |
| [48 — Operate the active session in VR](STORY-20260905-vr-session-permissions.md) | Start a session and inspect/answer its permissions | 45, 46, 47 |
| [49 — Review and annotate work in VR](STORY-20260905-vr-review-and-annotations.md) | Read diffs, compare artifacts, draw and attach corrections | 46, 47, 48 |
| [50 — Explore diagrams as spatial geometry](STORY-20260905-vr-spatial-diagrams.md) | Supported Mermaid flowcharts become selectable nodes and edges | 46, 49 |
| [51 — Accept the complete headset work loop](STORY-20260905-vr-workspace-acceptance.md) | Quest 3S evidence for controller/voice work, comfort, and performance | 45–50 |
| [52 — Add the Arena and Inbox](STORY-20260905-vr-arena-inbox.md) | Several visible sessions and cross-session attention in VR | 51 |

The first usable release is **45–51**, including real spatial diagrams and voice. **52 is later.**
Story 45 alone remains a foundation; it must not be announced as a fully usable VR workspace.
Story 50 adds real spatial diagrams without waiting for persistent code entities.
Model-native lenses/provenance arrive through reserved roadmap Stories 12–13 and reuse this shell;
they are not prerequisites for chatting in VR.

## Acceptance criteria

- [ ] Supported devices enter immersive VR from the Arena, Flat, Spatial, and empty sessions, with
  no diagram prerequisite; normal in-app navigation preserves one XR session.
- [ ] The complete six-step work session above succeeds on Quest 3S with controllers and voice,
  movable panels, and real 3D diagrams, without a required physical or virtual keyboard.
- [ ] Conversation, canvas, evidence, navigation, and attention can be arranged for seated use;
  all essential actions work through the chosen input baseline and remain readable.
- [ ] No command changes target because focus moved; approval conflicts, revocation, and offline
  executors have explicit outcomes using the existing server authorization boundary.
- [ ] Device layout and desktop return preserve context without persisting tracking or duplicating
  canonical records; content failures leave navigation and Exit usable.
- [x] The user confirms Quest 3S, one complete session first, panels plus real 3D diagrams,
  controllers plus voice, optional physical keyboard, and later hand tracking/virtual keyboard.
- [ ] Story 51 records physical-headset work, comfort, recovery, and resource evidence; applicable
  child stories pass their automated checks. No synthetic test result substitutes for headset use.
- [ ] The later Story 52 delivers and verifies the multi-session Arena and Inbox without regressing
  the accepted first-release work loop; this does not gate the single-session release.

## Future option — AR and passthrough

Retain AR as a candidate follow-up, with timing to be decided after the initial VR work loop is
useful. A first feasibility slice could present the same movable panels and spatial diagrams over
the physical surroundings. Evaluate device/browser support, readability against changing real
backgrounds, input, comfort, and performance before specifying a release.

Room-aware placement, persistent anchors, scene understanding, and occlusion are separate possible
increments. Do not bundle all of them into the first AR experiment or assume that retaining AR
commits to solving them. A dedicated story or epic should follow when that experience is selected.

## Out of scope for the current VR milestones

Native store distribution, AR/passthrough, room scanning, avatars, multi-user collaboration, cloud
execution, new provider capabilities, a terminal or code editor, and a new canonical model. Initial
pairing, certificates, machine attachment, and provider setup remain setup tasks before the VR work
session. Other administrative settings need not be replicated to deliver the daily work loop.
Hand tracking and virtual keyboard are later interaction work. Voice dictation/correction is in the
first release; automatic voice approval, general voice command agents, and spoken responses are not.
AR/passthrough is retained in the future option above; it is deferred from these milestones only.

## How to verify

Use [Story 51's acceptance protocol](STORY-20260905-vr-workspace-acceptance.md#how-to-verify).
Before implementation, validate the engineering choices identified above and update affected
stories. During implementation, tick each child's criteria only against observed evidence. The epic is complete
when the work journey and all epic checkboxes pass; Story 44's existing automated record alone
does not satisfy them.
