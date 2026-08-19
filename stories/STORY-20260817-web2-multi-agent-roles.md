# Story 23 — Add multi-agent conversation roles

**Status:** In progress · **Type:** Full-stack ·
**Depends on:** [Story 20](STORY-20260817-web2-codex-provider.md) ·
**Epic:** [web2 operational collaboration](EPIC-20260806-web2-operational-collaboration.md)

---

## Motivation

One conversation should support several agents iterating on shared work:

> One agent generates a spec based on the user drawing, the user asks another agent to review
> it and mark the problems, then asks the first agent to review the second agent's notes and
> make changes — until the spec is finalized. Then one of the agents implements it, the other
> reviews, and the implementation is improved with a couple of peer reviews from agents.

Cross-vendor peer review is the target: Claude implements and Codex reviews, or vice versa,
using each local CLI's existing subscription. Story 20 first proves both providers against the
same modes, sessions, approvals, and canvas contract; this story composes those adapters into
one correctly attributed conversation.

The first release remains deliberately user-orchestrated. The user creates a conversation with
one main agent, may add more agents from prepared role presets, explicitly addresses one agent
per turn, and may change which participant is the default main agent. Quick actions make common
handoffs cheap, but only prefill a prompt and recipient; they never start an agent-to-agent loop.

## Implementation (where the code is)

