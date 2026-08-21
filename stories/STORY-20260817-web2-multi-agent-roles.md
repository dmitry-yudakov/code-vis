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
  are defined in [web2/lib/shared/types.ts](../src/shared/types.ts#L43).
- The v3 atomic registry creates and manages rosters, keeps provider sessions/cursors private, and
  migrates v1/v2 single-provider records in
  [threadRegistry.ts](../src/server/storage/threadRegistry.ts#L95).
- Server-owned role fragments live in
  [agentRoles.ts](../src/server/agents/agentRoles.ts#L1); visible labels/defaults are shared without
  exposing prompt text in [participants.ts](../src/shared/participants.ts#L1).
- Addressing, transcript-author validation, provider health/mode checks, and sequential-run
  rejection happen before execution in
  [POST /api/agent/message](../src/app/api/agent/message/route.ts#L27).
- Per-participant missed context is cursor-aware, JSON-encoded, delivery-aware, and bounded by
  shared/configured limits in
  [transcript.ts](../src/server/conversation/transcript.ts#L1); successful responses advance only
  that participant's cursor in
  [conversationService.ts](../src/server/conversation/conversationService.ts#L28).
- Public-roster reconciliation and retry-idempotent participant creation use
  [participants/route.ts](../src/app/api/threads/%5BthreadId%5D/participants/route.ts#L14), while
  revisioned cross-tab merge and per-thread persistence recovery live in
  [conversationStore.ts](../src/features/conversation/conversationStore.ts#L1).
- The roster, `@participant` selection, main-agent action, add-agent form, and non-sending handoff
  chips are in [ParticipantControls.tsx](../src/features/agents/ParticipantControls.tsx#L15).
- Local v1→v2 authored-message migration and expanded identity-aware export live in
  [conversationStore.ts](../src/features/conversation/conversationStore.ts#L70).

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

## Review findings required before shipping

Peer review of the working tree (Claude reviewer, Codex coder) found defects at the
synchronization and transcript-boundary edges. Each item below names its location; the numbering
is the recommended implementation order.

### Blockers

1. **Publish the answer before persisting its cursor.**
   [conversationService.ts](../src/server/conversation/conversationService.ts#L136) awaits
   `markObserved()` *before* emitting `assistant-message`. A registry write failure — or an
   interruption in that window — discards an already completed model response while the turn is
   reported as failed. Emit or buffer the assistant event first, then persist the cursor
   best-effort. A cursor-write failure may repeat context on the next turn; it must never hide a
   finished answer.

2. **Encode handoff transcripts structurally so history cannot forge framing.**
   [transcript.ts](../src/server/conversation/transcript.ts#L55) renders entries as
   `[displayName · provider/role]` text and
   [prompt.ts](../src/server/conversation/prompt.ts#L53) wraps them between
   `[Missed shared transcript]` and `[End missed shared transcript]`. Nothing escapes those
   markers inside message text, so a prior message can close the quoted region and impersonate
   the contract, another participant, or the current `[User message]` section. This is not a
   privilege escalation — mode policy comes from `resolveAgentPolicy` and CLI flags, not prompt
   text — but it defeats the roster validation the design otherwise invests in, and the realistic
   source is agent output shaped by hostile repository content. Use JSON with escaped strings or
   another unambiguous envelope, and mark historical data as distinct from the current request.

3. **Reconcile the roster with the server.**
   Participant ids are server-owned, but the browser learns them only from the create and
   [add-participant](../src/app/api/threads/%5BthreadId%5D/participants/route.ts#L14) responses;
   there is no GET. Expose a session-free roster read and reconcile it on hydration and on run
   reattachment in [AppShell.tsx](../src/features/shell/AppShell.tsx#L329). Keep
   `session` and `lastObservedMessageId` server-private, exactly as
   [publicParticipants](../src/server/storage/threadRegistry.ts#L114) does today.

4. **Handle cross-tab conflicts instead of last-writer-wins.**
   [conversationStore.ts](../src/features/conversation/conversationStore.ts#L155) rewrites the whole project
   blob on every change and there is no `storage` listener or `BroadcastChannel` anywhere in
   `web2`. Two tabs on one project silently overwrite each other's rosters and messages; the
   project-wide save failure in finding 6 then surfaces later, typically when run reattachment
   appends an event authored by an agent the stale tab never learned about. Add revisions plus a
   `storage`/`BroadcastChannel` path with real conflict handling.

5. **Make participant creation retry-safe.**
   A lost POST response followed by a retry creates a second agent
   ([addAgent](../src/server/storage/threadRegistry.ts#L224) has no idempotency key). Because
   participant removal is out of scope, every duplicate is permanent and consumes part of the
   eight-agent cap.

6. **Isolate persistence failures per thread.**
   [saveProjectThreads](../src/features/conversation/conversationStore.ts#L155) validates the whole project
   as one batch and throws, so a single thread with a dangling `authorId` stops `localStorage`
   writes for every conversation in the project. The save effect in
   [AppShell.tsx](../src/features/shell/AppShell.tsx#L196) catches it into a notice and continues,
   making the loss silent. Report the offending thread by id, preserve its last valid serialized
   copy rather than dropping it, save unaffected threads, and offer a targeted recovery action.

7. **Send a bounded transcript window and remove the 200-message wall.**
   [AppShell.tsx](../src/features/shell/AppShell.tsx#L603) uploads the entire local transcript every
   turn — up to 200 entries × 8 000 characters against a 6 MB body limit shared with diagram
   attachments — and the server keeps at most 24 KB of it. Worse, `MAX_MESSAGES` and the
   [schema cap](../src/shared/protocol.ts#L44) are both 200, so at 201 messages saving *and*
   sending both fail, the latter as an opaque “Message request is invalid.”
   Send only the tail from the addressed agent's anchor onward. The client can derive that anchor
   locally without exposing server state: `markObserved` has exactly one production call site and
   is always called with that participant's own `assistantId`, so the cursor is always the
   agent's last completed assistant message. A stale client derives an *older* anchor and sends a
   longer tail, so the server still finds the cursor — it fails safe. Separately, decide the
   long-conversation product behavior (raise the limit, or an explicit archive/export flow before
   the boundary) rather than failing at it.

### Medium

8. **Preserve delivery status in handoffs.** `transcriptContext` maps every message regardless of
   `status`, so failed and cancelled instructions reach the next agent as ordinary delivered
   messages, and Retry delivers the same text twice — once in the delta, once as the user
   message. Omit definite `not-sent` messages and label cancelled/`possibly-sent` ones.

9. **Truncate for meaning, not for position.** Both the client `.slice(-8_000)` and the server's
   per-message clamp keep the *end* of a message, which in this product is usually a trailing
   Mermaid block, dropping the prose conclusion a reviewer actually needs. Use head-plus-tail with
   an explicit omission marker.

10. **Centralize the limits.** Fixed wire limits belong in shared constants; the server's prompt
    byte budget can stay configurable. Today `DEFAULT_MAX_MESSAGES`/`DEFAULT_MAX_BYTES` are
    hardcoded in [transcript.ts](../src/server/conversation/transcript.ts#L3) while every comparable
    bound lives in `Web2Config`, and the message route never passes overrides.

### Low and release follow-ups

11. **UX and documentation.** Retry and quick handoff call `setComposer(text)` and silently
    discard a half-written draft; `selectAgent` overwrites an explicit mode choice with the new
    recipient's preset every time the addressee changes (a role preset should initialize an agent,
    not keep overriding the user); the add-agent `<details>` menu has no Escape or outside-click
    close; and new conversations now default to **Plan** rather than Ask because the initial
    participant uses the `coder` preset — intentional, migrated threads correctly keep Ask, but it
    needs a release note.

### Reviewed and rejected — do not implement

Three review claims were checked against the code and did not hold. They are recorded so they are
not re-litigated during implementation.

- **“Byte truncation overflows the bound in production.”** The oversized-single-message branch in
  [transcript.ts](../src/server/conversation/transcript.ts#L46) is unreachable through the validated
  HTTP path: `z.string().max(8_000)` counts UTF-16 code units, whose worst UTF-8 expansion is 3
  bytes per unit, so a validated message is at most 24 000 bytes — exactly `DEFAULT_MAX_BYTES`,
  and the branch guards on `>`. The unit mismatch (`Buffer.byteLength` measured, `String.slice`
  enforced) is still real for callers passing custom limits, which the tests already do. Fix it as
  latent correctness with a multibyte test, not as a production defect, and note the worst-case
  ratio is 3×, not 4×.
- **“`role` on thread creation is dead surface.”**
  [threads/route.ts](../src/app/api/threads/route.ts#L15) passes `parsed.data.role` into
  `ThreadRegistry.create()`. The path is fully wired; only the browser omits it. The real gap is
  that no test exercises a non-default role on create — see the coverage list below.
- **“Approval cards do not identify the requesting agent.”**
  [PermissionCard.tsx](../src/features/agents/PermissionCard.tsx#L14) renders the requesting
  participant's display name and provider next to “Approval required”, wired from the roster in
  [ConversationDrawer.tsx](../src/features/conversation/ConversationDrawer.tsx#L92). Cards do not show the
  originating transcript author or rationale, but they do identify the requesting agent process,
  so the corresponding acceptance criterion stays checked.

## Follow-up round: cross-tab convergence

Peer review of the implemented fixes (Claude coder, Codex reviewer) accepted findings 1–11 and
reopened finding 4. Finding 12 supersedes it and is the only blocker carried forward from that
round.

12. **Serialize the `localStorage` read/merge/write, and stop gating `storage` events on the
    revision counter.**
    [saveProjectThreads](../src/features/conversation/conversationStore.ts#L285) reads the stored snapshot,
    merges, and writes `stored.revision + 1` with no compare-and-swap — and `localStorage` offers
    none. Two tabs that both read revision 5 both write revision 6, so the loser's write is simply
    overwritten. The guard in [AppShell.tsx](../src/features/shell/AppShell.tsx#L243) then rejects the
    survivor's `storage` event because `6 <= 6`, even though the two revision 6 payloads hold
    different content. The losing tab's messages survive only in its own memory, and are gone for
    good if that tab closes before it saves again.

    The current test saves tab A and then tab B, so B's save reads A's already-persisted write
    ([conversationStore.test.ts](../test/conversationStore.test.ts#L151)). That demonstrates
    sequential merging, not concurrent conflict handling, which is why finding 4 read as closed.

    Re-reading immediately after writing does **not** close this: both writers can verify before
    the competing write lands, so each confirms its own revision and neither observes the loss.
    Durable correctness needs the critical section serialized. Two changes, in this order.

    **12a. Hold a cross-tab lock across the whole critical section.** Web Locks are same-origin and
    cross-tab, so wrapping the existing synchronous save is sufficient and leaves the merge logic
    untouched. Add to `conversationStore.ts`, and have
    [the save effect](../src/features/shell/AppShell.tsx#L223) await it instead of calling
    `saveProjectThreads` directly:

    ```ts
    export async function commitProjectThreads(
      projectId: string,
      input: ChatThread[],
      storage: Storage = localStorage,
    ): Promise<SaveProjectThreadsResult> {
      const locks = crossTabLocks();
      if (!locks) return saveProjectThreads(projectId, input, storage);
      return locks.request(
        projectConversationLockName(projectId),
        async () => saveProjectThreads(projectId, input, storage),
      );
    }
    ```

    `saveProjectThreads` stays exported as the synchronous critical section, for tests and for the
    no-Web-Locks fallback. The save effect becomes async, so applying its result to state needs a
    cancellation flag — but the write itself must still be allowed to complete, because the merge
    re-reads storage inside the lock and an additive merge cannot lose the newer turn.

    **12b. Merge `storage` events on content, not on the counter.** Delete the
    `snapshot.revision <= storageRevision.current` guard, and the `storageRevision` ref with it,
    and merge on every event. `mergeProjectThreads` already returns the same array reference when
    nothing changed, so unconditional merging is idempotent and cannot loop. This is the live-tab
    recovery net for any race the lock does not cover.

    Keep `revision` in the stored payload — it remains useful as bookkeeping and for debugging —
    but document at its definition that it is not a conflict token, so the guard is not
    reintroduced later.

### Verification for finding 12

- A test that reproduces a real interleaving rather than a sequential save: capture the serialized
  payload both tabs read, let tab A save, rewind `localStorage` to that captured payload, then let
  tab B save. Assert both saves return the *same* revision and that A's message is absent from
  storage — that assertion is the executable statement of why the counter cannot gate the merge.
  Then assert that merging current storage into A's in-memory threads and re-saving restores the
  union.
- A test that `commitProjectThreads` requests a project-scoped lock and that serialized commits
  produce consecutive revisions, plus one that it still commits when `navigator.locks` is absent.
- Record what is *not* proven: browser-level mutual exclusion cannot be reproduced in-process. The
  unit tests cover the wiring and the recovery path; the lock's guarantee comes from the platform.

**Implemented 2026-08-20:** commits now hold a project-scoped Web Lock across the complete
read/merge/write critical section, with the documented synchronous fallback. Storage events merge
by content regardless of revision. The regression suite reproduces the same-revision overwrite and
recovery path, verifies serialized consecutive revisions, and covers the no-Web-Locks fallback.

### Residual risk after finding 12

Web Locks are unavailable in Safari below 15.4 and under SSR. There the fallback is the
unserialized synchronous save, and 12b is the only protection — which recovers only while both
tabs are open. Moving the project blob into an IndexedDB transaction would close that too; it is a
larger change than this follow-up and is deliberately not bundled with it.

### Also observed in the same review — not triaged into this follow-up

Recorded so they are not rediscovered. None of them block finding 12.

- `loadProjectSnapshot` throws on the first invalid thread, so hydration empties the workspace, the
  save effect then silently drops that thread from storage without naming it, and the notice's "the
  in-memory workspace is unchanged" is inaccurate in both directions. Finding 6's per-thread
  isolation exists on the save path but not on the load path.
- At the 2 000-message boundary the only offered recovery, "Restore last saved copy", discards
  every message since the boundary.
- Each save re-parses and re-validates the whole project, including Mermaid policy checks per
  artifact, on every thread mutation — now against a 10× larger ceiling, and 20× in a row during
  hydration as each roster reconciliation lands.
- `JSON.stringify` does not escape U+2028/U+2029, so the one-line envelope from finding 2 can still
  be made to render a line break.
- Only `failures[0]` is surfaced, and the notice is not cleared when the failure resolves.
- `participants/route.ts` selects its 404 by `message.includes('Unknown project-bound thread')`.
- The additive merge has no tombstones, so unpinning cannot be represented — latent while there is
  no delete UI.

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
  author-labeled delta plus its identity/role preamble. The delta is structurally encoded so
  historical text cannot forge transcript delimiters, participant labels, or the current-user
  section; it carries delivery status; and the browser sends only a bounded window rather than the
  whole local transcript. *(Reopened by review findings 2, 7, and 8.)*
- [x] Participant transcript cursors advance only on accepted delivery and recover safely after
  cancellation, missing sessions, reload, or ambiguous delivery — and a cursor-write failure
  repeats context rather than hiding a completed answer. *(Reopened by review finding 1.)*
- [x] Orchestrator, coder, reviewer, tester, and custom role presets are visible, server-owned,
  and have explicit default modes without weakening provider mode policies.
- [x] Roster-aware quick-action chips prefill an editable addressed turn and never send it
  automatically.
- [x] The browser reconciles the public roster from the server on hydration and on run
  reattachment, without exposing provider session ids or transcript cursors.
- [x] Two tabs on the same project converge: adding agents and messages in one tab does not
  silently erase the other's roster or messages, including when both tabs save concurrently.
  Revisions remain bookkeeping rather than compare-and-swap tokens; finding 12 serializes commits
  with Web Locks and merges storage events by content.
- [x] Participant creation is retry-safe; a lost response followed by a retry reconciles to the
  original participant instead of adding a permanent duplicate against the eight-agent cap.
- [x] One invalid thread cannot stop unrelated conversations in the same project from persisting;
  the affected thread is identified and its last valid copy preserved.
- [x] Crossing the stored-message limit produces intentional product behavior (archive, export, or
  a raised bound) rather than a silent save failure plus an opaque request rejection.
- [ ] Claude and Codex can alternate sequential turns over the same spec and implementation;
  each provider continues its own private context.
- [x] Permission cards identify the requesting agent/provider and can affect only that agent's
  active run.
- [x] Offline tests cover migration, author attribution, addressing validation, delta assembly,
  independent provider sessions, cursor recovery, export, and permission routing — plus the
  regression coverage listed under “How to verify”. *(132 tests passed on 2026-08-20.)*
- [x] `cd web2 && yarn test`, `yarn lint`, and `yarn build` pass. *(Verified 2026-08-20.)*
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
[web2/e2e/canvas.spec.ts](../e2e/canvas.spec.ts#L123): separate Claude coder/reviewer
sessions, quick-action prefill, attribution, and changing main. The real Claude↔Codex artifact and
permission-card scenario remains the release-closing check.

### Regression scenarios for the review findings

Each scenario maps to a numbered finding above and is covered by the offline suite.

- **(1)** A failing cursor write still leaves the completed assistant answer visible and
  replayable; the turn is not reported as failed.
- **(2)** Transcript text containing `[You]`, `[User message]`, `[Cartograph conversation
  contract v3]`, and the closing transcript marker stays historical data and cannot open a new
  current-user section.
- **(3)** Hydration and live-run reattachment reconcile the public roster without exposing
  provider session ids or private cursors.
- **(4/12)** Two tabs adding agents and messages converge without last-writer data loss —
  including the concurrent case, where both tabs read the same revision before either writes.
- **(5)** Retrying participant creation after a lost response returns or reconciles the original
  participant instead of adding a duplicate.
- **(6)** One malformed thread does not prevent another thread in the same project from
  persisting, and the failure names the affected thread.
- **(7)** A conversation past the stored-message limit follows the documented policy without an
  opaque 400 or a project-wide save failure.
- **(8)** Failed, cancelled, and `possibly-sent` instructions are omitted or clearly labelled in a
  handoff delta.
- **(9)** A long assistant message ending in a large Mermaid block retains its prose conclusion
  after truncation.

Offline coverage added with the findings: the participants route (409 on
an unhealthy provider, unknown-thread status and body, 201 shape); the message route rejecting a
participant id belonging to a different thread; display-name suffixing (`Claude Reviewer 2`) and
the eight-agent cap; `markSessionStarted` guards for a wrong provider or a mismatched existing
session id; v3 `validThread` rejecting a dangling `primaryAgentId`, duplicate display names, or
two humans; a non-default `role` passed to thread creation; and multibyte truncation in
`buildTranscriptDelta` under custom byte limits.

Close out with `cd web2 && yarn test`, `yarn lint`, and `yarn build`, then the real Claude↔Codex
handoff scenario above.

---
