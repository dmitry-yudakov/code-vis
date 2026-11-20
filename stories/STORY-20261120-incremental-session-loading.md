# Story 152 — Open conversations before their older history downloads

**Status:** Shipped · **Type:** Full-stack · **Depends on:** [Story 128](STORY-20261105-conversation-urls.md), [Story 129](STORY-20261106-workspace-subscriptions.md)

## Motivation

Opening a session over a slow mobile connection is noticeably slower than Arena. Show useful
recent conversation content and let the user reply without transferring sibling transcripts,
older messages, saved tool output, file evidence, or unused canvases. This supports the personal
device conversation journey in [the vision](../docs/vision.md).

## Implementation (where the code is)

- [sessionPaging.ts:1](../src/shared/sessionPaging.ts#L1) owns message-count/UTF-8 transfer budgets,
  explicit previews and stable backward cursors, after canonical sanitization.
- [session route:13](../src/app/api/sessions/[sessionId]/route.ts#L13) serves recent pages, complete
  message details and canvas content; its default GET remains complete. The
  [list route:31](../src/app/api/sessions/route.ts#L31) reuses cached summaries without transcripts.
- [sessionStore.ts:118](../src/features/conversation/sessionStore.ts#L118) merges partial reads with
  loaded/live content, retains deferred canvas identity and refuses partial exports.
- [AppShell.tsx:880](../src/features/shell/AppShell.tsx#L880) loads independent summary lists;
  [line 1029](../src/features/shell/AppShell.tsx#L1029) owns history/detail/canvas reads and complete
  export, while send captures draft/evidence before waiting for deferred canvas data.
- [ConversationDrawer.tsx:142](../src/features/conversation/ConversationDrawer.tsx#L142) loads earlier
  pages/details with inline recovery and stable scroll; nested canonical replies share those controls.
- [sessionPaging.test.ts:1](../test/sessionPaging.test.ts#L1),
  [sessionRoutes.test.ts:156](../test/sessionRoutes.test.ts#L156) and
  [incremental-session.spec.ts:1](../e2e/incremental-session.spec.ts#L1) cover transfer bounds, merging,
  the real read APIs, delayed history, live approvals, evidence, export, device state and mobile use.

## Desired behavior

Use compact summaries for project lists and tabs. Fetch only the selected conversation's recent
messages, with an explicit page/deferred-content contract. Page backward by stable message ids;
fetch full saved message details and canvases only when requested. Recent reads also serve
activation and run recovery. Keep the complete GET API for existing clients, exact delivery
reconciliation and complete exports. The server continues to own the entire canonical history.

Pages have count and UTF-8 byte budgets, including large individual messages: excerpts advertise
their deferred details and can always load the complete saved message. These are transfer limits,
not new storage or provider limits. Metadata remains small and separate from message-page budgets.
Recent pages contain at most 20 messages and 64 KiB of serialized UTF-8 message data, with a
24 KiB per-message preview budget. Metadata/known canvas ids are outside this message budget.
A disjoint recent window after a long absence resets to its own cursor so no intervening history
becomes unreachable. Entering immersive history explicitly loads the selected full transcript,
preserving its existing scrolling controls.
Merge by message id and revision, preserve newer live/optimistic state, ignore abandoned navigation
and out-of-order page reads, and preserve scroll position when prepending. Failed history/details
loads retain the visible conversation, draft and Retry. Deferred canvas ids preserve selection.
Preserve Stories 107/111's chronological delivery, Story 128's URL/draft ownership and archive/Undo
contracts. No partial read can establish that an uncertain send is absent.

## Acceptance criteria

- [x] Session lists and tabs use summaries; opening fetches no sibling transcripts and avoids
      overlapping selected-session hydration/recovery reads.
- [x] Recent messages and the composer work while older history is unavailable; pages have
      bounded bytes/count and explicit deferred details, including oversized messages.
- [x] Earlier messages load on demand with Retry and stable scroll, without losing newer replies
      or allowing a late response to change another destination.
- [x] Saved activity/file details and canvas content load on demand; deferred content preserves
      canvas selection and the complete message remains available.
- [x] Sending, approvals, reconnect, activation, archive/Restore, drafts and complete export retain
      their contracts. Canonical provider context and authoritative delivery checks remain complete.
- [x] Focused unit/browser checks, TypeScript, isolated production build and independent review pass.
      Record actual coverage and any environment limits.

## Out of scope

New persistence, offline transcript storage, provider changes, deployment or restarting the running
application. Closing this work session after committing is a separately requested lifecycle action.

## How to verify

Exercise the real session route projections and browser merge with long transcripts, large saved
activity, file evidence, multibyte text, pagination, and malformed/missing cursors. Hold older-history
and detail responses while verifying recent content, typing, sending and approvals; release pages
after newer live data or navigation. Check phone/desktop in both themes, archive/Undo and complete
export. Use an isolated build and fake providers; measure transferred recent payload versus full
history. Run focused Vitest, Playwright, TypeScript, and independent review before committing.


## Verification — November 20, 2026

- All 125 focused Vitest checks pass across session paging/routes/storage, workspace tabs/views,
  draft acceptance, conversation history and turn activity. Coverage includes UTF-8/JSON-escaping
  budgets, oversized activity metadata, complete export, deferred canvas identity and a disjoint
  refresh after more than one page of new messages.
- The clean full offline suite passes 2,357 of 2,358 checks. Its one failure is the existing
  `visualLanguage` assertion requiring `next/font/google`; the bundled-font implementation and
  assertion are unchanged. The first attempts inherited installation environment settings and
  sandbox restrictions; the reported full result uses default settings and normal test access.
- TypeScript and the isolated production build pass:
  `CODEAI_DIST_DIR=.next-e2e/incremental npm run build`.
- Forty-nine distinct production Chrome cases pass across incremental sessions, conversation URLs,
  participant controls and title-bar tabs. The final build passes all nine incremental journeys
  plus the existing stored-layout/live-approval journey. Earlier mocks now target the explicit
  recent read and summary shapes. Coverage includes a blocked project listing, failed history
  retry with stable scroll, delayed old pages during a successful live approval/reply, nested
  canonical message details, complete export, and draft/evidence ownership while a canvas waits.
- A device spatial-placement regression failed against the preceding build while its canvas
  response was held; it passes after deferred canvas ids participate in spatial reconciliation.
- At 360px, 150 ms latency and 64 KiB/s download throughput, a warm Arena-to-session transition
  became usable in 1.95 seconds. The fixture's uncompressed JSON response is 59,528 bytes for
  recent content versus 326,165 bytes for the complete session, with one selected-session read and
  no sibling-transcript reads. This is a synthetic Chrome network check, not a physical-phone
  benchmark. Both-theme desktop/phone screenshots were inspected.
- Four wider browser assertions remain unchanged-head failures: conversation URL link focus,
  external archive destination, title-tab overflow focus and background-tab archive focus. Each
  reproduces on isolated HEAD `abc2098127bd6add966b2e458b26283317617e7b`; the independent reviewer
  built that archive and ran the original tests separately. The wider 53-case set therefore reports
  49 passed and four existing failures, not a completely passing browser suite.
- Independent source review passes after fixes for oversized activity metadata, disjoint windows,
  nested detail controls, captured send evidence and deferred spatial placements. Whitespace checks
  pass. Canonical storage remains unchanged; the server still validates its complete session JSON
  before projecting a page. Real providers, attached TLS transport and physical devices were not
  rerun. The running application has not been rebuilt or restarted.
