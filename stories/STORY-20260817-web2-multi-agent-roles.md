# Story 23 — Add multi-agent conversation roles

**Status:** Draft · **Type:** Full-stack ·
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

## Current behavior (where the code is)

- Story 20 makes provider session identity independent from Cartograph thread identity, but a
  thread still owns exactly one `ProviderSessionRef`:
  [web2/lib/shared/types.ts](../web2/lib/shared/types.ts#L11).
- Messages are still binary `role: 'user' | 'assistant'` records without stable author ids:
  [web2/lib/shared/types.ts](../web2/lib/shared/types.ts#L113).
- A single run per thread is already enforced by
  [POST /api/agent/message](../web2/app/api/agent/message/route.ts#L41) and
  [runRegistry.ts](../web2/lib/server/runRegistry.ts#L16).
- The browser transcript remains in localStorage:
  [conversationStore.ts](../web2/lib/client/conversationStore.ts#L67).
- Shared canvases and their exported source already act as conversation artifacts:
  [web2/lib/shared/types.ts](../web2/lib/shared/types.ts#L88).

## Desired behavior

### 1. Participants and authored messages

Replace the thread's single agent reference with `participants[]`. A human participant has an
identity but no provider session. Each agent participant has a stable id, display name,
provider, role, mode policy, private provider session, and a cursor recording the last
transcript message it observed.

Every message has `authorId`; the presentation role remains a derived convenience, not the
identity. Existing conversations migrate to one local user plus one Claude participant, with
old user/assistant messages attributed deterministically.

```ts
type Participant =
  | { id: string; kind: 'human'; displayName: string }
  | {
      id: string;
      kind: 'agent';
      displayName: string;
      provider: AgentProvider;
      role: 'editor' | 'reviewer' | 'custom';
      defaultMode: AgentMode;
      sessionId?: string;
      lastObservedMessageId?: string;
    };

interface ChatMessage {
  authorId: string;
  // existing message-specific fields
}
```

### 2. Address one agent per turn

The user chooses a participant with an `@name` picker before sending. The server validates that
the participant belongs to the thread, is an agent, its provider/mode is healthy, and no turn
is active. Exactly one agent runs per turn; parallel agents are not introduced.

The addressed adapter resumes only that participant's private provider session. It receives a
bounded delta of transcript messages since its last successful turn, labeled with stable author
names, plus a standing identity preamble. The cursor advances only after the provider accepts
the turn; ambiguous delivery preserves the cursor and uses existing recovery UX.

### 3. Roles are transparent prompt presets

`editor`, `reviewer`, and `custom` are named prompt fragments with visible default modes.
Reviewer defaults to Ask and reports findings against the shared artifact; editor defaults to
Plan or Agent according to user selection. The UI shows and exports the role and provider, and
the server owns the actual prompt fragments.

Roles do not create autonomous behavior. The user explicitly chooses every next participant
and mode.

### 4. Iterate through shared artifacts

The spec and implementation live in project files, while the transcript coordinates work.
Reviewers read the artifact/diff and post findings; editors update it through Story 19/20's
permission flow. Canvases remain shared message attachments with their existing evidence and
validation contract.

## Acceptance criteria

- [ ] Threads contain stable human/agent participants and provider sessions are private to one
  agent participant.
- [ ] Existing single-provider conversations migrate without losing messages, canvases,
  provider session continuity, or local user identity.
- [ ] Every message and export entry has an unambiguous `authorId`, display name, participant
  kind, and provider/role where applicable.
- [ ] The composer addresses exactly one healthy agent; forged/unknown participant ids,
  unsupported modes, and concurrent turns are rejected server-side.
- [ ] The addressed agent resumes only its own provider session and receives a bounded,
  author-labeled delta plus its identity/role preamble.
- [ ] Participant transcript cursors advance only on accepted delivery and recover safely after
  cancellation, missing sessions, reload, or ambiguous delivery.
- [ ] Editor, reviewer, and custom role presets are visible, server-owned, and have explicit
  default modes without weakening provider mode policies.
- [ ] Claude and Codex can alternate sequential turns over the same spec and implementation;
  each provider continues its own private context.
- [ ] Permission cards identify the requesting agent/provider and can affect only that agent's
  active run.
- [ ] Offline tests cover migration, author attribution, addressing validation, delta assembly,
  independent provider sessions, cursor recovery, export, and permission routing.
- [ ] `cd web2 && yarn test`, `yarn lint`, and `yarn build` pass.
- [ ] The target scenario below is recorded end-to-end with correct attribution.

## Out of scope

- Multiple humans, identity, presence, and server-side shared transcripts —
  [Story 21](STORY-20260806-web2-team-environment.md).
- Autonomous multi-round relay or agent-to-agent loops without a user turn.
- Parallel agent runs; turns stay sequential.
- Provider API keys / BYOK billing.
- Native provider-specific review modes; reviewers use the common conversation contract first.

## How to verify

On a disposable project: user sketch → Claude editor drafts a spec file → Codex reviewer marks
problems → Claude editor revises → user approves → either editor implements in Agent mode →
the other provider reviews the diff → editor fixes. Reload between two turns. Confirm each
provider resumes its own context, permission cards identify the right participant, and thread
export preserves every author/provider/role.

---
