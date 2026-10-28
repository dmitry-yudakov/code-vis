# Story 117 — Show Claude replies once across block snapshots

**Status:** Shipped · **Type:** Server-only · **Depends on:** [Story 107](STORY-20261013-chronological-chat.md)

## Motivation

The conversation titled “Could you show me a close-to-source task and event migra” displays
both Claude answers twice, along with four duplicated progress updates. Its saved activity has
anonymous streamed text at block index 1 and identical completed text at index 0. Only the
completed copy links to the canonical answer. This breaks the conversation change loop in
[the software model](../docs/software-model.md).

## Current behavior (where the code is)

- [claudeProcessRunner.ts:350](../src/server/agents/claudeProcessRunner.ts#L350) tracks a message
  during streaming, but clears that scope on every assistant snapshot. Real Claude emits separate
  thinking and text snapshots for the same message; their arrays each start at zero.
- [turnActivity.ts:239](../src/shared/turnActivity.ts#L239) links final text by provider block identity.
- [sessionStore.ts:225](../src/server/storage/sessionStore.ts#L225) projects durable records for
  desktop, immersive and attached clients without repairing this historical display defect.
- [TurnActivity.tsx:29](../src/features/conversation/TurnActivity.tsx#L29) displays unlinked text
  separately from the canonical answer.

## Desired behavior

Keep Claude's message scope across per-block assistant snapshots and map a single-block snapshot
back to its observed stream index. Preserve independent parent/subagent scopes, multiple text
blocks, final identity, missing-phase behavior and intentional repeated commentary. Keep existing
display bookkeeping bounds; never retain or publish provider thinking or tool JSON as text.
The runner retains at most 1,000 assistant snapshot UUIDs per provider attempt and 1,000 pending
text indexes per parent scope within the existing 1,000-scope bound, discarding the oldest display
bookkeeping on saturation. Snapshot replay is ignored by UUID before changing any message state.

For terminal saved turns, the public-session projection may omit only the known historical pair:
adjacent, complete, untruncated Claude text entries from the same actor and attempt, with identical
text, an anonymous index-1 stream identity followed by a provider-message index-0 snapshot identity.
Neither entry may be a split segment or explicitly phased commentary. Keep the completed entry and
its canonical reference. Leave durable files, canonical messages, revisions and provider prompts
unchanged. Ambiguous or incomplete pairs remain visible.

The affected path is provider → activity → atomic final persistence → public snapshot → existing
renderer/navigation. Story 107's identity-based live reconciliation and Story 111's bounded delivery
remain intact. Permission, execution, cancellation, retention and checkout ownership do not change.

## Acceptance criteria

- [x] Realistic thinking/text/tool block snapshots produce one entry per text block, with stable
      streaming identity and all root final blocks linked to one canonical reply.
- [x] Repeated equal commentary, child-agent text, missing final identity/phase, interleaved tools,
      snapshots after message stop, and existing aggregated snapshots retain their contracts.
- [x] Historical duplicate pairs display once after reload and archive/restore; raw activity,
      canonical content, ordering, revision and unrelated repeated text remain intact.
- [x] Failing-first regressions, focused unit checks, TypeScript, isolated production build and
      production-browser checks pass. A review subagent has no unresolved actionable findings.

## Out of scope

Restarting/deploying the running app, rewriting the live session store, provider permission changes,
and general text deduplication.

## How to verify

Add the per-block sequence observed in the real Claude transcript to the fake provider and assert
the actual runner's projected activity before/after final persistence. Test public projection of
the historical signature and conservative counterexamples, including reload and archive/restore.
Exercise a real fake-provider turn and saved-history rendering in production Chrome. Read the
reported session through the new projection without acquiring its writer lock or modifying it.
Record exact checks, failures before implementation, review and remaining environment gaps below.

## Implementation and verification — October 28, 2026

- The runner keeps message scope across thinking/text/tool snapshots, maps standalone text frames
  to pending stream indexes, retains all final block identities and ignores replayed immutable
  assistant frame UUIDs before they can change another block or message.
- [claudeActivityRepair.ts:17](../src/server/storage/claudeActivityRepair.ts#L17) handles the narrow
  historical signature in `publicSession`; the original stored activity and canonical answers
  are preserved. Identified repetition, explicit commentary, other actors/providers/attempts,
  split/truncated/unfinished blocks and intervening tools remain untouched.
- Four initial regressions failed before implementation: three realistic provider sequences and
  historical public projection. Review identified replay after a later block/message as another
  failure; its added regression failed before the UUID guard and passes afterward. Mixed
  per-block/aggregate snapshots also pass. The review subagent's rereview found no unresolved
  actionable issues and confirmed its original reproduction now renders the progress update once.
- **114 unit checks in nine files pass:** `claudeProcessRunner`, `claudeActivityRepair`,
  `turnActivity`, `turnHistoryStore`, `turnHistoryConversation`, `turnHistoryStream`,
  `messageNavigation`, `chronologicalUi` and `runPresentation`. These include archive/restore,
  restart, atomic final persistence, approvals, retention and slow-consumer regressions.
- `npm run lint` passes. The final isolated production build, including TypeScript, passes:
  `CODEAI_DIST_DIR=.next-e2e npm run build`.
- **Three production Chrome cases pass:**
  `CODEAI_DIST_DIR=.next-e2e npx playwright test e2e/chronological-chat.spec.ts -g 'Claude|large activity bursts'`.
  They cover a real fake-provider turn through stream/final delivery/reload, historical duplicate
  projection while preserving intentional repeated commentary and raw disk bytes, and the
  existing large-history burst through approval, final persistence and reload. The initial sandbox
  attempt could not access loopback; the approved run with local server/Chrome access passed.
- A read-only projection of the reported session changes its Claude activity text-entry counts
  from **10 to 5** and **2 to 1**, with its Codex turn unchanged at four entries. Byte comparison
  confirms the original session file is unchanged.

No live provider turn, Docker/attached transport or physical headset check was run. This is a
shared server projection and parser change with no UI geometry changes. The owner's running app
was not restarted or deployed; these fixes take effect when the updated server is run.
