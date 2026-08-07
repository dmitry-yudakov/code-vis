# Story 20 — Multi-agent conversation with roles

**Status:** Draft (sequencing-level — refine to a full spec when picked up) · **Type:** Full-stack ·
**Depends on:** [Story 19](STORY-20260806-web2-conversation-modes.md) ·
**Epic:** [web2 operational collaboration](EPIC-20260806-web2-operational-collaboration.md)

---

## Motivation

One conversation, several agents, iterating on shared work:

> One agent generates a spec based on the user drawing, the user asks another agent to review
> it and mark the problems, then asks the first agent to review the second agent's notes and
> make changes — until the spec is finalized. Then one of the agents implements it, the other
> reviews, and the implementation is improved with a couple of peer reviews from agents.

Cross-vendor peer review is a real quality mechanism, not a demo: a different model family
reviewing (Claude implements / Codex reviews, and vice versa) is far less prone to the
self-agreement bias of a model reviewing its own output. It also lets the user run each stage
on their own existing subscription (Claude Pro/Max via `claude`, ChatGPT via `codex`) — no
platform API cost, consistent with the epic's billing invariant.

## Current behavior (where the code is)

- Thread **is** a Claude session: [web2/lib/server/threadRegistry.ts](../web2/lib/server/threadRegistry.ts#L81)
  (~line 81) asserts `threadId === sessionId`.
- Messages are two-party: `role: 'user' | 'assistant'` in
  [web2/lib/shared/types.ts](../web2/lib/shared/types.ts#L88).
- Everything Claude-specific already sits behind a provider-neutral seam
  (`AgentProcessRun`/`AgentProcessEvent`/`AgentProcessResult`,
  [web2/lib/shared/types.ts](../web2/lib/shared/types.ts#L188)) — `buildClaudeArgs` plus the
  stream parser are effectively the Claude adapter.

## Desired behavior (sketch)

1. **Conversation ≠ session.** The web2 thread becomes the canonical transcript. Each agent
   participant owns a private provider session (Claude session id, Codex rollout); humans are
   participants without sessions. Turn flow: when an agent is addressed, resume *its* session
   and feed it only the delta — messages added since its last turn, each labeled by author —
   plus a standing identity preamble ("You are *claude-architect* in a conversation with
   *codex-reviewer* and the user"). Attribution and self-identity are mandatory; models in
   shared transcripts otherwise confuse who said what.
2. **Provider adapter.** Formalize the runner seam into an adapter interface (build args,
   parse events, preflight, capability flags such as `supportsInteractivePermissions`). Add a
   Codex adapter: `codex exec` headless with JSONL events, `--sandbox read-only` for Ask/Plan
   and `workspace-write` for building; auth inherited from the user's own `codex login` /
   environment, per the epic's bring-your-own-auth invariant. Codex CLI flags churn —
   re-verify at pickup.
3. **Participants and roles.** `participants[]` on the thread (provider, display name, role,
   session ref, mode policy); `author` on messages replaces the binary role field. Roles —
   *editor*, *reviewer*, *custom* — are named persona presets: a system-prompt fragment plus a
   default mode (reviewer defaults to Ask, editor may use Plan/Agent). Addressing via `@name`
   or a reply-to picker; exactly one agent speaks per turn (the existing single-process
   constraint survives).
4. **Shared artifacts, not chat prose.** The thing being iterated (spec, then implementation)
   lives as a file the agents read and edit; the conversation is the coordination channel —
   the same pattern the Mermaid canvas already established. Reviewer turns read it and post
   findings; author turns edit it under Story 19's scoped permissions.
5. **Manual relay first.** The user drives the ping-pong by addressing each turn. Automated
   relay ("alternate until both approve") needs a structured approval verdict in agent output
   to terminate and is a stretch/follow-up, not v1.

## Open questions for the full spec

- Codex headless approvals: `codex exec` is CI-oriented and non-interactive; granular
  permission prompts likely require Codex's app-server/JSON-RPC protocol. Building with Codex
  may ship as sandboxed `workspace-write` without per-action prompts, or Agent-equivalent mode
  stays Claude-only initially.
- Session mapping and recovery per provider (`codex exec resume` semantics, missing-session
  behavior parity with Story 18's recovery UX).
- Context divergence between participants' private sessions over long threads; whether/when a
  recap turn is needed.
- Transcript storage: multi-participant threads strain the localStorage model; server-side
  transcript storage may pull forward from Story 21.
- Migration of existing single-participant threads.

## Out of scope

- Multiple humans, identity, presence — [Story 21](STORY-20260806-web2-team-environment.md).
- Autonomous multi-round orchestration without user turns (beyond the stretch relay above).
- Parallel agent runs; turns stay sequential.
- Provider API keys / BYOK billing.

## How to verify (target scenario)

The motivating loop end-to-end on a disposable project: user drawing → *editor* drafts a spec
file → *reviewer* (other provider) marks problems → editor revises → user approves → editor
implements in agent mode → reviewer reviews the diff → editor fixes. Thread export shows
correctly attributed authorship throughout; each provider bills its own subscription.

---
