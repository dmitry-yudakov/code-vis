# Cartograph experiment log

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