- Public participants, private server agent records, authored messages, and the main-agent pointer
  are defined in [web2/lib/shared/types.ts](../web2/lib/shared/types.ts#L43).
- The v3 atomic registry creates and manages rosters, keeps provider sessions/cursors private, and
  migrates v1/v2 single-provider records in
  [threadRegistry.ts](../web2/lib/server/threadRegistry.ts#L95).
- Server-owned role fragments live in
  [agentRoles.ts](../web2/lib/server/agentRoles.ts#L1); visible labels/defaults are shared without
  exposing prompt text in [participants.ts](../web2/lib/shared/participants.ts#L1).
- Addressing, transcript-author validation, provider health/mode checks, and sequential-run
  rejection happen before execution in
  [POST /api/agent/message](../web2/app/api/agent/message/route.ts#L27).
- Per-participant missed context is cursor-aware and bounded to 40 messages/24 KB in
  [transcript.ts](../web2/lib/conversation/transcript.ts#L1); successful responses advance only
  that participant's cursor in
  [conversationService.ts](../web2/lib/conversation/conversationService.ts#L28).
- The roster, `@participant` selection, main-agent action, add-agent form, and non-sending handoff
  chips are in [ParticipantControls.tsx](../web2/components/ParticipantControls.tsx#L15).
- Local v1→v2 authored-message migration and expanded identity-aware export live in
  [conversationStore.ts](../web2/lib/client/conversationStore.ts#L70).

## Desired behavior

### 1. Create and manage a participant roster

Creating a conversation chooses its first agent provider. That participant is the initial main
agent and defaults to the `coder` preset. From the conversation drawer the user can add another
healthy provider as an orchestrator, coder, reviewer, tester, or custom agent, select any agent
as the next recipient, and make any agent the main agent. “Main” means only “default recipient”;
it is not a capability or role and changing it never moves or shares provider sessions.

Participant display names are unique within a thread and server-normalized. The first provider
uses its provider label (`Claude` or `Codex`); repeated providers gain their role or a numeric
suffix. The server owns participant ids and membership. Removing participants and editing custom
prompt text are deferred until their session/history semantics are designed.

### 2. Participants and authored messages

Replace the thread's single agent reference with `participants[]`. A human participant has an
identity but no provider session. Each agent participant has a stable id, display name,
provider, role, mode policy, private provider session, and a cursor recording the last
transcript message it observed. `primaryAgentId` names the default addressee independently from
the participant's role.

Every message has `authorId`; the presentation role remains a derived convenience, not the
identity. Existing conversations migrate to one local user plus one agent participant, with old
user/assistant messages attributed deterministically and the existing provider session retained.

```ts
type HumanParticipant = { id: string; kind: 'human'; displayName: string };
type AgentParticipant = {
  id: string;
  kind: 'agent';
  displayName: string;
  provider: AgentProvider;
  role: 'orchestrator' | 'coder' | 'reviewer' | 'tester' | 'custom';
  defaultMode: AgentMode;
};
type Participant = HumanParticipant | AgentParticipant;

type ServerAgentParticipant = AgentParticipant & {
  session: ProviderSessionRef; // stripped from browser/export rosters
  lastObservedMessageId?: string;
};

interface ChatMessage {
  authorId: string;
  // existing message-specific fields
}
```

### 3. Address one agent per turn

The composer always exposes an `@name` recipient picker. The explicit participant id, not
parsing free-form prose, is the canonical address. The server validates that the participant
belongs to the thread, is an agent, its provider/mode is healthy, and no turn is active. Exactly
one agent runs per turn; parallel agents are not introduced.

The addressed adapter resumes only that participant's private provider session. The browser
sends bounded local transcript records for handoff; the server validates authors against its
roster, locates the participant's cursor, applies its own count/byte bound, and renders a labeled
delta plus a standing identity preamble. The cursor advances through the successfully produced
assistant message only after a complete turn. Cancellation, failure, or ambiguous delivery
preserves it, so a retry may repeat context rather than omit it.

### 4. Roles are transparent prompt presets

`orchestrator`, `coder`, `reviewer`, `tester`, and `custom` are named server-owned prompt
fragments with visible default modes. Orchestrator coordinates and defaults to Plan; coder
implements and defaults to Plan; reviewer reports prioritized findings and defaults to Ask;
tester verifies claims and defaults to Ask; custom is a neutral Ask preset until editable custom
instructions get their own story. A role never weakens the selected provider mode's policy.

Roles do not create autonomous behavior. The user explicitly chooses every next participant
and mode.

### 5. Quick handoffs without automation

Small action chips above the composer cover the common manual loop. They are roster-aware and
prefill both recipient and editable text, for example `@Reviewer Review the latest proposal for
correctness and missing risks` or `@Coder Address the review findings above`. A chip never sends,
changes files, or causes a second turn. The ordinary recipient picker remains available when no
preset fits.

### 6. Iterate through shared artifacts

The spec and implementation live in project files, while the transcript coordinates work.
Reviewers read the artifact/diff and post findings; coders update it through Story 19/20's
permission flow. Canvases remain shared message attachments with their existing evidence and
validation contract.

## Acceptance criteria

- [x] Threads contain stable human/agent participants and provider sessions are private to one
  agent participant.
- [x] A new conversation creates one human plus one main coder; the user can add healthy agents
  with prepared roles, explicitly select the next recipient, and change the main agent without
  moving sessions or changing roles.
- [x] Existing single-provider conversations migrate without losing messages, canvases,
  provider session continuity, or local user identity.
- [x] Every message and export entry has an unambiguous `authorId`, display name, participant
  kind, and provider/role where applicable.
- [x] The composer addresses exactly one healthy agent; forged/unknown participant ids,
  unsupported modes, and concurrent turns are rejected server-side.
- [x] The addressed agent resumes only its own provider session and receives a bounded,
  author-labeled delta plus its identity/role preamble.
- [x] Participant transcript cursors advance only on accepted delivery and recover safely after
  cancellation, missing sessions, reload, or ambiguous delivery.
- [x] Orchestrator, coder, reviewer, tester, and custom role presets are visible, server-owned,
  and have explicit default modes without weakening provider mode policies.
- [x] Roster-aware quick-action chips prefill an editable addressed turn and never send it
  automatically.
- [ ] Claude and Codex can alternate sequential turns over the same spec and implementation;
  each provider continues its own private context.
- [x] Permission cards identify the requesting agent/provider and can affect only that agent's
  active run.
- [x] Offline tests cover migration, author attribution, addressing validation, delta assembly,
  independent provider sessions, cursor recovery, export, and permission routing.
- [x] `cd web2 && yarn test`, `yarn lint`, and `yarn build` pass.
- [ ] The target scenario below is recorded end-to-end with correct attribution.

## Out of scope

- Multiple humans, identity, presence, and server-side shared transcripts —
  [Story 21](STORY-20260806-web2-team-environment.md).
- Autonomous multi-round relay or agent-to-agent loops without a user turn.
- Parallel agent runs; turns stay sequential.
- Removing participants, transferring provider sessions, or editing custom role prompt text.
- Provider API keys / BYOK billing.
- Native provider-specific review modes; reviewers use the common conversation contract first.

## How to verify

On a disposable project: create with Claude as the main coder → add Codex reviewer → user sketch
→ Claude drafts a spec file → use a quick handoff to ask Codex to mark problems → make Codex main
and then explicitly address Claude to revise → user approves → either coder implements in Agent mode
→ the other provider reviews the diff → coder fixes. Reload between two turns. Confirm each
provider resumes its own context, permission cards identify the right participant, and thread
export preserves every author/provider/role.

Automated coverage records the same-provider manual handoff slice in
[web2/e2e/canvas.spec.ts](../web2/e2e/canvas.spec.ts#L123): separate Claude coder/reviewer
sessions, quick-action prefill, attribution, and changing main. The real Claude↔Codex artifact and
permission-card scenario remains the release-closing check.

---
