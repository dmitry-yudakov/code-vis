# CodeAI experiment log

Manual real-agent evidence for the root application. Entries recorded before August 21, 2026 name
the product **Cartograph** and its package `web2`; that prose is left as it was written. Variables
named `CODEAI_WEB2_*` in those entries are now spelled `CODEAI_*` and the old names still work.

## Story 20 — Codex provider smoke (2026-08-18)

**Outcome:** Passed for the shipped Ask/Plan surface. Ask, Plan, post-Plan cross-restart resume, and
the canvas local-image/Mermaid path passed. Codex Agent was not advertised and was not tested
because its separate approval-parity release gate has not passed.

- Environment: Linux, Codex CLI upgraded from `0.137.0` to `0.147.0`, trusted Cartograph
  repository, production Next.js build.
- Model-free readiness: passed. Existing authentication was reused; Ask/Plan were exposed; Agent
  was withheld. An inherited `context_7` MCP entry was discovered, disabled by name in the
  ephemeral/thread config, and verified thread-scoped with no server info, tools, resources, or
  templates before any prompt was sent.
- Compatibility finding: CLI `0.137.0` reached a native thread but could not decode the current
  `gpt-5.6-sol` model metadata. An explicit `gpt-5.5` Ask resumed that thread and completed with
  `CODEX_ASK_OK` in 17.1 seconds. After upgrading, CLI `0.147.0` used the default model successfully.
- Plan: CLI `0.147.0` resumed the native thread created by `0.137.0`, streamed reasoning and text,
  produced both Cartograph plan delimiters, and completed with `planProposed: true` in 22.7 seconds.
- Post-Plan resume: after a full production-server restart, Ask resumed the same native thread,
  streamed five text deltas, and completed with exactly `CODEX_RESUME_OK` in 16.6 seconds.
- Canvas path: a bounded composite PNG plus Mermaid/vector manifest reached Codex as one local-image
  turn. Codex acknowledged the canvas, returned a valid `A --> B` Mermaid flowchart, and Cartograph
  emitted a `ready` diagram artifact whose `derivedFromDiagramIds` contained the attached canvas.
- Repository safety: every real turn used the `readOnly` sandbox with network disabled and was
  explicitly told not to use tools. No Agent turn or write approval was attempted.
- Remaining optional evidence: Codex Agent's real approval matrix. Until it passes,
  `CODEAI_CODEX_AGENT` (formerly `CODEAI_WEB2_CODEX_AGENT`) remains unset and the product exposes
  only Ask and Plan.

**Status:** Not yet run with a real authenticated Claude Code session.

Automated tests use `test/fixtures/fake-claude.mjs`; they are implementation verification and do not
count as product-signal evidence. Record real runs below before Story 18 can be marked Shipped.

## Environment

- Date / tester:
- Claude Code version:
- Operating system:
- Project A (description only; no absolute path):
- Project B (description only; no absolute path):
- Clean fixture initial status/content hash:
- Clean fixture final status/content hash:

## Success summary

- Threads with at least five coherent turns: 0 / 2
- Diagram-bearing turns: 0 / 6
- First-pass Mermaid render rate: —
- Longest active-diagram lineage: 0 / 4
- Drawing-attached follow-ups: 0 / 3
- Full-screen canvas-first task completed: no
- Prose-only turn: no
- Cancellation/failure preservation run: no
- Repository byte-for-byte unchanged: not measured

## Turn log

| Thread / turn | Prompt category | Attachment / marks | First-pass render | Time | Context continuity | Useful? | Notes |
|---|---|---|---|---:|---|---|---|
| | current diff / staged / last commit / spec / subsystem / feature-bug / drawing / prose | | | | | | |

## Required focused observations

### One evolving diagram

Record at least four versions, parent lineage, whether labels/ids stayed stable, whether **Previous
version** was sufficient, and whether any marks were lost from earlier versions.

### Drawing context

Record pen, box, arrow, text, and an intentionally ambiguous mark. Note what the agent demonstrably
used, what it misunderstood, and whether ambiguity remained visible.

### Conversation hidden

Complete one task primarily in Focus mode. Record agent-status clarity, whether results were
understandable without opening chat, the largest diagram dimensions, pan/zoom readability, and
whether the composer/attachment chip remained clear.

### Failure preservation

Cancel one turn and exercise malformed Mermaid plus missing-session output. Confirm user message,
prior transcript, artifacts, active selection, and per-diagram marks remain present.

### Repository immutability

Compare clean fixture status and a deterministic content hash before and after conversation,
diff-context, drawing, cancellation, and timeout runs. Record the exact comparison commands and
result without pasting repository contents into this file.

## Decision

- Outcome: pending
- Hypotheses supported:
- Hypotheses rejected:
- Changes needed before a production story:
