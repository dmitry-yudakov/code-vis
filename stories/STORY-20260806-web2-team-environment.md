# Story 21 — Team environment: multiple humans in the conversation

**Status:** Draft (sequencing-level — refine to a full spec when picked up) · **Type:** Full-stack ·
**Depends on:** [Story 27](STORY-20260826-session-keyed-host-bound-runs.md) ·
**Epic:** [web2 operational collaboration](EPIC-20260806-web2-operational-collaboration.md)

---

## Motivation

Once a conversation can hold several agents with roles, the remaining participant type is
other people: a colleague joins the thread, sees the spec and diagrams evolve, addresses the
reviewer agent themselves, or approves an agent's permission request while the thread owner is
away. Story 23's participant model already treats humans as participants without sessions —
this story makes that real beyond the single desktop user.

This is deliberately last: it is the point where almost every local-first simplification
expires at once, and none of it should leak complexity into Stories 19–20 or 23 earlier than
needed.

## What changes at this boundary

1. **Server-owned conversations become shared live state.** Story 26 moves threads, messages,
   artifacts, and annotations out of browser `localStorage` into host-owned durable storage. This
   story adds the authenticated sync/streaming protocol for multiple concurrent viewers: presence,
   unread state, live turn status, and conflict policy for human edits.
2. **Identity and authorization.** Named human participants, sign-in, per-thread membership,
   and explicit rights: who may address which agent, who may send agent-mode turns, who may
   answer permission cards (Story 19's approval flow becomes multi-party).
3. **Billing model shifts.** The bring-your-own-auth invariant is single-user by nature: one
   desktop login/environment, one person. A team deployment moves to provider API keys or
   BYOK per user — decided here, not before, and kept out of Stories 19–20 by design.
4. **Sandboxing becomes mandatory.** Story 18's stance — capability restriction on a trusted
   desktop, no OS sandbox — does not survive remote or multi-user use. Agent processes need
   OS-level isolation (and likely worktree isolation lands here at the latest) before any
   non-localhost exposure.
5. **Concurrency.** "One global process" and "one turn per thread" get revisited: multiple
   threads active across a team, still sequential within a thread.

## Open questions for the full spec

- Deployment shape: shared always-on host vs. one member's machine with invited access.
- Auth mechanism appropriate for a small team (and whether it reuses an existing IdP).
- Hosted storage backend and deployment topology for the server-owned conversation contract.
- Whether agent credentials are per-deployment (service keys) or per-member (BYOK).
- Moderation of concurrent input: typing/turn arbitration when two humans address agents at
  once.

## Out of scope

- Public/multi-tenant SaaS hosting; the target is a small trusted team.
- Anything already owned by Stories 19, 20, and 23 (modes, permissions, providers, roles).
- Real-time co-editing of drawings (single-annotator-at-a-time is acceptable first).

## How to verify (target scenario)

Two people in the same thread from different machines: both see streamed turns and diagram
updates live; the second person addresses the reviewer agent and approves one permission
card; the transcript shows correct human and agent attribution; a signed-out visitor gets
nothing.

---
