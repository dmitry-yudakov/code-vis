# Story 123 — Generate a useful conversation title after the first reply

**Status:** Shipped · **Type:** Full-stack · **Depends on:** [Story 73](STORY-20261003-title-bar-tabs.md)

## Motivation

The first 56 characters of a prompt often name its preamble instead of its subject. Give sessions
recognizable titles in tabs, the conversation header, Arena and Inbox, supporting the vision's
persistent repository conversations without adding a step to sending a message.

## Implementation (where the code is)

- `src/server/conversation/conversationTitle.ts:32` owns independent jobs, model choice, bounded
  context, parsing and fallback. `:15` selects an offered small model and supported effort.
- `src/app/api/agent/message/route.ts:372` launches title work after successful conversation delivery;
  `src/server/conversation/conversationService.ts:294` retains the durable answer-before-event contract.
- `src/server/storage/sessionStore.ts:825` conditionally saves a title under the mutation queue,
  incrementing revision while preserving last activity and concurrent content.
- `src/server/agents/claudeInvocation.ts:14`, `codexInvocation.ts:32`, and
  `codexProcessRunner.ts:1078` restrict title invocation and keep its provider session separate.
- `src/server/execution/dockerProcessRunner.ts:35` omits the repository/customizations mounts;
  `dockerRuntime.ts:396` gives background resources their own lease and recovery identity.
- `src/features/conversation/sessionStore.ts:113` reconciles fresh titles with a disposable revision
  watermark; `src/features/shell/AppShell.tsx:503` refreshes before the next revisioned edit.

## Desired behavior

Keep the existing immediate placeholder. After the first successful complete reply, make one
independent background title request using that provider and execution environment's existing
login. Send only bounded opening-prompt/reply text (4,000 and 6,000 UTF-16 code units respectively),
with instructions to return a concise specific
title in the user's language. Prefer Haiku for Claude and an advertised small/mini model for
Codex; otherwise retain the selected/default Codex model with its lowest advertised effort.

Reuse existing process runners and cleanup, with a server-only title purpose. Use a fresh provider
session and private scratch working directory, Guarded Ask restrictions regardless of the original
mode, no customizations, no repository mount for Docker, no Claude tools, and no Codex shell,
delegation or external integrations. Codex's read-only policy also refuses file mutations. Do not
resume or modify the conversation's provider session. Keep title output out of transcript/activity.
Any unexpected provider tool activity aborts generation. Local Codex's read-only sandbox is not a
filesystem read-isolation boundary; the title path disables its shell and external integrations,
uses no repository context and refuses mutation. Codex has no supported all-built-ins-off switch.

Allow at most two title jobs per machine with no queue; overload retains the placeholder. Each
provider title call has a 30-second deadline and a 1 KiB output bound. Failure, invalid output,
unavailable models, shutdown or lost best-effort work keeps the placeholder, without retries or
backfilling old sessions. A completed response already saved before a restart is never regenerated.
Release normal turn ownership independently of title work. Docker titles use a distinct worker
lease but retain the original participant's legacy login home when applicable.
Confirmed process/container cleanup can outlast the title deadline and retains its background slot.

Save the title through a serialized conditional mutation against the placeholder and first reply
identity, retaining concurrent messages, provider cursors, archive/delete decisions and updatedAt.
Increment the canonical revision, but do not change last-activity/attention ordering. Reconcile
only titles from fresh, newer Arena summaries into loaded sessions; do not claim their other
fields/revisions have been hydrated. Refresh the full record before the next revisioned edit when
the title watermark is newer, without introducing background transcript refetches. Preserve Stories 107/111's durable answer delivery and
Story 85's inactivity clock.

## Acceptance criteria

- [x] The first successful reply starts at most one independent, bounded title request; failed or
      cancelled replies and later successful replies never start one.
- [x] The completed answer and next conversation turn remain usable while title work is pending
      or fails; title text and its provider identity never enter conversation history.
- [x] Claude/Codex title invocations use the existing login with the restricted policy above;
      Docker titles mount no repository, do not share the conversation worker lease, and clean up.
- [x] A valid short title persists without losing concurrent messages or changing updatedAt;
      archived/deleted sessions and titles changed since generation began are not overwritten.
- [x] Tabs, conversation header and Arena reflect a late title without reload, including an
      attached-machine summary, while stale/offline summaries cannot revert it.
- [x] Focused regressions fail before implementation and pass afterward, alongside TypeScript,
      an isolated production build, production-browser delivery and independent review.

## Out of scope

Manual rename UI, periodic retitling, historical backfills, new API credentials, durable title queues,
deployment and restarting the running application.

## How to verify

Run focused title/storage/provider/route checks and `npm run lint`; build into an isolated directory.
In a production browser with fake providers, send a first prompt and verify the placeholder changes
after the reply, the answer remains intact, a second turn works, and reload retains the title.
Record actual checks and any unverified provider/device environments below when complete.

### Verification — November 3, 2026

- All 1,798 offline tests pass with inherited `CODEAI_*` deployment settings removed from the test
  process. Route fixtures that model only foreground turns explicitly stub background inference;
  title lifecycle/model/store/client tests and actual fake-CLI invocation tests cover that path.
- The new provider assertions failed before invocation changes, then passed. Coverage includes
  concurrent messages, unchanged activity time, duplicate/late jobs, overload, timeout, provider
  failure, unexpected tools, invalid output, archived sessions, stale/offline/foreign-machine
  summaries, export filtering, and Docker lease/home/orphan cleanup.
- `npm run lint` and an isolated production build into `.next-e2e` pass. The build needed approved
  network access for existing Google Fonts; user-folder fixture tests needed `/var/tmp` access.
- Both new production-browser checks pass: a second turn during a delayed title, late tab/header
  update, a successful pin after that update, persistence after reload, and failure fallback.
  Five related tab-archive/draft-acceptance/disconnection browser regressions also pass. The existing
  archive/Undo test now checks the displayed title instead of assuming the opening prompt is final.
- Real installed CLI probes generated **Better Titles for Conversations After First Reply** using
  Claude Haiku (3.8 seconds), and **Background Conversation Title Generation** using the advertised
  Codex `gpt-6-luna` at low effort (4.9 seconds). Both disposable sessions retained exactly their
  original two messages. The probe did not inspect credentials or send real conversation histories.
- Independent review found and resolved Docker orphan attribution, stale revisioned edits, export
  filtering and a background full-refetch race. Final source review reports no actionable findings.

Real Docker inference, production attached-machine transport and physical devices were not rerun.
The running app has not been restarted.
